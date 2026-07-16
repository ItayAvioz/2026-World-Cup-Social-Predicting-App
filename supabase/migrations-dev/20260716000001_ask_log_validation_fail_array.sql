-- v31 D3: widen ask_log.validation_fail from scalar text to text[] — the universal validation
-- layer (V1 repeat + V2 shape + V4 numeric + V5 entity, observe-mode) can flag MULTIPLE checks
-- on one answer (e.g. wrong-shape AND ungrounded-number). Existing scalar values ('repeat',
-- written by the old V1 repeat_guard) become 1-element arrays; NULLs stay NULL. Additive /
-- backward-compatible; service-role-only grants on the table are unchanged (REVOKE is not
-- column-scoped — the new shape inherits the existing table-level revoke).
-- DEV ONLY (ask_log exists only on ftryuvfdihmhlzvbpfeu).
alter table public.ask_log
  alter column validation_fail type text[]
  using (case when validation_fail is null then null else array[validation_fail] end);
