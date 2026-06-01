-- ============================================================
-- 011_shift_to_bkk_time.sql
--
-- ONE-TIME DATA MIGRATION — RUN EXACTLY ONCE.
--
-- The app moved from "store UTC, display Bangkok" to "store Bangkok
-- wall-clock directly" (see src/data.js). Bangkok is a fixed UTC+7 with no
-- DST, so we shift every existing transaction's executed_at forward by 7
-- hours: its stored value now equals the Bangkok wall-clock it represents.
--
-- ⚠️  Running this twice double-shifts (+14h). There is no built-in guard —
--     preview first, run once, and deploy the matching frontend at the same
--     time (the new frontend reads timestamps literally, with no ±7).
--
-- Not touched:
--   • created_at  — machine/audit + tiebreak only; stays real UTC.
--   • price_history / prices / portfolio_snapshots — cron-written, stay UTC.
-- ============================================================

-- Preview (run on its own first; confirm the +7h shift looks right):
--   select id, ticker, action, executed_at as old, executed_at + interval '7 hours' as new
--   from transactions order by executed_at;

update transactions
set executed_at = executed_at + interval '7 hours';
