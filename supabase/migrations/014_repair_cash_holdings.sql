-- Repair drifted cash holdings from the transaction ledger (the source of
-- truth). holdings(dime, USD) had rotted to -5113.75 while the ledger balance
-- is +65.11 — a denormalized-cache divergence that made the
-- apply_holdings_delta share-guard reject otherwise-valid USD deposits
-- ("Not enough shares: dime has -5113.75 of USD, attempted delta ...").
--
-- Recomputes qty for every cash holding using the same delta math as
-- check_cash_trajectory. cost_basis for cash is always 1. Securities are left
-- alone (their weighted-avg cost needs an ordered replay, and they matched the
-- ledger). Idempotent: a correct row is rewritten to the same value.
with cash as (
  select
    t.brokerage_id,
    case when t.action in ('Deposit','Withdraw') then t.ticker
         else coalesce(a.settlement_currency, 'USD') end as currency,
    sum(case t.action
      when 'Deposit'  then  coalesce(t.shares, 0)
      when 'Withdraw' then -coalesce(t.shares, 0)
      when 'Buy'      then -(coalesce(t.shares,0)*coalesce(t.price,0)
                              + coalesce(t.fees,0) + coalesce(t.taxes,0))
      when 'Sell'     then  (coalesce(t.shares,0)*coalesce(t.price,0)
                              - coalesce(t.fees,0) - coalesce(t.taxes,0))
      when 'Dividend' then  coalesce(t.value_usd, 0)
      when 'Fee'      then -coalesce(t.value_usd, 0)
      when 'Tax'      then -coalesce(t.value_usd, 0)
      else 0
    end) as bal
  from transactions t
  left join assets a on a.ticker = t.ticker
  group by 1, 2
)
update holdings h
set qty = c.bal, updated_at = now()
from cash c
where h.brokerage_id = c.brokerage_id
  and h.ticker = c.currency
  and h.ticker in (select ticker from assets where is_cash);
