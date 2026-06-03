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
    .select('ticker, name, type, sector, logo_bg, logo_text, logo_dark, is_cash, settlement_currency')
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
    .select('id, brokerage_id, ticker, action, shares, price, value_usd, fees, taxes, description, executed_at, fx_rate_at_tx')
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
    fx_rate_at_tx: t.fx_rate_at_tx == null ? null : Number(t.fx_rate_at_tx),
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
  if (data && args.fxRateAtTx != null) {
    const { error: fxErr } = await supabase
      .from('transactions')
      .update({ fx_rate_at_tx: args.fxRateAtTx })
      .eq('id', data);
    if (fxErr) console.warn('[tx] fx_rate_at_tx write failed', fxErr.message);
  }
  return data; // new uuid
}

export async function updateTransaction(txId, args) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('update_transaction', {
    tx_id: txId,
    new_tx: buildTxPayload(args),
  });
  if (error) throw error;
  if (args.fxRateAtTx != null) {
    const { error: fxErr } = await supabase
      .from('transactions')
      .update({ fx_rate_at_tx: args.fxRateAtTx })
      .eq('id', txId);
    if (fxErr) console.warn('[tx] fx_rate_at_tx write failed', fxErr.message);
  }
}

// Atomic bulk import — all rows commit together or none do. `items` is an
// array of addTransaction-style args; they're sent pre-built to the
// import_transactions RPC, which loops them in one transaction and aborts the
// whole batch on any failure. Caller must order items chronologically.
export async function importTransactions(items) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  const payloads = items.map(a => ({ ...buildTxPayload(a), fx_rate_at_tx: a.fxRateAtTx ?? null }));
  const { data, error } = await supabase.rpc('import_transactions', { p_txs: payloads });
  if (error) throw error;
  return data; // array of new uuids
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
// ----------------------------------------------------------------------------
// Cash balance for a (brokerage, currency) pair, derived from in-memory
// transactions. Mirrors the SQL trajectory math so the modal hint matches
// what the RPC enforces.
//
//   Deposit/Withdraw of <currency>      → ±shares
//   Buy of an asset settling in <currency>      → −(shares·price + fees + taxes)
//   Sell of an asset settling in <currency>     → +(shares·price − fees − taxes)
//   Dividend on an asset settling in <currency> → +value_usd
// ----------------------------------------------------------------------------
// Fingerprint shared by DB rows and parsed import rows. Used to dedup imports
// so a re-upload (or overlapping screenshot batch) doesn't create duplicates.
// Key: brokerage | ticker | action | amount | minute | label.
//   - amount is the share count for trades, but the USD value for cash rows
//     (Dividend/Fee/Tax have no qty).
//   - label disambiguates same-minute cash rows that are otherwise identical —
//     notably a TAF Fee and a SEC Fee posted at the same instant (both −$0.01,
//     both ticker USD). Without it the second would look like a duplicate.
// Price is intentionally NOT in the key — OCR + FX drift would break matches.
const CASH_ACTIONS = new Set(['Dividend', 'Fee', 'Tax']);

function fingerprintKey(brokerId, ticker, action, amount, minute, label) {
  return `${brokerId}|${(ticker || '').toUpperCase()}|${action}|${amount}|${minute}Z|${label || ''}`;
}

export function txFingerprint(t) {
  const brokerId = BROKER_NAME_TO_ID[t.source] ?? t.source ?? '';
  const minute = t.date ? new Date(t.date).toISOString().slice(0, 16) : '';
  const isCash = CASH_ACTIONS.has(t.action);
  const amount = isCash ? Number(t.valueUSD ?? 0).toFixed(2) : Number(t.shares ?? 0).toFixed(8);
  // Only fees need the label (TAF vs SEC collide on USD/0.01/minute); dividends
  // and taxes are already unique by action+ticker+value.
  const label = t.action === 'Fee' ? (t.description || '') : '';
  return fingerprintKey(brokerId, t.ticker, t.action, amount, minute, label);
}

export function importedRowFingerprint(r, brokerageId) {
  const minute = r.executedAt ? new Date(r.executedAt).toISOString().slice(0, 16) : '';
  const isCash = CASH_ACTIONS.has(r.action);
  const amount = isCash ? Number(r.value ?? 0).toFixed(2) : Number(r.qty ?? 0).toFixed(8);
  const label = r.action === 'Fee' ? (r.label || '') : '';
  return fingerprintKey(brokerageId, r.ticker, r.action, amount, minute, label);
}

// Shares held of a specific ticker in a brokerage, derived from in-memory
// transactions. Mirrors apply_holdings_delta semantics.
export function computeSharesHeld(transactions, brokerage, ticker) {
  if (!brokerage || !ticker) return 0;
  let qty = 0;
  const tk = ticker.toUpperCase();
  for (const t of transactions || []) {
    if (t.source !== brokerage) continue;
    if ((t.ticker || '').toUpperCase() !== tk) continue;
    const s = Number(t.shares) || 0;
    if (t.action === 'Buy' || t.action === 'Deposit')      qty += s;
    else if (t.action === 'Sell' || t.action === 'Withdraw') qty -= s;
  }
  return qty;
}

// Per (source, ticker) historical-FX cost basis in THB. Replays Buys with each
// one's fx_rate_at_tx so the resulting weighted avg reflects the baht the user
// actually paid — see docs/adr/0002-average-cost-uses-historical-fx.md.
// Sells reduce qty but not the per-share THB cost (mirrors apply_holdings_delta
// avg-cost semantics). A Buy missing fx_rate_at_tx marks the position as
// `approx: true` and uses today's FX_RATE for that one buy — the cell renders
// with a "~" prefix until backfillHistoricalFx() runs.
// Returns Map<"source|ticker", { qty, thbCostTotal, thbPerShare, approx }>.
export function computeThbCostByKey(transactions) {
  const out = new Map();
  const sorted = [...(transactions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
  for (const t of sorted) {
    const action = t.action;
    if (action !== 'Buy' && action !== 'Sell') continue;       // dividends/fees/tax don't move basis
    const tk = (t.ticker || '').toUpperCase();
    if (!tk) continue;
    const key = `${t.source}|${tk}`;
    const cur = out.get(key) || { qty: 0, thbCostTotal: 0, approx: false };
    const shares = Number(t.shares) || 0;
    if (shares <= 0) { out.set(key, cur); continue; }

    if (action === 'Buy') {
      const priceUsd = Number(t.price) || 0;
      let fx = Number(t.fx_rate_at_tx);
      let approxThis = false;
      if (!fx || fx <= 0) { fx = MOCK_FX_RATE; approxThis = true; }
      cur.qty += shares;
      cur.thbCostTotal += shares * priceUsd * fx;             // baht paid for these shares
      if (approxThis) cur.approx = true;
    } else if (action === 'Sell') {
      // Per-share THB avg cost is preserved across sells; reduce qty and basis
      // proportionally so thbPerShare stays the same.
      const perShare = cur.qty > 0 ? cur.thbCostTotal / cur.qty : 0;
      cur.qty = Math.max(0, cur.qty - shares);
      cur.thbCostTotal = cur.qty * perShare;
      if (cur.qty === 0) cur.approx = false;                  // fresh start if reopened
    }
    out.set(key, cur);
  }
  for (const [k, v] of out) {
    v.thbPerShare = v.qty > 0 ? v.thbCostTotal / v.qty : 0;
    out.set(k, v);
  }
  return out;
}

export function computeCashBalance(transactions, brokerage, currency, catalog = []) {
  const settlementByTicker = Object.fromEntries(
    (catalog || []).map(a => [a.ticker, a.settlement_currency || (a.is_cash ? a.ticker : 'USD')])
  );
  let bal = 0;
  for (const t of transactions || []) {
    if (t.source !== brokerage) continue;
    const isCashFlow = t.action === 'Deposit' || t.action === 'Withdraw';
    const txCurrency = isCashFlow
      ? t.ticker
      : (settlementByTicker[t.ticker] || 'USD');
    if (txCurrency !== currency) continue;

    const shares = Number(t.shares) || 0;
    const price  = Number(t.price)  || 0;
    const fees   = Number(t.fees)   || 0;
    const taxes  = Number(t.taxes)  || 0;
    const value  = Number(t.valueUSD) || 0;

    if      (t.action === 'Deposit')  bal += shares;
    else if (t.action === 'Withdraw') bal -= shares;
    else if (t.action === 'Buy')      bal -= shares * price + fees + taxes;
    else if (t.action === 'Sell')     bal += shares * price - fees - taxes;
    else if (t.action === 'Dividend') bal += value;
    else if (t.action === 'Fee')      bal -= value;
    else if (t.action === 'Tax')      bal -= value;
  }
  return bal;
}

export function computeAssetsFromTransactions(transactions, catalog, priceMap) {
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const positions = new Map(); // key = `${source}|${ticker}` → { qty, cost }
  const settlementByTicker = Object.fromEntries(
    (catalog || []).map(a => [a.ticker, a.settlement_currency || (a.is_cash ? a.ticker : 'USD')])
  );

  const mutateCash = (source, currency, delta) => {
    const key = `${source}|${currency}`;
    const cur = positions.get(key) || { qty: 0, cost: 1 };
    cur.qty += delta;
    cur.cost = 1;
    positions.set(key, cur);
  };

  for (const t of sorted) {
    const key = `${t.source}|${t.ticker}`;
    const cur = positions.get(key) || { qty: 0, cost: 0 };
    const shares = Number(t.shares ?? 0);
    const price = Number(t.price ?? 0);
    const fees = Number(t.fees) || 0;
    const taxes = Number(t.taxes) || 0;
    const value = Number(t.valueUSD) || 0;

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
    positions.set(key, cur);

    // Cash side-effects on Buy/Sell/Dividend/Fee/Tax (matches SQL apply_cash_delta).
    if (t.action === 'Buy' || t.action === 'Sell' || t.action === 'Dividend'
        || t.action === 'Fee' || t.action === 'Tax') {
      const ccy = settlementByTicker[t.ticker] || 'USD';
      let delta = 0;
      if      (t.action === 'Buy')      delta = -(shares * price + fees + taxes);
      else if (t.action === 'Sell')     delta =  (shares * price - fees - taxes);
      else if (t.action === 'Dividend') delta = value;
      else if (t.action === 'Fee')      delta = -value;
      else if (t.action === 'Tax')      delta = -value;
      if (delta !== 0) mutateCash(t.source, ccy, delta);
    }
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
  const positions = new Map(); // ticker -> { qty, cost, lastPrice }
  const series = [];

  const snapshot = (useCurrentPrice) => {
    let value = 0;
    let invested = 0;
    for (const [tk, p] of positions) {
      if (p.qty <= 0) continue;
      const px = useCurrentPrice
        ? (priceMap[tk] ?? p.lastPrice ?? 0)
        : (p.lastPrice ?? priceMap[tk] ?? 0);
      value += p.qty * px;
      invested += p.qty * (p.cost ?? 0);
    }
    return { value, invested };
  };

  const mutateCash = (ticker, delta) => {
    const c = positions.get(ticker) || { qty: 0, cost: 1, lastPrice: 1 };
    c.qty += delta;
    c.cost = 1;
    c.lastPrice = 1;
    positions.set(ticker, c);
  };

  for (const t of sorted) {
    const cur = positions.get(t.ticker) || { qty: 0, cost: 0, lastPrice: null };
    const shares = Number(t.shares ?? 0);
    const price = t.price != null ? Number(t.price) : (t.ticker === 'USD' ? 1 : null);
    const fees = Number(t.fees) || 0;
    const taxes = Number(t.taxes) || 0;
    const value = Number(t.valueUSD) || 0;
    if (t.action === 'Buy' || t.action === 'Deposit') {
      const newQty = cur.qty + shares;
      if (newQty > 0 && price != null) {
        if (cur.qty <= 0 || cur.cost === 0) cur.cost = price;
        else cur.cost = ((cur.qty * cur.cost) + (shares * price)) / newQty;
      }
      cur.qty = newQty;
    } else if (t.action === 'Sell' || t.action === 'Withdraw') {
      cur.qty = cur.qty - shares;
      if (cur.qty <= 0) { cur.qty = 0; cur.cost = 0; }
    }
    if (price != null) cur.lastPrice = price;
    positions.set(t.ticker, cur);

    // Buy/Sell/Dividend mutate the cash bucket (settlement currency). All
    // current non-cash assets settle in USD; revisit when THB-settled assets exist.
    if (t.action === 'Buy')      mutateCash('USD', -(shares * price + fees + taxes));
    else if (t.action === 'Sell')     mutateCash('USD',  (shares * price - fees - taxes));
    else if (t.action === 'Dividend') mutateCash('USD',  value);
    else if (t.action === 'Fee')      mutateCash('USD', -value);
    else if (t.action === 'Tax')      mutateCash('USD', -value);

    const snap = snapshot(false);
    series.push({ date: new Date(t.date), value: snap.value, invested: snap.invested });
  }

  const lastDate = series[series.length - 1].date;
  const now = new Date();
  const nowSnap = snapshot(true);
  if (now.getTime() - lastDate.getTime() > 60_000) {
    series.push({ date: now, value: nowSnap.value, invested: nowSnap.invested });
  } else {
    series[series.length - 1] = { date: lastDate, value: nowSnap.value, invested: nowSnap.invested };
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
  const positions = new Map(); // ticker -> { qty, cost }
  const lastTxPrice = new Map(); // ticker -> price from most recent tx
  const series = [];

  // Cumulative invested-capital in baht, locked at each deposit's FX rate.
  // Lets the chart show real "conversion-risk" return in THB mode: the gap
  // between value-in-THB-today vs THB-actually-put-in.
  let investedThb = 0;

  const startMs = new Date(toYMD(from) + 'T00:00:00Z').getTime();
  const endMs = new Date(toYMD(to) + 'T00:00:00Z').getTime();
  let txi = 0;

  for (let dayMs = startMs; dayMs <= endMs; dayMs += MS_PER_DAY) {
    const dayEnd = dayMs + MS_PER_DAY - 1;
    while (txi < sorted.length && new Date(sorted[txi].date).getTime() <= dayEnd) {
      const t = sorted[txi];
      const shares = Number(t.shares ?? 0);
      const price = t.price != null ? Number(t.price) : (t.ticker === 'USD' ? 1 : null);
      const fees = Number(t.fees) || 0;
      const taxes = Number(t.taxes) || 0;
      const value = Number(t.valueUSD) || 0;
      const cur = positions.get(t.ticker) || { qty: 0, cost: 0 };
      if (t.action === 'Buy' || t.action === 'Deposit') {
        const newQty = cur.qty + shares;
        if (newQty > 0 && price != null) {
          if (cur.qty <= 0 || cur.cost === 0) cur.cost = price;
          else cur.cost = ((cur.qty * cur.cost) + (shares * price)) / newQty;
        }
        cur.qty = newQty;
      } else if (t.action === 'Sell' || t.action === 'Withdraw') {
        cur.qty = cur.qty - shares;
        if (cur.qty <= 0) { cur.qty = 0; cur.cost = 0; }
      }
      if (price != null) lastTxPrice.set(t.ticker, price);
      positions.set(t.ticker, cur);

      // Cash side-effects on Buy/Sell/Dividend (USD settlement for all current assets).
      const mutateUsd = (delta) => {
        const c = positions.get('USD') || { qty: 0, cost: 1 };
        c.qty += delta;
        c.cost = 1;
        positions.set('USD', c);
        lastTxPrice.set('USD', 1);
      };
      if (t.action === 'Buy')      mutateUsd(-(shares * price + fees + taxes));
      else if (t.action === 'Sell')     mutateUsd( (shares * price - fees - taxes));
      else if (t.action === 'Dividend') mutateUsd( value);
      else if (t.action === 'Fee')      mutateUsd(-value);
      else if (t.action === 'Tax')      mutateUsd(-value);

      // Track cumulative THB-denominated invested capital. THB deposits add
      // baht directly; USD deposits convert at deposit-day FX so the line
      // captures the rate the user actually exchanged at. Withdraws subtract.
      if (t.action === 'Deposit' || t.action === 'Withdraw') {
        const sign = t.action === 'Deposit' ? 1 : -1;
        if (t.ticker === 'THB') {
          investedThb += sign * shares;
        } else if (t.ticker === 'USD') {
          let fx = Number(t.fx_rate_at_tx) || 0;
          if (!fx) {
            const ymd = new Date(t.date).toISOString().slice(0, 10);
            const usdPerThb = priceHistory.get('THB')?.get(ymd);
            if (usdPerThb && usdPerThb > 0) fx = 1 / usdPerThb;
          }
          if (fx > 0) investedThb += sign * shares * fx;
        }
      }

      txi++;
    }

    const dayStr = new Date(dayMs).toISOString().slice(0, 10);
    let value = 0;
    let invested = 0;
    for (const [ticker, { qty, cost }] of positions) {
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
      invested += qty * cost;
    }

    // Attach the day's USD-per-THB FX so the chart can render historical
    // values in THB at the rate they were actually worth on that day. Walks
    // back up to 7 days if the exact day is missing (weekends / gaps).
    const thbHist = priceHistory.get('THB');
    let fxRate = thbHist?.get(dayStr);
    if (fxRate == null && thbHist) {
      for (let back = 1; back <= 7 && fxRate == null; back++) {
        fxRate = thbHist.get(new Date(dayMs - back * MS_PER_DAY).toISOString().slice(0, 10));
      }
    }
    // priceHistory stores THB as USD-per-THB, but the FX_RATE elsewhere is
    // THB-per-USD. Invert to match: fxRate = THB per 1 USD.
    fxRate = (fxRate != null && fxRate > 0) ? 1 / fxRate : null;

    series.push({ date: new Date(dayMs), value, invested, investedThb, fxRate });
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
// Parse a Webull monthly-statement CSV into the same row shape the image
// importer produces. Runs entirely client-side — no edge function, no quota.
//
// Expected sections (only TRADE RECORDS / Stocks is extracted today):
//   "Monthly Statement YYYY-MM"
//   "TRADE RECORDS "
//   "Stocks"
//   "Currency: USD"
//   Symbol & Name,Trade Date,Settlement Date,Buy/Sell,Quantity,Traded Price,
//     Gross Amount,Comm/Fee/Tax,VAT,Net Amount
//   <data rows…>
//   "Options"   <-- everything below is ignored
//
// Trade row example:
//   META META PLATFORMS INC,31/10/2025,03/11/2025,BUY,0.26925,657.36,176.99,-0.18,-0.01,177.18
//
// Notes:
// - Ticker is the FIRST whitespace-delimited token of "Symbol & Name".
// - Dates are DD/MM/YYYY. We don't have a clock time so we stamp 05:00 UTC
//   (≈ noon Bangkok) — the user can fine-tune in the preview.
// - Comm/Fee/Tax and VAT are signed negative in the export; we store the
//   absolute value as positive `fees` / `taxes` to match our DB convention.
// ----------------------------------------------------------------------------
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseWebullCSV(text) {
  const lines = (text || '').split(/\r?\n/);
  const rows = [];
  let skipped = 0;
  let inTradeRecords = false;
  let inStocks = false;
  let currency = 'USD';
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/TRADE RECORDS/i.test(trimmed)) { inTradeRecords = true; inStocks = false; headerSeen = false; continue; }
    if (/^PORTFOLIO/i.test(trimmed) || /^Portfolio Advisory/i.test(trimmed)) { inTradeRecords = false; inStocks = false; continue; }

    if (inTradeRecords) {
      if (/^Stocks\b/i.test(trimmed))  { inStocks = true;  headerSeen = false; continue; }
      if (/^Options\b/i.test(trimmed)) { inStocks = false; headerSeen = false; continue; }
    }
    if (!inStocks) continue;

    const cells = splitCsvLine(line);
    const first = (cells[0] || '').trim();

    if (first.startsWith('Currency:')) {
      currency = first.split(':')[1]?.trim() || 'USD';
      continue;
    }
    if (first === 'Symbol & Name') { headerSeen = true; continue; }
    if (!headerSeen) continue;

    // Webull pads its sections with `"",,,,` rows — skip them silently so
    // the user's "skipped" counter only reflects rows we actually tried to
    // parse.
    if (cells.every(c => c.trim() === '')) continue;

    const sym = first;
    const tradeDate = (cells[1] || '').trim();
    const buyOrSell = (cells[3] || '').trim().toUpperCase();
    const qty = parseFloat(cells[4]);
    const price = parseFloat(cells[5]);
    const fee = Math.abs(parseFloat(cells[7]) || 0);
    const vat = Math.abs(parseFloat(cells[8]) || 0);

    const ticker = sym.split(/\s+/)[0]?.toUpperCase();
    const action = buyOrSell === 'BUY' ? 'Buy' : buyOrSell === 'SELL' ? 'Sell' : null;
    const dm = tradeDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (!ticker || !action || !isFinite(qty) || qty <= 0 || !isFinite(price) || !dm) {
      skipped++;
      continue;
    }
    const [, dd, mm, yyyy] = dm;
    const executedAt = `${yyyy}-${mm}-${dd}T12:00:00Z`; // noon Bangkok (stored as-is)

    rows.push({
      action,
      ticker,
      qty,
      executedPrice: price,
      currency: currency === 'THB' ? 'THB' : 'USD',
      executedAt,
      fees: fee,
      taxes: vat,
    });
  }
  return { rows, skipped };
}

// ----------------------------------------------------------------------------
// Parse a transaction-history screenshot via the parse-transactions-image
// edge function. `file` is a Blob/File from an <input type=file>.
// Returns { rows, skipped } where rows is an array of:
//   { action: 'Buy'|'Sell', ticker, qty, executedPrice, currency: 'USD'|'THB', executedAt }
// ----------------------------------------------------------------------------
// Resize an image File/Blob so its long edge is at most `maxEdge` pixels and
// re-encode to JPEG. Used to keep the parse-transactions-image edge function
// body under Supabase's request size limit.
async function downscaleImageBlob(file, maxEdge = 1600, quality = 0.85) {
  if (typeof window === 'undefined' || !window.createImageBitmap) {
    return { blob: file, mimeType: file.type || 'image/jpeg' };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob) return { blob: file, mimeType: file.type || 'image/jpeg' };
    return { blob, mimeType: 'image/jpeg' };
  } catch {
    return { blob: file, mimeType: file.type || 'image/jpeg' };
  }
}

export async function parseTransactionsImage(file, brokerage = '', bucket = 'security') {
  if (!supabaseEnabled) throw new Error('Supabase not configured');
  if (!file) throw new Error('no file');

  // Downscale before sending so we don't blow Supabase's edge-function body
  // limit on full-resolution phone screenshots. Long edge capped at 1600px,
  // re-encoded to JPEG at quality 0.85. Text stays plenty readable for OCR.
  const { blob, mimeType: outMime } = await downscaleImageBlob(file, 1600, 0.85);

  // Send as multipart/form-data via supabase-js. The SDK forwards FormData
  // bodies as multipart/form-data (no JSON serialization, no base64 inflation)
  // while keeping its known-good auth + CORS handling.
  const form = new FormData();
  form.append('image', blob, file.name || 'image.jpg');
  form.append('mimeType', outMime);
  form.append('bucket', bucket);
  if (brokerage) form.append('brokerage', brokerage);

  // Up to 3 attempts when Gemini throttles us. The edge function always
  // returns HTTP 200; errors live in body.error. On rate_limited we sleep
  // client-side using the retryAfterMs hint from Gemini's RetryInfo.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.functions.invoke('parse-transactions-image', {
      body: form,
    });
    if (error) {
      // The function always returns 200, so any error here is genuine network
      // / CORS / supabase-js failure.
      throw new Error(error.message || String(error));
    }
    if (data?.error === 'rate_limited' && attempt < MAX_ATTEMPTS) {
      // Cap at 60s — beyond that the user might as well retry manually.
      const wait = Math.min(60000, Number(data.retryAfterMs) || 10000);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (data?.error) throw new Error(data.error);
    return { rows: data?.rows || [], skipped: data?.skipped || 0 };
  }
  throw new Error('parse-transactions-image: exhausted retries');
}

// ----------------------------------------------------------------------------
// One-shot: rewrite fx_rate_at_tx on every THB-denominated tx (or any tx with
// a null FX rate) using the historical THB price on that tx's executed_at.
// Returns { updated, missing, total }.
// ----------------------------------------------------------------------------
export async function backfillHistoricalFx() {
  if (!supabaseEnabled) return { updated: 0, missing: 0, total: 0 };
  const { data, error } = await supabase
    .from('transactions')
    .select('id, executed_at, ticker, action, fx_rate_at_tx');
  if (error) throw error;
  const rows = data || [];
  let updated = 0, missing = 0;
  // Cache historical rate per date so we hit the edge function once per date,
  // not once per row.
  const cache = new Map();
  for (const t of rows) {
    const dateStr = new Date(t.executed_at).toISOString().slice(0, 10);
    let fx = cache.get(dateStr);
    if (fx === undefined) {
      const p = await fetchHistoricalPrice('THB', dateStr);
      fx = (p == null || p <= 0) ? null : Number((1 / p).toFixed(4));
      cache.set(dateStr, fx);
    }
    if (fx == null) { missing++; continue; }
    // Skip the UPDATE if the stored rate already matches (saves a write).
    if (Math.abs(Number(t.fx_rate_at_tx ?? 0) - fx) < 0.00005) { updated++; continue; }
    const { error: upErr } = await supabase
      .from('transactions')
      .update({ fx_rate_at_tx: fx })
      .eq('id', t.id);
    if (upErr) { console.warn('[backfillFx] update failed', t.id, upErr.message); missing++; continue; }
    updated++;
  }
  return { updated, missing, total: rows.length };
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
