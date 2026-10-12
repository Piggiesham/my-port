// Parses a transaction-history image into structured rows using a vision LLM.
//
// Supports two providers via env switch:
//   LLM_PROVIDER=gemini  (default) — uses gemini-2.5-flash (250 req/day free)
//   LLM_PROVIDER=groq              — uses Qwen vision via Groq (~7000 req/day free)
//
// Required secrets (set whichever provider you use):
//   supabase secrets set GEMINI_API_KEY=...   (https://aistudio.google.com/apikey)
//   supabase secrets set GROQ_API_KEY=...     (https://console.groq.com/keys)
//
// Optional overrides:
//   supabase secrets set GEMINI_MODEL=gemini-2.5-flash
//   supabase secrets set GROQ_MODEL=qwen/qwen3.8-27b
//   supabase secrets set LLM_PROVIDER=groq
//
// NOTE: Groq deprecates vision models periodically (see
// https://console.groq.com/docs/deprecations). meta-llama/llama-4-scout-17b-16e-instruct
// was retired 2026-06-17; this defaults to qwen/qwen3.8-27b (multimodal) now.
// When Groq errors (other than a 429) the function now retries the image on
// Gemini automatically, so a retired model degrades instead of blocking.
// Still worth fixing: if imports start 404ing with "model ... does not exist", check that page
// and update GROQ_MODEL (code default below, and the live secret if it was
// set explicitly — secrets override the code default).
//
// Accepts either multipart/form-data (preferred):
//   image: File, mimeType: string (optional), bucket: 'security' | 'bond' | 'cash'
// Or legacy JSON:
//   { imageBase64: string, mimeType: string, bucket: 'security' | ... }
//
// Response: { rows: Array<TradeRow | CashRow>, skipped: number }
//          | { error: string, retryAfterMs?: number }
//   TradeRow: { action:'Buy'|'Sell', ticker, qty, executedPrice, currency, executedAt }
//   CashRow:  { action:'Dividend'|'Fee'|'Tax', ticker, value, currency:'USD', executedAt, label }
//
// Always returns HTTP 200 — error info goes in body.error so supabase-js's
// non-2xx wrapper doesn't swallow the real message.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, range, x-supabase-api-version',
  'Access-Control-Max-Age': '86400',
};

const PROVIDER = (Deno.env.get('LLM_PROVIDER') || 'gemini').toLowerCase();
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
const GROQ_MODEL   = Deno.env.get('GROQ_MODEL')   || 'qwen/qwen3.8-27b';

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const PROMPT_DIME = `You are extracting transactions from a screenshot of the Dime! brokerage Activity screen.

Extract these row types: Buy, Sell, Dividend, Dividend Withholding Tax, and broker fees (TAF Fee, SEC Fee). SKIP any row labelled "Cancelled" or "Expired" — those never executed. Skip month-header rows like "February 2025".

Classify each row by its left-hand label:
- "Buy <TICKER>"  → action "Buy"
- "Sell <TICKER>" → action "Sell"
- "Dividend <TICKER>"  (but NOT "Dividend Withholding Tax") → action "Dividend"
- "Dividend Withholding Tax <TICKER>" → action "Tax"
- "TAF Fee" / "SEC Fee" → action "Fee"

For Buy/Sell rows, return:
{
  "action": "Buy" | "Sell",
  "ticker": "<symbol next to Buy/Sell, uppercase>",
  "qty": <number from the "Shares" line>,
  "executedPrice": <number from "Executed Price" — USD per share, ALWAYS>,
  "currency": "USD",
  "executedAt": "<ISO 8601 with Z>"
}

For Dividend / Tax / Fee rows, return:
{
  "action": "Dividend" | "Tax" | "Fee",
  "ticker": "<see ticker rule>",
  "value": <the USD amount shown, as a POSITIVE number, ignoring any +/- sign>,
  "currency": "USD",
  "executedAt": "<ISO 8601 with Z>",
  "label": "<the exact row label, e.g. \\"TAF Fee\\", \\"SEC Fee\\", \\"Dividend\\", \\"Dividend Withholding Tax\\">"
}

Ticker rule for cash rows:
- Dividend and Tax: ticker = the security symbol in the label ("Dividend VOO" → "VOO"; "Dividend Withholding Tax VOO" → "VOO").
- Fee (TAF/SEC): ticker = "USD" (a fee is deducted from USD cash; there is no security).

Critical Dime! format rules:
- Buy/Sell: the right side shows a total like "999.86 THB" or "50.00 USD". IGNORE this total. "Executed Price" (e.g. "538.44") is ALWAYS USD per share, even when the total is THB — output it as-is. "currency" is ALWAYS "USD". "qty" comes from the "Shares" line.
- Cash rows: "value" is the USD number on the right, as a POSITIVE magnitude. Dividends post positive ("Deposit to Dime! USD"); Tax and Fee post negative ("Deduct from Dime! USD") — still output the positive magnitude; the system knows Tax/Fee are outflows.
- SKIP rows displaying "Cancelled" or "Expired".
- Dates are shown in Asia/Bangkok. Output them EXACTLY as shown, ISO 8601 with a Z suffix, WITHOUT converting time zones. Convert 12-hour clock to 24-hour: AM keeps the hour (12 AM → 00), PM adds 12 to hours 1-11 (12 PM stays 12). Examples: "28 Feb 2025 - 03:17:45 AM" → "2025-02-28T03:17:45Z". "28 Feb 2025 - 11:44:10 PM" → "2025-02-28T23:44:10Z".
- Month headers (e.g. "February 2025") set the year/month context for rows below until the next header.
- If a field is unreadable, set it to null. Do not invent values.

Return ONLY a valid JSON array. No markdown fences, no commentary.`;

const PROMPT_WEBULL = `You are extracting transactions from a Webull (Thailand) Monthly Account Statement PDF.

Extract rows from these sections ONLY (skip NET ACCOUNT VALUE, CASH REPORT SUMMARY, PORTFOLIO SUMMARY, NOTES):

1. TRADE RECORDS → one object per trade:
{
  "action": "Buy" | "Sell",
  "ticker": "<Symbol, uppercase>",
  "qty": <Quantity>,
  "executedPrice": <Traded Price>,
  "fees": <absolute value of Comm/Fee/Tax, e.g. -0.18 → 0.18; 0 if blank>,
  "taxes": <absolute value of VAT; 0 if blank>,
  "currency": "USD",
  "executedAt": "<from Trade Date + Time, ISO 8601. Time column is GMT+07 — output with +07:00 offset, e.g. 22/06/2026 23:42:48 → \\"2026-06-22T23:42:48+07:00\\">"
}

2. DIVIDENDS → TWO objects per row (dates are DD/MM/YYYY):
   { "action": "Dividend", "ticker": "<symbol from the description, e.g. META PLATFORMS INC → META>", "value": <Gross Amount>, "currency": "USD", "executedAt": "<Posting Date>T12:00:00+07:00", "label": "<the description text>" }
   and, when Withholding Tax is non-zero:
   { "action": "Tax", "ticker": "<same symbol>", "value": <absolute value of Withholding Tax>, "currency": "USD", "executedAt": "<Posting Date>T12:00:00+07:00", "label": "Dividend withholding tax" }

3. INTEREST → { "action": "Dividend", "ticker": "USD", "value": <Amount>, "currency": "USD", "executedAt": "<Date>T12:00:00+07:00", "label": "<description, e.g. Credit Interest 05/01/2026 to 05/31/2026>" }
   INTEREST WHT → { "action": "Tax", "ticker": "USD", "value": <absolute Amount>, "currency": "USD", "executedAt": "<Date>T12:00:00+07:00", "label": "<description>" }

4. CURRENCY EXCHANGE RECORDS (THB → USD) → the account's real funding events:
   { "action": "Deposit", "value": <Converted Amount in USD>, "fxRate": <Converted Rate, THB per USD>, "currency": "USD", "executedAt": "<Date + Time with +07:00 offset>" }
   Skip the DEPOSIT & WITHDRAWAL RECORDS THB rows — the exchange row is the one that matters.

Rules:
- Dates in this statement are DD/MM/YYYY. 02/06/2026 means 2 June 2026.
- Amounts: strip thousands separators; output plain numbers.
- If a field is unreadable, set it to null. Do not invent values.

Return ONLY a valid JSON array. No markdown fences, no commentary.`;

const PROMPT_SECURITY = `You are extracting transactions from a screenshot of a brokerage transaction list.

ONLY extract rows whose action is "Buy" or "Sell". Skip every other row type — fees (TAF Fee, SEC Fee, ECN Fee, etc.), dividends, dividend withholding tax, deposits, withdrawals, transfers. Skip month-header rows like "December 2024".

For each Buy/Sell row, return one object:
{
  "action": "Buy" | "Sell",
  "ticker": "<symbol shown next to Buy/Sell, uppercase>",
  "qty": <number of shares>,
  "executedPrice": <price per share as a number>,
  "currency": "USD" | "THB",
  "executedAt": "<ISO 8601 in UTC>"
}

Rules:
- The right-hand side shows either a total like "60.00 USD" / "4,999.85 THB" OR a share count like "1 Shares". When it shows a share count, qty equals that number and currency comes from the executed-price context (default USD if no currency shown). When it shows a total, qty comes from the "Shares" row below and currency comes from that total.
- "Executed Price" is the per-share price.
- Dates are shown in Asia/Bangkok. Output them EXACTLY as shown, in ISO 8601 with a Z suffix, WITHOUT converting time zones. Convert 12-hour clock to 24-hour: AM keeps the hour (12 AM → 00), PM adds 12 to hours 1-11 (12 PM stays 12). Examples: "28 Jan 2025 - 07:27:51 AM" → "2025-01-28T07:27:51Z". "28 Jan 2025 - 11:44:10 PM" → "2025-01-28T23:44:10Z".
- Month headers (e.g. "December 2024", "November 2024") set the year/month context for the rows under them until a new header appears.
- If a field is unreadable, set it to null. Do not invent values.

Return ONLY a valid JSON array. No markdown fences, no commentary.`;

// ---------------------------------------------------------------------------
// Provider: Gemini
// ---------------------------------------------------------------------------
async function callGemini(imageBase64: string, mimeType: string, prompt: string) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return { error: 'GEMINI_API_KEY not set. Run: supabase secrets set GEMINI_API_KEY=<key>' };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const reqBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) {
      let retryAfterMs = 10000;
      try {
        const parsed = JSON.parse(txt);
        const details = parsed?.error?.details ?? [];
        const retryInfo = details.find((d: { '@type'?: string }) =>
          d['@type']?.includes('RetryInfo')
        );
        const m = retryInfo?.retryDelay?.match?.(/^([\d.]+)s$/);
        if (m) retryAfterMs = Math.ceil(parseFloat(m[1]) * 1000) + 500;
      } catch { /* keep default */ }
      return { error: 'rate_limited', retryAfterMs, model: GEMINI_MODEL, raw: txt.slice(0, 1500) };
    }
    return { error: `gemini ${res.status}: ${txt.slice(0, 500)}` };
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { text };
}

// ---------------------------------------------------------------------------
// Provider: Groq (Qwen vision, OpenAI-compatible API)
// ---------------------------------------------------------------------------
async function callGroq(imageBase64: string, mimeType: string, prompt: string) {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) return { error: 'GROQ_API_KEY not set. Run: supabase secrets set GROQ_API_KEY=<key>' };

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const reqBody = {
    model: GROQ_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        // Groq's Llama vision expects the JSON-array-only prompt wrapped in
        // an object request, since response_format=json_object needs the
        // top-level reply to be an object. We ask for { rows: [...] }.
        { type: 'text', text: prompt + '\n\nWrap the array under a key "rows", like {"rows":[...]}' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ],
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) {
      const retryHeader = res.headers.get('retry-after');
      const retryAfterMs = retryHeader ? Math.ceil(parseFloat(retryHeader) * 1000) + 500 : 10000;
      return { error: 'rate_limited', retryAfterMs, model: GROQ_MODEL, raw: txt.slice(0, 1500) };
    }
    return { error: `groq ${res.status}: ${txt.slice(0, 500)}` };
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return { text };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    let imageBase64 = '';
    let mimeType = 'image/jpeg';
    let bucket = 'security';
    let brokerage = '';
    const contentType = req.headers.get('content-type') || '';

    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('image') as File | null;
        if (!file) return json({ error: 'image field missing' });
        mimeType = (form.get('mimeType') as string) || file.type || 'image/jpeg';
        bucket = ((form.get('bucket') as string) || 'security').toLowerCase();
        brokerage = (form.get('brokerage') as string) || '';
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < buf.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)));
        }
        imageBase64 = btoa(binary);
      } else {
        const body = await req.json();
        imageBase64 = String(body?.imageBase64 ?? '');
        mimeType = String(body?.mimeType ?? 'image/jpeg');
        bucket = String(body?.bucket ?? 'security').toLowerCase();
        brokerage = String(body?.brokerage ?? '');
      }
    } catch (err) {
      return json({ error: `invalid body: ${(err as Error).message}` });
    }

    if (!imageBase64) return json({ error: 'image data required' });
    if (bucket !== 'security') return json({ error: `bucket "${bucket}" not supported yet` });

    // Brokerage-specific prompt. Dime!'s "Executed Price" is always USD/share
    // even when the total amount is in THB, so it needs its own instructions.
    // Webull uploads are monthly statement PDFs, not screenshots.
    const prompt = brokerage === 'Dime!' ? PROMPT_DIME
      : brokerage === 'Webull' ? PROMPT_WEBULL
      : PROMPT_SECURITY;

    // Route to the configured provider. PDFs always go to Gemini — Groq's
    // Llama vision endpoint only accepts images ("invalid image data").
    const isPdf = mimeType === 'application/pdf';
    let result = (PROVIDER === 'groq' && !isPdf)
      ? await callGroq(imageBase64, mimeType, prompt)
      : await callGemini(imageBase64, mimeType, prompt);

    // Groq retires vision models every few weeks ("model ... does not exist").
    // Rather than block the import, retry the same image on Gemini. 429s are
    // left to the client's retry-after loop, so they don't burn Gemini quota.
    let fellBackFrom: string | null = null;
    if (PROVIDER === 'groq' && !isPdf && 'error' in result
        && result.error !== 'rate_limited' && Deno.env.get('GEMINI_API_KEY')) {
      console.warn('[parse] groq failed, falling back to gemini:', String(result.error).slice(0, 200));
      fellBackFrom = String(result.error).slice(0, 200);
      result = await callGemini(imageBase64, mimeType, prompt);
    }
    if ('error' in result) {
      return json(fellBackFrom
        ? { ...result, error: `${result.error} (after groq failed: ${fellBackFrom})` }
        : result);
    }

    const text = result.text || '';
    if (!text) return json({ rows: [], skipped: 0 });

    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); } catch (e) {
      return json({ error: `parse error: ${(e as Error).message}`, raw: cleaned.slice(0, 300) });
    }

    // Gemini returns a JSON array directly; Groq returns { rows: [...] }
    // because response_format=json_object requires a top-level object.
    let rows: unknown;
    if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).rows)) {
      rows = (parsed as Record<string, unknown>).rows;
    } else {
      return json({ error: 'response was not an array', raw: cleaned.slice(0, 300) });
    }

    const isTrade = (r: Record<string, unknown>) =>
      (r.action === 'Buy' || r.action === 'Sell') &&
      typeof r.ticker === 'string' && r.ticker.length > 0 &&
      typeof r.qty === 'number' && isFinite(r.qty) && r.qty > 0 &&
      typeof r.executedPrice === 'number' && isFinite(r.executedPrice) &&
      (r.currency === 'USD' || r.currency === 'THB') &&
      typeof r.executedAt === 'string' && r.executedAt.length > 0;

    // Dividend / Fee / Tax — cash rows carry a USD `value` instead of qty/price.
    const isCashRow = (r: Record<string, unknown>) =>
      (r.action === 'Dividend' || r.action === 'Fee' || r.action === 'Tax') &&
      typeof r.ticker === 'string' && r.ticker.length > 0 &&
      typeof r.value === 'number' && isFinite(r.value) && r.value > 0 &&
      typeof r.executedAt === 'string' && r.executedAt.length > 0;

    // Deposit — a THB→USD funding exchange from a Webull statement.
    const isDeposit = (r: Record<string, unknown>) =>
      r.action === 'Deposit' &&
      typeof r.value === 'number' && isFinite(r.value) && r.value > 0 &&
      typeof r.executedAt === 'string' && r.executedAt.length > 0;

    const valid = (rows as Array<Record<string, unknown>>).filter(r => isTrade(r) || isCashRow(r) || isDeposit(r));

    return json({
      rows: valid,
      skipped: (rows as unknown[]).length - valid.length,
      ...(fellBackFrom ? { provider: 'gemini', fallbackFrom: 'groq', fallbackReason: fellBackFrom } : {}),
    });
  } catch (err) {
    return json({ error: `function crash: ${(err as Error).message}` });
  }
});
