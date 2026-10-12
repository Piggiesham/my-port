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

### USD-only ledger
Every cash row is denominated in USD. A baht deposit or withdrawal is converted
at entry using the THB-per-USD rate for its date (user-overridable) and stored as
a USD row that keeps the rate in `fx_rate_at_tx`. There is no separate baht cash
position. See ADR 0005.

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
Same-ticker only. A per-brokerage view never
combines, because each brokerage holds at most one row per ticker.

On a combined row:
- **Quantity** is the sum of the per-brokerage quantities.
- **Cost basis** is the sum of the per-brokerage cost-basis dollars (`Σ qty·cost`).
- **Average cost** is the derived per-share weighted average (`cost basis / qty`).
- **Source** is a sentinel — the literal label "Multiple" — rather than any one
  brokerage's tag.

### Invested capital
The net money the user has actually put in: cumulative **Deposits** minus
**Withdrawals**. In THB it is locked at each deposit's exchange rate
(`fx_rate_at_tx`, the baht actually exchanged), not revalued at today's FX. This is the baseline **return**
is measured against. It is **not** the same as **cost basis**: realized gains
and dividends that sit as cash count toward portfolio value but not toward
invested capital, so they surface as return.

### Cost basis
The money tied up in the shares currently held — `Σ qty·cost` per position,
summed. Drives the **Average Cost** column (`cost basis / qty`) and converts to
THB at each buy's historical FX (see ADR 0002). Distinct from **invested
capital**: cost basis excludes cash held (including dividends and realized
gains).

### Return
How much the portfolio has earned on the user's **invested capital**,
independent of how much was put in: `value − invested capital`, as a ratio over
invested capital. Because the base is contributed money rather than cost basis,
dividends and realized gains count as return. Surfaced as "Portfolio Return" /
"Performance" on the Overview.

### Period return
**Return** over the selected range (1W, 1M, 3M, 6M, YTD, 1Y, ALL), excluding
cash moved in or out *during* that range:
`(value_now − value_start) − net deposits in the period`, over the capital
deployed at the start. A deposit made mid-range therefore does not register as
return. For ALL this equals total return (the start value is ~0).

### Insufficient-funds error
Raised when importing or editing a transaction would make a cash trajectory dip
below zero. Today it is most often a *false* error: the buy was really funded by
a cash inflow (a dividend or a real deposit) that was never recorded, because the
importer captures only Buy/Sell rows.
