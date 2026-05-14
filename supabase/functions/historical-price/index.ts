// Returns the Yahoo Finance closing price for a given ticker on a given date.
// Body: { ticker: string, date: string (YYYY-MM-DD) }
// Response: { price: number | null }

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let ticker = '';
  let date = '';
  try {
    const body = await req.json();
    ticker = String(body?.ticker ?? '').toUpperCase().trim();
    date = String(body?.date ?? '').trim();
  } catch { /* ignore */ }

  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ price: null, error: 'ticker and YYYY-MM-DD date required' }, 400);
  }

  if (ticker === 'USD') return json({ price: 1 });

  const yahooTicker = YAHOO_OVERRIDE[ticker] ?? ticker;
  // Pull a 7-day window around the requested date so weekends / holidays still
  // resolve to the nearest trading-day close. We pick the close <= target.
  const target = new Date(`${date}T00:00:00Z`).getTime() / 1000;
  const period1 = target - 3 * 86400;
  const period2 = target + 4 * 86400;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?period1=${Math.floor(period1)}&period2=${Math.floor(period2)}&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return json({ price: null, error: `upstream ${res.status}` });
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    if (!timestamps.length || !closes.length) return json({ price: null });

    // Find the latest trading day at or before the target.
    let chosen: number | null = null;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] <= target + 86400 && typeof closes[i] === 'number') {
        chosen = closes[i] as number;
      }
    }
    if (chosen == null) {
      // Fall back to first available close in the window
      const firstClose = closes.find((c) => typeof c === 'number');
      chosen = (firstClose as number | undefined) ?? null;
    }

    let price = chosen;
    if (price != null && ticker === 'THB') price = 1 / price;
    return json({ price });
  } catch (err) {
    return json({ price: null, error: String(err) });
  }
});
