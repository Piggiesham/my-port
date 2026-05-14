// Data-access layer. Reads from Supabase when configured; otherwise returns
// the mock data from src/data.js so the UI still works for local development.

import { supabase, supabaseEnabled } from './supabase.js';
import {
  ASSETS as MOCK_ASSETS,
  TRANSACTIONS as MOCK_TRANSACTIONS,
  SOURCES as MOCK_SOURCES,
} from '../data.js';

// Map brokerage IDs ('dime') back to display names ('Dime!') used in the UI.
const BROKER_ID_TO_NAME = { dime: 'Dime!', webull: 'Webull', binance: 'Binance' };
const BROKER_NAME_TO_ID = { 'Dime!': 'dime', 'Webull': 'webull', 'Binance': 'binance' };

// ----------------------------------------------------------------------------
// Assets (holdings joined with asset metadata + latest price)
// Returns rows in the shape the existing components expect:
//   { ticker, name, type, source, logo, price, qty, cost, holdingUSD, pctProfit, plUSD, isCash }
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
// Transactions
// ----------------------------------------------------------------------------
export async function fetchTransactions() {
  if (!supabaseEnabled) return MOCK_TRANSACTIONS;

  const { data, error } = await supabase
    .from('transactions')
    .select('id, brokerage_id, ticker, action, shares, price, value_usd, executed_at')
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
    source: BROKER_ID_TO_NAME[t.brokerage_id] ?? t.brokerage_id,
    status: 'Done',
  }));
}

export async function addTransaction({ portfolio, ticker, action, shares, price, valueUsd, fees = 0, taxes = 0, description, executedAt }) {
  if (!supabaseEnabled) throw new Error('Supabase not configured');

  const { data, error } = await supabase.from('transactions').insert({
    brokerage_id: BROKER_NAME_TO_ID[portfolio] ?? portfolio,
    ticker,
    action,
    shares,
    price,
    value_usd: valueUsd,
    fees,
    taxes,
    description,
    executed_at: executedAt,
  }).select().single();
  if (error) throw error;
  return data;
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
