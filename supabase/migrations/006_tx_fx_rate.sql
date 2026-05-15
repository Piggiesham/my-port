-- ============================================================
-- 006_tx_fx_rate.sql
--
-- Persist the USD<->THB exchange rate in force at each
-- transaction's executed_at. Lets the Transactions UI show a
-- date-correct THB aux line under USD values without re-deriving
-- FX at render time. Backfills from price_history.THB
-- (USD-per-THB rows upserted by refresh-prices).
-- ============================================================

alter table transactions
  add column if not exists fx_rate_at_tx numeric;

-- Backfill: for each tx without a stored rate, find the most
-- recent price_history.THB row on or before executed_at and
-- invert (price_history stores USD per THB; fx_rate_at_tx stores
-- THB per USD). Rows older than the earliest THB history stay
-- null and fall back to the live FX_RATE at render time.
update transactions t
set fx_rate_at_tx = sub.rate
from (
  select t2.id,
         (1.0 / ph.price_usd) as rate
  from transactions t2
  cross join lateral (
    select price_usd
    from price_history
    where ticker = 'THB'
      and date <= t2.executed_at::date
    order by date desc
    limit 1
  ) ph
  where t2.fx_rate_at_tx is null
) sub
where t.id = sub.id;
