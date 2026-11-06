-- =====================================================================
-- OWNER-APPLIED MIGRATION — DO NOT APPLY AUTOMATICALLY.
-- Roamly Live Companion eligibility: ONE rule, destination-local
-- window (L12 timezone workstream, 2026-10-31).
--
-- This file is delivered as part of a LOCAL release candidate under a
-- production HOLD. It has NOT been applied to any database by the
-- author of the candidate. Apply only on the owner's explicit word,
-- in the owner's Supabase project, after reviewing this header.
--
-- WHAT IT CHANGES (exactly one gate function + one new helper):
--   * public.roamly_destination_registry_timezone(text) — NEW helper:
--     the verified destination registry's city -> IANA zone mapping,
--     transcribed from the app's own registries (lib/roamly/places.ts
--     recommendedPlaces and lib/roamly/engine/packs/destinations.ts
--     PRODUCTION_DESTINATION_SEEDS, the same rows
--     lib/roamly/tripTimezone.ts / tripTimezoneServer.ts resolve
--     against). Exact city match (text before the first comma,
--     case-insensitive) only — no substring/fuzzy matching, no
--     country-to-zone inference.
--   * public.roamly_has_operational_location_trip(uuid, uuid) —
--     REDEFINED to the ONE eligibility rule implemented in JS by
--     lib/roamly/liveEligibility.ts:
--       eligible <=> status in ('locked','active','planned',
--                    'generated')
--                    AND locked in the app's own sense
--                        (itinerary_locked is true
--                         OR itinerary_status = 'locked'
--                         OR itinerary_generated_at is not null)
--                    AND (tracking_unlocked OR live_companion_unlocked)
--                    AND start_date <= D <= end_date, where D is the
--                        calendar date of now() in the trip's
--                        DESTINATION timezone, resolved as:
--                          1. stored metadata zone (the same
--                             candidate keys the previous definition
--                             read, in the same order),
--                          2. the destination registry above, over
--                             destination / destination_name /
--                             destination_city / planning.destination /
--                             planning.destinationCity,
--                          3. 'UTC' — the documented fallback when no
--                             zone is known (never the database or
--                             process timezone).
--     roamly_write_foreground_location and
--     roamly_clear_last_location_if_no_operational_trip are NOT
--     redefined: both call this gate, so they inherit the rule.
--
-- WHY: migration 20260928000200's gate accepted only
-- ('locked','active','planned') and judged the window from stored
-- metadata alone with a UTC fallback. The owner's Montreal trip
-- (production read 2026-10-31) is status='generated',
-- itinerary_locked=true, tracking_unlocked=true,
-- live_companion_unlocked=true, Oct 30 - Nov 2, destination Montreal
-- (registry zone America/Toronto), planning.timezone NULL — refused
-- on BOTH counts: 'generated' was outside the status set, and from
-- Nov 2 19:00 EST (= Nov 3 00:00 UTC) the UTC date was already past
-- end_date while destination-local Nov 2 was still in window.
--
-- EFFECT OF APPLYING: 'generated' + locked + unlocked trips in their
-- destination-local window become operational for foreground
-- location writes / cleanup decisions; draft/preview/generating/
-- completed/cancelled/archived trips remain outside; the last-evening
-- UTC cutoff disappears for registry-known destinations. No data is
-- read, changed, or deleted by this migration itself — it replaces
-- two function definitions only (the cleanup UPDATE at the end of
-- 20260928000200 is NOT repeated here). Rollback = re-apply the
-- function definitions from 20260928000200 and drop the helper.
-- =====================================================================

create or replace function public.roamly_destination_registry_timezone(
  p_destination text
)
returns text
language sql
immutable
as $$
  select case lower(trim(split_part(coalesce(p_destination, ''), ',', 1)))
    when 'saint john' then 'America/Moncton'
    when 'fredericton' then 'America/Moncton'
    when 'toronto' then 'America/Toronto'
    when 'montreal' then 'America/Toronto'
    when 'québec city' then 'America/Toronto'
    when 'quebec city' then 'America/Toronto'
    when 'vancouver' then 'America/Vancouver'
    when 'banff' then 'America/Edmonton'
    when 'halifax' then 'America/Halifax'
    when 'charlottetown' then 'America/Halifax'
    when 'lunenburg' then 'America/Halifax'
    when 'rocky harbour' then 'America/St_Johns'
    when 'new york city' then 'America/New_York'
    when 'los angeles' then 'America/Los_Angeles'
    when 'las vegas' then 'America/Los_Angeles'
    when 'paris' then 'Europe/Paris'
    when 'london' then 'Europe/London'
    when 'rome' then 'Europe/Rome'
    when 'barcelona' then 'Europe/Madrid'
    when 'amsterdam' then 'Europe/Amsterdam'
    when 'lisbon' then 'Europe/Lisbon'
    when 'tokyo' then 'Asia/Tokyo'
    when 'seoul' then 'Asia/Seoul'
    when 'singapore' then 'Asia/Singapore'
    when 'bangkok' then 'Asia/Bangkok'
    when 'bali' then 'Asia/Makassar'
    when 'dubai' then 'Asia/Dubai'
    when 'sydney' then 'Australia/Sydney'
    when 'manila' then 'Asia/Manila'
    when 'boracay' then 'Asia/Manila'
    when 'el nido' then 'Asia/Manila'
    when 'coron' then 'Asia/Manila'
    when 'puerto princesa' then 'Asia/Manila'
    when 'cebu city' then 'Asia/Manila'
    when 'bohol' then 'Asia/Manila'
    when 'siargao' then 'Asia/Manila'
    when 'baguio' then 'Asia/Manila'
    when 'davao city' then 'Asia/Manila'
    when 'samal island' then 'Asia/Manila'
    else null
  end;
$$;

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

revoke all on function public.roamly_destination_registry_timezone(text) from public, anon;
revoke all on function public.roamly_has_operational_location_trip(uuid, uuid) from public, anon;
grant execute on function public.roamly_destination_registry_timezone(text) to authenticated, service_role;
grant execute on function public.roamly_has_operational_location_trip(uuid, uuid) to authenticated, service_role;
