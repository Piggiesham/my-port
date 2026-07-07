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
