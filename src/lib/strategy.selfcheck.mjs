import assert from 'node:assert/strict';
import { computeStrategy, findUnassigned, aggregateByTicker, ALLOCATION_TEMPLATES } from './strategy.js';

const assets = [
  { ticker: 'VOO',  holdingUSD: 500 },
  { ticker: 'VOO',  holdingUSD: 100 },  // second brokerage, same ticker
  { ticker: 'NVDA', holdingUSD: 300 },
  { ticker: 'BTC',  holdingUSD: 150 },
  { ticker: 'SOFI', holdingUSD: 50 },   // held but unassigned
  { ticker: 'OLD',  holdingUSD: 0 },    // closed position, ignored
];
const plan = {
  buckets: [
    { id: 'core',   name: 'Core',        target: 60 },
    { id: 'growth', name: 'Growth',      target: 25 },
    { id: 'spec',   name: 'Speculative', target: 15 },
  ],
  assignments: { VOO: 'core', NVDA: 'growth', BTC: 'spec' },
};

const r = computeStrategy(assets, plan);

assert.equal(aggregateByTicker(assets).get('VOO'), 600, 'aggregate across brokerages');
assert.equal(r.total, 1100, 'total excludes closed position');

const sum = r.rows.reduce((s, x) => s + x.actualPct, 0);
assert.ok(Math.abs(sum - 100) < 1e-9, `all actuals incl Unassigned sum to 100 (got ${sum})`);

for (const row of r.rows) {
  assert.ok(Math.abs(row.drift - (row.target - row.actualPct)) < 1e-9, `drift=target-actual for ${row.id}`);
}

const core = r.rows.find(x => x.id === 'core'); // 600/1100=54.5%, target 60 -> under -> buy
assert.ok(core.drift > 0 && core.tradeUSD > 0, 'under-weight bucket => buy');

assert.deepEqual(findUnassigned(assets, plan.assignments), ['SOFI'], 'unassigned detection');
const un = r.rows.find(x => x.id === 'unassigned');
assert.ok(un && Math.abs(un.holdingUSD - 50) < 1e-9, 'Unassigned row carries the 50');

// over-weight bucket => sell (growth = 300/1100 = 27.3% > 25% target)
const growth = r.rows.find(x => x.id === 'growth');
assert.ok(growth.drift < 0 && growth.tradeUSD < 0, 'over-weight bucket => sell');

// every allocation template's targets sum to 100
assert.ok(
  ALLOCATION_TEMPLATES.every(t => Math.abs(t.buckets.reduce((s, b) => s + b.target, 0) - 100) < 1e-9),
  'all templates sum to 100',
);

// regression: a ticker assigned to a non-existent bucket must still surface in unassignedTickers
const ghost = computeStrategy(
  [{ ticker: 'FOO', holdingUSD: 10 }],
  { buckets: [{ id: 'core', name: 'Core', target: 100 }], assignments: { FOO: 'no-such-bucket' } },
);
assert.ok(ghost.unassignedTickers.includes('FOO'), 'ghost-bucket ticker surfaced in unassignedTickers');
assert.ok(Math.abs(ghost.rows.find(x => x.id === 'unassigned').holdingUSD - 10) < 1e-9, 'ghost money lands in Unassigned');

console.log('strategy.selfcheck: OK');
