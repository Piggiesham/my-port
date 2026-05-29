-- ============================================================
-- 009_relax_shares_tolerance.sql
--
-- apply_holdings_delta previously raised whenever the resulting qty was
-- strictly less than zero. With brokerage exports that round shares to 7-8
-- decimals, a Sell can over-shoot the stored holding by 1e-7 shares purely
-- from decimal rounding — even when the user really did sell exactly what
-- they hold. This bumps the guard to a 1e-6 tolerance (about 1 millionth of
-- a share), large enough to absorb that noise but still tight enough to
-- catch real over-sells (which manifest as fractional or whole shares).
-- ============================================================

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
  if p_action = 'Dividend' then
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

  -- Tolerate up to 1e-6 of float drift from importer rounding; clamp to 0
  -- so the holding doesn't carry tiny negative residues.
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
