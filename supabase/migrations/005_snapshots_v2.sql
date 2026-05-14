-- ============================================================
-- 005_snapshots_v2.sql
--
-- Activates the daily snapshot cron and fixes historical accuracy.
--
-- Changes vs migration 001:
--   1. `backfill_portfolio_snapshots()` now joins `price_history`
--      (date-correct) instead of the `prices` table (today's price).
--      Past snapshots actually reflect what the portfolio was worth on
--      that date. Uses a LATERAL subquery with a 14-day walk-back
--      window so weekends/holidays don't blank rows.
--   2. Snapshots are now written for every day in range, not only
--      tx-event dates — so the daily chart has gap-free coverage.
--   3. New `backfill_price_history()` populates `price_history` by
--      calling the `historical-price-range` Edge Function over
--      pg_net for every ever-held ticker. Run once after deploy.
--   4. pg_cron + pg_net are enabled and a single daily job at
--      23:00 UTC hits `refresh-prices` (which already calls
--      `take_daily_snapshot` inline — no second cron needed).
--
-- ONE-TIME SETUP BEFORE THIS MIGRATION:
--   -- Store the service_role JWT in Supabase Vault (encrypted at rest).
--   -- `alter database … set …` is blocked on managed Supabase, so we
--   -- use Vault and read via `vault.decrypted_secrets`.
--   select vault.create_secret(
--     '<your service_role JWT>',
--     'service_role_key'
--   );
--
-- AFTER THIS MIGRATION:
--   select backfill_price_history();        -- async; wait ~30s
--   select backfill_portfolio_snapshots();  -- now uses historical prices
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- backfill_portfolio_snapshots — replays tx state per day,
-- prices via price_history with LATERAL walk-back fallback.
-- ============================================================
create or replace function backfill_portfolio_snapshots()
returns void language plpgsql as $$
declare
  snap_date date;
  start_date date;
begin
  select min(executed_at::date) into start_date from transactions;
  if start_date is null then return; end if;

  for snap_date in
    select generate_series(start_date, current_date - 1, interval '1 day')::date
  loop
    -- Per brokerage
    insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
    select
      snap_date,
      h.brokerage_id,
      coalesce(sum(h.qty_held * p.price_usd), 0)
    from (
      select
        brokerage_id,
        ticker,
        sum(case action
          when 'Buy'      then coalesce(shares, 0)
          when 'Deposit'  then coalesce(shares, 0)
          when 'Sell'     then -coalesce(shares, 0)
          when 'Withdraw' then -coalesce(shares, 0)
          else 0 end) as qty_held
      from transactions
      where executed_at::date <= snap_date
      group by brokerage_id, ticker
    ) h
    cross join lateral (
      select case when h.ticker = 'USD' then 1
                  else ph.price_usd end as price_usd
      from price_history ph
      where ph.ticker = h.ticker
        and ph.date <= snap_date
        and ph.date >  snap_date - interval '14 days'
      order by ph.date desc
      limit 1
    ) p
    where h.qty_held > 0
    group by h.brokerage_id
    on conflict (snapshot_date, brokerage_id) do update
      set total_usd = excluded.total_usd;

    -- 'all' aggregate
    insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
    select snap_date, 'all', coalesce(sum(h.qty_held * p.price_usd), 0)
    from (
      select ticker,
        sum(case action
          when 'Buy'      then coalesce(shares, 0)
          when 'Deposit'  then coalesce(shares, 0)
          when 'Sell'     then -coalesce(shares, 0)
          when 'Withdraw' then -coalesce(shares, 0)
          else 0 end) as qty_held
      from transactions
      where executed_at::date <= snap_date
      group by ticker
    ) h
    cross join lateral (
      select case when h.ticker = 'USD' then 1
                  else ph.price_usd end as price_usd
      from price_history ph
      where ph.ticker = h.ticker
        and ph.date <= snap_date
        and ph.date >  snap_date - interval '14 days'
      order by ph.date desc
      limit 1
    ) p
    where h.qty_held > 0
    on conflict (snapshot_date, brokerage_id) do update
      set total_usd = excluded.total_usd;
  end loop;

  -- Today's row uses live `prices` (price_history may not yet have today)
  insert into portfolio_snapshots (snapshot_date, brokerage_id, total_usd)
  select current_date, h.brokerage_id, coalesce(sum(h.qty_held * p.price_usd), 0)
  from (
    select brokerage_id, ticker,
      sum(case action
        when 'Buy'      then coalesce(shares, 0)
        when 'Deposit'  then coalesce(shares, 0)
        when 'Sell'     then -coalesce(shares, 0)
        when 'Withdraw' then -coalesce(shares, 0)
        else 0 end) as qty_held
    from transactions group by brokerage_id, ticker
  ) h
  join prices p on p.ticker = h.ticker
  where h.qty_held > 0
  group by h.brokerage_id
  on conflict (snapshot_date, brokerage_id) do update
    set total_usd = excluded.total_usd;

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
  ) h
  join prices p on p.ticker = h.ticker
  where h.qty_held > 0
  on conflict (snapshot_date, brokerage_id) do update
    set total_usd = excluded.total_usd;
end;
$$;

-- ============================================================
-- backfill_price_history — for each ever-held ticker, fire an
-- async POST to the historical-price-range Edge Function.
-- The Edge Function upserts results into `price_history`.
-- Fire-and-forget: returns before HTTP calls complete.
-- ============================================================
create or replace function backfill_price_history(p_from date default null)
returns void language plpgsql as $$
declare
  t record;
  from_date date;
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if service_key is null or service_key = '' then
    raise exception 'service_role_key not found in vault. Run: select vault.create_secret(''<key>'', ''service_role_key'');';
  end if;

  for t in
    select distinct ticker from transactions where ticker <> 'USD'
  loop
    select coalesce(p_from, min(executed_at::date))
    into from_date
    from transactions
    where ticker = t.ticker;

    if from_date is null then continue; end if;

    perform net.http_post(
      url := 'https://vpemowcqunjebkpndxgk.functions.supabase.co/historical-price-range',
      body := jsonb_build_object(
        'ticker', t.ticker,
        'from',   from_date::text,
        'to',     current_date::text
      ),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      timeout_milliseconds := 30000
    );
  end loop;
end;
$$;

-- ============================================================
-- Cron — single daily job at 23:00 UTC.
-- refresh-prices already calls take_daily_snapshot() inline.
-- ============================================================
-- Drop legacy schedule names if a prior version of this migration
-- created them. unschedule() raises if the job doesn't exist, so
-- guard each call.
do $$
declare
  jobs text[] := array['refresh-prices', 'daily-snapshot'];
  j text;
begin
  foreach j in array jobs loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

select cron.schedule(
  'refresh-prices',
  '0 23 * * *',
  $$
    select net.http_post(
      url := 'https://vpemowcqunjebkpndxgk.functions.supabase.co/refresh-prices',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        )
      ),
      timeout_milliseconds := 60000
    )
  $$
);
