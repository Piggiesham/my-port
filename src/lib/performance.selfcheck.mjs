// Run: node src/lib/performance.selfcheck.mjs
import assert from 'node:assert/strict';
import {
  computeTwrSeries, computeBenchmarkSeries, maxDrawdown, annualizedVolatility,
  modifiedDietz, computeContribution,
} from './performance.js';

const d = (n) => new Date(Date.UTC(2026, 0, 1 + n));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// --- TWR: deposit mid-stream must NOT count as return -----------------------
// Day0: deposit 100, worth 100. Day1: grows to 110 (+10%).
// Day2: deposit 110 more (value 220), no market move. Day3: +10% again → 242.
let twr = computeTwrSeries([
  { date: d(0), value: 100, invested: 100 },
  { date: d(1), value: 110, invested: 100 },
  { date: d(2), value: 220, invested: 210 },
  { date: d(3), value: 242, invested: 210 },
]);
close(twr[1].pct, 10);
close(twr[2].pct, 10);           // deposit day: no phantom gain
close(twr[3].pct, 21);           // 1.1 × 1.1 − 1
assert.equal(twr[0].pct, 0);

// Withdrawal is a negative flow, not a loss.
twr = computeTwrSeries([
  { date: d(0), value: 100, invested: 100 },
  { date: d(1), value: 50, invested: 50 },   // withdrew 50, flat market
]);
close(twr[1].pct, 0);

// Leading unfunded days are skipped.
twr = computeTwrSeries([
  { date: d(0), value: 0, invested: 0 },
  { date: d(1), value: 100, invested: 100 },
  { date: d(2), value: 105, invested: 100 },
]);
assert.equal(twr.length, 2);
close(twr[1].pct, 5);

// --- Benchmark rebase + forward fill ----------------------------------------
const prices = new Map([
  ['2026-01-01', 200],
  ['2026-01-02', 210],
  // 01-03 missing (weekend) → forward-fill from 01-02
  ['2026-01-04', 220],
]);
const bench = computeBenchmarkSeries(prices, [d(0), d(1), d(2), d(3)]);
close(bench[0].pct, 0);
close(bench[1].pct, 5);
close(bench[2].pct, 5);          // forward-filled
close(bench[3].pct, 10);

// No data at all before range → all null.
assert.ok(computeBenchmarkSeries(new Map(), [d(0), d(1)]).every(p => p.pct === null));

// --- Max drawdown ------------------------------------------------------------
// 0% → +20% → −10% (level 0.9 from peak 1.2 = −25%) → +30%
const dd = maxDrawdown([{ pct: 0 }, { pct: 20 }, { pct: -10 }, { pct: 30 }].map((p, i) => ({ date: d(i), ...p })));
close(dd, -25);
assert.equal(maxDrawdown([{ pct: 0 }, { pct: 5 }, { pct: 9 }]), 0);

// --- Volatility ----------------------------------------------------------------
// Constant series → 0 vol; too-short series → null.
close(annualizedVolatility([{ pct: 0 }, { pct: 0 }, { pct: 0 }, { pct: 0 }]), 0);
assert.equal(annualizedVolatility([{ pct: 0 }, { pct: 1 }]), null);
// Alternating ±1% daily is a big annualized number (sanity: > 10%).
const alt = Array.from({ length: 30 }, (_, i) => ({ pct: i % 2 ? 1 : 0 }));
assert.ok(annualizedVolatility(alt) > 10);

// --- Modified Dietz -----------------------------------------------------------
// No flows: plain return.
close(modifiedDietz([
  { date: d(0), value: 100, invested: 100 },
  { date: d(1), value: 110, invested: 100 },
]), 10);
// Deposit halfway through, then +10%: MWR > TWR because the deposit caught the gain.
// V=100→(deposit 100)→210? no growth→231 (+10%). Dietz: (231−100−100)/(100+100·0.5) = 20.67%.
close(modifiedDietz([
  { date: d(0), value: 100, invested: 100 },
  { date: d(1), value: 210, invested: 200 },
  { date: d(2), value: 231, invested: 200 },
]), (31 / 150) * 100, 1e-6);
assert.equal(modifiedDietz([{ date: d(0), value: 0, invested: 0 }]), null);

// --- Contribution -----------------------------------------------------------------
const hist = new Map([
  ['AAA', new Map([['2026-01-05', 100], ['2026-01-15', 150]])],
  ['THB', new Map([['2026-01-05', 0.030], ['2026-01-15', 0.033]])],
]);
const txs = [
  // Before range: fund and buy 1 AAA @ 100.
  { date: d(0).toISOString(), action: 'Deposit', ticker: 'USD', shares: 300, price: 1, valueUSD: 300 },
  { date: d(0).toISOString(), action: 'Buy', ticker: 'AAA', shares: 1, price: 100, valueUSD: 100 },
  // In range (from = Jan 5): buy 1 more @ 120 with $1 fee, receive $10 dividend.
  { date: d(9).toISOString(), action: 'Buy', ticker: 'AAA', shares: 1, price: 120, fees: 1, valueUSD: 120 },
  { date: d(11).toISOString(), action: 'Dividend', ticker: 'AAA', valueUSD: 10 },
];
const rows = computeContribution(txs, hist, d(4), d(14));
const aaa = rows.find(r => r.ticker === 'AAA');
const usd = rows.find(r => r.ticker === 'USD');
// AAA: start 1×100=100, end 2×150=300, flow +120, fee −1, div +10 → gain 89.
close(aaa.gain, 89);
// USD cash is pure internal flows → gain 0.
close(usd.gain, 0);
// pp base = startTotal (100 AAA + 200 USD) + 0 deposits = 300.
close(aaa.pp, (89 / 300) * 100, 1e-6);
// THB deposit mid-range, FX moves 0.030→0.033: gain = FX only.
const thbTxs = [
  { date: d(6).toISOString(), action: 'Deposit', ticker: 'THB', shares: 1000, price: 0.030, valueUSD: 30 },
];
const thbRows = computeContribution(thbTxs, hist, d(4), d(14));
const thb = thbRows.find(r => r.ticker === 'THB');
close(thb.gain, 1000 * 0.033 - 30); // +$3 FX gain
// Sell path: no phantom gain when selling flat.
const sellTxs = [
  { date: d(0).toISOString(), action: 'Buy', ticker: 'AAA', shares: 2, price: 100, valueUSD: 200 },
  { date: d(9).toISOString(), action: 'Sell', ticker: 'AAA', shares: 1, price: 150, valueUSD: 150 },
];
const sellRows = computeContribution(sellTxs, hist, d(4), d(14));
// start 2×100=200, end 1×150=150, flow −150 → gain +100 (the 100→150 move on 2 shares).
close(sellRows.find(r => r.ticker === 'AAA').gain, 100);
close(sellRows.find(r => r.ticker === 'USD').gain, 0);

console.log('performance.selfcheck: OK');
