-- ============================================================
-- 007_full_ledger_cash.sql
--
-- OPTION 1 — full ledger cash model.
--
-- Every Buy/Sell/Dividend now mutates the brokerage's cash position
-- in addition to the security position. Before commit, the RPC
-- replays the cumulative cash trajectory for the affected
-- (brokerage, settlement_currency) and hard-blocks if the running
-- balance ever goes negative — including future-dated rows.
--
-- ONE-TIME WIPE: per the locked plan, all existing transactions and
-- holdings are deleted at the end of this migration. Users re-enter
-- their starting positions via the new starter-mode UI on first
-- "Add transaction" click for each brokerage (which is now empty).
-- ============================================================

-- ============================================================
-- 1. Schema: add settlement_currency on assets
-- ============================================================
alter table assets
  add column if not exists settlement_currency text not null default 'USD';

-- Cash assets settle in themselves
update assets set settlement_currency = ticker where is_cash = true;

-- ============================================================
-- 2. Cash delta — credit/debit a brokerage's cash position
--
-- Only fires for Buy/Sell/Dividend. Deposit/Withdraw are already
-- the cash position mutation themselves (handled by apply_holdings_delta).
-- ============================================================
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

-- ============================================================
-- 3. Trajectory check — scan all txs for this (brokerage, currency)
-- in chronological order; raise if the cumulative balance dips below
-- zero at any point. Handles back-dated inserts that would invalidate
-- a later tx.
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

  if min_balance is not null and min_balance < -0.000001 then
    raise exception '% cash at % goes negative — lowest point: %',
      p_currency, p_brokerage_id, min_balance;
  end if;
end;
$$;

-- ============================================================
-- 4. apply_transaction — insert tx, update holdings + cash, validate
-- ============================================================
create or replace function apply_transaction(tx jsonb)
returns uuid language plpgsql as $$
declare
  new_id        uuid;
  v_brokerage   text;
  v_ticker      text;
  v_action      text;
  v_currency    text;
begin
  v_brokerage := tx->>'brokerage_id';
  v_ticker    := tx->>'ticker';
  v_action    := tx->>'action';

  -- Resolve settlement currency for this tx
  if v_action in ('Deposit', 'Withdraw') then
    v_currency := v_ticker;
  else
    select settlement_currency into v_currency from assets where ticker = v_ticker;
    if v_currency is null then v_currency := 'USD'; end if;
  end if;

  insert into transactions (
    brokerage_id, ticker, action, shares, price, value_usd,
    fees, taxes, description, executed_at
  )
  values (
    v_brokerage, v_ticker, v_action,
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
    v_brokerage, v_ticker, v_action,
    nullif(tx->>'shares', '')::numeric,
    nullif(tx->>'price', '')::numeric,
    1
  );

  perform apply_cash_delta(
    v_brokerage, v_currency, v_action,
    nullif(tx->>'shares', '')::numeric,
    nullif(tx->>'price', '')::numeric,
    (tx->>'value_usd')::numeric,
    coalesce((tx->>'fees')::numeric, 0),
    coalesce((tx->>'taxes')::numeric, 0),
    1
  );

  perform check_cash_trajectory(v_brokerage, v_currency);

  return new_id;
end;
$$;

-- ============================================================
-- 5. revert_transaction — reverse cash + holdings, then delete
-- ============================================================
create or replace function revert_transaction(tx_id uuid)
returns void language plpgsql as $$
declare
  t          record;
  v_currency text;
begin
  select * into t from transactions where id = tx_id for update;
  if not found then raise exception 'Transaction % not found', tx_id; end if;

  if t.action in ('Deposit', 'Withdraw') then
    v_currency := t.ticker;
  else
    select settlement_currency into v_currency from assets where ticker = t.ticker;
    if v_currency is null then v_currency := 'USD'; end if;
  end if;

  perform apply_holdings_delta(t.brokerage_id, t.ticker, t.action, t.shares, t.price, -1);
  perform apply_cash_delta(
    t.brokerage_id, v_currency, t.action,
    t.shares, t.price, t.value_usd, t.fees, t.taxes, -1
  );

  delete from transactions where id = tx_id;

  -- Reverting could only ever increase cash availability for this currency
  -- (we removed a debit, or removed a credit that's now smaller). Still
  -- run the trajectory check in case a tx still in the table now needs
  -- the reverted Deposit it depended on.
  perform check_cash_trajectory(t.brokerage_id, v_currency);
end;
$$;

-- ============================================================
-- 6. update_transaction — revert old effect, apply new effect, validate
-- ============================================================
create or replace function update_transaction(tx_id uuid, new_tx jsonb)
returns void language plpgsql as $$
declare
  t              record;
  v_old_currency text;
  v_new_currency text;
  v_new_action   text;
  v_new_ticker   text;
  v_new_broker   text;
begin
  select * into t from transactions where id = tx_id for update;
  if not found then raise exception 'Transaction % not found', tx_id; end if;

  v_new_action := new_tx->>'action';
  v_new_ticker := new_tx->>'ticker';
  v_new_broker := new_tx->>'brokerage_id';

  if t.action in ('Deposit', 'Withdraw') then
    v_old_currency := t.ticker;
  else
    select settlement_currency into v_old_currency from assets where ticker = t.ticker;
    if v_old_currency is null then v_old_currency := 'USD'; end if;
  end if;

  if v_new_action in ('Deposit', 'Withdraw') then
    v_new_currency := v_new_ticker;
  else
    select settlement_currency into v_new_currency from assets where ticker = v_new_ticker;
    if v_new_currency is null then v_new_currency := 'USD'; end if;
  end if;

  -- Revert old
  perform apply_holdings_delta(t.brokerage_id, t.ticker, t.action, t.shares, t.price, -1);
  perform apply_cash_delta(
    t.brokerage_id, v_old_currency, t.action,
    t.shares, t.price, t.value_usd, t.fees, t.taxes, -1
  );

  -- Update row
  update transactions set
    brokerage_id = v_new_broker,
    ticker       = v_new_ticker,
    action       = v_new_action,
    shares       = nullif(new_tx->>'shares', '')::numeric,
    price        = nullif(new_tx->>'price', '')::numeric,
    value_usd    = (new_tx->>'value_usd')::numeric,
    fees         = coalesce((new_tx->>'fees')::numeric, 0),
    taxes        = coalesce((new_tx->>'taxes')::numeric, 0),
    description  = new_tx->>'description',
    executed_at  = (new_tx->>'executed_at')::timestamptz
  where id = tx_id;

  -- Apply new
  perform apply_holdings_delta(
    v_new_broker, v_new_ticker, v_new_action,
    nullif(new_tx->>'shares', '')::numeric,
    nullif(new_tx->>'price', '')::numeric,
    1
  );
  perform apply_cash_delta(
    v_new_broker, v_new_currency, v_new_action,
    nullif(new_tx->>'shares', '')::numeric,
    nullif(new_tx->>'price', '')::numeric,
    (new_tx->>'value_usd')::numeric,
    coalesce((new_tx->>'fees')::numeric, 0),
    coalesce((new_tx->>'taxes')::numeric, 0),
    1
  );

  -- Validate trajectory on every affected (brokerage, currency) pair
  perform check_cash_trajectory(t.brokerage_id, v_old_currency);
  if v_new_broker <> t.brokerage_id or v_new_currency <> v_old_currency then
    perform check_cash_trajectory(v_new_broker, v_new_currency);
  end if;
end;
$$;

-- ============================================================
-- 7. One-time wipe — fresh start under the new rules
-- ============================================================
delete from transactions;
delete from holdings;
