# Strategy page — design spec

Date: 2026-06-30
Status: Approved (design); pending implementation plan

## Context

The app has a **Watchlist** tab that is only a stub (search box + "under
construction"). We are replacing it with a **Strategy** page: the place to
decide and maintain the portfolio's *intended* structure, see how the *actual*
holdings drift from it, get research-grounded suggestions, and read the "why"
behind each position.

The distinctive idea is a **localized research agent that splits work across two
brains**: Google's NotebookLM does Retrieval-Augmented Generation (RAG) over a
large corpus of investment research on Google's side (effectively unlimited
context, grounded + cited), while Claude does the orchestration, analysis, and
coding locally. NotebookLM answers standing questions; Claude distills those
answers into structured app data. This bypasses Claude's context-window limits —
the raw corpus never enters Claude's context, only NotebookLM's distilled
answers do.

The app already computes actual allocation (`categoryDataFor`, per-asset
`holdingUSD`/`alloc%`), so the missing half is the *target* structure and the
gap to it.

## Decisions (resolved during brainstorming)

- **Primary job:** three stacked concerns that work together — rebalancing
  (target vs actual) → suggestions → research hub — plus an allocation
  "workbench" that helps decide the target before it is set.
- **Target dimension:** **custom buckets** (user-defined groups such as
  Core / Growth / Speculative / Ballast), each holding mapped to exactly one
  bucket. An **Unassigned** catch-all holds newly-bought tickers until mapped;
  unassigned holdings still count in the denominator so drift never lies.
- **Who sets targets:** the user sets them. Research justifies or challenges;
  NotebookLM never invents the numbers (except as an optional *seed* proposal).
- **Data pipeline:** `notebooklm-py` (unofficial NotebookLM API,
  https://github.com/teng-lin/notebooklm-py) runs **locally**, orchestrated by
  Claude in a session, and writes grounded answers into `notebooklm/*.md`.
  Claude distills those into `src/data/plan.json`. The deployed app reads only
  `plan.json` — it never runs Python, never holds Google auth, never calls
  NotebookLM.
- **State home:** `src/data/plan.json`, committed to git, is the single source
  of truth. The page renders it read-only; edits are made by Claude editing the
  file and pushing (Vercel redeploys). No database, no localStorage.
- **Name:** **Strategy**.

## Architecture

Two runtimes separated by one interface file (`plan.json`):

```
LOCAL AGENT (session; Google cookies; may break)
  notebooklm-py ──standing questions──▶ notebooklm/*.md (grounded, cited)
  Claude distills + user decides ─────▶ src/data/plan.json
                                              │ commit + push
                                              ▼
DEPLOYED APP (Vercel; no secrets; always works)
  StrategyPage reads plan.json + live holdings ──▶ 4 sections (read-only)
```

The `plan.json` boundary insulates the site from Google's instability: if the
unofficial API breaks, the user pastes NotebookLM answers into `notebooklm/*.md`
by hand and everything downstream is unchanged.

### `plan.json` shape

```jsonc
{
  "meta": { "updated": "2026-06-30", "riskProfile": "moderate" },
  "buckets": [
    { "id": "core",    "name": "Core",        "target": 50 },
    { "id": "growth",  "name": "Growth",      "target": 25 },
    { "id": "spec",    "name": "Speculative", "target": 15 },
    { "id": "ballast", "name": "Ballast",     "target": 10 }
  ],
  "assignments": { "VOO": "core", "NVDA": "growth", "BTC": "spec", "USD": "ballast" },
  "guardrails": { "maxSingleName": 10, "minCash": 5 },
  "suggestions": [
    { "bucket": "growth", "action": "Trim NVDA to <10%", "why": "...", "cite": "nvda-thesis.md" }
  ],
  "research": [
    { "scope": "core", "summary": "...", "cite": "2026-06-allocation.md" }
  ]
}
```

Invariant: `buckets[].target` sums to 100. `assignments` keys on **ticker**
(one ticker → one bucket regardless of broker).

### Actual vs target math (computed live in the browser; never stored)

- Group each holding's `holdingUSD` by `assignments[ticker] → bucket`.
- `bucket.actualPct = bucketHoldings / total * 100`.
- `drift = target − actual`; `tradeUSD = drift/100 * total` (▲ buy / ▼ sell).
- Tickers absent from `assignments` → **Unassigned** bucket, still in `total`.

All lives in a pure module (`src/lib/strategy.js`), testable without React.

## Page layout (top to bottom: decide → check → act → understand)

1. **Allocation Workbench** (collapsed once a target exists). Interactive for
   *exploration only*; nothing persists until Claude writes `plan.json`.
   - **Seed:** templates (60/40, Boglehead three-fund, All-Weather, "use my
     current") or "Ask NotebookLM to propose" (fills draft buckets + % with
     cited rationale).
   - **Adjust:** slider/number per bucket; live sum indicator (red ≠ 100%);
     guardrail violations flagged inline (`maxSingleName`, `minCash`).
   - **Commit:** produces a one-line instruction the user hands to Claude
     ("set Growth 25→30"); Claude writes + pushes. Sliders reset to `plan.json`
     on refresh (ephemeral state; git stays the source of truth).
2. **Rebalance** (headline). Per bucket: target-vs-actual bar, drift %, trade $.
   Total portfolio drift and "last set" date. Unassigned banner
   ("2 holdings unassigned — SOFI, XLV") when any held ticker is unmapped.
3. **Suggestions.** NotebookLM-grounded, tied to §2: within an over/under
   bucket, which specific tickers to add or trim, each with a one-line "why"
   and a citation chip to the source file.
4. **Research hub.** Collapsible per-bucket / per-ticker summaries from the
   corpus, with citation chips. The "why do I own this" reference.

## Codebase structure

```
src/data/plan.json                      source of truth (Claude-edited)
src/lib/strategy.js                     PURE math + ALLOCATION_TEMPLATES:
    computeBucketActuals(assets, assignments, buckets)
    computeDrift(actuals, buckets) · computeTrades(drift, total)
    findUnassigned(assets, assignments)
src/lib/strategy.selfcheck.mjs          assert-based check (node, no framework)
src/components/StrategyPage.jsx         reads plan.json + assets; owns layout
src/components/strategy/
    AllocationWorkbench.jsx             ① seed + sliders (ephemeral)
    RebalancePanel.jsx                  ② target vs actual, drift, trade $
    SuggestionsPanel.jsx               ③ grounded, cited
    ResearchHub.jsx                    ④ summaries + citation chips
notebooklm/
    questions.md                        the standing questions
    *.md                                grounded answers (committed)
    .config                             notebook id + auth (.gitignore'd)
scripts/refresh-strategy.mjs            thin wrapper: notebooklm-py → notebooklm/*.md
```

- `App.jsx`: `navItems = ['Overview', 'Transactions', 'Strategy']`; the
  `Watchlist` branch becomes `<StrategyPage assets={assets} />`;
  `WatchlistPage.jsx` deleted.
- Holdings→bucket grouping keys on `ticker`, aggregating `holdingUSD` across
  sources. Money rendering reuses `fmtCurrency`/`fmt2` + `CurrencyContext`, so
  the USD/THB toggle works with no extra work.
- The four panels are dumb renderers fed computed props; all non-trivial math
  lives in `strategy.js`.

## The standing questions (`notebooklm/questions.md`)

1. For each holding, the current bull and bear case, with sources.
2. Does the evidence still support the target of [buckets + %]? Where strongest
   / weakest?
3. What is over- or under-represented in a portfolio structured like this?
4. Propose an allocation for a [risk profile] investor from these sources, with
   rationale. *(only when seeding the Workbench)*

## Monthly loop

```
User: "update my Strategy plan"
  1. Claude runs notebooklm-py (Bash) → asks the standing questions
  2. Answers land in notebooklm/*.md (grounded, cited)
  3. Claude reads them + current holdings → distills into plan.json
       (refresh suggestions[]/research[]; flag weakened theses;
        surface newly-held tickers as unassigned)
  4. Claude shows a diff; user decides target changes
  5. Claude writes plan.json + pushes → Vercel redeploys
```

One-time setup: install the tool (`uv tool` / `pipx`), `notebooklm login` to
capture the Google session, point `.config` at the notebook id.

## Failure handling

- API broke / Google changed → user pastes NotebookLM answers into
  `notebooklm/*.md` manually; steps 3–5 unchanged.
- No new research this month → skip steps 1–2; still tweak targets + re-commit.
- Deployed site is never affected — it only reads the committed `plan.json`.
- Secrets (Google cookies/token, notebook id) stay in `.gitignore`'d local
  config. Raw `notebooklm/*.md` answers are committed so citation chips resolve.

## Definition of done

- Watchlist removed; **Strategy** tab renders all four sections from a real,
  seeded `plan.json` using live holdings.
- Drift/trade math correct: `strategy.selfcheck.mjs` green (all bucket actuals
  **including Unassigned** sum to 100%, drift = target − actual, unassigned
  detection) and eyeballed against Overview.
- Unassigned banner appears when a held ticker is unmapped.
- Refresh loop documented (`scripts/refresh-strategy.mjs` + "update my plan").
- `npx vite build` and `eslint` clean.

## Out of scope (v1)

- Pre-commit what-if comparison of multiple candidate targets (Rebalance already
  shows drift/trades for the committed target).
- Live in-browser persistence (localStorage/Supabase) — deferred; git is truth.
- Automating the NotebookLM→file hop beyond the local wrapper (no server-side).
- Visual polish of bars/cards — handled at implementation time via the
  frontend-design skill, not specified here.
