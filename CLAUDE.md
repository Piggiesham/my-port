# Portfolio Tracker — Claude navigation guide

## File map
- `src/App.jsx` — root; fetches all data on mount, owns `CurrencyContext`, routes between 3 pages
- `src/data.js` — mock fallback data + shared formatters (`fmtCurrency`, `fmtDateBkk`, etc.) + `SOURCES`, `PORTFOLIOS`, `PORTFOLIO_TYPES`
- `src/lib/api.js` — all Supabase reads/writes; falls back to mock data when `supabaseEnabled` is false
- `src/lib/supabase.js` — Supabase client + `supabaseEnabled` flag
- `src/components/ReturnChart.jsx` — Overview page: performance chart + portfolio breakdown + asset list
- `src/components/TransactionsPage.jsx` — Transactions page: filtered/sorted list, mounts the 3 modals below
- `src/components/AddTransactionModal.jsx` — add-tx form; also exports `CurrencySuffix` and `EditDateField`
- `src/components/TransactionDetailModal.jsx` — view / edit / delete a transaction (includes `EditTransactionForm`)
- `src/components/ImportModal.jsx` — screenshot → parsed rows → bulk import flow
- `src/components/WatchlistPage.jsx` — Watchlist page

## Key conventions
- **USD canonical**: all values stored/computed in USD; multiply by `fxRate` from `CurrencyContext` only at render time
- **Supabase gating**: every API call checks `supabaseEnabled`; the mock data path must always keep working
- **Brokerage IDs**: DB uses `dime` / `webull` / `binance`; UI shows `Dime!` / `Webull` / `Binance` — mapping is in `api.js`
- **THB cash**: stored as qty in baht, price as `1/FX_RATE` (USD per THB)
- **Bangkok time**: all dates display in `Asia/Bangkok`; helpers `fmtDateBkk`, `bkkNowParts`, `utcIsoToBkkParts`, `bkkPartsToUtcIso` are in `data.js`

## Supabase schema
| Table | Contents |
|---|---|
| `assets` | asset catalog — ticker, name, type, logo, is_cash, settlement_currency |
| `holdings` | qty + cost_basis per (brokerage_id, ticker); mutated by RPCs only |
| `transactions` | every tx; `apply_transaction` / `revert_transaction` / `update_transaction` RPCs mutate holdings atomically |
| `prices` | latest price per ticker (THB stored as USD-per-THB, i.e. ~0.031) |
| `price_history` | daily closes per ticker; gaps filled on-demand by `historical-price-range` edge function |
| `portfolio_snapshots` | daily total_usd per brokerage_id, written by scheduled cron |
| `brokerages` | id, name, color |
