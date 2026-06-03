# Context — Portfolio Tracker

A glossary of the domain language for this project. Terms only — no
implementation details. When code and this file disagree, one of them is wrong;
resolve it.

## Glossary

### Cash trajectory
The running balance of a single cash position — a `(brokerage, currency)` pair —
reconstructed by replaying every cash-affecting transaction in chronological
order. Invariant: it must never go negative at any point in time. A negative dip
is the symptom the user calls an **insufficient-funds error**.

### Cash movement
Any transaction that changes a cash position. Includes Buy and Sell (their net
proceeds), Dividend, Deposit, Withdraw, and the fees/taxes attached to a trade.
The system's accuracy depends on capturing *all* cash movements, not just trades.

### Dividend
A cash inflow paid to the holder of a security for holding it. Pure cash — it
does **not** change the share quantity. Dividends are paid as cash and any
reinvestment happens as a separate, ordinary Buy. (No DRIP / auto-reinvestment
in any of the user's accounts.)

### Dividend withholding tax
A cash *outflow* the broker deducts when a dividend is paid — US tax withheld on
a foreign (Thai) holder, ≈15% under the US–Thailand treaty. On Dime! it posts as
its own line ("Dividend Withholding Tax VOO −0.32 USD"), paired with but separate
from the gross Dividend line. Reduces return; it is not a transfer of the user's
own money.

### Fee (TAF / SEC)
A small regulatory cash outflow (≈$0.01) Dime! deducts per trade, posted as its
own dated line ("TAF Fee", "SEC Fee") — often on a different date than the trade
it relates to, so it is a *standalone* expense, not an adjustment attached to a
specific Buy/Sell.

### Expired / Cancelled order
An order row that never executed (Dime! labels it "Expired" or "Cancelled"). Not
a transaction at all — must be excluded from any import.

### Combined-ticker view
The portfolio-wide ("All") rendering of holdings on the Overview, in which rows
for the same ticker held at multiple brokerages are merged into a single line.
Same-ticker only — different cash currencies (e.g. USD and THB) stay distinct
rows because their per-unit meaning differs. A per-brokerage view never
combines, because each brokerage holds at most one row per ticker.

On a combined row:
- **Quantity** is the sum of the per-brokerage quantities.
- **Cost basis** is the sum of the per-brokerage cost-basis dollars (`Σ qty·cost`).
- **Average cost** is the derived per-share weighted average (`cost basis / qty`).
- **Source** is a sentinel — the literal label "Multiple" — rather than any one
  brokerage's tag.

### Insufficient-funds error
Raised when importing or editing a transaction would make a cash trajectory dip
below zero. Today it is most often a *false* error: the buy was really funded by
a cash inflow (a dividend or a real deposit) that was never recorded, because the
importer captures only Buy/Sell rows.
