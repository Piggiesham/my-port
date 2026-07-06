// Pure portfolio-structure math. No React, no imports — unit-testable via
// strategy.selfcheck.mjs. All amounts are USD (convert at render).

// Preset structures used to seed the Workbench.
export const ALLOCATION_TEMPLATES = [
  { id: '60-40', name: 'Classic 60/40', buckets: [
    { id: 'equity', name: 'Equity', target: 60 },
    { id: 'bonds',  name: 'Bonds',  target: 40 },
  ] },
  { id: 'three-fund', name: 'Three-Fund', buckets: [
    { id: 'us',    name: 'US Equity',   target: 50 },
    { id: 'intl',  name: 'Intl Equity', target: 30 },
    { id: 'bonds', name: 'Bonds',       target: 20 },
  ] },
  { id: 'all-weather', name: 'All-Weather', buckets: [
    { id: 'stocks',  name: 'Stocks',        target: 30 },
    { id: 'longbd',  name: 'Long Bonds',    target: 40 },
    { id: 'midbd',   name: 'Interm Bonds',  target: 15 },
    { id: 'gold',    name: 'Gold',          target: 7.5 },
    { id: 'commod',  name: 'Commodities',   target: 7.5 },
  ] },
];

// Sum holdingUSD across brokerages for each ticker.
export function aggregateByTicker(assets = []) {
  const map = new Map();
  for (const a of assets) {
    if (!a || !a.ticker) continue;
    map.set(a.ticker, (map.get(a.ticker) || 0) + (Number(a.holdingUSD) || 0));
  }
  return map;
}

// Tickers with a live balance that have no bucket assignment.
export function findUnassigned(assets, assignments = {}) {
  const out = [];
  for (const [ticker, usd] of aggregateByTicker(assets)) {
    if (usd > 0 && !assignments[ticker]) out.push(ticker);
  }
  return out;
}

// The single entry the page needs.
export function computeStrategy(assets, plan) {
  const buckets = plan?.buckets || [];
  const assignments = plan?.assignments || {};
  const byTicker = aggregateByTicker(assets);

  const usdByBucket = new Map(buckets.map(b => [b.id, 0]));
  const unassignedTickers = [];
  let unassignedUsd = 0;
  let total = 0;

  for (const [ticker, usd] of byTicker) {
    if (usd <= 0) continue;               // closed positions need no bucket
    total += usd;
    const bid = assignments[ticker];
    if (bid && usdByBucket.has(bid)) {
      usdByBucket.set(bid, usdByBucket.get(bid) + usd);
    } else {
      unassignedUsd += usd;
      unassignedTickers.push(ticker);
    }
  }
  const denom = total || 1;

  const rows = buckets.map(b => {
    const holdingUSD = usdByBucket.get(b.id) || 0;
    const actualPct = (holdingUSD / denom) * 100;
    const drift = b.target - actualPct;
    return { id: b.id, name: b.name, target: b.target, actualPct, holdingUSD, drift, tradeUSD: (drift / 100) * total };
  });

  if (unassignedUsd > 0) {
    const actualPct = (unassignedUsd / denom) * 100;
    rows.push({ id: 'unassigned', name: 'Unassigned', target: 0, actualPct, holdingUSD: unassignedUsd, drift: -actualPct, tradeUSD: (-actualPct / 100) * total });
  }

  // Turnover measure: fraction of the portfolio that must move to reach target.
  const totalDriftPct = rows.reduce((s, r) => s + Math.abs(r.drift), 0) / 2;
  return { total, rows, unassignedTickers, totalDriftPct };
}
