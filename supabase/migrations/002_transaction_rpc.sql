-- Run after 001_snapshots_and_prices.sql
--
-- These three RPCs are the only supported way for the app to mutate
-- transactions: they keep `holdings` in sync inside the same SQL
-- transaction so the two tables can't drift apart on partial failure.
--
-- Holdings semantics:
--   Buy       qty += shares,  cost_basis = weighted average
--   Sell      qty -= shares,  cost_basis unchanged (FIFO/LIFO is a later feature)
--   Deposit   cash qty += shares (ticker must be a cash asset)
--   Withdraw  cash qty -= shares
--   Dividend  no holding change (treat as informational; user records a Deposit
--             separately if they want cash credited)

-- ============================================================
-- apply_holdings_delta — shared mutation used by apply & revert
-- direction = +1 (apply) or -1 (revert)
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

  -- Sign of qty change before applying direction
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

  if new_qty < 0 then
    raise exception 'Not enough shares: % has % of %, attempted delta %',
      p_brokerage_id, cur_qty, p_ticker, delta_qty;
  end if;

  -- Weighted-average cost basis recalculation
  if p_action in ('Buy', 'Deposit') then
    if p_direction = 1 then
      -- Adding shares: weighted avg
      if new_qty = 0 then
        new_cost := 0;
      else
        new_cost := ((cur_qty * cur_cost) + (p_shares * coalesce(p_price, 0))) / new_qty;
      end if;
    else
      -- Reverting a buy: back out this lot's contribution
      if new_qty = 0 then
        new_cost := 0;
      else
        new_cost := ((cur_qty * cur_cost) - (p_shares * coalesce(p_price, 0))) / new_qty;
        if new_cost < 0 then new_cost := 0; end if;
      end if;
    end if;
  else
    -- Sell / Withdraw: cost basis per remaining unit is unchanged
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

-- ============================================================
-- apply_transaction — insert tx and update holdings atomically
-- ============================================================
create or replace function apply_transaction(tx jsonb)
returns uuid language plpgsql as $$
declare
  new_id uuid;
begin
  insert into transactions (
    brokerage_id, ticker, action, shares, price, value_usd,
    fees, taxes, description, executed_at
  )
  values (
    tx->>'brokerage_id',
    tx->>'ticker',
    tx->>'action',
    nullif(tx->>'shares', '')::numeric,
    nullif(tx->>'price', '')::numeric,
    (tx->>'value_usd')::numeric,
    coalesce((tx->>'fees')::numeric, 0),
    coalesce((tx->>'taxes')::numeric, 0),
    tx->>'description',
    (tx->>'executed_at')::timestamptz
  )
  returning id into new_id;

  perform apply_holdings_delta(
    tx->>'brokerage_id',
    tx->>'ticker',
    tx->>'action',
    nullif(tx->>'shares', '')::numeric,
    nullif(tx->>'price', '')::numeric,
    1
  );

  return new_id;
end;
$$;

-- ============================================================
-- revert_transaction — reverse holding effect, then delete the row
-- ============================================================
create or replace function revert_transaction(tx_id uuid)
returns void language plpgsql as $$
declare
  t record;
begin
  select * into t from transactions where id = tx_id for update;
  if not found then
    raise exception 'Transaction % not found', tx_id;
  end if;

  perform apply_holdings_delta(
    t.brokerage_id, t.ticker, t.action, t.shares, t.price, -1
  );

  delete from transactions where id = tx_id;
end;
$$;

-- ============================================================
-- update_transaction — revert old, apply new, keep same id
-- ============================================================
create or replace function update_transaction(tx_id uuid, new_tx jsonb)
returns void language plpgsql as $$
declare
  t record;
begin
  select * into t from transactions where id = tx_id for update;
  if not found then
    raise exception 'Transaction % not found', tx_id;
  end if;

  -- Reverse the old effect
  perform apply_holdings_delta(
    t.brokerage_id, t.ticker, t.action, t.shares, t.price, -1
  );

  -- Update the row in place
  update transactions set
    brokerage_id = new_tx->>'brokerage_id',
    ticker       = new_tx->>'ticker',
    action       = new_tx->>'action',
    shares       = nullif(new_tx->>'shares', '')::numeric,
    price        = nullif(new_tx->>'price', '')::numeric,
    value_usd    = (new_tx->>'value_usd')::numeric,
    fees         = coalesce((new_tx->>'fees')::numeric, 0),
    taxes        = coalesce((new_tx->>'taxes')::numeric, 0),
    description  = new_tx->>'description',
    executed_at  = (new_tx->>'executed_at')::timestamptz
  where id = tx_id;

  -- Apply the new effect
  perform apply_holdings_delta(
    new_tx->>'brokerage_id',
    new_tx->>'ticker',
    new_tx->>'action',
    nullif(new_tx->>'shares', '')::numeric,
    nullif(new_tx->>'price', '')::numeric,
    1
  );
end;
$$;
