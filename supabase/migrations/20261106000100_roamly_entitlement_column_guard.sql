-- Close the Free-Pro hole found by the 2026-11-06 security pass (Check 4).
--
-- Paid entitlement on roamly_trips lives in row columns, and the owner-write
-- RLS policy let any signed-in traveller PATCH those columns directly
-- through PostgREST with the public key -- flipping tracking_unlocked /
-- live_companion_unlocked / itinerary_payment_status on their own trip and
-- unlocking the paid product (Live Companion, tracking, repeat generation)
-- without paying.
--
-- From this migration on, the entitlement / payment-linkage columns listed
-- in the guard can only take non-default values from a PRIVILEGED writer:
--   * the service role (Roamly's server code: Stripe webhook + checkout
--     return path, the generation worker, and the billing helpers that
--     resolve their writer through createSupabaseAdminClient()),
--   * the database owner (migrations, operator SQL), or
--   * a SECURITY DEFINER function owned by the database owner (the
--     customer trip-change RPCs that copy a trip's EXISTING entitlement
--     onto its successor trip, the generation finalizers) -- inside those
--     functions current_user is the owner, so they pass the guard while
--     the values they write remain ones a privileged path already set.
--
-- Every legitimate writer was verified in code before this mechanism was
-- chosen (security-pass-2026-11-06/SECURITY-FIXES-REPORT.md has the full
-- census). No legitimate path changes these columns through the
-- traveller's own (authenticated) database role.
--
-- Behaviour for non-privileged writers:
--   * INSERT -- the protected columns are forced to their safe defaults,
--     so a hand-crafted insert cannot be born paid. The app's own draft
--     inserts already pass exactly these defaults, so nothing changes
--     for them.
--   * UPDATE -- any statement that would CHANGE a protected column's
--     value is rejected (42501). Updates that leave the protected
--     columns untouched (title, metadata, status, dates, checklists --
--     the traveller-content writes the app makes every day) pass
--     unchanged, including updates whose SET list repeats the current
--     protected values verbatim.
--
-- This function is deliberately NOT security definer: it must see the
-- caller's own database role.

create or replace function public.roamly_guard_trip_entitlement_columns()
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
  -- and never let a malformed value break a trip write.
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
    new.itinerary_payment_status := 'unpaid';
    new.itinerary_unlock_source := null;
    new.stripe_checkout_session_id := null;
    new.stripe_payment_intent_id := null;
    new.tracking_unlocked := false;
    new.tracking_unlock_source := null;
    new.tracking_paid_at := null;
    new.tracking_stripe_checkout_session_id := null;
    new.tracking_stripe_payment_intent_id := null;
    new.live_companion_unlocked := false;
    new.live_companion_unlocked_at := null;
    new.live_companion_source := null;
    return new;
  end if;

  -- UPDATE
  if privileged then
    return new;
  end if;

  if new.itinerary_payment_status is distinct from old.itinerary_payment_status
    or new.itinerary_unlock_source is distinct from old.itinerary_unlock_source
    or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
    or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
    or new.tracking_unlocked is distinct from old.tracking_unlocked
    or new.tracking_unlock_source is distinct from old.tracking_unlock_source
    or new.tracking_paid_at is distinct from old.tracking_paid_at
    or new.tracking_stripe_checkout_session_id is distinct from old.tracking_stripe_checkout_session_id
    or new.tracking_stripe_payment_intent_id is distinct from old.tracking_stripe_payment_intent_id
    or new.live_companion_unlocked is distinct from old.live_companion_unlocked
    or new.live_companion_unlocked_at is distinct from old.live_companion_unlocked_at
    or new.live_companion_source is distinct from old.live_companion_source
  then
    raise exception 'Roamly trip entitlement columns are server-managed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists roamly_guard_trip_entitlement_columns on public.roamly_trips;
create trigger roamly_guard_trip_entitlement_columns
before insert or update on public.roamly_trips
for each row
execute function public.roamly_guard_trip_entitlement_columns();

revoke all on function public.roamly_guard_trip_entitlement_columns() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
