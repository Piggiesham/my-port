# 2. Average Cost uses historical FX while Market Price uses current FX

Date: 2026-06-03

## Status

Accepted

## Context

The Overview's asset list adds an **Average Cost** column displayed in the
user-selected currency (USD or THB), placed adjacent to the existing **Market
Price** column. The two columns answer different questions and naturally pair —
the user eyeballs Market Price ≷ Average Cost to see whether they're up or down.

For USD-denominated holdings, the question is trivial: cost is in USD, price is
in USD. The decision concerns the THB display: at what FX rate is "average
cost" converted to baht?

- **Today's FX (matches Market Price).** Both columns convert the same way, so
  green/red on Avg Cost vs Market Price visually matches the row's %profit.
  Symmetric, but the displayed avg cost moves with today's FX even when the
  user paid baht months ago at a different rate — hiding conversion risk.
- **Historical FX (rate at the time of each buy).** A weighted average of
  what the user actually paid in baht per share. Honest about how many baht
  flowed out of the user's pocket; surfaces FX risk per asset. But the column
  no longer trivially aligns to Market Price's color-coded comparison.

This sits inside a broader project philosophy already established by [the chart's
invested-in-THB line](../adr/0001-fee-and-tax-as-distinct-cash-actions.md) (the
chart shows USD-cost converted at deposit-day FX, exactly so the gap to today's
value captures real conversion risk). Choosing today's FX for Avg Cost would
contradict that philosophy in the place users look most often.

## Decision

**Average Cost converts to THB at historical FX**, computed by replaying each
relevant Buy with that buy's `fx_rate_at_tx` (falling back to the THB row in
`price_history` on the buy's date when the column is null).

**Market Price stays on today's FX**, unchanged.

The two columns therefore use **different conversion rules**. To make this
legible:

- When *all* buys for a position have a known historical FX, the avg cost
  renders cleanly.
- When *any* buy is missing both `fx_rate_at_tx` and a `price_history.THB` row
  for its date, that buy falls back to today's FX in the weighted average and
  the rendered value is prefixed with `~` (e.g. `~฿16,500/sh`) signalling that
  it is approximate. The existing `backfillHistoricalFx()` utility is the
  user's path to remove the marker.
- For cash positions (USD, THB), the column shows `—` rather than a synthetic
  number — see ../CONTEXT.md.

## Consequences

- The Avg Cost cell does not change as USD/THB moves day-to-day. The Market
  Price cell does. The two columns can therefore appear "out of sync" in THB
  mode — that is the *point*: the gap reflects FX-driven return that wouldn't
  exist if the user transacted purely in USD.
- The column is not a simple multiplication of `cost × current_fx`. It is a
  per-`(brokerage, ticker)` replay of buy transactions with each one's stored
  or looked-up FX, mirroring how `computeDailyReturnSeries` builds
  `investedThb`. Renaming or removing `fx_rate_at_tx` propagates here.
- The `~` marker is a soft consistency contract: if a future change ever lets
  buys lose their FX without backfill, the marker shows up automatically. Don't
  silently swallow missing-FX rows (would inflate apparent profit in THB).
- Combined-ticker rows on the "All" view (see ../CONTEXT.md → "Combined-ticker
  view") sum each contributing brokerage's `Σ shares · historical-fx · price`
  to produce a portfolio-wide weighted-baht average, marked `~` if any
  contributing buy fell back.
