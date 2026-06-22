# 3. Return is measured against invested capital, not cost basis

Date: 2026-06-22

## Status

Accepted

## Context

The Overview headline shows a **return** for the selected range. It was
computed two different ways depending on display currency:

- **USD:** `value − cost basis` over cost basis (`Σ qty·cost`).
- **THB:** `value − invested capital` over invested capital, where invested
  capital is net deposits locked at each deposit's historical FX.

So toggling USD ↔ THB changed the number for reasons beyond exchange rate, and
the two disagreed by more than FX (~14% vs ~18% in the user's data). The
cost-basis base also hid **dividends** and realized gains: because cash holding
counts toward both value and cost, those gains netted to ~0 return instead of
showing as return.

Separately, the headline change was always *total* return regardless of the
selected range — picking "1W" still showed all-time return.

Two questions had to be settled: what is return measured against, and what does
the range mean.

## Decision

1. **Return is measured against invested capital** (net Deposits − Withdrawals)
   in **both** currencies. THB invested capital stays FX-locked at each
   deposit's rate, mirroring ADR 0002 (cost uses historical FX, value uses
   current FX) — so the THB return legitimately includes conversion gain.
   Cost basis is retained only for the **Average Cost** column, not for return.

2. **Period return excludes in-period cash flows.** For a range,
   `gain = (value_end − value_start) − net deposits in the period`, over
   `value_start + net deposits in the period`. A deposit mid-range does not
   register as return; ALL reduces to total return (start value ≈ 0).

## Consequences

- USD and THB returns now differ only by the real FX gain, not by a hidden
  change of base.
- Dividends and realized gains correctly count as return.
- Returns are no longer comparable to a "return on the cost of what I currently
  hold" reading — the base is contributed money. The glossary distinguishes
  **invested capital** from **cost basis** to keep this clear.
- A pure deposit shows 0% period return, which is the intended behaviour.
