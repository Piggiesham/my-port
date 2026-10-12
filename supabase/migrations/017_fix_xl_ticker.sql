-- ============================================================
-- 017_fix_xl_ticker.sql
--
-- One-off data repair. The Dime! screenshot importer read "XLV" as "XL" on a
-- dividend (+$0.55) and its withholding tax (-$0.08) dated 2025-09-24, which
-- booked them under a fake `XL` ticker and auto-created `XL` (and an unused
-- `XLW`) in the asset catalog. Both assets have no price, so they showed up as
-- unpriced tickers.
--
-- PREVIEW (read-only) — should list exactly 2 rows:
--   select id, action, value_usd, description, executed_at
--   from transactions where ticker = 'XL';
--
-- Cash effect is unchanged: both assets settle in USD, so USD cash and
-- `holdings` stay the same. The final delete is guarded — an asset is only
-- removed if no transaction or holding still points at it.
-- Idempotent: a re-run finds no XL rows and deletes nothing more.
-- ============================================================
update transactions
set ticker = 'XLV'
where ticker = 'XL'
  and description like '%XLV%';

delete from assets a
where a.ticker in ('XL', 'XLW')
  and not exists (select 1 from transactions t where t.ticker = a.ticker)
  and not exists (select 1 from holdings h where h.ticker = a.ticker);
