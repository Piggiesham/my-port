// ----------------------------------------------------------------------------
// Performance-page math. Pure functions, no I/O — see performance.selfcheck.mjs.
//
// TWR (time-weighted return): chain-links daily growth factors with external
// cash flows (deposits/withdrawals) stripped out, so the result is directly
// comparable to an index. Flows are taken from the day-over-day change in
// `invested` (net deposits) on the series produced by computeDailyReturnSeries,
// and are treated as arriving at the start of the day:
//   g_t = V_t / (V_{t-1} + F_t)
// ----------------------------------------------------------------------------

// series: [{ date, value, invested }] → [{ date, pct }] cumulative TWR in %.
// Leading days with no capital are skipped (pct 0 from the first funded day).
export function computeTwrSeries(series) {
  if (!series || series.length === 0) return [];
  const out = [];
  let cum = 1;
  let prevValue = null;
  let prevInvested = null;
  for (const p of series) {
    if (prevValue === null) {
      if (p.value > 0) { prevValue = p.value; prevInvested = p.invested; out.push({ date: p.date, pct: 0 }); }
      continue;
    }
    const flow = (p.invested ?? 0) - (prevInvested ?? 0);
    const base = prevValue + flow;
    const g = base > 0 ? p.value / base : 1;
    cum *= g;
    out.push({ date: p.date, pct: (cum - 1) * 100 });
    prevValue = p.value;
    prevInvested = p.invested;
  }
  return out;
}

// priceByDate: Map<'YYYY-MM-DD', price>; dates: Date[] (the portfolio series'
// dates). Rebases the benchmark to 0% at its first available price within the
// range, forward-filling gaps (weekends/holidays) up to 7 days back.
// Returns [{ date, pct }] with pct = null before the first price.
export function computeBenchmarkSeries(priceByDate, dates) {
  if (!priceByDate || !dates || dates.length === 0) return [];
  const MS_PER_DAY = 86400000;
  const lookup = (ms) => {
    for (let back = 0; back <= 7; back++) {
      const p = priceByDate.get(new Date(ms - back * MS_PER_DAY).toISOString().slice(0, 10));
      if (p != null && p > 0) return p;
    }
    return null;
  };
  let base = null;
  return dates.map((d) => {
    const price = lookup(d.getTime());
    if (price == null) return { date: d, pct: null };
    if (base == null) base = price;
    return { date: d, pct: (price / base - 1) * 100 };
  });
}

// Money-weighted return (%) over the series' range via Modified Dietz:
//   R = (V_end − V_begin − F) / (V_begin + Σ F_i · w_i)
// where w_i is the fraction of the period remaining after flow i. Unlike TWR
// this rewards/punishes deposit timing — the TWR−MWR gap is "did my timing
// help". Day-0 deposits are folded into V_begin (weight 1).
export function modifiedDietz(series) {
  if (!series || series.length < 2) return null;
  const start = series.findIndex(p => p.value > 0);
  if (start < 0) return null;
  const s = series.slice(start);
  if (s.length < 2) return null;
  const N = s.length - 1;
  const vBegin = s[0].value;
  let flows = 0, weighted = 0;
  for (let i = 1; i <= N; i++) {
    const f = (s[i].invested ?? 0) - (s[i - 1].invested ?? 0);
    if (f !== 0) { flows += f; weighted += f * ((N - i) / N); }
  }
  const denom = vBegin + weighted;
  if (denom <= 0) return null;
  return ((s[N].value - vBegin - flows) / denom) * 100;
}

// Max drawdown of a TWR series, as a negative % (0 if never down from a peak).
export function maxDrawdown(twrSeries) {
  let peak = -Infinity;
  let worst = 0;
  for (const p of twrSeries) {
    const level = 1 + p.pct / 100;
    if (level > peak) peak = level;
    else if (peak > 0) worst = Math.min(worst, (level / peak - 1) * 100);
  }
  return worst;
}

// Underwater series + stats from a cumulative TWR series.
// Returns { series: [{date, dd}], worst, current, recoveryDays } where dd ≤ 0
// in %, and recoveryDays is trough → regained-prior-peak (null if not yet).
export function drawdownStats(twrSeries) {
  if (!twrSeries || twrSeries.length === 0) return null;
  const MS_PER_DAY = 86400000;
  let peak = -Infinity;
  let worst = 0, troughIdx = 0, peakAtTrough = 1;
  const series = twrSeries.map((p, i) => {
    const level = 1 + p.pct / 100;
    if (level > peak) peak = level;
    const dd = peak > 0 ? Math.min(0, (level / peak - 1) * 100) : 0;
    if (dd < worst) { worst = dd; troughIdx = i; peakAtTrough = peak; }
    return { date: p.date, dd };
  });
  let recoveryDays = null;
  for (let i = troughIdx + 1; i < twrSeries.length; i++) {
    if (1 + twrSeries[i].pct / 100 >= peakAtTrough) {
      recoveryDays = Math.round((twrSeries[i].date - twrSeries[troughIdx].date) / MS_PER_DAY);
      break;
    }
  }
  return { series, worst, current: series[series.length - 1].dd, recoveryDays };
}

// Per-ticker contribution to the period's return.
// Replays quantities up to `from`, values positions at the range ends against
// priceHistory, and nets out intra-range flows so only market moves,
// dividends, and trade costs land in `gain`:
//   gain = endVal − startVal − net money moved into the ticker
//          + dividends − per-trade fees/taxes
// USD cash nets to ~0 by construction (price 1, trades are internal flows);
// THB shows pure FX gain/loss. pp = gain / (startVal_total + in-period net
// deposits) — the same capital-deployed base the Overview period % uses, so
// rows roughly sum to the period return (not exactly TWR; that's fine).
export function computeContribution(transactions, priceHistory, from, to) {
  if (!transactions || transactions.length === 0) return [];
  const MS_PER_DAY = 86400000;
  const toYMD = (d) => new Date(d).toISOString().slice(0, 10);
  const fromMs = new Date(toYMD(from) + 'T00:00:00Z').getTime();
  const toMs = new Date(toYMD(to) + 'T00:00:00Z').getTime();

  const priceAt = (ticker, ms, fallback) => {
    if (ticker === 'USD') return 1;
    const hist = priceHistory?.get(ticker);
    if (hist) {
      for (let back = 0; back <= 7; back++) {
        const p = hist.get(new Date(ms - back * MS_PER_DAY).toISOString().slice(0, 10));
        if (p != null && p > 0) return p;
      }
    }
    return fallback ?? 0;
  };

  const qty = new Map();       // ticker -> current qty
  const lastTxPrice = new Map();
  const flow = new Map();      // ticker -> net USD moved into it during range
  const adj = new Map();       // ticker -> dividends − fees/taxes during range
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  let netDeposits = 0;         // external flows during range (USD)

  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const startQty = new Map();  // qty snapshot at range start
  let snapped = false;
  const snap = () => { for (const [k, v] of qty) startQty.set(k, v); snapped = true; };

  for (const t of sorted) {
    const txMs = new Date(t.date).getTime();
    if (!snapped && txMs >= fromMs) snap();
    if (txMs > toMs + MS_PER_DAY - 1) break;
    const inRange = txMs >= fromMs;

    const shares = Number(t.shares ?? 0);
    const price = t.price != null ? Number(t.price) : (t.ticker === 'USD' ? 1 : null);
    const fees = (Number(t.fees) || 0) + (Number(t.taxes) || 0);
    const value = Number(t.valueUSD) || 0;

    if (t.action === 'Buy' || t.action === 'Deposit') bump(qty, t.ticker, shares);
    else if (t.action === 'Sell' || t.action === 'Withdraw') bump(qty, t.ticker, -shares);
    if (price != null) lastTxPrice.set(t.ticker, price);

    // Cash side-effects mirror computeDailyReturnSeries (USD settlement).
    if (t.action === 'Buy') bump(qty, 'USD', -(shares * price + fees));
    else if (t.action === 'Sell') bump(qty, 'USD', shares * price - fees);
    else if (t.action === 'Dividend') bump(qty, 'USD', value);
    else if (t.action === 'Fee' || t.action === 'Tax') bump(qty, 'USD', -value);

    if (!inRange) continue;

    if (t.action === 'Buy') {
      bump(flow, t.ticker, shares * price);
      bump(flow, 'USD', -(shares * price + fees));
      bump(adj, t.ticker, -fees);
    } else if (t.action === 'Sell') {
      bump(flow, t.ticker, -(shares * price));
      bump(flow, 'USD', shares * price - fees);
      bump(adj, t.ticker, -fees);
    } else if (t.action === 'Dividend') {
      bump(adj, t.ticker, value);
      bump(flow, 'USD', value);
    } else if (t.action === 'Fee' || t.action === 'Tax') {
      bump(adj, t.ticker || 'USD', -value);
      bump(flow, 'USD', -value);
    } else if (t.action === 'Deposit' || t.action === 'Withdraw') {
      const sign = t.action === 'Deposit' ? 1 : -1;
      bump(flow, t.ticker, sign * value);
      netDeposits += sign * value;
    }
  }
  if (!snapped) snap();

  let startTotal = 0;
  const rows = [];
  const tickers = new Set([...qty.keys(), ...startQty.keys(), ...flow.keys(), ...adj.keys()]);
  for (const ticker of tickers) {
    // No clamping at 0: valuing negative cash at face keeps the accounting
    // identity (Σ gains = value change − flows) exact; real ledgers never go
    // negative anyway (the RPCs enforce it).
    const q0 = startQty.get(ticker) || 0;
    const q1 = qty.get(ticker) || 0;
    const startVal = q0 !== 0 ? q0 * priceAt(ticker, fromMs, lastTxPrice.get(ticker)) : 0;
    const endVal = q1 !== 0 ? q1 * priceAt(ticker, toMs, lastTxPrice.get(ticker)) : 0;
    startTotal += startVal;
    const gain = endVal - startVal - (flow.get(ticker) || 0) + (adj.get(ticker) || 0);
    rows.push({ ticker, gain, startVal, endVal });
  }

  const base = startTotal + netDeposits;
  return rows
    .map(r => ({ ticker: r.ticker, gain: r.gain, pp: base > 1e-9 ? (r.gain / base) * 100 : 0 }))
    .filter(r => Math.abs(r.gain) > 0.005 || r.ticker === 'USD' || r.ticker === 'THB')
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
}

// Annualized volatility (%) from a cumulative TWR series over CALENDAR days.
// Weekend/holiday returns are 0, so daily variance over calendar days is
// (tradingDays/365) × trading-day variance — annualizing with √365 recovers
// the standard √252-over-trading-days figure without filtering weekends.
export function annualizedVolatility(twrSeries) {
  if (!twrSeries || twrSeries.length < 3) return null;
  const rets = [];
  for (let i = 1; i < twrSeries.length; i++) {
    const a = 1 + twrSeries[i - 1].pct / 100;
    const b = 1 + twrSeries[i].pct / 100;
    if (a > 0) rets.push(b / a - 1);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varSum = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varSum) * Math.sqrt(365) * 100;
}
