// Proxies Yahoo Finance's symbol search so the browser can look up tickers
// without hitting CORS. Returns a trimmed list of { symbol, name, type, exchange }.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let query = '';
  try {
    const body = await req.json();
    query = (body?.query ?? '').trim();
  } catch { /* ignore */ }

  if (!query) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ results: [], error: `upstream ${res.status}` }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const json = await res.json();
    const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
    const results = quotes
      .filter((q: any) => q?.symbol && q?.quoteType !== 'OPTION')
      .map((q: any) => ({
        symbol: q.symbol as string,
        name: (q.shortname || q.longname || q.symbol) as string,
        type: q.quoteType as string,        // EQUITY | ETF | CRYPTOCURRENCY | INDEX | …
        exchange: (q.exchDisp || q.exchange || '') as string,
      }));
    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ results: [], error: String(err) }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
