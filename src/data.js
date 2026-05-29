// Mock portfolio data — used as a fallback when Supabase isn't configured.
// When the Supabase env vars are present (see src/lib/supabase.js), real data
// is fetched in App.jsx and replaces this.

// FX_RATE is the live USD→THB exchange rate. The seeded value is a fallback
// for local dev (no Supabase) and the first paint before fetchFxRate() resolves.
// Mutable: setFxRate() updates the binding in-place; all consumers reading
// `FX_RATE` via an ESM import will observe the new value on next render.
export let FX_RATE = 32.27;
export function setFxRate(v) {
  if (typeof v === 'number' && isFinite(v) && v > 0) FX_RATE = v;
}

export const SOURCES = {
  'Dime!':   { color: '#6EF5A4', dot: '#3fbe72' },
  'Webull':  { color: '#3b82f6', dot: '#1d4ed8' },
  'Binance': { color: '#f0b90b', dot: '#b8860b' },
};
export const PORTFOLIOS = ['All', 'Dime!', 'Webull', 'Binance'];
export const PORTFOLIO_TYPES = {
  'Dime!':   ['Security', 'Bond', 'Cash'],
  'Webull':  ['Security', 'Bond', 'Cash'],
  'Binance': ['Crypto', 'Cash'],
};

const ASSETS_RAW = [
  { ticker: 'VOO',  name: 'Vanguard S&P 500', type: 'ETF',       source: 'Dime!',   logo: { bg: '#9c1b1b', text: 'V' },  price: 528.42,  qty: 1.811,  cost: 448.85,  holdingUSD: 956.71,  pctProfit: 17.86, plUSD: 144.95 },
  { ticker: 'AMZN', name: 'Amazon.com Inc',   type: 'Stock',     source: 'Webull',  logo: { bg: '#0f0f10', text: 'a' },  price: 198.74,  qty: 3.044,  cost: 168.55,  holdingUSD: 604.99,  pctProfit: 17.91, plUSD: 91.91 },
  { ticker: 'GOOGL',name: 'Alphabet Inc',     type: 'Stock',     source: 'Webull',  logo: { bg: '#1a73e8', text: 'G' },  price: 178.21,  qty: 2.259,  cost: 73.94,   holdingUSD: 402.62,  pctProfit: 140.74, plUSD: 235.38 },
  { ticker: 'TSM',  name: 'Taiwan Semicond.', type: 'Stock',     source: 'Webull',  logo: { bg: '#cc0000', text: 'tsm', small: true }, price: 195.18, qty: 2.010, cost: 95.54, holdingUSD: 392.26, pctProfit: 104.29, plUSD: 200.25 },
  { ticker: 'PM',   name: 'Philip Morris',    type: 'Stock',     source: 'Dime!',   logo: { bg: '#2a8bc3', text: 'PM' }, price: 134.07,  qty: 2.231,  cost: 117.57,  holdingUSD: 299.16,  pctProfit: 14.01, plUSD: 36.76 },
  { ticker: 'VSAT', name: 'Viasat Inc',       type: 'Stock',     source: 'Webull',  logo: { bg: '#ffffff', text: 'M', dark: true }, price: 31.45, qty: 9.498, cost: 13.46, holdingUSD: 298.70, pctProfit: 133.69, plUSD: 170.88 },
  { ticker: 'BTC',  name: 'Bitcoin',          type: 'Crypto',    source: 'Binance', logo: { bg: '#f7931a', text: '₿' },  price: 67842.10, qty: 0.0038, cost: 41200.00, holdingUSD: 257.80, pctProfit: 64.66, plUSD: 101.24 },
  { ticker: 'ETH',  name: 'Ethereum',         type: 'Crypto',    source: 'Binance', logo: { bg: '#627eea', text: 'Ξ' },  price: 3215.40,  qty: 0.061,  cost: 2410.00, holdingUSD: 196.40,  pctProfit: 33.42, plUSD: 49.18 },
  { ticker: 'GLD',  name: 'SPDR Gold Shares', type: 'Commodity', source: 'Webull',  logo: { bg: '#d4af37', text: 'Au' }, price: 242.10,  qty: 0.682,  cost: 195.20,  holdingUSD: 165.11,  pctProfit: 24.02, plUSD: 31.97 },
  { ticker: 'USTB', name: 'US 3-Mo T-Bill',   type: 'Bond',      source: 'Webull',  logo: { bg: '#1e293b', text: 'T' },  price: 99.78,   qty: 1.323,  cost: 98.50,   holdingUSD: 132.05,  pctProfit: 1.30, plUSD: 1.70 },
  { ticker: 'USD',  name: 'US Dollar Cash',   type: 'Cash',      source: 'Webull',  logo: { bg: '#16a34a', text: '$' },  price: 1.00,    qty: 250.00, cost: 1.00,    holdingUSD: 250.00,  pctProfit: 0, plUSD: 0, isCash: true },
  { ticker: 'THB',  name: 'Thai Baht Cash',   type: 'Cash',      source: 'Dime!',   logo: { bg: '#dc2626', text: '฿' },  price: 1/FX_RATE, qty: 8000.00, cost: 1/FX_RATE, holdingUSD: 247.91, pctProfit: 0, plUSD: 0, isCash: true },
];

const TOTAL_NOW = ASSETS_RAW.reduce((s, a) => s + a.holdingUSD, 0);
const TOTAL_COST = ASSETS_RAW.reduce((s, a) => s + a.qty * a.cost, 0);
export const ASSETS = ASSETS_RAW.map(a => ({ ...a, alloc: (a.holdingUSD / TOTAL_NOW) * 100 }));
export { TOTAL_NOW, TOTAL_COST };

export function filterByPortfolio(portfolio) {
  if (portfolio === 'All') return ASSETS;
  const filtered = ASSETS_RAW.filter(a => a.source === portfolio);
  const total = filtered.reduce((s, a) => s + a.holdingUSD, 0) || 1;
  return filtered.map(a => ({ ...a, alloc: (a.holdingUSD / total) * 100 }));
}

export function totalsFor(assets) {
  const now = assets.reduce((s, a) => s + a.holdingUSD, 0);
  const cost = assets.reduce((s, a) => s + a.qty * a.cost, 0);
  return { now, cost };
}

export const CATEGORIES = ['By Asset Type', 'By Individual Asset', 'By Sector', 'By Currency', 'By Source'];

export const PALETTE = ['#7dd3fc', '#a78bfa', '#f472b6', '#fbbf24', '#4ade80', '#fb7185', '#22d3ee', '#facc15', '#c4b5fd', '#f97316', '#34d399', '#e879f9'];

const SECTOR_MAP = {
  VOO: 'Diversified', AMZN: 'Consumer', GOOGL: 'Tech', TSM: 'Tech', PM: 'Consumer',
  VSAT: 'Communications', BTC: 'Crypto', ETH: 'Crypto', GLD: 'Commodity', USTB: 'Fixed Income',
  USD: 'Cash', THB: 'Cash',
};

const CURRENCY_MAP = (a) => (a.ticker === 'THB' ? 'THB' : 'USD');

function groupByOn(assets, keyFn) {
  const m = new Map();
  for (const a of assets) {
    const v = Number(a.holdingUSD) || 0;
    if (v <= 0) continue;
    const k = keyFn(a);
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m.entries()].sort((a,b) => b[1]-a[1]).map(([name, value], i) => ({ name, value, color: PALETTE[i % PALETTE.length] }));
}

export function categoryDataFor(assets) {
  const individual = assets
    .filter(a => (Number(a.holdingUSD) || 0) > 0)
    .map((a, i) => ({ name: a.ticker, value: Number(a.holdingUSD), color: PALETTE[i % PALETTE.length] }));
  return {
    'By Asset Type':       groupByOn(assets, a => a.type),
    'By Individual Asset': individual,
    'By Sector':           groupByOn(assets, a => SECTOR_MAP[a.ticker] || 'Other'),
    'By Currency':         groupByOn(assets, CURRENCY_MAP),
    'By Source':           groupByOn(assets, a => a.source),
  };
}

function genSeries(points, startVal, endVal, volatility, seed) {
  let s = seed;
  function rng() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
  const arr = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const target = startVal + (endVal - startVal) * t;
    const noise = (rng() - 0.5) * volatility * endVal;
    arr.push(target + noise);
  }
  arr[arr.length - 1] = endVal;
  arr[0] = startVal;
  return arr;
}

export const RANGES = {
  '1W':  { points: 24,  label: 'Past 7 days' },
  '1M':  { points: 30,  label: 'Past 30 days' },
  '3M':  { points: 60,  label: 'Past 3 months' },
  '6M':  { points: 90,  label: 'Past 6 months' },
  '1Y':  { points: 120, label: 'Past 12 months' },
  'ALL': { points: 180, label: 'All time' },
};

export const SERIES_BY_PORTFOLIO = {};
for (const p of PORTFOLIOS) {
  const assets = p === 'All' ? ASSETS : ASSETS_RAW.filter(a => a.source === p);
  const now = assets.reduce((s, a) => s + a.holdingUSD, 0);
  const cost = assets.reduce((s, a) => s + a.qty * a.cost, 0) || now * 0.7;
  const seedBase = { 'All': 0, 'Dime!': 100, 'Webull': 200, 'Binance': 300 }[p];
  SERIES_BY_PORTFOLIO[p] = {
    '1W':  genSeries(24,  now * 0.985, now, 0.005, seedBase + 11),
    '1M':  genSeries(30,  now * 0.94,  now, 0.012, seedBase + 22),
    '3M':  genSeries(60,  now * 0.88,  now, 0.018, seedBase + 33),
    '6M':  genSeries(90,  now * 0.79,  now, 0.022, seedBase + 44),
    '1Y':  genSeries(120, now * 0.71,  now, 0.028, seedBase + 55),
    'ALL': genSeries(180, cost,        now, 0.035, seedBase + 66),
  };
}

export function dateLabelsFor(range) {
  const now = new Date(2026, 4, 14);
  const pts = RANGES[range].points;
  const labels = [];
  const spanDays = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 730 }[range];
  for (let i = 0; i < pts; i++) {
    const t = i / (pts - 1);
    const d = new Date(now.getTime() - (1 - t) * spanDays * 86400000);
    labels.push(d);
  }
  return labels;
}

export const TRANSACTIONS = [
  { id: 1,  date: '2026-05-12T14:32', action: 'Buy',      ticker: 'VOO',   shares: 0.205,  price: 525.40,  valueUSD: 107.71, source: 'Dime!',   status: 'Done' },
  { id: 2,  date: '2026-05-10T09:14', action: 'Buy',      ticker: 'BTC',   shares: 0.0008, price: 66120.50, valueUSD: 52.90, source: 'Binance', status: 'Done' },
  { id: 3,  date: '2026-05-08T22:01', action: 'Dividend', ticker: 'PM',    shares: null,    price: null,    valueUSD: 2.34,   source: 'Dime!',   status: 'Done' },
  { id: 4,  date: '2026-05-06T15:48', action: 'Buy',      ticker: 'GOOGL', shares: 0.282,   price: 177.30,  valueUSD: 50.00,  source: 'Webull',  status: 'Done' },
  { id: 5,  date: '2026-05-03T11:22', action: 'Sell',     ticker: 'VSAT',  shares: 1.500,   price: 30.80,   valueUSD: 46.20,  source: 'Webull',  status: 'Done' },
  { id: 6,  date: '2026-04-30T21:42', action: 'Buy',      ticker: 'AMZN',  shares: 0.503,   price: 198.74,  valueUSD: 100.00, source: 'Webull',  status: 'Done' },
  { id: 7,  date: '2026-04-28T17:18', action: 'Buy',      ticker: 'ETH',   shares: 0.0156,  price: 3210.10, valueUSD: 50.08,  source: 'Binance', status: 'Done' },
  { id: 8,  date: '2026-04-22T13:05', action: 'Deposit',  ticker: 'USD',   shares: 200,     price: 1.00,    valueUSD: 200.00, source: 'Webull',  status: 'Done' },
  { id: 9,  date: '2026-04-20T08:56', action: 'Buy',      ticker: 'TSM',   shares: 0.331,   price: 184.60,  valueUSD: 61.10,  source: 'Webull',  status: 'Done' },
  { id: 10, date: '2026-04-15T16:14', action: 'Buy',      ticker: 'VOO',   shares: 0.0782,  price: 639.48,  valueUSD: 50.00,  source: 'Dime!',   status: 'Done' },
  { id: 11, date: '2026-04-14T10:00', action: 'Dividend', ticker: 'VOO',   shares: null,    price: null,    valueUSD: 4.18,   source: 'Dime!',   status: 'Done' },
  { id: 12, date: '2026-04-10T12:38', action: 'Buy',      ticker: 'GLD',   shares: 0.124,   price: 240.40,  valueUSD: 29.81,  source: 'Webull',  status: 'Done' },
  { id: 13, date: '2026-04-04T19:55', action: 'Sell',     ticker: 'GOOGL', shares: 0.150,   price: 175.20,  valueUSD: 26.28,  source: 'Webull',  status: 'Done' },
  { id: 14, date: '2026-04-02T09:00', action: 'Deposit',  ticker: 'THB',   shares: 3000,    price: 1/FX_RATE, valueUSD: 92.97, source: 'Dime!',   status: 'Done' },
  { id: 15, date: '2026-03-28T14:42', action: 'Buy',      ticker: 'BTC',   shares: 0.0014,  price: 64100.00, valueUSD: 89.74, source: 'Binance', status: 'Done' },
  { id: 16, date: '2026-03-22T15:30', action: 'Buy',      ticker: 'PM',    shares: 0.745,   price: 133.10,  valueUSD: 99.16,  source: 'Dime!',   status: 'Done' },
  { id: 17, date: '2026-03-18T11:09', action: 'Buy',      ticker: 'USTB',  shares: 1.323,   price: 99.78,   valueUSD: 132.00, source: 'Webull',  status: 'Done' },
  { id: 18, date: '2026-03-12T20:11', action: 'Buy',      ticker: 'VSAT',  shares: 4.000,   price: 14.20,   valueUSD: 56.80,  source: 'Webull',  status: 'Done' },
  { id: 19, date: '2026-03-08T18:24', action: 'Dividend', ticker: 'PM',    shares: null,    price: null,    valueUSD: 2.18,   source: 'Dime!',   status: 'Done' },
  { id: 20, date: '2026-03-04T13:50', action: 'Buy',      ticker: 'AMZN',  shares: 0.250,   price: 192.40,  valueUSD: 48.10,  source: 'Webull',  status: 'Done' },
];

export function fmtCurrency(usd, currency, opts = {}) {
  const { decimals = 2, compact = false, showCode = false } = opts;
  if (currency === 'THB') {
    const v = usd * FX_RATE;
    if (compact && Math.abs(v) >= 1000) {
      return '฿' + (v / 1000).toFixed(decimals) + 'K' + (showCode ? ' THB' : '');
    }
    return '฿' + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (showCode ? ' THB' : '');
  }
  if (compact && Math.abs(usd) >= 1000) {
    return '$' + (usd / 1000).toFixed(decimals) + 'K' + (showCode ? ' USD' : '');
  }
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (showCode ? ' USD' : '');
}

export const fmtCurrencySym = (currency) => (currency === 'THB' ? '฿' : '$');
export const fmtCurrencyCode = (currency) => (currency === 'THB' ? 'THB' : 'USD');

// ----------------------------------------------------------------------------
// Bangkok-local time helpers. Every user-visible date/time goes through these
// so the UI doesn't shift around when the user is travelling between time
// zones. Storage stays UTC; only display + form defaults are Bangkok-local.
// ----------------------------------------------------------------------------
export const BKK_TZ = 'Asia/Bangkok';
export const fmtDateBkk = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  new Date(d).toLocaleDateString('en-US', { ...opts, timeZone: BKK_TZ });
export const fmtTimeBkk = (d, opts = { hour: '2-digit', minute: '2-digit', hour12: true }) =>
  new Date(d).toLocaleTimeString('en-US', { ...opts, timeZone: BKK_TZ });
export const fmtDateTimeBkk = (d) =>
  new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: BKK_TZ });
// `now` in Bangkok, split into form-friendly parts.
export function bkkNowParts() {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${bkk.getUTCFullYear()}-${pad(bkk.getUTCMonth() + 1)}-${pad(bkk.getUTCDate())}`,
    time: `${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}`,
  };
}
// UTC ISO → Bangkok date+time inputs (e.g. for the Edit form).
export function utcIsoToBkkParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const b = new Date(d.getTime() + 7 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`,
    time: `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`,
  };
}
// Bangkok wall-clock date+time → UTC ISO (for saving to Postgres).
export function bkkPartsToUtcIso(date, time = '00:00') {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const asIfUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  return new Date(asIfUtc - 7 * 3600_000).toISOString();
}

// Shared Currency context
import { createContext } from 'react';
export const CurrencyContext = createContext({ currency: 'USD', setCurrency: () => {} });
