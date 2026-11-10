-- Stage 1 (engineering assessment remediation, 2026-11-10): bind identity
-- in the data layer. Three defects, one root cause (assessment RC-4):
-- identity taken from the caller instead of the session.
--
-- 1. roamly_transition_activity_status (Live Companion check-in / complete)
--    shipped 2026-10-14 with the B01 defect class: SECURITY DEFINER,
--    executable by `authenticated`, ownership gated ONLY on the
--    caller-supplied p_user_id, and its p_user_id IS NULL path checked
--    only that the trip exists. Any signed-in user calling PostgREST
--    directly could flip activity statuses (check-ins, completions) on
--    ANOTHER traveller's trip. PROVEN LIVE in production 2026-11-09
--    (read-only SQL: body has no auth.uid(), authenticated execute = true).
--    Fixed here exactly on the PR #87 pattern (20261024): a session-bound
--    function for travellers + a service-role-only twin for the two
--    trusted server paths (the field-test session, whose routes run on
--    the admin client, and the admin live-test simulators, which call
--    with no user id at all). The old migration file is left untouched;
--    this is a forward-only correction.
--
-- 2. roamly_has_operational_location_trip answered "does this user have
--    a live trip right now" for ANY user id supplied by any signed-in
--    caller (boolean oracle, proven live 2026-11-09). Its only runtime
--    callers are its two definer wrappers (which already enforce the
--    same session binding and raise on mismatch) and server contexts.
--    Fixed by binding the answer to the session in the body: a caller
--    with a session identity only ever learns about their own trips;
--    service contexts (auth.uid() is null) evaluate as before, so the
--    wrappers, the terminal-trip trigger chain, and server callers are
--    behaviour-unchanged. Grants are re-asserted unchanged.
--
-- 3. F1: a signed-in traveller could directly UPDATE the truth-bearing
--    columns of their own roamly_bookings rows (row-level policy only,
--    grants never tightened — open in production, proven 2026-11-09).
--    Column grants are NOT safe here: the wallet's own save path
--    (createTripBooking, manual/confirm/attach routes) writes full rows
--    through the traveller's session role. The mechanism is therefore
--    the entitlement-guard pattern (20261106000100), with the protected
--    list set by a full writer census (STAGE1-IDENTITY-REPORT.md):
--    the columns NO legitimate session writer ever sets to a
--    truth-manufacturing value —
--      traveler_confirmed    (every live session route hardcodes false;
--                             the only flag-true writer in the codebase,
--                             saveConfirmedBooking, has no production
--                             call site — pinned by an existing suite)
--      extraction_confidence (never emitted by the session write path;
--                             forced to the column's own neutral default
--                             'medium' — the column is NOT NULL with a
--                             low/medium/high CHECK, so it cannot be
--                             forced to null)
--      source_connection_id  (set only from Gmail reconciliation input,
--      source_message_id       which only the admin pipeline supplies)
--    Both bookingTruth tiers require traveler_confirmed = true, so the
--    flag is the keystone: with it server-only, a session can no longer
--    manufacture a "Confirmed" booking. Columns with legitimate session
--    writes (booking_status — cancel/attach/re-save transitions;
--    source_type, amount_cents, currency, metadata, trip_id — the
--    wallet form's own fields) are deliberately NOT protected; see the
--    report for the per-column census and the stated residual.
--
-- DEPLOY NOTE (fail-closed): after this migration, any service-key
-- caller still invoking roamly_transition_activity_status gets a
-- permission error instead of a silent success; lib/roamly/
-- activityActions.ts routes server contexts to the _service twin in
-- the same change. No user-session caller changes behaviour: every
-- in-repo user flow already passes its own user id, and every
-- legitimate session booking write already supplies the values the
-- guard forces.

-- =====================================================================
-- 1a. roamly_transition_activity_status — session-bound (traveller path)
-- =====================================================================

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

  -- S1: bind the caller-supplied owner to the session identity. auth.uid()
  -- is the JWT subject of the caller; a service-role JWT carries no
  -- subject, so service callers cannot pass this gate at all and must use
  -- the _service function below. Without this gate, any authenticated
  -- caller could name another traveller's identifiers and pass the old
  -- ownership check.
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    raise exception 'roamly_transition_activity_status: caller identity mismatch.';
  end if;

  -- Ownership re-check, server-side: the trip must belong to the session
  -- user. The predicate uses auth.uid(), never the caller-supplied value,
  -- so a forged p_user_id cannot help even if the gate above were ever
  -- weakened.
  if not exists (
    select 1 from public.roamly_trips where id = p_trip_id and user_id = auth.uid()
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

-- Authenticated path only. CREATE OR REPLACE preserves pre-existing
-- grants, so the service_role grant from 20261014 is explicitly revoked
-- here.
revoke all on function public.roamly_transition_activity_status(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  from public, anon, service_role;
grant execute on function public.roamly_transition_activity_status(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  to authenticated;

-- =====================================================================
-- 1b. roamly_transition_activity_status_service — trusted server path
-- =====================================================================

-- Same signature, same compare-and-swap semantics, same caller-supplied
-- ownership gate as the original 20261014 function (including the
-- no-user-id field-test path) — but executable ONLY by service_role
-- (revoked from public, anon, authenticated). This is the path for the
-- field-test session (capability-gated upstream in getTripForAction,
-- routes run on the admin client) and the admin live-test simulators,
-- which act on a trip without a traveller session.
-- lib/roamly/activityActions.ts routes server contexts here.
create or replace function public.roamly_transition_activity_status_service(
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
    raise exception 'roamly_transition_activity_status_service: trip, target status, and allowed statuses are required.';
  end if;

  -- Ownership gate. The field-test path calls without a user id (it is
  -- capability-gated upstream in getTripForAction); in that case only
  -- verify the trip exists. Mirrors getTripForAction()'s ownership
  -- checks. This gate is trusted because the ACL below confines the
  -- function to the service role — no user session can reach it.
  if p_user_id is null then
    if not exists (select 1 from public.roamly_trips where id = p_trip_id) then
      raise exception 'roamly_transition_activity_status_service: trip not found.';
    end if;
  elsif not exists (
    select 1 from public.roamly_trips where id = p_trip_id and user_id = p_user_id
  ) then
    raise exception 'roamly_transition_activity_status_service: trip not found for this user.';
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

-- Service path only. Never executable by a user session.
revoke all on function public.roamly_transition_activity_status_service(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.roamly_transition_activity_status_service(uuid, uuid, uuid, uuid, text, text[], timestamptz, timestamptz)
  to service_role;

-- =====================================================================
-- 2. roamly_has_operational_location_trip — bind the answer to the
--    session. Body is the 20261031000200 definition verbatim, plus the
--    binding gate; the eligibility rule does not change.
-- =====================================================================

create or replace function public.roamly_has_operational_location_trip(
  p_user_id uuid,
  p_trip_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  -- S1: a caller with a session identity may only ever learn about
  -- their own trips. Returning false (not raising) keeps the boolean
  -- gate's contract for its definer callers, which already enforce the
  -- same binding themselves. Service contexts (auth.uid() is null —
  -- the wrappers' server callers, cron, the trigger chain) evaluate
  -- as before.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return false;
  end if;

  return exists (
    select 1
    from public.roamly_trips t
    cross join lateral (
      select coalesce(
        nullif(t.metadata #>> '{planning,timezone}', ''),
        nullif(t.metadata #>> '{tripPlanning,timezone}', ''),
        nullif(t.metadata ->> 'timezone', ''),
        nullif(t.metadata ->> 'destinationTimezone', ''),
        nullif(t.metadata ->> 'destination_timezone', ''),
        public.roamly_destination_registry_timezone(t.destination),
        public.roamly_destination_registry_timezone(t.destination_name),
        public.roamly_destination_registry_timezone(t.destination_city),
        public.roamly_destination_registry_timezone(t.metadata #>> '{planning,destination}'),
        public.roamly_destination_registry_timezone(t.metadata #>> '{planning,destinationCity}'),
        'UTC'
      ) as trip_timezone
    ) z
    where t.user_id = p_user_id
      and (p_trip_id is null or t.id = p_trip_id)
      and t.status in ('locked', 'active', 'planned', 'generated')
      and (
        t.itinerary_locked is true
        or t.itinerary_status = 'locked'
        or t.itinerary_generated_at is not null
      )
      and (coalesce(t.tracking_unlocked, false) or coalesce(t.live_companion_unlocked, false))
      and t.start_date is not null
      and t.end_date is not null
      and t.start_date <= (now() at time zone z.trip_timezone)::date
      and t.end_date >= (now() at time zone z.trip_timezone)::date
  );
end;
$$;

revoke all on function public.roamly_has_operational_location_trip(uuid, uuid) from public, anon;
grant execute on function public.roamly_has_operational_location_trip(uuid, uuid) to authenticated, service_role;

-- =====================================================================
-- 3. F1 — roamly_bookings truth guard (entitlement-guard pattern).
--
-- From this migration on, the confirmation keystone columns can only
-- take truth-manufacturing values from a PRIVILEGED writer:
--   * the service role (the Gmail reconciliation pipeline and the
--     other server flows that resolve their writer through
--     createSupabaseAdminClient()),
--   * the database owner (migrations, operator SQL), or
--   * a SECURITY DEFINER function owned by the database owner (e.g.
--     roamly_apply_gmail_booking_revision) — inside those functions
--     current_user is the owner, so they pass the guard.
--
-- Behaviour for non-privileged (traveller session) writers:
--   * INSERT — the protected columns are forced to their safe values
--     (traveler_confirmed = false, the attribution columns null,
--     extraction_confidence = 'medium', the column's own default).
--     Every legitimate session insert already supplies exactly
--     these values, so nothing changes for them; a hand-crafted insert
--     cannot be born confirmed.
--   * UPDATE — any statement that would CHANGE a protected column's
--     value is rejected (42501). Updates that leave the protected
--     columns untouched (cancel, review/discard metadata, the wallet
--     re-save spread — which repeats the stored flag verbatim) pass
--     unchanged.
--
-- This function is deliberately NOT security definer: it must see the
-- caller's own database role.
-- =====================================================================

create or replace function public.roamly_guard_booking_truth_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
  privileged boolean;
begin
  -- Newer PostgREST exposes the claims as one JSON setting instead of the
  -- per-claim setting; read it only when it is present and JSON-shaped,
  -- and never let a malformed value break a booking write.
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  privileged := current_user in ('service_role', 'postgres', 'supabase_admin')
    or jwt_role = 'service_role'
    or claims_role = 'service_role';

  if tg_op = 'INSERT' then
    if privileged then
      return new;
    end if;
    new.traveler_confirmed := false;
    new.extraction_confidence := 'medium';
    new.source_connection_id := null;
    new.source_message_id := null;
    return new;
  end if;

  -- UPDATE
  if privileged then
    return new;
  end if;

  if new.traveler_confirmed is distinct from old.traveler_confirmed
    or new.extraction_confidence is distinct from old.extraction_confidence
    or new.source_connection_id is distinct from old.source_connection_id
    or new.source_message_id is distinct from old.source_message_id
  then
    raise exception 'Roamly booking confirmation columns are server-managed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists roamly_guard_booking_truth_columns on public.roamly_bookings;
create trigger roamly_guard_booking_truth_columns
before insert or update on public.roamly_bookings
for each row
execute function public.roamly_guard_booking_truth_columns();

revoke all on function public.roamly_guard_booking_truth_columns() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
