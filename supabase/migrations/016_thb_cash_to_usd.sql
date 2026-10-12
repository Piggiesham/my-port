-- ============================================================
-- 016_thb_cash_to_usd.sql
--
-- ADR 0005: the ledger holds USD cash only. A baht deposit/withdrawal is
-- converted at entry and stored as a USD row whose fx_rate_at_tx is the
-- THB-per-USD rate actually used. Before this, the manual add-transaction
-- path stored such flows under ticker 'THB' (qty in baht), which put them in
-- a separate cash bucket that never funded USD Buys.
--
-- This migration converts every existing THB-ticker Deposit/Withdraw:
--   shares        := USD amount            (value_usd, or shares * price)
--   price         := 1
--   value_usd     := USD amount
--   fx_rate_at_tx := baht / USD amount     (the baht actually exchanged)
--   ticker        := 'USD'
--
-- PREVIEW (read-only) — run this first; it should list the rows below:
--   select id, brokerage_id, action, executed_at,
--          shares as baht,
--          coalesce(nullif(value_usd,0), shares * price) as usd,
--          shares / nullif(coalesce(nullif(value_usd,0), shares * price),0) as thb_per_usd
--   from transactions where ticker = 'THB' and action in ('Deposit','Withdraw');
--
-- Idempotent: after it runs no THB-ticker cash rows remain, so a re-run
-- touches nothing. The `holdings` cache is rebuilt from the ledger at the end
-- (015's rebuild_holdings), so the stale THB cash position disappears.
-- The 'THB' row in `assets` and the THB series in `prices`/`price_history`
-- are left alone — they are still the FX source.
-- ============================================================
update transactions
set
  shares        = coalesce(nullif(value_usd, 0), shares * price),
  fx_rate_at_tx = case
                    when coalesce(nullif(value_usd, 0), shares * price) > 0
                      then shares / coalesce(nullif(value_usd, 0), shares * price)
                    else fx_rate_at_tx
                  end,
  value_usd     = coalesce(nullif(value_usd, 0), shares * price),
  price         = 1,
  ticker        = 'USD'
where ticker = 'THB'
  and action in ('Deposit', 'Withdraw');

select rebuild_holdings();
