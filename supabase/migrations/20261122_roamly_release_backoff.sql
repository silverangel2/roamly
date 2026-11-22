-- Pack-wait release backoff (Koeln 2026-11-22, KF-2 #3 reclassified SLOW).
--
-- Root cause: a cold big city needs a destination-pack build whose live
-- collection lane takes up to ~210 s of continuous work, but the outline
-- stage released the job immediately-due on every pack-wait cycle, so the
-- harness's ~4 s advance polling re-claimed it at once and re-kicked a
-- ~50 s drive that discarded its partial live collection — 75 waits in
-- 5 min, pack never published. The */5 cron wake that could host the
-- full 300 s drive never got an uncontested claim (the job was running
-- under a harness claim at the wake's claim instant). Koeln completed on
-- its own at the 19:50 wake, 14m32s in — slow, not stranded.
--
-- Fix: roamly_release_generation_job accepts an optional
-- p_next_attempt_at. The worker passes now + 90 s only on the pack-wait
-- busy release, so the job is unclaimable for 90 s: the in-flight drive
-- runs, and the next claim (cron or harness) finds a ready pack or a
-- still-building one. All other releases pass nothing and the row keeps
-- its existing next_attempt_at — pre-fix behavior. The 2 h pack-wait
-- bound, the claim RPCs, and the drive budgets are untouched.
--
-- Apply: run this file on the Dell DB at ship (same manual apply as the
-- 20261122 claim-dedupe migration, PR #139). The old 3-argument function
-- is dropped first: CREATE OR REPLACE cannot change a function's
-- argument list, and leaving both overloads would split callers between
-- two definitions. The drop + create run in one transaction, so there is
-- no window without the function; the 4th parameter defaults to NULL, so
-- existing 3-argument calls keep working unchanged.

drop function if exists public.roamly_release_generation_job(uuid, text, text);

create or replace function public.roamly_release_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_next_status text default 'waiting',
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.roamly_trip_generation_jobs
  set
    status = case when p_next_status in ('queued', 'waiting', 'failed') then p_next_status else 'waiting' end,
    locked_at = null,
    locked_by = null,
    lease_expires_at = null,
    next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at)
  where id = p_job_id
    and locked_by = p_worker_id
    and status in ('running', 'waiting', 'failed');
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.roamly_release_generation_job(uuid, text, text, timestamptz) from public, authenticated;

grant execute on function public.roamly_release_generation_job(uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
