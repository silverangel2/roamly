-- CA3 (booking-persistence hardening, corrective action 3): atomic activity-status
-- transition for the live companion (skip / check-in / complete).
--
-- Background: skip state is already server-persisted — performActivityAction()
-- (lib/roamly/activityActions.ts) writes status='skipped' to
-- public.roamly_activities and records a companion event, so a
-- tab-close/disconnect/redeploy does NOT lose skips (the sessionStorage
-- copy in liveCompanion.ts is only an instant-UI mirror + offline-outbox
-- backstop). The genuine "during updates" defect in this area was the write
-- itself: transitionActivityAtomically() updated the tracking row
-- (roamly_activities) and its display mirror (roamly_trip_activities) in two
-- sequential statements. A deploy/restart between them left the two sources of
-- truth disagreeing — e.g. an activity showing skipped in one view and planned
-- in another after a reconnect.
--
-- roamly_transition_activity_status performs the guarded tracking write and the
-- display mirror in ONE transaction. The status guard (status = ANY of the
-- allowed previous statuses) is the same compare-and-swap the old code applied
-- in PostgREST, so double-taps stay idempotent.

create or replace function public.roamly_transition_activity_status(
  p_trip_id uuid,
  p_user_id uuid,
  p_tracking_activity_id uuid,
  p_display_activity_id uuid,
  p_to_status text,
  p_allowed_statuses text[],
  p_checked_in_at timestamptz default null,
  p_completed_at timestamptz default null
)
returns table (transitioned boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracking_rows integer := 0;
  v_display_rows integer := 0;
begin
  if p_trip_id is null or p_to_status is null or p_allowed_statuses is null then
    raise exception 'roamly_transition_activity_status: trip, target status, and allowed statuses are required.';
  end if;

  -- Ownership gate. The field-test path calls without a user id (it is
  -- capability-gated upstream in getTripForAction); in that case only verify
  -- the trip exists. Mirrors getTripForAction()'s ownership checks.
  if p_user_id is null then
    if not exists (select 1 from public.roamly_trips where id = p_trip_id) then
      raise exception 'roamly_transition_activity_status: trip not found.';
    end if;
  elsif not exists (
    select 1 from public.roamly_trips where id = p_trip_id and user_id = p_user_id
  ) then
    raise exception 'roamly_transition_activity_status: trip not found for this user.';
  end if;

  if p_tracking_activity_id is not null then
    -- Guarded compare-and-swap, exactly as the old PostgREST update did.
    update public.roamly_activities
    set status = p_to_status,
        checked_in_at = coalesce(p_checked_in_at, checked_in_at),
        completed_at = coalesce(p_completed_at, completed_at)
    where id = p_tracking_activity_id
      and trip_id = p_trip_id
      and status = any(p_allowed_statuses);
    get diagnostics v_tracking_rows = row_count;

    if v_tracking_rows = 1 and p_display_activity_id is not null then
      -- Display mirror: unguarded, exactly as the old code did once the
      -- guarded tracking write succeeded.
      update public.roamly_trip_activities
      set status = p_to_status,
          checked_in_at = coalesce(p_checked_in_at, checked_in_at),
          completed_at = coalesce(p_completed_at, completed_at)
      where id = p_display_activity_id
        and trip_id = p_trip_id;
      get diagnostics v_display_rows = row_count;
    end if;
  elsif p_display_activity_id is not null then
    -- Display-only activities keep the guarded write, as before.
    update public.roamly_trip_activities
    set status = p_to_status,
        checked_in_at = coalesce(p_checked_in_at, checked_in_at),
        completed_at = coalesce(p_completed_at, completed_at)
    where id = p_display_activity_id
      and trip_id = p_trip_id
      and status = any(p_allowed_statuses);
    get diagnostics v_display_rows = row_count;
  end if;

  return query select (v_tracking_rows = 1 or v_display_rows = 1);
end;
$$;

-- ACL: callable by authenticated users (their own trips only — ownership is
-- enforced inside the function) and the service role. The skip/check-in/
-- complete API routes run with either the user's own client (requireUser) or
-- the admin client (field-test path), so both grants are required to avoid a
-- behavior regression versus the old direct table writes under RLS.
revoke all on function public.roamly_transition_activity_status(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  from public, anon;
grant execute on function public.roamly_transition_activity_status(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  to authenticated, service_role;
