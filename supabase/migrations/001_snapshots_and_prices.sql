-- Run this in Supabase SQL Editor after the initial schema.sql

-- ============================================================
-- PORTFOLIO SNAPSHOTS (daily portfolio value per brokerage)
-- ============================================================
create table if not exists portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  brokerage_id  text not null,            -- 'all' | 'dime' | 'webull' | 'binance'
  total_usd     numeric(20, 6) not null,
  created_at    timestamptz default now(),
  unique (snapshot_date, brokerage_id)
);

alter table portfolio_snapshots enable row level security;
drop policy if exists "anon all" on portfolio_snapshots;
create policy "anon all" on portfolio_snapshots for all using (true) with check (true);

create index if not exists snapshots_date_broker_idx
  on portfolio_snapshots (snapshot_date desc, brokerage_id);

-- ============================================================
-- BACKFILL: compute portfolio value for each transaction date
-- using current prices (approximate for past dates)
-- ============================================================
create or replace function backfill_portfolio_snapshots()
returns void language plpgsql as $$
declare
  snap_date date;
begin
  -- For each distinct date when a transaction happened
  for snap_date in
    select distinct executed_at::date
    from transactions
    order by 1
  loop
    -- Per brokerage
    insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
    select
      snap_date,
      brokerage_id,
      coalesce(sum(qty_held * p.price_usd), 0) as total_usd
    from (
      select
        brokerage_id,
        ticker,
        sum(
          case action
            when 'Buy'      then coalesce(shares, 0)
            when 'Deposit'  then coalesce(shares, 0)
            when 'Sell'     then -coalesce(shares, 0)
            when 'Withdraw' then -coalesce(shares, 0)
            else 0
          end
        ) as qty_held
      from transactions
      where executed_at::date <= snap_date
      group by brokerage_id, ticker
    ) h
    join prices p on p.ticker = h.ticker
    where h.qty_held > 0
    group by brokerage_id
    on conflict (snapshot_date, brokerage_id) do update
      set total_usd = excluded.total_usd;

    -- 'all' brokerage = sum of all
    insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
    select
      snap_date,
      'all',
      coalesce(sum(qty_held * p.price_usd), 0)
    from (
      select
        ticker,
        sum(
          case action
            when 'Buy'      then coalesce(shares, 0)
            when 'Deposit'  then coalesce(shares, 0)
            when 'Sell'     then -coalesce(shares, 0)
            when 'Withdraw' then -coalesce(shares, 0)
            else 0
          end
        ) as qty_held
      from transactions
      where executed_at::date <= snap_date
      group by ticker
    ) h
    join prices p on p.ticker = h.ticker
    where h.qty_held > 0
    on conflict (snapshot_date, brokerage_id) do update
      set total_usd = excluded.total_usd;
  end loop;

  -- Also write today's snapshot
  insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
  select
    current_date,
    brokerage_id,
    coalesce(sum(h.qty_held * p.price_usd), 0)
  from (
    select brokerage_id, ticker,
      sum(case action
        when 'Buy'      then coalesce(shares, 0)
        when 'Deposit'  then coalesce(shares, 0)
        when 'Sell'     then -coalesce(shares, 0)
        when 'Withdraw' then -coalesce(shares, 0)
        else 0 end) as qty_held
    from transactions group by brokerage_id, ticker
  ) h join prices p on p.ticker = h.ticker where h.qty_held > 0
  group by brokerage_id
  on conflict (snapshot_date, brokerage_id) do update set total_usd = excluded.total_usd;

  insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
  select current_date, 'all', coalesce(sum(h.qty_held * p.price_usd), 0)
  from (
    select ticker,
      sum(case action
        when 'Buy'      then coalesce(shares, 0)
        when 'Deposit'  then coalesce(shares, 0)
        when 'Sell'     then -coalesce(shares, 0)
        when 'Withdraw' then -coalesce(shares, 0)
        else 0 end) as qty_held
    from transactions group by ticker
  ) h join prices p on p.ticker = h.ticker where h.qty_held > 0
  on conflict (snapshot_date, brokerage_id) do update set total_usd = excluded.total_usd;
end;
$$;

-- Run the backfill immediately
select backfill_portfolio_snapshots();

-- ============================================================
-- DAILY SNAPSHOT FUNCTION (called by pg_cron after price refresh)
-- ============================================================
create or replace function take_daily_snapshot()
returns void language plpgsql as $$
begin
  -- Per brokerage
  insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
  select
    current_date,
    h.brokerage_id,
    coalesce(sum(h.qty * p.price_usd), 0)
  from holdings h
  join prices p on p.ticker = h.ticker
  group by h.brokerage_id
  on conflict (snapshot_date, brokerage_id) do update
    set total_usd = excluded.total_usd;

  -- 'all'
  insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
  select current_date, 'all', coalesce(sum(h.qty * p.price_usd), 0)
  from holdings h join prices p on p.ticker = h.ticker
  on conflict (snapshot_date, brokerage_id) do update
    set total_usd = excluded.total_usd;
end;
$$;

-- ============================================================
-- ENABLE pg_cron EXTENSION (may already be enabled on your plan)
-- Schedule: refresh prices at 08:00 UTC daily, snapshot at 08:05
-- Uncomment these after deploying the Edge Function
-- ============================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule('refresh-prices', '0 8 * * *',
--   $$select net.http_post(
--       url := 'https://vpemowcqunjebkpndxgk.functions.supabase.co/refresh-prices',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--       )
--   )$$
-- );
--
-- select cron.schedule('daily-snapshot', '5 8 * * *',
--   $$ select take_daily_snapshot() $$
-- );
