-- My Port — Supabase schema
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Single-user model: the anon key can read/write all rows.
-- If you later add auth, replace the policies with auth.uid()-scoped ones.

-- ============================================================
-- BROKERAGES (Dime!, Webull, Binance, …)
-- ============================================================
create table if not exists brokerages (
  id          text primary key,            -- e.g. 'dime', 'webull', 'binance'
  name        text not null,               -- 'Dime!', 'Webull', 'Binance'
  color       text not null default '#999' -- hex for chip dots
);

insert into brokerages (id, name, color) values
  ('dime',    'Dime!',   '#6EF5A4'),
  ('webull',  'Webull',  '#3b82f6'),
  ('binance', 'Binance', '#f0b90b')
on conflict (id) do nothing;

-- ============================================================
-- ASSETS (asset metadata: ticker, name, type, logo, sector)
-- ============================================================
create table if not exists assets (
  ticker      text primary key,            -- 'VOO', 'BTC', 'USD', …
  name        text not null,
  type        text not null,               -- 'Stock' | 'ETF' | 'Crypto' | 'Bond' | 'Commodity' | 'Cash'
  sector      text,                        -- 'Tech' | 'Consumer' | 'Crypto' | …
  logo_bg     text default '#333',
  logo_text   text,
  logo_dark   boolean default false,
  is_cash     boolean default false,
  created_at  timestamptz default now()
);

-- ============================================================
-- HOLDINGS (current position per broker + ticker)
-- One row per (brokerage, ticker). Could be computed from transactions,
-- but storing it makes the dashboard cheap to render.
-- ============================================================
create table if not exists holdings (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  text not null references brokerages(id) on delete cascade,
  ticker        text not null references assets(ticker) on delete restrict,
  qty           numeric(20, 8) not null default 0,
  cost_basis    numeric(20, 6) not null default 0,    -- average cost per unit, USD
  updated_at    timestamptz default now(),
  unique (brokerage_id, ticker)
);

create index if not exists holdings_brokerage_idx on holdings (brokerage_id);

-- ============================================================
-- TRANSACTIONS (the source of truth — buys, sells, dividends, deposits)
-- ============================================================
create table if not exists transactions (
  id            uuid primary key default gen_random_uuid(),
  brokerage_id  text not null references brokerages(id) on delete cascade,
  ticker        text not null references assets(ticker) on delete restrict,
  action        text not null,                     -- 'Buy' | 'Sell' | 'Dividend' | 'Deposit' | 'Withdraw'
  shares        numeric(20, 8),                    -- null for dividends with no share count
  price         numeric(20, 6),                    -- per-share price in USD; null where N/A
  value_usd     numeric(20, 6) not null,           -- total USD value of the transaction
  fees          numeric(20, 6) default 0,
  taxes         numeric(20, 6) default 0,
  description   text,
  executed_at   timestamptz not null,
  created_at    timestamptz default now()
);

create index if not exists transactions_executed_idx on transactions (executed_at desc);
create index if not exists transactions_brokerage_idx on transactions (brokerage_id);
create index if not exists transactions_ticker_idx on transactions (ticker);

-- ============================================================
-- PRICES (latest market price cache per ticker — refreshed by a job)
-- ============================================================
create table if not exists prices (
  ticker        text primary key references assets(ticker) on delete cascade,
  price_usd     numeric(20, 6) not null,
  updated_at    timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Single-user: allow anon read+write everywhere. Tighten when adding auth.
-- ============================================================
alter table brokerages   enable row level security;
alter table assets       enable row level security;
alter table holdings     enable row level security;
alter table transactions enable row level security;
alter table prices       enable row level security;

-- Permissive policies (single-user demo). Remove and replace if you add auth.
do $$
declare
  t text;
begin
  for t in select unnest(array['brokerages','assets','holdings','transactions','prices']) loop
    execute format('drop policy if exists "anon all" on %I', t);
    execute format('create policy "anon all" on %I for all using (true) with check (true)', t);
  end loop;
end$$;

-- ============================================================
-- SEED DATA (matches the mock data in src/data.js so the UI looks identical)
-- ============================================================
insert into assets (ticker, name, type, sector, logo_bg, logo_text, logo_dark, is_cash) values
  ('VOO',   'Vanguard S&P 500',  'ETF',       'Diversified',     '#9c1b1b', 'V',   false, false),
  ('AMZN',  'Amazon.com Inc',    'Stock',     'Consumer',        '#0f0f10', 'a',   false, false),
  ('GOOGL', 'Alphabet Inc',      'Stock',     'Tech',            '#1a73e8', 'G',   false, false),
  ('TSM',   'Taiwan Semicond.',  'Stock',     'Tech',            '#cc0000', 'tsm', false, false),
  ('PM',    'Philip Morris',     'Stock',     'Consumer',        '#2a8bc3', 'PM',  false, false),
  ('VSAT',  'Viasat Inc',        'Stock',     'Communications',  '#ffffff', 'M',   true,  false),
  ('BTC',   'Bitcoin',           'Crypto',    'Crypto',          '#f7931a', '₿',   false, false),
  ('ETH',   'Ethereum',          'Crypto',    'Crypto',          '#627eea', 'Ξ',   false, false),
  ('GLD',   'SPDR Gold Shares',  'Commodity', 'Commodity',       '#d4af37', 'Au',  false, false),
  ('USTB',  'US 3-Mo T-Bill',    'Bond',      'Fixed Income',    '#1e293b', 'T',   false, false),
  ('USD',   'US Dollar Cash',    'Cash',      'Cash',            '#16a34a', '$',   false, true),
  ('THB',   'Thai Baht Cash',    'Cash',      'Cash',            '#dc2626', '฿',   false, true)
on conflict (ticker) do nothing;

insert into prices (ticker, price_usd) values
  ('VOO', 528.42), ('AMZN', 198.74), ('GOOGL', 178.21), ('TSM', 195.18),
  ('PM', 134.07), ('VSAT', 31.45), ('BTC', 67842.10), ('ETH', 3215.40),
  ('GLD', 242.10), ('USTB', 99.78), ('USD', 1.00), ('THB', 0.031)
on conflict (ticker) do update set price_usd = excluded.price_usd, updated_at = now();

insert into holdings (brokerage_id, ticker, qty, cost_basis) values
  ('dime',    'VOO',  1.811,  448.85),
  ('webull',  'AMZN', 3.044,  168.55),
  ('webull',  'GOOGL',2.259,  73.94),
  ('webull',  'TSM',  2.010,  95.54),
  ('dime',    'PM',   2.231,  117.57),
  ('webull',  'VSAT', 9.498,  13.46),
  ('binance', 'BTC',  0.0038, 41200.00),
  ('binance', 'ETH',  0.061,  2410.00),
  ('webull',  'GLD',  0.682,  195.20),
  ('webull',  'USTB', 1.323,  98.50),
  ('webull',  'USD',  250.00, 1.00),
  ('dime',    'THB',  8000.00, 0.031)
on conflict (brokerage_id, ticker) do nothing;
