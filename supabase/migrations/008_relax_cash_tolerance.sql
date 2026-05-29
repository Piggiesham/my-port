-- ============================================================
-- 008_relax_cash_tolerance.sql
--
-- check_cash_trajectory previously failed when the cumulative cash balance
-- dipped below -0.000001 USD. Real-world brokerage exports (Webull monthly
-- statements, Dime! screenshots, etc.) round prices and quantities to 4–5
-- decimals, so qty*price arithmetic in SQL drifts from the printed Net
-- Amount by fractions of a cent. Over a few Buys the cumulative drift
-- reaches 1–3 cents — enough to trigger the old tolerance even when the
-- user's actual cash position is whole.
--
-- This migration bumps the tolerance to 5 cents. Still tight enough to
-- catch real overdrafts (which manifest as multi-dollar shortfalls), but
-- loose enough to ignore aggregation rounding.
-- ============================================================

create or replace function check_cash_trajectory(
  p_brokerage_id text,
  p_currency     text
)
returns void language plpgsql as $$
declare
  min_balance numeric;
begin
  with deltas as (
    select
      t.executed_at,
      t.created_at,
      case t.action
        when 'Deposit'  then coalesce(t.shares, 0)
        when 'Withdraw' then -coalesce(t.shares, 0)
        when 'Buy'      then -(coalesce(t.shares, 0) * coalesce(t.price, 0)
                                 + coalesce(t.fees, 0) + coalesce(t.taxes, 0))
        when 'Sell'     then  (coalesce(t.shares, 0) * coalesce(t.price, 0)
                                 - coalesce(t.fees, 0) - coalesce(t.taxes, 0))
        when 'Dividend' then  coalesce(t.value_usd, 0)
        else 0
      end as d
    from transactions t
    left join assets a on a.ticker = t.ticker
    where t.brokerage_id = p_brokerage_id
      and (
        (t.action in ('Deposit', 'Withdraw') and t.ticker = p_currency)
        or
        (t.action in ('Buy', 'Sell', 'Dividend')
         and coalesce(a.settlement_currency, 'USD') = p_currency)
      )
  ),
  cumulative as (
    select sum(d) over (order by executed_at, created_at
                        rows between unbounded preceding and current row) as cum
    from deltas
  )
  select min(cum) into min_balance from cumulative;

  -- Allow up to 5 cents of negative drift to absorb decimal rounding from
  -- brokerage CSV/screenshot imports. Anything beyond that is a real overdraft.
  if min_balance is not null and min_balance < -0.05 then
    raise exception '% cash at % goes negative — lowest point: %',
      p_currency, p_brokerage_id, min_balance;
  end if;
end;
$$;
