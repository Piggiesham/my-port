// Data-access layer. Reads from Supabase when configured; otherwise returns
// the mock data from src/data.js so the UI still works for local development.

import { supabase, supabaseEnabled } from './supabase.js';
import {
  ASSETS as MOCK_ASSETS,
  TRANSACTIONS as MOCK_TRANSACTIONS,
  SOURCES as MOCK_SOURCES,
  FX_RATE as MOCK_FX_RATE,
} from '../data.js';

// Map brokerage IDs ('dime') back to display names ('Dime!') used in the UI.
const BROKER_ID_TO_NAME = { dime: 'Dime!', webull: 'Webull', binance: 'Binance' };
const BROKER_NAME_TO_ID = { 'Dime!': 'dime', 'Webull': 'webull', 'Binance': 'binance' };

// ----------------------------------------------------------------------------
// Assets (holdings joined with asset metadata + latest price)
// ----------------------------------------------------------------------------
export async function fetchAssets() {
  if (!supabaseEnabled) return MOCK_ASSETS;

  const [{ data: holdings, error: hErr }, { data: prices, error: pErr }] = await Promise.all([
    supabase.from('holdings').select('brokerage_id, ticker, qty, cost_basis, assets(name, type, logo_bg, logo_text, logo_dark, is_cash)'),
    supabase.from('prices').select('ticker, price_usd'),
  ]);
  if (hErr) throw hErr;
  if (pErr) throw pErr;

  const priceMap = Object.fromEntries((prices ?? []).map(p => [p.ticker, Number(p.price_usd)]));

  return (holdings ?? []).map(h => {
    const a = h.assets || {};
    const price = priceMap[h.ticker] ?? 0;
    const qty = Number(h.qty);
    const cost = Number(h.cost_basis);
    const holdingUSD = qty * price;
    const costTotal = qty * cost;
    const plUSD = holdingUSD - costTotal;
    const pctProfit = costTotal > 0 ? (plUSD / costTotal) * 100 : 0;
    return {
      ticker: h.ticker,
      name: a.name,
      type: a.type,
      source: BROKER_ID_TO_NAME[h.brokerage_id] ?? h.brokerage_id,
      logo: { bg: a.logo_bg, text: a.logo_text, dark: a.logo_dark },
      price, qty, cost,
      holdingUSD, plUSD, pctProfit,
      isCash: a.is_cash,
    };
  });
}

// ----------------------------------------------------------------------------
// Asset catalog — every known ticker (for the typeahead on transaction entry)
// ----------------------------------------------------------------------------
export async function fetchAssetCatalog() {
  if (!supabaseEnabled) {
    return MOCK_ASSETS.map(a => ({
      ticker: a.ticker,
      name: a.name,
      type: a.type,
      sector: a.sector ?? null,
      logo_bg: a.logo?.bg ?? '#333',
      logo_text: a.logo?.text ?? a.ticker[0],
      logo_dark: a.logo?.dark ?? false,
      is_cash: !!a.isCash,
    }));
  }
  const { data, error } = await supabase
    .from('assets')
    .select('ticker, name, type, sector, logo_bg, logo_text, logo_dark, is_cash')
    .order('ticker');
  if (error) throw error;
  return data ?? [];
}

export async function createAsset({ ticker, name, type, sector = null, logoBg = '#333', logoText = null }) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('assets').insert({
    ticker: ticker.toUpperCase().trim(),
    name,
    type,
    sector,
    logo_bg: logoBg,
    logo_text: logoText ?? ticker[0]?.toUpperCase() ?? '?',
    is_cash: type === 'Cash',
  }).select().single();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------------------
// Transactions
// ----------------------------------------------------------------------------
export async function fetchTransactions() {
  if (!supabaseEnabled) return MOCK_TRANSACTIONS;

  const { data, error } = await supabase
    .from('transactions')
    .select('id, brokerage_id, ticker, action, shares, price, value_usd, fees, taxes, description, executed_at')
    .order('executed_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map(t => ({
    id: t.id,
    date: t.executed_at,
    action: t.action,
    ticker: t.ticker,
    shares: t.shares == null ? null : Number(t.shares),
    price: t.price == null ? null : Number(t.price),
    valueUSD: Number(t.value_usd),
    fees: t.fees == null ? 0 : Number(t.fees),
    taxes: t.taxes == null ? 0 : Number(t.taxes),
    description: t.description ?? '',
    source: BROKER_ID_TO_NAME[t.brokerage_id] ?? t.brokerage_id,
    status: 'Done',
  }));
}

function buildTxPayload({ portfolio, ticker, action, shares, price, valueUsd, fees = 0, taxes = 0, description, executedAt }) {
  return {
    brokerage_id: BROKER_NAME_TO_ID[portfolio] ?? portfolio,
    ticker,
    action,
    shares: shares ?? null,
    price: price ?? null,
    value_usd: valueUsd,
    fees,
    taxes,
    description: description ?? null,
    executed_at: executedAt,
  };
}

export async function addTransaction(args) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('apply_transaction', { tx: buildTxPayload(args) });
  if (error) throw error;
  return data; // new uuid
}

export async function updateTransaction(txId, args) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('update_transaction', {
    tx_id: txId,
    new_tx: buildTxPayload(args),
  });
  if (error) throw error;
}

export async function deleteTransaction(txId) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('revert_transaction', { tx_id: txId });
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Latest prices map { ticker -> price_usd }. Used by computeAssetsFromTransactions.
// ----------------------------------------------------------------------------
export async function fetchPriceMap() {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from('prices').select('ticker, price_usd');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map(p => [p.ticker, Number(p.price_usd)]));
}

// ----------------------------------------------------------------------------
// Compute holdings from transactions (the source of truth). Keeps a per
// (source, ticker) running qty and weighted-average cost basis, mirroring
// the SQL `apply_holdings_delta` so the Overview matches the Transactions list.
// ----------------------------------------------------------------------------
export function computeAssetsFromTransactions(transactions, catalog, priceMap) {
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const positions = new Map(); // key = `${source}|${ticker}` → { qty, cost }

  for (const t of sorted) {
    const key = `${t.source}|${t.ticker}`;
    const cur = positions.get(key) || { qty: 0, cost: 0 };
    const shares = Number(t.shares ?? 0);
    const price = Number(t.price ?? 0);

    if (t.action === 'Buy' || t.action === 'Deposit') {
      const newQty = cur.qty + shares;
      if (newQty === 0) { cur.qty = 0; cur.cost = 0; }
      else {
        cur.cost = ((cur.qty * cur.cost) + (shares * price)) / newQty;
        cur.qty = newQty;
      }
    } else if (t.action === 'Sell' || t.action === 'Withdraw') {
      cur.qty = cur.qty - shares;
      if (cur.qty <= 0) { cur.qty = 0; cur.cost = 0; }
    }
    // Dividend: doesn't change qty or cost basis (cash impact tracked separately)
    positions.set(key, cur);
  }

  const catalogByTicker = Object.fromEntries((catalog ?? []).map(a => [a.ticker, a]));
  const out = [];
  for (const [key, { qty, cost }] of positions) {
    if (qty <= 0.00000001) continue;
    const [source, ticker] = key.split('|');
    const meta = catalogByTicker[ticker] || {};
    const price = priceMap?.[ticker] ?? 0;
    const holdingUSD = qty * price;
    const costTotal = qty * cost;
    const plUSD = holdingUSD - costTotal;
    out.push({
      ticker,
      name: meta.name ?? ticker,
      type: meta.type ?? 'Stock',
      source,
      logo: { bg: meta.logo_bg ?? '#333', text: meta.logo_text ?? ticker[0], dark: meta.logo_dark ?? false },
      price, qty, cost,
      holdingUSD, plUSD,
      pctProfit: costTotal > 0 ? (plUSD / costTotal) * 100 : 0,
      isCash: !!meta.is_cash,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Portfolio value series derived from transactions. One point per transaction
// (after the tx is applied) plus a final point at "now" using current market
// prices. Per-event valuation uses the most recent transaction price for each
// ticker; the final "now" point uses current market price.
// ----------------------------------------------------------------------------
export function computeReturnSeries(transactions, priceMap = {}) {
  if (!transactions || transactions.length === 0) return [];
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const positions = new Map(); // ticker -> { qty, lastPrice }
  const series = [];

  const valueAt = (useCurrentPrice) => {
    let v = 0;
    for (const [tk, p] of positions) {
      if (p.qty <= 0) continue;
      const px = useCurrentPrice
        ? (priceMap[tk] ?? p.lastPrice ?? 0)
        : (p.lastPrice ?? priceMap[tk] ?? 0);
      v += p.qty * px;
    }
    return v;
  };

  for (const t of sorted) {
    const cur = positions.get(t.ticker) || { qty: 0, lastPrice: null };
    const shares = Number(t.shares ?? 0);
    if (t.action === 'Buy' || t.action === 'Deposit') cur.qty += shares;
    else if (t.action === 'Sell' || t.action === 'Withdraw') cur.qty -= shares;
    if (t.price != null) cur.lastPrice = Number(t.price);
    else if (t.ticker === 'USD') cur.lastPrice = 1;
    positions.set(t.ticker, cur);
    series.push({ date: new Date(t.date), value: valueAt(false) });
  }

  const lastDate = series[series.length - 1].date;
  const now = new Date();
  const nowValue = valueAt(true);
  if (now.getTime() - lastDate.getTime() > 60_000) {
    series.push({ date: now, value: nowValue });
  } else {
    series[series.length - 1] = { date: lastDate, value: nowValue };
  }
  return series;
}

// ----------------------------------------------------------------------------
// Historical price cache + daily portfolio-value series.
//
// `fetchPriceHistory` reads the `price_history` table for the requested range,
// computes which date spans are missing per ticker, calls the
// `historical-price-range` edge function for those spans (which upserts into
// the cache), and returns a merged Map<ticker, Map<'YYYY-MM-DD', price_usd>>.
//
// `computeDailyReturnSeries` replays the transaction stream day-by-day across
// the same range, valuing each day's holdings against the historical prices.
// USD = 1.0; THB uses its own history row. Tickers missing a price for a given
// day fall back to the most recent earlier close (up to 7d), then the last
// transaction price.
// ----------------------------------------------------------------------------

const MS_PER_DAY = 86400000;

function toYMD(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addDaysYMD(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function fetchPriceHistory(tickers, from, to) {
  const result = new Map();
  if (!supabaseEnabled || !tickers || tickers.length === 0) return result;
  const fromStr = toYMD(from);
  const toStr = toYMD(to);

  const uniq = [...new Set(tickers)];
  const { data: cached, error } = await supabase
    .from('price_history')
    .select('ticker, date, price_usd')
    .in('ticker', uniq)
    .gte('date', fromStr)
    .lte('date', toStr);
  if (error) console.warn('[price_history] read failed', error.message);

  for (const t of uniq) result.set(t, new Map());
  for (const row of cached ?? []) {
    result.get(row.ticker)?.set(row.date, Number(row.price_usd));
  }

  await Promise.all(uniq.map(async (ticker) => {
    if (ticker === 'USD') return; // edge fn handles, but we skip the call
    const map = result.get(ticker);
    const dates = [...map.keys()].sort();
    const gaps = [];
    if (dates.length === 0) {
      gaps.push([fromStr, toStr]);
    } else {
      if (dates[0] > fromStr) gaps.push([fromStr, addDaysYMD(dates[0], -1)]);
      const last = dates[dates.length - 1];
      if (last < toStr) gaps.push([addDaysYMD(last, 1), toStr]);
    }
    for (const [gFrom, gTo] of gaps) {
      if (gFrom > gTo) continue;
      try {
        const { data, error } = await supabase.functions.invoke('historical-price-range', {
          body: { ticker, from: gFrom, to: gTo },
        });
        if (error) { console.warn(`[historical-price-range] ${ticker} failed`, error.message); continue; }
        for (const p of data?.prices ?? []) {
          map.set(p.date, Number(p.price));
        }
      } catch (err) {
        console.warn(`[historical-price-range] ${ticker} threw`, err);
      }
    }
  }));

  return result;
}

export function computeDailyReturnSeries(transactions, priceHistory, from, to) {
  if (!transactions || transactions.length === 0) return [];
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const positions = new Map(); // ticker -> qty
  const lastTxPrice = new Map(); // ticker -> price from most recent tx
  const series = [];

  const startMs = new Date(toYMD(from) + 'T00:00:00Z').getTime();
  const endMs = new Date(toYMD(to) + 'T00:00:00Z').getTime();
  let txi = 0;

  for (let dayMs = startMs; dayMs <= endMs; dayMs += MS_PER_DAY) {
    const dayEnd = dayMs + MS_PER_DAY - 1;
    while (txi < sorted.length && new Date(sorted[txi].date).getTime() <= dayEnd) {
      const t = sorted[txi];
      const shares = Number(t.shares ?? 0);
      const cur = positions.get(t.ticker) || 0;
      if (t.action === 'Buy' || t.action === 'Deposit') positions.set(t.ticker, cur + shares);
      else if (t.action === 'Sell' || t.action === 'Withdraw') positions.set(t.ticker, cur - shares);
      if (t.price != null) lastTxPrice.set(t.ticker, Number(t.price));
      else if (t.ticker === 'USD') lastTxPrice.set('USD', 1);
      txi++;
    }

    const dayStr = new Date(dayMs).toISOString().slice(0, 10);
    let value = 0;
    for (const [ticker, qty] of positions) {
      if (qty <= 0) continue;
      let price;
      if (ticker === 'USD') {
        price = 1;
      } else {
        const hist = priceHistory.get(ticker);
        price = hist?.get(dayStr);
        if (price == null && hist) {
          for (let back = 1; back <= 7 && price == null; back++) {
            price = hist.get(new Date(dayMs - back * MS_PER_DAY).toISOString().slice(0, 10));
          }
        }
        if (price == null) price = lastTxPrice.get(ticker) ?? 0;
      }
      value += qty * price;
    }
    series.push({ date: new Date(dayMs), value });
  }
  return series;
}

// ----------------------------------------------------------------------------
// Yahoo Finance live symbol search (via edge function — Yahoo blocks browser CORS)
// ----------------------------------------------------------------------------
export async function searchYahooSymbols(query) {
  if (!supabaseEnabled) return [];
  const q = (query || '').trim();
  if (!q) return [];
  const { data, error } = await supabase.functions.invoke('yahoo-search', { body: { query: q } });
  if (error) { console.warn('[yahoo-search] failed', error); return []; }
  return Array.isArray(data?.results) ? data.results : [];
}

// ----------------------------------------------------------------------------
// Historical closing price for a ticker on a given date (YYYY-MM-DD).
// ----------------------------------------------------------------------------
export async function fetchHistoricalPrice(ticker, date) {
  if (!supabaseEnabled) return null;
  if (!ticker || !date) return null;
  const { data, error } = await supabase.functions.invoke('historical-price', {
    body: { ticker, date },
  });
  if (error) { console.warn('[historical-price] failed', error); return null; }
  return typeof data?.price === 'number' ? data.price : null;
}

// ----------------------------------------------------------------------------
// Portfolio snapshots (for the return chart)
// ----------------------------------------------------------------------------
const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 9999 };

export async function fetchSnapshots(portfolioName, range) {
  if (!supabaseEnabled) return null;

  const brokerId = portfolioName === 'All' ? 'all'
    : ({ 'Dime!': 'dime', 'Webull': 'webull', 'Binance': 'binance' }[portfolioName] ?? 'all');

  const days = RANGE_DAYS[range] ?? 365;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_usd')
    .eq('brokerage_id', brokerId)
    .gte('snapshot_date', since.toISOString().slice(0, 10))
    .order('snapshot_date', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(r => ({
    date: new Date(r.snapshot_date),
    value: Number(r.total_usd),
  }));
}

// ----------------------------------------------------------------------------
// Brokerages
// ----------------------------------------------------------------------------
export async function fetchBrokerages() {
  if (!supabaseEnabled) return MOCK_SOURCES;
  const { data, error } = await supabase.from('brokerages').select('id, name, color');
  if (error) throw error;
  const map = {};
  for (const b of data ?? []) map[b.name] = { color: b.color, dot: b.color };
  return map;
}

// ----------------------------------------------------------------------------
// FX rate (USD → THB). The `prices` table stores ticker 'THB' as USD-per-THB
// (e.g. 0.031), matching what refresh-prices upserts from Yahoo's THB=X.
// FX_RATE is the inverse — THB per USD (e.g. 32.27).
// ----------------------------------------------------------------------------
export async function fetchFxRate() {
  if (!supabaseEnabled) return MOCK_FX_RATE;
  const { data, error } = await supabase
    .from('prices')
    .select('price_usd')
    .eq('ticker', 'THB')
    .maybeSingle();
  if (error) throw error;
  const usdPerThb = data ? Number(data.price_usd) : 0;
  if (!usdPerThb) return MOCK_FX_RATE;
  return 1 / usdPerThb;
}
