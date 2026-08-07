# 4. Average Cost uses FIFO for securities, weighted-average for cash

Date: 2026-08-07

## Status

Accepted

## Context

`computeAssetsFromTransactions` and `computeThbCostByKey` tracked avg cost as
a single blended weighted average per `(brokerage, ticker)`: every Buy folded
its price into the running average; every Sell reduced qty but left the
average untouched. That's invariant to *which* shares were sold — a Sell
never changes the avg cost of what's left.

Dime! (the actual brokerage) doesn't work that way. It reports cost basis
using **FIFO lot accounting**: a Sell consumes the oldest shares first, and
the displayed avg cost is recomputed only over whatever lots remain. The two
methods agree until a position has a partial sell, then diverge — confirmed
against real data: VSAT (avg cost 31.28 real vs 30.20 weighted-average) and PM
(164.82 real vs 170.72 weighted-average) both matched Dime! exactly once
recomputed as FIFO.

Since the whole point of this tracker is to mirror the user's real portfolio,
silently disagreeing with the broker's own cost-basis number after every
partial sell defeats the purpose.

## Decision

**Securities (non-cash tickers) use FIFO.** Each Buy pushes a `{ qty, price }`
lot; each Sell consumes lots oldest-first, partially draining a lot if needed.
Avg cost is the weighted average of whatever lots remain.

**Cash (USD, THB) keeps the weighted-average, historical-FX blend from
[0002](0002-average-cost-uses-historical-fx.md).** FIFO has no meaning for a
currency position — there's no "lot" to a baht. Applying it would also
contradict 0002's blended historical-FX cost, which is deliberately an
average across all deposits, not a per-lot replay.

Both `computeAssetsFromTransactions` (drives Overview's USD avg cost /
holding value) and `computeThbCostByKey` (drives the THB avg-cost column,
still historical-FX per buy, per 0002 — just FIFO-ordered now instead of
proportionally-reduced on Sell) were updated together so USD and THB avg cost
stay consistent with each other.

## Consequences

- Avg cost now changes on a Sell whenever the position isn't fully closed —
  it will visibly jump after a partial sell, reflecting which lots remain.
  This is expected, not a bug.
- The `holdings` table's SQL-side `cost_basis` column (maintained by
  `apply_holdings_delta`) was **not** changed — it's still weighted-average.
  This is currently harmless: `fetchAssets()` (the only reader) is dead code,
  and the Overview always recomputes live from `transactions` in JS. If
  `holdings.cost_basis` is ever wired back up for display, it must be
  migrated to FIFO too or it will silently disagree with the Overview again.
- FIFO is path-dependent on transaction order, so a backdated or reordered
  Buy/Sell can shift avg cost for every later Sell on that ticker — same
  sensitivity FIFO has in real brokerage systems.
