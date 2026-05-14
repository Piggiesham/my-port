// Fetches daily closing prices for a ticker over [from, to] from Yahoo Finance
// and upserts them into the `price_history` table so subsequent requests are
// served from cache by the client.
//
// Body: { ticker: string, from: string (YYYY-MM-DD), to: string (YYYY-MM-DD) }
// Response: { prices: [{ date: 'YYYY-MM-DD', price: number }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const YAHOO_OVERRIDE: Record<string, string> = {
  BTC:  'BTC-USD',
  ETH:  'ETH-USD',
  USTB: 'BIL',
  THB:  'THB=X',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function ymd(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let ticker = '';
  let from = '';
  let to = '';
  try {
    const body = await req.json();
    ticker = String(body?.ticker ?? '').toUpperCase().trim();
    from = String(body?.from ?? '').trim();
    to = String(body?.to ?? '').trim();
  } catch { /* ignore */ }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!ticker || !dateRe.test(from) || !dateRe.test(to)) {
    return json({ prices: [], error: 'ticker, from, to (YYYY-MM-DD) required' }, 400);
  }

  // USD is always 1.0 — emit a synthetic point per day; the client iterates
  // by date anyway, so a single anchor is enough.
  if (ticker === 'USD') {
    return json({ prices: [{ date: from, price: 1 }, { date: to, price: 1 }] });
  }

  const yahooTicker = YAHOO_OVERRIDE[ticker] ?? ticker;
  const period1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000) - 3 * 86400;
  const period2 = Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000) + 86400;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?period1=${period1}&period2=${period2}&interval=1d`;

  let prices: { date: string; price: number }[] = [];
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return json({ prices: [], error: `upstream ${res.status}` });
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];

    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c !== 'number') continue;
      const price = ticker === 'THB' ? 1 / c : c;
      prices.push({ date: ymd(timestamps[i]), price });
    }
  } catch (err) {
    return json({ prices: [], error: String(err) });
  }

  // Persist to cache. Failure to upsert is non-fatal — we still return the
  // freshly-fetched prices so the client can render this turn.
  if (prices.length > 0) {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);
    const rows = prices.map(p => ({ ticker, date: p.date, price_usd: p.price }));
    const { error } = await supabase.from('price_history').upsert(rows, { onConflict: 'ticker,date' });
    if (error) console.warn('[historical-price-range] upsert failed', error.message);
  }

  return json({ prices });
});
