-- Seed the USD/THB cash assets. schema.sql seeds these, but the numbered
-- migrations never did — so a DB built via `supabase db push` (migrations only)
-- has no cash assets, and every cash Deposit/Withdraw fails the
-- transactions_ticker_fkey foreign key. Securities work, cash doesn't.
--
-- Idempotent: safe to re-run. settlement_currency is set explicitly because
-- migration 007's `update ... where is_cash` ran before these rows existed.
insert into assets (ticker, name, type, sector, logo_bg, logo_text, logo_dark, is_cash, settlement_currency) values
  ('USD', 'US Dollar Cash', 'Cash', 'Cash', '#16a34a', '$', false, true, 'USD'),
  ('THB', 'Thai Baht Cash', 'Cash', 'Cash', '#dc2626', '฿', false, true, 'THB')
on conflict (ticker) do update
  set is_cash = true,
      settlement_currency = excluded.settlement_currency;

-- Cash needs a price row or holdings valuation reads 0. Don't clobber a live
-- THB rate the cron may have written.
insert into prices (ticker, price_usd) values
  ('USD', 1.00), ('THB', 0.031)
on conflict (ticker) do nothing;
