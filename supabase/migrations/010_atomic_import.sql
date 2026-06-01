-- ============================================================
-- 010_atomic_import.sql
--
-- Atomic bulk import. Inserts an ordered array of transactions inside a
-- SINGLE transaction by looping apply_transaction. Because a PL/pgSQL
-- function runs in one transaction, any row that raises aborts the whole
-- batch — nothing is committed. A failed import therefore never leaves
-- partial rows (and never the holdings/cash drift partial inserts caused).
--
-- p_txs: jsonb array of apply_transaction payloads, each optionally carrying
--        an "fx_rate_at_tx" key (written onto the row after insert). Rows are
--        applied in array order, so the caller must pre-sort chronologically
--        (a funding Deposit must precede the Buy it funds).
--
-- On failure raises 'row N (<action> <ticker>): <original error>' so the
-- client can map the failure back to a specific row. Returns the array of
-- new transaction ids on success.
-- ============================================================
create or replace function import_transactions(p_txs jsonb)
returns jsonb language plpgsql as $$
declare
  elem   jsonb;
  new_id uuid;
  ids    uuid[] := array[]::uuid[];
  idx    int := 0;
  fx     numeric;
begin
  for elem in select value from jsonb_array_elements(p_txs)
  loop
    idx := idx + 1;
    begin
      new_id := apply_transaction(elem - 'fx_rate_at_tx');
    exception when others then
      -- Re-raise with row context; this aborts the whole function (rollback).
      raise exception 'row % (% %): %',
        idx, coalesce(elem->>'action', ''), coalesce(elem->>'ticker', ''), sqlerrm;
    end;

    fx := nullif(elem->>'fx_rate_at_tx', '')::numeric;
    if fx is not null then
      update transactions set fx_rate_at_tx = fx where id = new_id;
    end if;

    ids := ids || new_id;
  end loop;

  return to_jsonb(ids);
end;
$$;
