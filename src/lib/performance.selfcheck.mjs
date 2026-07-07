// Run: node src/lib/performance.selfcheck.mjs
import assert from 'node:assert/strict';
import { computeTwrSeries, computeBenchmarkSeries, maxDrawdown, annualizedVolatility } from './performance.js';

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

console.log('performance.selfcheck: OK');
