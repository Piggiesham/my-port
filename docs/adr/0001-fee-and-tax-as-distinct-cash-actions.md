# 1. Fee and Tax as distinct cash actions

Date: 2026-06-01

## Status

Accepted

## Context

Dime!'s Activity feed contains cash movements the importer historically dropped:
gross **Dividends** (cash in), **Dividend Withholding Tax** (cash out, ≈15%), and
**TAF/SEC Fees** (cash out, ≈$0.01). Dropping them made the reconstructed
**cash trajectory** diverge from reality — most visibly as false
**insufficient-funds errors** when importing Buys that were really funded by
dividends, and as a small drift in the portfolio's value and return.

The data model had only two cash-*outflow* actions: `Buy` (tied to shares) and
`Withdraw` (the user moving their own money out). Fees and withholding tax are
neither. We had to decide how to represent them.

Options considered:

- **Reuse `Withdraw`.** Zero schema change, correct for the cash trajectory. But
  a `Withdraw` is treated as the user removing *invested capital*, so the return
  calculation would read these costs as capital leaving rather than as expenses —
  quietly inflating reported gains. Re-introduces a "small difference" while
  fixing another.
- **Net the withholding into the dividend** (one `Dividend` of gross − tax) and
  add only a `Fee` action. Lighter, but loses the gross/tax split that Dime!
  shows, and still needs a new action for fees.
- **Distinct `Fee` and `Tax` actions.** More surfaces to change (action set,
  `apply_cash_delta`, trajectory check, importer, pre-flight, chart), but the
  only option that is correct for *both* the cash trajectory and the return.

## Decision

Introduce two new transaction actions, `Fee` and `Tax`, alongside the existing
`Dividend`:

- All three move only **cash**; none touch share quantity or cost basis
  (`apply_holdings_delta` early-returns for them, as it already does for
  `Dividend`).
- `Dividend` credits cash (`+value_usd`); `Fee` and `Tax` debit it
  (`−value_usd`). All settle in USD on Dime!.
- A `Fee` carries ticker **`USD`** (the cash it is deducted from — no security is
  involved). A `Tax` carries the **security's ticker** (e.g. `VOO`), matching how
  Dime! attributes withholding to the dividend's stock.
- The gross **Dividend** and its **Withholding Tax** are kept as **two separate
  transactions**, mirroring Dime! exactly and preserving the visible 15% split.

Because the chart already counts cash as part of portfolio value, these actions
flow into **total return** automatically: dividends as gains, fees/taxes as
costs, with invested capital untouched. A dividend-income breakout is deferred
but trivial later (`sum(value_usd) where action = 'Dividend'`).

## Consequences

- Re-importing Dime! Activity now reconstructs a *true* cash trajectory, so Buys
  are funded by real dividends + real (manually-entered) deposits, and the
  synthetic pre-flight "funding deposit" becomes a rare fallback rather than the
  norm.
- Cost: `Fee`/`Tax` must be handled in `apply_cash_delta`, `check_cash_trajectory`,
  `apply_transaction`, the screenshot importer (new row types + skip
  Expired/Cancelled), the import pre-flight simulation, and the daily-return
  chart math. Missing any one of these leaves the trajectory or the return
  subtly wrong.
- Reversing this (collapsing back to `Withdraw`/net-dividend) would lose the
  cost-vs-capital distinction and the gross/tax split — hence recorded here.
