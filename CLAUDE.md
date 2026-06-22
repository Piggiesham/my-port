# Portfolio Tracker — Claude navigation guide

## File map
- `src/App.jsx` — root; fetches all data on mount, owns `CurrencyContext`, routes between 3 pages
- `src/data.js` — mock fallback data + shared formatters (`fmtCurrency`, `fmtDateBkk`, etc.) + `SOURCES`, `PORTFOLIOS`, `PORTFOLIO_TYPES`
- `src/lib/api.js` — all Supabase reads/writes; falls back to mock data when `supabaseEnabled` is false
- `src/lib/supabase.js` — Supabase client + `supabaseEnabled` flag
- `src/components/ReturnChart.jsx` — Overview: portfolio value/return line chart (range tabs incl. YTD, value↔performance toggle); builds its own series from transactions
- `src/components/PieChart.jsx` — Overview: allocation donut + legend (category dropdown; hover shows name/value/%)
- `src/components/AssetList.jsx` — Overview: holdings table (combined-ticker on "All")
- `src/components/TransactionsPage.jsx` — Transactions page: filtered/sorted list, mounts the 3 modals below
- `src/components/AddTransactionModal.jsx` — add-tx form; also exports `CurrencySuffix` and `EditDateField`
- `src/components/TransactionDetailModal.jsx` — view / edit / delete a transaction (includes `EditTransactionForm`)
- `src/components/ImportModal.jsx` — screenshot → parsed rows → bulk import flow
- `src/components/WatchlistPage.jsx` — Watchlist page

## Key conventions
- **USD canonical**: all values stored/computed in USD; multiply by `fxRate` from `CurrencyContext` only at render time
- **Supabase gating**: every API call checks `supabaseEnabled`; the mock data path must always keep working
- **Brokerage IDs**: DB uses `dime` / `webull` / `binance`; UI shows `Dime!` / `Webull` / `Binance` — mapping is in `api.js`
- **THB cash**: stored as qty in baht; a Deposit's price is the USD-per-THB rate on its transaction date (historical FX) so cost basis reflects the baht actually exchanged, while current value uses live FX. (`AddTransactionModal` sets this; older rows used the constant `1/FX_RATE`.)
- **Return**: measured against **invested capital** (net deposits), not cost basis; period return excludes in-period cash flows — see ADR 0003 and `CONTEXT.md`. `invested`/`investedThb` in `computeReturnSeries`/`computeDailyReturnSeries` are net deposits, not `Σ qty·cost`.
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
