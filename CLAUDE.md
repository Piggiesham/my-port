# Portfolio Tracker — Claude navigation guide

## Docs — read before you touch related code
- `docs/DESIGN.md` — the design system (tokens, type/spacing scales, component idioms, responsive rules, semantic conventions). **Read before building or restyling any UI** so new work stays visually consistent.
- `docs/CONTEXT.md` — domain model + terminology + the reasoning behind the money/return logic. **Read before changing return math, cost basis, FX, or cash handling.**
- `docs/adr/` — accepted architecture decisions (0001 fee/tax actions, 0002 avg-cost historical FX, 0003 return vs invested capital, 0004 avg-cost FIFO for securities, 0005 USD-only ledger). Consult when a decision seems arbitrary; add a new ADR rather than silently reversing one.

## File map
- `src/App.jsx` — root; fetches all data on mount, owns `CurrencyContext`; routes Overview/Transactions/Strategy/Performance. Strategy currently renders an inline maintenance placeholder — its import is commented out so the bundle tree-shakes it out of prod; the comment there says how to re-enable.
- `src/data.js` — mock fallback data + shared formatters (`fmtCurrency`, `fmtDateBkk`, etc.) + `SOURCES`, `PORTFOLIOS`, `PORTFOLIO_TYPES`
- `src/lib/api.js` — all Supabase reads/writes; falls back to mock data when `supabaseEnabled` is false
- `src/lib/supabase.js` — Supabase client + `supabaseEnabled` flag
- `src/lib/useClickOutside.js` — shared hook; closes a dropdown/popover on outside mousedown (used by most pickers)
- `src/lib/strategy.js` — pure rebalance math (target-vs-actual drift, buy/sell trades); has `strategy.selfcheck.mjs`
- `src/lib/performance.js` — pure TWR / Modified-Dietz MWR / drawdown / volatility / per-asset contribution math; has `performance.selfcheck.mjs`
- `src/data/plan.json` — git-versioned Strategy source of truth (buckets, suggestions, research); Claude-edited, page is read-only; validated by `scripts/validate-plan.mjs`
- `src/components/ReturnChart.jsx` — Overview: portfolio value/return line chart (range tabs incl. YTD, value↔performance toggle); builds its own series from transactions
- `src/components/PieChart.jsx` — Overview: allocation donut + legend (category dropdown; hover shows name/value/%)
- `src/components/AssetList.jsx` — Overview: holdings table (combined-ticker on "All")
- `src/components/TransactionsPage.jsx` — Transactions page: filtered/sorted list, mounts the 3 modals below
- `src/components/AddTransactionModal.jsx` — add-tx form; composes the three shared controls below
- `src/components/CurrencySuffix.jsx` — `CurrencySuffix`: per-field USD/THB picker chip (parent does the conversion). Shared by both modals
- `src/components/DateField.jsx` — `EditDateField` (DD/MM/YYYY input + calendar button, speaks ISO strings) + `DatePopover` (the calendar). Shared by both modals
- `src/components/AssetSearchInput.jsx` — `AssetSearchInput`: ticker typeahead (local catalog + Yahoo search + manual create); owns `createAsset`/`searchYahooSymbols`
- `src/components/TransactionDetailModal.jsx` — view / edit / delete a transaction (includes `EditTransactionForm`); imports `CurrencySuffix`/`EditDateField`
- `src/components/ImportModal.jsx` — import flow: Dime! screenshots + Webull statement PDFs → `parse-transactions-image` edge fn (PDFs always Gemini; images follow live `LLM_PROVIDER` secret, currently Groq/Qwen) → parsed rows → atomic bulk import
- `src/components/StrategyPage.jsx` — Strategy page (dormant — not imported by App.jsx, see above); mounts `strategy/` panels (`AllocationWorkbench`, `RebalancePanel`, `SuggestionsPanel`, `ResearchHub`); reads `plan.json`
- `src/components/PerformancePage.jsx` — Performance page: TWR vs USD-ETF benchmark chart + KPI tiles (TWR/MWR/drawdown/vol) + per-asset contribution

## Key conventions
- **USD canonical**: all values stored/computed in USD; multiply by `fxRate` from `CurrencyContext` only at render time
- **Supabase gating**: every API call checks `supabaseEnabled`; the mock data path must always keep working
- **Brokerage IDs**: DB uses `dime` / `webull` / `binance`; UI shows `Dime!` / `Webull` / `Binance` — mapping is in `api.js`
- **Ledger is USD-only**: a baht deposit/withdrawal is converted at entry (rate prefilled by date, editable) and stored as a **USD** row with `fx_rate_at_tx` = THB-per-USD, so the baht actually exchanged stays recoverable (`shares × fx_rate_at_tx`). There is no THB cash holding — see ADR 0005. (Statement-import deposits already worked this way; migration 016 converted older `THB`-ticker rows.)
- **Return**: measured against **invested capital** (net deposits), not cost basis; period return excludes in-period cash flows — see ADR 0003 and `docs/CONTEXT.md`. `invested`/`investedThb` in `computeReturnSeries`/`computeDailyReturnSeries` are net deposits, not `Σ qty·cost`.
- **Avg cost is FIFO for securities, weighted-average for cash**: a Sell consumes the oldest lot first (matches broker-reported cost basis), so avg cost changes after a partial sell — see ADR 0004. `computeAssetsFromTransactions`/`computeThbCostByKey` in `api.js`; the SQL `holdings.cost_basis` cache is still weighted-average but unread (`fetchAssets()` is dead code).
- **Ledger is source of truth**: `transactions` is authoritative; `holdings` is a derived cache (the Overview recomputes from transactions in JS). Cash assets `USD`/`THB` must exist in `assets` or cash Deposits fail the FK (seeded in migration 013); resync the cache with `rebuild_holdings()` (migration 015).
- **Bangkok time**: all dates display in `Asia/Bangkok`; helpers `fmtDateBkk`, `bkkNowParts`, `utcIsoToBkkParts`, `bkkPartsToUtcIso` are in `data.js`

## Supabase schema
| Table | Contents |
|---|---|
| `assets` | asset catalog — ticker, name, type, logo, is_cash, settlement_currency |
| `holdings` | derived cache: qty + cost_basis per (brokerage_id, ticker); mutated by RPCs only; rebuildable from the ledger via `rebuild_holdings()` |
| `transactions` | source of truth — every tx; `apply_transaction` / `revert_transaction` / `update_transaction` / `import_transactions` RPCs mutate holdings atomically |
| `prices` | latest price per ticker (THB stored as USD-per-THB, i.e. ~0.031) |
| `price_history` | daily closes per ticker; gaps filled on-demand by `historical-price-range` edge function |
| `portfolio_snapshots` | daily total_usd per brokerage_id, written by scheduled cron |
| `brokerages` | id, name, color |
