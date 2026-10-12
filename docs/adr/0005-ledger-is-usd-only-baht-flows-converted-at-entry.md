# 5. The ledger is USD-only; baht cash flows are converted at entry

Date: 2026-10-12

## Status

Accepted. Supersedes the "THB cash: stored as qty in baht" convention (the
`THB` cash asset used by manual deposits, see ADR 0002 for the FX fields it
relied on).

## Context

USD is the canonical currency, but the manual Add-transaction path stored a
baht deposit as ticker `THB` with qty in baht and price = USD-per-THB. That
created a second cash bucket. Brokers (Dime!, Webull) settle in USD, so a
baht balance never funded a USD Buy: the import pre-flight replayed the ledger,
saw no USD cash at the Buy's date, and proposed "fix" deposits. Accepting those
inflated net deposits (invested capital, ADR 0003) and understated return.

The statement-import path had already modelled this correctly: a THB→USD
exchange is a USD Deposit carrying `fx_rate_at_tx`. Only the manual path
disagreed.

## Decision

**All cash rows are USD.** A baht Deposit or Withdraw is converted when it is
entered:

- The modal prefills THB-per-USD from `price_history` for the transaction date;
  the user may override it.
- The row is stored as `ticker = 'USD'`, `shares = value_usd = baht / rate`,
  `price = 1`, `fx_rate_at_tx = rate`.
- The baht actually exchanged is therefore recoverable (`shares × fx_rate_at_tx`),
  so the invested-in-THB line, Avg Cost in THB (ADR 0002) and the Transactions
  list keep showing locked-rate baht with no code change.

A **USD Deposit** takes the same rate input (prefilled by date, editable), so the
baht actually paid for those dollars is recorded the same way. The edit form
only re-prefills the rate when the user changes the date; opening it never
replaces a stored rate.

Existing THB-ticker cash rows are converted by migration 016
(`rate = baht / value_usd`, preserving the baht exactly), followed by
`rebuild_holdings()`.

## Consequences

- One cash bucket per brokerage: the pre-flight and the SQL cash trajectory see
  every deposit, so false "insufficient funds" fixes caused by baht deposits go
  away.
- The `THB` row in `assets` and the THB series in `prices`/`price_history` stay;
  they are FX data, not a holding.
- A baht Withdraw is converted at the rate entered for that withdrawal, not at
  the original deposit's rate, so THB-denominated invested capital after a
  withdrawal reflects the rate used on that day.
- A THB cash line no longer appears on the Overview; baht values are a display
  conversion of the USD balance at current FX, like every other holding.
