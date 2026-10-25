-- Roamly auto-sync fix (2026-10-25): record the last Gmail sync failure
-- next to the connection row so traveler surfaces can name it in plain
-- words ("Gmail sync hasn't worked since <date> — reconnect Gmail")
-- instead of showing "connected" beside a frozen sync date.
--
-- ADDITIVE ONLY: two nullable columns, no existing column touched, no
-- data rewritten, no RLS/policy change. Safe to apply any time; the code
-- reads and writes these columns best-effort, so deploying before or
-- after this migration is applied cannot break sync or the gate view.
-- Rollback: drop the two columns (loses only failure history, nothing
-- else). Owner-applied in the Supabase SQL editor, like steps 1–3.
alter table public.email_connections
  add column if not exists last_sync_error_code text,
  add column if not exists last_sync_failed_at timestamptz;
