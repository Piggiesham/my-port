-- ============================================================
-- 015_rebuild_holdings.sql
--
-- Self-healing cache rebuild. `holdings` is a denormalized cache of the
-- transaction ledger (the source of truth). It drifted once already
-- (dime|USD, repaired in 014) — a scar from the 002→007 cash-model change,
-- where the old apply_transaction tracked no cash and nothing rebuilt the
-- cache when the model changed.
--
-- rebuild_holdings() wipes holdings and replays every transaction in
-- chronological order through the SAME production functions that live
-- mutations use (apply_holdings_delta + apply_cash_delta). So the rebuilt
-- cache is, by construction, exactly what normal app activity would have
-- produced — including weighted-average cost basis, which the set-based
-- repair in 014 couldn't recompute.
--
-- Re-runnable any time the cache is suspect (after a messy import, a manual
-- DB edit, or another model change). Supersedes the one-off 014.
--
-- Safe to truncate-and-replay: every holdings row is transaction-backed
-- (verified — no seed-only positions), so nothing is lost.
-- ============================================================
create or replace function rebuild_holdings()
returns void language plpgsql as $$
declare
  t          record;
  v_currency text;
begin
  delete from holdings;

  for t in
    select * from transactions
    order by executed_at, created_at
  loop
    -- Resolve settlement currency the same way apply_transaction does.
    if t.action in ('Deposit', 'Withdraw') then
      v_currency := t.ticker;
    else
      select settlement_currency into v_currency from assets where ticker = t.ticker;
      if v_currency is null then v_currency := 'USD'; end if;
    end if;

    perform apply_holdings_delta(
      t.brokerage_id, t.ticker, t.action, t.shares, t.price, 1
    );
    perform apply_cash_delta(
      t.brokerage_id, v_currency, t.action,
      t.shares, t.price, t.value_usd, t.fees, t.taxes, 1
    );
  end loop;
end;
$$;

-- Run it once now to resync any lingering cost-basis drift.
select rebuild_holdings();
