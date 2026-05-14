-- Historical daily close prices, populated by the historical-price-range edge fn.
-- The chart reads from here and falls back to calling the edge fn for missing
-- date spans, upserting results so subsequent loads are instant.

create table if not exists price_history (
  ticker     text not null,
  date       date not null,
  price_usd  numeric(20, 6) not null,
  created_at timestamptz default now(),
  primary key (ticker, date)
);

alter table price_history enable row level security;

drop policy if exists "anon read" on price_history;
create policy "anon read"
  on price_history for select
  using (true);

-- service_role bypasses RLS by default; this policy is explicit for clarity
-- and lets future authenticated writes be tightened without changing schema.
drop policy if exists "service write" on price_history;
create policy "service write"
  on price_history for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists price_history_ticker_date_idx
  on price_history (ticker, date desc);
