# Strategy Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub Watchlist tab with a **Strategy** page that shows custom-bucket target-vs-actual drift and trades, NotebookLM-grounded suggestions, a research hub, and an allocation workbench.

**Architecture:** A committed `src/data/plan.json` (buckets, ticker→bucket assignments, targets, suggestions, research) is the single source of truth. `src/lib/strategy.js` (pure) turns live holdings + plan into drift/trade rows. Dumb React panels render the result. A local, Claude-orchestrated `notebooklm-py` pipeline distills NotebookLM answers into `plan.json`; the deployed app only reads it.

**Tech Stack:** React 18 + Vite, existing `CurrencyContext`/`fmt2`/`fmtCurrency` helpers, plain SVG/CSS. Tests for pure logic use Node's `assert` (no test framework — the repo has none). Component tasks verify via `vite build` + `eslint` + manual dev-server check.

## Global Constraints

- **USD canonical:** all math in USD; convert to THB only at render with `cur.fxRate` (live), falling back to `FX_RATE`. Copy the AssetList pattern.
- **No new runtime deps** for the web app. `notebooklm-py` is a *local* Python tool, never imported by the app and never deployed.
- **plan.json is the only source of truth.** The page is read-only; no localStorage, no DB. Edits happen by changing the file.
- **Secrets** (Google cookies/token, notebook id) live in `.gitignore`'d local config, never committed.
- **Commit message trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Model per task** is noted in each task header (assigned by task complexity).

---

### Task 1: Pure strategy math (`strategy.js`) — **Model: Opus**

**Files:**
- Create: `src/lib/strategy.js`
- Test: `src/lib/strategy.selfcheck.mjs`

**Interfaces:**
- Consumes: nothing (pure; no imports).
- Produces:
  - `ALLOCATION_TEMPLATES: Array<{ id, name, buckets: Array<{id,name,target}> }>`
  - `aggregateByTicker(assets) → Map<ticker, holdingUSD>`
  - `findUnassigned(assets, assignments) → string[]`
  - `computeStrategy(assets, plan) → { total:number, rows: Array<{ id, name, target, actualPct, holdingUSD, drift, tradeUSD }>, unassignedTickers:string[], totalDriftPct:number }` — `rows` has one entry per `plan.buckets` plus an `id:'unassigned'` row when unmapped holdings exist. `tradeUSD > 0` = buy, `< 0` = sell.

- [ ] **Step 1: Write the failing self-check**

Create `src/lib/strategy.selfcheck.mjs`:

```js
import assert from 'node:assert/strict';
import { computeStrategy, findUnassigned, aggregateByTicker } from './strategy.js';

const assets = [
  { ticker: 'VOO',  holdingUSD: 500 },
  { ticker: 'VOO',  holdingUSD: 100 },  // second brokerage, same ticker
  { ticker: 'NVDA', holdingUSD: 200 },
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

console.log('strategy.selfcheck: OK');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node src/lib/strategy.selfcheck.mjs`
Expected: FAIL — `Cannot find module './strategy.js'`.

- [ ] **Step 3: Implement `strategy.js`**

Create `src/lib/strategy.js`:

```js
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
      if (!assignments[ticker]) unassignedTickers.push(ticker);
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
```

- [ ] **Step 4: Run the self-check to confirm it passes**

Run: `node src/lib/strategy.selfcheck.mjs`
Expected: prints `strategy.selfcheck: OK`, exit 0.

- [ ] **Step 5: Lint**

Run: `npx eslint src/lib/strategy.js src/lib/strategy.selfcheck.mjs`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/strategy.js src/lib/strategy.selfcheck.mjs
git commit -m "$(printf 'feat(strategy): pure bucket drift/trade math + self-check\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Seed `plan.json` — **Model: main session (you + Claude), not a subagent**

Bucket assignments are a personal decision, so this is done interactively, not farmed to a subagent. The file below is a valid starting point using real held tickers; finalize the buckets/targets/assignments with the user.

**Files:**
- Create: `src/data/plan.json`

- [ ] **Step 1: Create the seed file**

Create `src/data/plan.json`:

```json
{
  "meta": { "updated": "2026-07-06", "riskProfile": "moderate" },
  "buckets": [
    { "id": "core",    "name": "Core",        "target": 45 },
    { "id": "growth",  "name": "Growth",      "target": 30 },
    { "id": "spec",    "name": "Speculative", "target": 10 },
    { "id": "ballast", "name": "Ballast",     "target": 15 }
  ],
  "assignments": {
    "VOO": "core", "MA": "core", "PM": "core", "GOOGL": "core",
    "AMZN": "growth", "META": "growth", "UBER": "growth", "MELI": "growth", "TSM": "growth",
    "NVDA": "growth", "VSAT": "spec", "BTC": "spec",
    "USD": "ballast", "THB": "ballast"
  },
  "guardrails": { "maxSingleName": 12, "minCash": 5 },
  "suggestions": [
    { "bucket": "growth", "action": "Placeholder — run 'update my plan' to populate", "why": "Seeded before first NotebookLM refresh.", "cite": "" }
  ],
  "research": [
    { "scope": "core", "summary": "Placeholder research note — populated by the NotebookLM refresh.", "cite": "" }
  ]
}
```

- [ ] **Step 2: Sanity-check targets sum to 100**

Run: `node -e "const p=require('./src/data/plan.json');console.log(p.buckets.reduce((s,b)=>s+b.target,0))"`
Expected: `100`.

- [ ] **Step 3: Commit**

```bash
git add src/data/plan.json
git commit -m "$(printf 'feat(strategy): seed plan.json with buckets + assignments\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Strategy page shell + Rebalance panel + nav wiring — **Model: Sonnet**

Deliverable: clicking **Strategy** in the nav shows the Rebalance section computed from live holdings.

**Files:**
- Create: `src/components/StrategyPage.jsx`
- Create: `src/components/strategy/RebalancePanel.jsx`
- Modify: `src/data.js` (add `fmtLive` helper near `fmt2`)
- Modify: `src/App.jsx` (nav rename + route; remove Watchlist import/route)
- Delete: `src/components/WatchlistPage.jsx`
- Modify: `src/index.css` (append the `.rebal-*` / `.strategy-*` block below)

**Interfaces:**
- Consumes: `computeStrategy` (Task 1), `plan.json` (Task 2), `CurrencyContext`/`FX_RATE`/`fmt2` from `data.js`, `assets` prop from `App.jsx`.
- Produces: `<StrategyPage assets={assets} />`; `fmtLive(usd, cur) → string` in `data.js`.

- [ ] **Step 1: Add `fmtLive` to `src/data.js`**

Immediately after the `fmt2` export, add:

```js
// Money formatter for a USD value using the LIVE fx rate from CurrencyContext
// (unlike fmtCurrency, which uses the constant FX_RATE). Mirrors AssetList.
export const fmtLive = (usd, cur) => {
  const fx = (cur && cur.fxRate) || FX_RATE;
  const v = cur && cur.currency === 'THB' ? usd * fx : usd;
  return (cur && cur.currency === 'THB' ? '฿' : '$') + fmt2(v);
};
```

- [ ] **Step 2: Create `RebalancePanel.jsx`**

Create `src/components/strategy/RebalancePanel.jsx`:

```jsx
import { useContext } from 'react';
import { CurrencyContext, fmtLive } from '../../data.js';

export default function RebalancePanel({ strategy, plan }) {
  const cur = useContext(CurrencyContext);
  const { rows, total, totalDriftPct, unassignedTickers } = strategy;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Rebalance</div>
          <div className="card-sub">drift {totalDriftPct.toFixed(1)}% · last set {plan.meta?.updated || '—'}</div>
        </div>
        <div className="num" style={{ fontWeight: 600 }}>{fmtLive(total, cur)}</div>
      </div>

      {unassignedTickers.length > 0 && (
        <div className="strategy-unassigned">
          {unassignedTickers.length} holding{unassignedTickers.length > 1 ? 's' : ''} unassigned — {unassignedTickers.join(', ')}
        </div>
      )}

      {rows.map(r => {
        const buy = r.tradeUSD >= 0;
        const onTarget = Math.abs(r.tradeUSD) < 0.5;
        return (
          <div className="rebal-row" key={r.id}>
            <div className="rebal-label">
              <span className="rebal-name">{r.name}</span>
              <span className="rebal-target">{r.target}% target</span>
            </div>
            <div className="rebal-bar">
              <div className="rebal-bar-target" style={{ width: `${Math.min(r.target, 100)}%` }} />
              <div className="rebal-bar-actual" style={{ width: `${Math.min(r.actualPct, 100)}%` }} />
            </div>
            <div className="rebal-figures">
              <span className="rebal-actual">{r.actualPct.toFixed(1)}%</span>
              <span className={`rebal-trade ${buy ? 'up' : 'down'}`}>
                {onTarget ? 'on target' : `${buy ? '▲ buy' : '▼ sell'} ${fmtLive(Math.abs(r.tradeUSD), cur)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Create `StrategyPage.jsx`**

Create `src/components/StrategyPage.jsx`:

```jsx
import { useMemo } from 'react';
import plan from '../data/plan.json';
import { computeStrategy } from '../lib/strategy.js';
import RebalancePanel from './strategy/RebalancePanel.jsx';

export default function StrategyPage({ assets = [] }) {
  const strategy = useMemo(() => computeStrategy(assets, plan), [assets]);
  return (
    <div className="strategy-page">
      <RebalancePanel strategy={strategy} plan={plan} />
    </div>
  );
}
```

- [ ] **Step 4: Wire into `App.jsx`**

In `src/App.jsx`:
1. Replace the import `import WatchlistPage from './components/WatchlistPage.jsx';` with `import StrategyPage from './components/StrategyPage.jsx';`
2. Change `const navItems = ['Overview', 'Transactions', 'Watchlist'];` to `const navItems = ['Overview', 'Transactions', 'Strategy'];`
3. Replace `{navTab === 'Watchlist' && <WatchlistPage />}` with `{navTab === 'Strategy' && <StrategyPage assets={assets} />}`

- [ ] **Step 5: Delete the old page**

Run: `git rm src/components/WatchlistPage.jsx`

- [ ] **Step 6: Append CSS to `src/index.css`**

```css
.strategy-page { display: flex; flex-direction: column; gap: 20px; }
.strategy-unassigned { margin: 8px 0 4px; padding: 8px 12px; border-radius: 8px; font-size: 12px;
  color: var(--text-dim); background: rgba(251,191,36,0.10); border: 1px solid rgba(251,191,36,0.25); }
.rebal-row { display: grid; grid-template-columns: 150px 1fr 160px; gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); }
.rebal-label { display: flex; flex-direction: column; gap: 2px; }
.rebal-name { font-weight: 600; font-size: 14px; }
.rebal-target { font-size: 12px; color: var(--text-faint); }
.rebal-bar { position: relative; height: 10px; border-radius: 6px; background: var(--panel-2); overflow: hidden; }
.rebal-bar-target { position: absolute; inset: 0 auto 0 0; height: 100%; background: var(--border-strong); opacity: 0.6; }
.rebal-bar-actual { position: absolute; inset: 0 auto 0 0; height: 100%; background: var(--accent); border-radius: 6px; }
.rebal-figures { display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.rebal-actual { color: var(--text-dim); }
.rebal-trade.up { color: var(--green); }
.rebal-trade.down { color: var(--red); }
@media (max-width: 880px) {
  .rebal-row { grid-template-columns: 1fr; gap: 8px; }
  .rebal-figures { justify-content: flex-start; gap: 16px; }
}
```

- [ ] **Step 7: Build + lint**

Run: `npx vite build && npx eslint src/components/StrategyPage.jsx src/components/strategy/RebalancePanel.jsx src/App.jsx src/data.js`
Expected: build succeeds; eslint clean.

- [ ] **Step 8: Manual check**

Run the dev server, open the app, click **Strategy**. Confirm: the Rebalance card lists each bucket with a target/actual bar and a buy/sell figure, a total top-right, and (if any held ticker is unmapped) the unassigned banner. Toggle USD/THB — money values convert, percentages stay.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(printf 'feat(strategy): Strategy page shell + Rebalance panel, replace Watchlist\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Allocation Workbench — **Model: Opus**

The interactive target-drafting aid: seed from a template, adjust sliders with live sum + guardrail flags, and produce a one-line commit instruction. State is ephemeral (resets to `plan.json` on refresh).

**Files:**
- Create: `src/components/strategy/AllocationWorkbench.jsx`
- Modify: `src/components/StrategyPage.jsx` (mount it above RebalancePanel)
- Modify: `src/index.css` (append `.wb-*` block below)

**Interfaces:**
- Consumes: `ALLOCATION_TEMPLATES` (Task 1), `plan.buckets` + `plan.guardrails` (Task 2). Does NOT use currency or `strategy` — it drafts targets only.
- Produces: `<AllocationWorkbench plan={plan} />`.

- [ ] **Step 1: Create `AllocationWorkbench.jsx`**

```jsx
import { useState, useMemo } from 'react';
import { ALLOCATION_TEMPLATES } from '../../lib/strategy.js';

// Build the editable draft from the committed buckets.
const draftFromBuckets = (buckets) => buckets.map(b => ({ id: b.id, name: b.name, target: b.target }));

export default function AllocationWorkbench({ plan }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromBuckets(plan.buckets));
  const [seed, setSeed] = useState('current');

  const sum = useMemo(() => draft.reduce((s, b) => s + (Number(b.target) || 0), 0), [draft]);
  const sumOk = Math.abs(sum - 100) < 0.001;

  const applyTemplate = (tplId) => {
    setSeed(tplId);
    if (tplId === 'current') { setDraft(draftFromBuckets(plan.buckets)); return; }
    const tpl = ALLOCATION_TEMPLATES.find(t => t.id === tplId);
    if (tpl) setDraft(tpl.buckets.map(b => ({ ...b })));
  };

  const setTarget = (id, v) => setDraft(d => d.map(b => b.id === id ? { ...b, target: Number(v) } : b));

  // One-line instruction the user hands to Claude to persist.
  const instruction = useMemo(() => {
    const parts = draft.map(b => `${b.name} ${b.target}%`).join(', ');
    return `set targets: ${parts}`;
  }, [draft]);

  const minCash = plan.guardrails?.minCash ?? 0;
  const cashBucket = draft.find(b => /cash|ballast/i.test(b.name));
  const cashViol = cashBucket && cashBucket.target < minCash;

  return (
    <div className="card wb">
      <div className="wb-head" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="card-title">Allocation Workbench</div>
          <div className="card-sub">draft a target — nothing saves until you commit</div>
        </div>
        <span className={`wb-caret ${open ? 'open' : ''}`}>▾</span>
      </div>

      {open && (
        <div className="wb-body">
          <div className="wb-seeds">
            <span className="wb-label">Seed:</span>
            <button className={`pill-btn ${seed === 'current' ? 'active' : ''}`} onClick={() => applyTemplate('current')}>My current</button>
            {ALLOCATION_TEMPLATES.map(t => (
              <button key={t.id} className={`pill-btn ${seed === t.id ? 'active' : ''}`} onClick={() => applyTemplate(t.id)}>{t.name}</button>
            ))}
            <span className="wb-note">Tip: ask Claude to “propose an allocation from my research” to seed from NotebookLM.</span>
          </div>

          {draft.map(b => (
            <div className="wb-row" key={b.id}>
              <span className="wb-name">{b.name}</span>
              <input type="range" min="0" max="100" step="1" value={b.target} onChange={e => setTarget(b.id, e.target.value)} />
              <input className="field-input wb-num" type="number" min="0" max="100" value={b.target} onChange={e => setTarget(b.id, e.target.value)} />
              <span className="wb-pct">%</span>
            </div>
          ))}

          <div className={`wb-sum ${sumOk ? 'ok' : 'bad'}`}>Sum: {sum.toFixed(0)}% {sumOk ? '✓' : '— must equal 100%'}</div>
          {cashViol && <div className="wb-guard">⚠ Ballast/cash {cashBucket.target}% is below your {minCash}% minimum</div>}

          <div className="wb-commit">
            <span className="wb-label">To commit:</span>
            <code className="wb-instruction">{instruction}</code>
            <div className="wb-note">Paste that to Claude — it writes plan.json and pushes. (Sliders reset on refresh.)</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `StrategyPage.jsx`**

Add the import `import AllocationWorkbench from './strategy/AllocationWorkbench.jsx';` and render it above `RebalancePanel`:

```jsx
    <div className="strategy-page">
      <AllocationWorkbench plan={plan} />
      <RebalancePanel strategy={strategy} plan={plan} />
    </div>
```

- [ ] **Step 3: Append CSS to `src/index.css`**

```css
.wb-head { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
.wb-caret { transition: transform 0.18s; color: var(--text-dim); }
.wb-caret.open { transform: rotate(180deg); }
.wb-body { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.wb-seeds { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wb-label { font-size: 12px; color: var(--text-faint); }
.wb-note { font-size: 11px; color: var(--text-faint); }
.wb-row { display: grid; grid-template-columns: 120px 1fr 72px 16px; gap: 10px; align-items: center; }
.wb-name { font-size: 13px; font-weight: 600; }
.wb-num { padding: 6px 8px; text-align: right; }
.wb-pct { color: var(--text-faint); font-size: 12px; }
.wb-sum { font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.wb-sum.ok { color: var(--green); }
.wb-sum.bad { color: var(--red); }
.wb-guard { font-size: 12px; color: var(--red); }
.wb-commit { margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.wb-instruction { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: var(--panel-2); padding: 8px 10px; border-radius: 8px; }
```

- [ ] **Step 4: Build + lint**

Run: `npx vite build && npx eslint src/components/strategy/AllocationWorkbench.jsx src/components/StrategyPage.jsx`
Expected: build succeeds; eslint clean (no unused vars).

- [ ] **Step 5: Manual check**

Dev server → Strategy → expand Workbench. Click each template (sliders jump to that model), drag a slider (sum indicator updates, turns red off-100), set Ballast below the min (guardrail warns), read the commit instruction string. Refresh → draft resets to plan.json.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(printf 'feat(strategy): Allocation Workbench (seed/adjust/commit-instruction)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Suggestions panel — **Model: Haiku**

Dumb renderer of `plan.suggestions`, grouped by bucket, with citation chips.

**Files:**
- Create: `src/components/strategy/SuggestionsPanel.jsx`
- Modify: `src/components/StrategyPage.jsx` (mount below RebalancePanel)
- Modify: `src/index.css` (append `.sugg-*` block)

**Interfaces:**
- Consumes: `plan.suggestions: Array<{ bucket, action, why, cite }>`, `plan.buckets` (for bucket display names).
- Produces: `<SuggestionsPanel plan={plan} />`.

- [ ] **Step 1: Create `SuggestionsPanel.jsx`**

```jsx
export default function SuggestionsPanel({ plan }) {
  const suggestions = plan.suggestions || [];
  const nameOf = (id) => (plan.buckets.find(b => b.id === id)?.name) || id || 'General';
  if (suggestions.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Suggestions</div>
          <div className="card-sub">grounded in your research · {suggestions.length}</div>
        </div>
      </div>
      {suggestions.map((s, i) => (
        <div className="sugg-row" key={i}>
          <span className="sugg-bucket">{nameOf(s.bucket)}</span>
          <div className="sugg-body">
            <div className="sugg-action">{s.action}</div>
            {s.why && <div className="sugg-why">{s.why}</div>}
          </div>
          {s.cite ? <span className="sugg-cite" title={s.cite}>{s.cite}</span> : null}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `StrategyPage.jsx`**

Import `SuggestionsPanel` and render it after `RebalancePanel`:

```jsx
      <RebalancePanel strategy={strategy} plan={plan} />
      <SuggestionsPanel plan={plan} />
```

- [ ] **Step 3: Append CSS**

```css
.sugg-row { display: grid; grid-template-columns: 110px 1fr auto; gap: 12px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--border); }
.sugg-bucket { font-size: 12px; font-weight: 600; color: var(--text-dim); padding-top: 2px; }
.sugg-action { font-size: 14px; font-weight: 500; }
.sugg-why { font-size: 12px; color: var(--text-faint); margin-top: 3px; line-height: 1.4; }
.sugg-cite { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); background: var(--panel-2); padding: 3px 7px; border-radius: 6px; white-space: nowrap; }
@media (max-width: 880px) { .sugg-row { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Build + lint**

Run: `npx vite build && npx eslint src/components/strategy/SuggestionsPanel.jsx src/components/StrategyPage.jsx`
Expected: build succeeds; eslint clean.

- [ ] **Step 5: Manual check**

Dev server → Strategy → Suggestions card lists the seeded suggestion with its bucket label and citation chip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(printf 'feat(strategy): Suggestions panel\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Research hub — **Model: Haiku**

Dumb renderer of `plan.research`, collapsible cards with citation chips.

**Files:**
- Create: `src/components/strategy/ResearchHub.jsx`
- Modify: `src/components/StrategyPage.jsx` (mount last)
- Modify: `src/index.css` (append `.rh-*` block)

**Interfaces:**
- Consumes: `plan.research: Array<{ scope, summary, cite }>`, `plan.buckets` (scope→name).
- Produces: `<ResearchHub plan={plan} />`.

- [ ] **Step 1: Create `ResearchHub.jsx`**

```jsx
import { useState } from 'react';

export default function ResearchHub({ plan }) {
  const research = plan.research || [];
  const [openIdx, setOpenIdx] = useState(null);
  const nameOf = (id) => (plan.buckets.find(b => b.id === id)?.name) || id || 'General';
  if (research.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Research</div>
          <div className="card-sub">why you hold what you hold · {research.length}</div>
        </div>
      </div>
      {research.map((r, i) => {
        const open = openIdx === i;
        return (
          <div className="rh-item" key={i}>
            <button className="rh-head" onClick={() => setOpenIdx(open ? null : i)}>
              <span className="rh-scope">{nameOf(r.scope)}</span>
              <span className={`rh-caret ${open ? 'open' : ''}`}>▾</span>
            </button>
            {open && (
              <div className="rh-body">
                <div className="rh-summary">{r.summary}</div>
                {r.cite ? <span className="rh-cite" title={r.cite}>{r.cite}</span> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `StrategyPage.jsx`** (append after SuggestionsPanel):

```jsx
      <SuggestionsPanel plan={plan} />
      <ResearchHub plan={plan} />
```

- [ ] **Step 3: Append CSS**

```css
.rh-item { border-bottom: 1px solid var(--border); }
.rh-head { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 0; background: none; border: none; color: var(--text); cursor: pointer; font-size: 14px; font-weight: 600; }
.rh-caret { color: var(--text-dim); transition: transform 0.18s; }
.rh-caret.open { transform: rotate(180deg); }
.rh-body { padding: 0 0 14px; display: flex; flex-direction: column; gap: 8px; }
.rh-summary { font-size: 13px; color: var(--text-dim); line-height: 1.5; }
.rh-cite { align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); background: var(--panel-2); padding: 3px 7px; border-radius: 6px; }
```

- [ ] **Step 4: Build + lint**

Run: `npx vite build && npx eslint src/components/strategy/ResearchHub.jsx src/components/StrategyPage.jsx`
Expected: build succeeds; eslint clean.

- [ ] **Step 5: Manual check**

Dev server → Strategy → Research card; clicking a row expands the summary + citation chip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(printf 'feat(strategy): Research hub\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: NotebookLM refresh pipeline — **Model: Sonnet** (bump to Opus if auth/CLI proves fiddly)

The local agent side: standing questions, a wrapper script, ignore rules, and operator docs. Nothing here is imported by the web app.

**Files:**
- Create: `notebooklm/questions.md`
- Create: `notebooklm/README.md`
- Create: `scripts/refresh-strategy.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the `notebooklm-py` CLI (installed separately), authenticated via `notebooklm login`.
- Produces: `notebooklm/*.md` answer files that Claude later distills into `plan.json`.

- [ ] **Step 1: Create `notebooklm/questions.md`**

```markdown
# Standing questions (paste into NotebookLM each review)

1. For each of my holdings, give the current bull and bear case, with sources.
2. Does the evidence still support my target of [buckets + %]? Where is it
   strongest / weakest?
3. What is over- or under-represented in a portfolio structured like this?
4. (Seeding only) Propose an allocation for a [moderate]-risk investor from
   these sources, with rationale.
```

- [ ] **Step 2: Create `scripts/refresh-strategy.mjs`**

```js
#!/usr/bin/env node
// Thin wrapper around the notebooklm-py CLI: asks each standing question and
// writes the grounded answer to notebooklm/<slug>.md. Run locally only
// (needs `notebooklm login` first). Verify exact flags with `notebooklm --help`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NOTEBOOK = process.env.NOTEBOOKLM_ID;
if (!NOTEBOOK) { console.error('Set NOTEBOOKLM_ID (your notebook id) first.'); process.exit(1); }

const questions = readFileSync('notebooklm/questions.md', 'utf8')
  .split('\n').filter(l => /^\d+\./.test(l)).map(l => l.replace(/^\d+\.\s*/, '').trim());

mkdirSync('notebooklm', { recursive: true });
questions.forEach((q, i) => {
  console.log(`[${i + 1}/${questions.length}] ${q}`);
  // Adjust the subcommand/flags to match notebooklm-py's CLI (see --help).
  const answer = execFileSync('notebooklm', ['chat', '--notebook', NOTEBOOK, '--query', q], { encoding: 'utf8' });
  writeFileSync(`notebooklm/answer-${i + 1}.md`, `# ${q}\n\n${answer}\n`);
});
console.log('Done. Now tell Claude: "update my Strategy plan".');
```

- [ ] **Step 3: Create `notebooklm/README.md`**

```markdown
# Local NotebookLM research agent

One-time setup:
1. `uv tool install notebooklm-py` (or `pipx install notebooklm-py`)
2. `notebooklm login` — authenticates with your Google account (Playwright).
3. Find your notebook id and export it: `export NOTEBOOKLM_ID=...`

Monthly loop:
1. `node scripts/refresh-strategy.mjs` — writes grounded answers to `notebooklm/answer-*.md`.
2. Tell Claude: "update my Strategy plan." Claude distills the answers +
   current holdings into `src/data/plan.json`, shows a diff, and pushes.

If the unofficial API breaks: open NotebookLM in the browser, paste the
questions from `questions.md`, and save each answer into `notebooklm/answer-N.md`
by hand. Everything downstream is unchanged.

This tooling is LOCAL only — never deployed, never imported by the web app.
```

- [ ] **Step 4: Update `.gitignore`**

Append:

```
# Local NotebookLM agent — secrets & config, never commit
notebooklm/.config
.env.notebooklm
```

(The `notebooklm/answer-*.md` files ARE committed so the page's citation chips resolve.)

- [ ] **Step 5: Verify the script parses questions (dry, no CLI needed)**

Run: `node -e "const s=require('fs').readFileSync('notebooklm/questions.md','utf8');console.log(s.split('\n').filter(l=>/^\d+\./.test(l)).length)"`
Expected: `4`.

- [ ] **Step 6: Commit**

```bash
git add notebooklm/ scripts/refresh-strategy.mjs .gitignore
git commit -m "$(printf 'feat(strategy): local NotebookLM refresh pipeline (questions, wrapper, docs)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Verification (whole feature)

- [ ] `node src/lib/strategy.selfcheck.mjs` → `strategy.selfcheck: OK`
- [ ] `npx vite build` → succeeds
- [ ] `npx eslint src/components/StrategyPage.jsx src/components/strategy/*.jsx src/lib/strategy.js src/data.js src/App.jsx` → clean
- [ ] Dev server: **Strategy** tab shows Workbench ▸ Rebalance ▸ Suggestions ▸ Research; USD/THB toggle converts money; unassigned banner correct; Watchlist gone from nav.
- [ ] `docs/superpowers/specs/2026-06-30-strategy-page-design.md` requirements all map to a task (see coverage note below).

## Spec coverage note

- Custom buckets + Unassigned + drift/trades → Task 1 (math) + Task 3 (render).
- Workbench seed/adjust/commit → Task 4.
- Suggestions (grounded, cited) → Task 5.
- Research hub → Task 6.
- Two-runtime pipeline, standing questions, monthly loop, failure fallback, secrets in .gitignore → Task 7.
- plan.json as source of truth → Task 2 + read-only rendering throughout.
- Name "Strategy", nav replace, delete Watchlist → Task 3.
