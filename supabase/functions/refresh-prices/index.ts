import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Special-cased Yahoo symbol overrides. For everything else we use the ticker
// itself, which is correct for US equities and ETFs on Yahoo.
const YAHOO_OVERRIDE: Record<string, string> = {
  BTC:  'BTC-USD',
  ETH:  'ETH-USD',
  USTB: 'BIL',     // SPDR Bloomberg 1-3 Month T-Bill ETF (closest to 3-mo T-bill)
  THB:  'THB=X',   // USD/THB — Yahoo gives THB-per-USD; we store USD-per-THB (inverted)
};

// Tickers we never fetch — USD is always 1.0; pure cash entries other than THB
// are handled separately.
const SKIP = new Set(['USD']);

async function fetchYahooPrice(yahooTicker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?interval=1d&range=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

Deno.serve(async (_req) => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRoleKey,
  );

  // Pull the live ticker universe from the assets table. Cash entries other
  // than THB are skipped (we don't have a real FX price for them).
  const { data: assetRows, error: assetErr } = await supabase
    .from('assets')
    .select('ticker, is_cash');
  if (assetErr) {
    return new Response(JSON.stringify({ error: assetErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tickers = (assetRows ?? [])
    .map(r => r.ticker as string)
    .filter(t => !SKIP.has(t))
    .filter(t => {
      const row = (assetRows ?? []).find(r => r.ticker === t);
      // Skip cash assets unless we have a known FX override (THB).
      return !row?.is_cash || YAHOO_OVERRIDE[t];
    });

  const results: Record<string, number | null> = {};
  const upserts: { ticker: string; price_usd: number; updated_at: string }[] = [];

  const batchSize = 4;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (ourTicker) => {
      const yahooTicker = YAHOO_OVERRIDE[ourTicker] ?? ourTicker;
      let price = await fetchYahooPrice(yahooTicker);
      if (price !== null) {
        if (ourTicker === 'THB') price = 1 / price;
        results[ourTicker] = price;
        upserts.push({
          ticker: ourTicker,
          price_usd: price,
          updated_at: new Date().toISOString(),
        });
      } else {
        results[ourTicker] = null;
      }
    }));
    if (i + batchSize < tickers.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // USD is always 1.0
  upserts.push({ ticker: 'USD', price_usd: 1.0, updated_at: new Date().toISOString() });

  const { error } = await supabase.from('prices').upsert(upserts, { onConflict: 'ticker' });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mirror today's prices into price_history so the historical series
  // grows forward each day without re-fetching from Yahoo. USD is
  // implicitly 1.0 and not stored in price_history.
  const today = new Date().toISOString().slice(0, 10);
  const historyRows = upserts
    .filter(u => u.ticker !== 'USD')
    .map(u => ({ ticker: u.ticker, date: today, price_usd: u.price_usd }));
  if (historyRows.length > 0) {
    const { error: phErr } = await supabase
      .from('price_history')
      .upsert(historyRows, { onConflict: 'ticker,date' });
    if (phErr) console.warn('[refresh-prices] price_history upsert failed', phErr.message);
  }

  await supabase.rpc('take_daily_snapshot');

  return new Response(
    JSON.stringify({ success: true, updated: upserts.length, prices: results }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
