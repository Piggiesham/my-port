-- ============================================================
-- 012_fee_tax_actions.sql
--
-- Adds two cash-only transaction actions — Fee and Tax — alongside the
-- existing Dividend. See docs/adr/0001-fee-and-tax-as-distinct-cash-actions.md.
--
--   Dividend  → +value_usd   (cash in;  ticker = the security)
--   Fee       → -value_usd   (cash out; ticker = 'USD' — the cash it's deducted from)
--   Tax       → -value_usd   (cash out; ticker = the security, e.g. withholding on VOO)
--
-- All three move only cash: they never touch share quantity or cost basis.
-- They settle in USD on Dime!, resolved the same way every other non-cash
-- action is (assets.settlement_currency), so apply_transaction /
-- revert_transaction / update_transaction need NO change — a Fee's ticker
-- 'USD' settles USD, and a Tax's security ticker settles USD.
--
-- Three functions change:
--   1. apply_holdings_delta  — skip Fee/Tax (no share effect), like Dividend.
--   2. apply_cash_delta      — debit cash for Fee/Tax by value_usd.
--   3. check_cash_trajectory — include Fee/Tax in the running-balance scan.
-- ============================================================

-- ------------------------------------------------------------
-- 1. apply_holdings_delta — Fee/Tax carry no shares, so guard them out
--    explicitly (mirrors the existing Dividend guard).
-- ------------------------------------------------------------
create or replace function apply_holdings_delta(
  p_brokerage_id text,
  p_ticker       text,
  p_action       text,
  p_shares       numeric,
  p_price        numeric,
  p_direction    int
)
returns void language plpgsql as $$
declare
  cur_qty   numeric;
  cur_cost  numeric;
  delta_qty numeric;
  new_qty   numeric;
  new_cost  numeric;
begin
  -- Cash-only actions never change a share position.
  if p_action in ('Dividend', 'Fee', 'Tax') then
    return;
  end if;

  if p_shares is null or p_shares = 0 then
    return;
  end if;

  delta_qty := case p_action
    when 'Buy'      then  p_shares
    when 'Deposit'  then  p_shares
    when 'Sell'     then -p_shares
    when 'Withdraw' then -p_shares
    else 0
  end;
  delta_qty := delta_qty * p_direction;

  select qty, cost_basis into cur_qty, cur_cost
  from holdings
  where brokerage_id = p_brokerage_id and ticker = p_ticker
  for update;

  if not found then
    cur_qty  := 0;
    cur_cost := 0;
  end if;

  new_qty := cur_qty + delta_qty;

  -- Tolerate up to 1e-6 of float drift from importer rounding; clamp to 0.
  if new_qty < -0.000001 then
    raise exception 'Not enough shares: % has % of %, attempted delta %',
      p_brokerage_id, cur_qty, p_ticker, delta_qty;
  end if;
  if new_qty < 0 then
    new_qty := 0;
  end if;

  -- Weighted-average cost basis recalculation
  if p_action in ('Buy', 'Deposit') then
    if p_direction = 1 then
      if new_qty = 0 then
        new_cost := 0;
      else
        new_cost := ((cur_qty * cur_cost) + (p_shares * coalesce(p_price, 0))) / new_qty;
      end if;
    else
      if new_qty = 0 then
        new_cost := 0;
      else
        new_cost := ((cur_qty * cur_cost) - (p_shares * coalesce(p_price, 0))) / new_qty;
        if new_cost < 0 then new_cost := 0; end if;
      end if;
    end if;
  else
    new_cost := cur_cost;
  end if;

  insert into holdings (brokerage_id, ticker, qty, cost_basis, updated_at)
  values (p_brokerage_id, p_ticker, new_qty, new_cost, now())
  on conflict (brokerage_id, ticker) do update
    set qty = excluded.qty,
        cost_basis = excluded.cost_basis,
        updated_at = now();
end;
$$;

-- ------------------------------------------------------------
-- 2. apply_cash_delta — Fee and Tax debit cash by value_usd.
-- ------------------------------------------------------------
create or replace function apply_cash_delta(
  p_brokerage_id text,
  p_currency     text,
  p_action       text,
  p_shares       numeric,
  p_price        numeric,
  p_value_usd    numeric,
  p_fees         numeric,
  p_taxes        numeric,
  p_direction    int
)
returns void language plpgsql as $$
declare
  delta numeric;
begin
  delta := case p_action
    when 'Buy'      then -(coalesce(p_shares, 0) * coalesce(p_price, 0)
                            + coalesce(p_fees, 0) + coalesce(p_taxes, 0))
    when 'Sell'     then  (coalesce(p_shares, 0) * coalesce(p_price, 0)
                            - coalesce(p_fees, 0) - coalesce(p_taxes, 0))
    when 'Dividend' then  coalesce(p_value_usd, 0)
    when 'Fee'      then -coalesce(p_value_usd, 0)
    when 'Tax'      then -coalesce(p_value_usd, 0)
    else 0
  end;
  delta := delta * p_direction;
  if delta = 0 then return; end if;

  insert into holdings (brokerage_id, ticker, qty, cost_basis, updated_at)
  values (p_brokerage_id, p_currency, delta, 1, now())
  on conflict (brokerage_id, ticker) do update
    set qty        = holdings.qty + excluded.qty,
        cost_basis = 1,
        updated_at = now();
end;
$$;

-- ------------------------------------------------------------
-- 3. check_cash_trajectory — Fee/Tax count as cash outflows in the
--    chronological running-balance scan. Both settle in USD via the
--    security/cash ticker's settlement_currency. Tolerance stays at 5 cents
--    (see 008).
-- ------------------------------------------------------------
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
        when 'Fee'      then -coalesce(t.value_usd, 0)
        when 'Tax'      then -coalesce(t.value_usd, 0)
        else 0
      end as d
    from transactions t
    left join assets a on a.ticker = t.ticker
    where t.brokerage_id = p_brokerage_id
      and (
        (t.action in ('Deposit', 'Withdraw') and t.ticker = p_currency)
        or
        (t.action in ('Buy', 'Sell', 'Dividend', 'Fee', 'Tax')
         and coalesce(a.settlement_currency, 'USD') = p_currency)
      )
  ),
  cumulative as (
    select sum(d) over (order by executed_at, created_at
                        rows between unbounded preceding and current row) as cum
    from deltas
  )
  select min(cum) into min_balance from cumulative;

  -- Allow up to 5 cents of negative drift to absorb decimal rounding.
  if min_balance is not null and min_balance < -0.05 then
    raise exception '% cash at % goes negative — lowest point: %',
      p_currency, p_brokerage_id, min_balance;
  end if;
end;
$$;
