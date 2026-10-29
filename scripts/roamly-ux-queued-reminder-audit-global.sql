-- ============================================================================
-- roamly-ux-queued-reminder-audit-global.sql — READ-ONLY GLOBAL AUDIT
-- (final local round, 2026-10-27). READ-ONLY: SELECT statements only.
-- There is NO INSERT, UPDATE, UPSERT, DELETE, or reschedule anywhere
-- in this file. Running it changes nothing; it only counts and lists
-- already-queued reminders so the owner can see the global total that
-- the scoped audit (tester + anon credentials) cannot read.
--
-- HOW TO RUN (owner path, pick ONE):
--   A. Supabase Dashboard → SQL Editor → paste this whole file → Run.
--      The SQL editor runs as the database owner and is NOT RLS-scoped,
--      so it sees all customers' queued rows. No key handling needed.
--   B. Service-role script run (same classification, app resolver):
--        1. Write a 0600 .render-env in the tree root containing the
--           service-role URL/key (SUPABASE_URL / SUPABASE_KEY lines,
--           same four-line shape as the render env).
--        2. node --experimental-strip-types --import \
--             ./scripts/roamly-test-register.mjs \
--             scripts/roamly-ux-queued-reminder-audit.mjs
--        3. Delete .render-env immediately after the run.
--      The script's own report then carries the service-role counts.
--      Do NOT commit, share, or keep a service-role key in the tree.
--
-- CLASSIFICATION (identical to scripts/roamly-ux-queued-reminder-audit.mjs,
-- applied here in SQL, in the same order):
--   1. Queued legacy pre-trip deliveries only: notification_type IN
--      ('trip_predeparture_7d', 'trip_predeparture_1d') AND status = 'queued'.
--   2. HELD_UNKNOWN_ZONE — no stored metadata zone AND the destination
--      is not in the seed-zone mapping below (the mapping mirrors the
--      app's destination-seed registry in
--      lib/roamly/engine/packs/destinations.ts; a destination outside
--      it is HELD, never corrected on a guessed zone — the
--      owner-APPROVED hold rule). Also HELD when start_date is null.
--   3. NOT_AFFECTED_STORED_ZONE — the trip's metadata already carried
--      a zone, so the old math never used the UTC fallback.
--   4. NOT_AFFECTED_BOOKING_ANCHORED — a non-superseded booking with a
--      start exists: absolute booking times are identical under old
--      and new math.
--   5. NOT_AFFECTED_UTC_ZONE — resolved zone is UTC, so the old
--      09:00 UTC start was already correct (or the recomputed shift
--      is zero).
--   6. AFFECTED — all of: no stored metadata zone, a date-only
--      start_date, no booking-anchored start, resolved zone != 'UTC',
--      and the 09:00 shift is non-zero. Corrected send =
--      scheduled_for + (09:00 resolved-zone start − 09:00 UTC start)
--      on the trip's start_date. The corrected time is a PROPOSAL
--      printed by this query — applying it is a separate,
--      owner-authorized update per row, NOT done here.
--
-- Briefing ledger rows (Query 2) are reported separately and are NOT
-- counted as stuck: pending briefing rows are rewritten to the
-- corrected window target on each scheduler run, so they self-correct.
--
-- PRIVACY: these queries return trip ids, destinations, reminder
-- types, and times only. They select NO email, NO name, and NO
-- user/account id, and never the delivery logical_key.
-- ============================================================================

-- --- Seed-zone mapping (mirrors lib/roamly/engine/packs/destinations.ts).
-- Only destinations the app registry knows are mapped; anything else
-- stays HELD (see classification rule 2).
WITH seed_zones (destination_name, zone) AS (
  VALUES
    ('Montreal', 'America/Toronto'),
    ('Quebec City', 'America/Toronto'),
    ('Fredericton', 'America/Moncton'),
    ('Halifax', 'America/Halifax'),
    ('Charlottetown', 'America/Halifax'),
    ('Lunenburg', 'America/Halifax'),
    ('Banff', 'America/Edmonton'),
    ('Rocky Harbour', 'America/St_Johns'),
    ('Paris', 'Europe/Paris'),
    ('Manila', 'Asia/Manila'),
    ('Boracay', 'Asia/Manila'),
    ('El Nido', 'Asia/Manila'),
    ('Coron', 'Asia/Manila'),
    ('Puerto Princesa', 'Asia/Manila'),
    ('Cebu City', 'Asia/Manila'),
    ('Bohol', 'Asia/Manila'),
    ('Siargao', 'Asia/Manila'),
    ('Baguio', 'Asia/Manila'),
    ('Davao City', 'Asia/Manila'),
    ('Samal Island', 'Asia/Manila')
),
-- --- Query 1: queued legacy pre-trip deliveries, classified. ---------
classified AS (
  SELECT
    d.id AS delivery_id,
    d.trip_id,
    COALESCE(t.destination_name, t.destination_city, t.destination, 'unknown destination') AS destination,
    t.start_date,
    d.notification_type,
    d.scheduled_for,
    COALESCE(
      t.metadata ->> 'timezone',
      t.metadata ->> 'time_zone',
      t.metadata ->> 'trip_timezone',
      t.metadata -> 'trip' ->> 'timezone'
    ) AS stored_metadata_zone,
    s.zone AS seed_zone,
    COALESCE(
      t.metadata ->> 'timezone',
      t.metadata ->> 'time_zone',
      t.metadata ->> 'trip_timezone',
      t.metadata -> 'trip' ->> 'timezone',
      s.zone
    ) AS resolved_zone,
    EXISTS (
      SELECT 1
      FROM roamly_bookings b
      WHERE b.trip_id = d.trip_id
        AND b.superseded_by_booking_id IS NULL
        AND (b.start_at IS NOT NULL OR b.check_in_at IS NOT NULL)
    ) AS has_booking_anchor,
    -- 09:00 on start_date in the resolved zone, minus 09:00 UTC:
    -- the shift the corrected send must apply (NULL when unresolvable).
    CASE
      WHEN t.start_date IS NULL THEN NULL
      WHEN COALESCE(
        t.metadata ->> 'timezone',
        t.metadata ->> 'time_zone',
        t.metadata ->> 'trip_timezone',
        t.metadata -> 'trip' ->> 'timezone',
        s.zone
      ) IS NULL THEN NULL
      ELSE (
        (t.start_date + TIME '09:00') AT TIME ZONE COALESCE(
          t.metadata ->> 'timezone',
          t.metadata ->> 'time_zone',
          t.metadata ->> 'trip_timezone',
          t.metadata -> 'trip' ->> 'timezone',
          s.zone
        )
      ) - (
        (t.start_date + TIME '09:00') AT TIME ZONE 'UTC'
      )
    END AS shift_interval
  FROM roamly_companion_notification_deliveries d
  JOIN roamly_trips t ON t.id = d.trip_id
  LEFT JOIN seed_zones s
    ON s.destination_name = COALESCE(t.destination_name, t.destination_city, t.destination)
  WHERE d.status = 'queued'
    AND d.notification_type IN ('trip_predeparture_7d', 'trip_predeparture_1d')
)
SELECT
  delivery_id,
  trip_id,
  destination,
  start_date,
  notification_type,
  scheduled_for AS currently_scheduled_send_utc,
  resolved_zone,
  CASE
    WHEN start_date IS NULL THEN 'HELD_UNKNOWN_ZONE'
    WHEN resolved_zone IS NULL THEN 'HELD_UNKNOWN_ZONE'
    WHEN stored_metadata_zone IS NOT NULL THEN 'NOT_AFFECTED_STORED_ZONE'
    WHEN has_booking_anchor THEN 'NOT_AFFECTED_BOOKING_ANCHORED'
    WHEN resolved_zone = 'UTC' OR shift_interval = INTERVAL '0' THEN 'NOT_AFFECTED_UTC_ZONE'
    ELSE 'AFFECTED'
  END AS classification,
  -- Proposed corrected send (AFFECTED rows only; NULL otherwise).
  -- PROPOSAL ONLY — this SELECT applies nothing.
  CASE
    WHEN start_date IS NOT NULL
      AND resolved_zone IS NOT NULL
      AND stored_metadata_zone IS NULL
      AND NOT has_booking_anchor
      AND resolved_zone <> 'UTC'
      AND shift_interval IS NOT NULL
      AND shift_interval <> INTERVAL '0'
    THEN scheduled_for + shift_interval
    ELSE NULL
  END AS proposed_corrected_send_utc,
  shift_interval
FROM classified
ORDER BY scheduled_for ASC;

-- --- Query 1b: global counts by classification (the headline numbers). ---
WITH seed_zones (destination_name, zone) AS (
  VALUES
    ('Montreal', 'America/Toronto'),
    ('Quebec City', 'America/Toronto'),
    ('Fredericton', 'America/Moncton'),
    ('Halifax', 'America/Halifax'),
    ('Charlottetown', 'America/Halifax'),
    ('Lunenburg', 'America/Halifax'),
    ('Banff', 'America/Edmonton'),
    ('Rocky Harbour', 'America/St_Johns'),
    ('Paris', 'Europe/Paris'),
    ('Manila', 'Asia/Manila'),
    ('Boracay', 'Asia/Manila'),
    ('El Nido', 'Asia/Manila'),
    ('Coron', 'Asia/Manila'),
    ('Puerto Princesa', 'Asia/Manila'),
    ('Cebu City', 'Asia/Manila'),
    ('Bohol', 'Asia/Manila'),
    ('Siargao', 'Asia/Manila'),
    ('Baguio', 'Asia/Manila'),
    ('Davao City', 'Asia/Manila'),
    ('Samal Island', 'Asia/Manila')
),
classified AS (
  SELECT
    d.id AS delivery_id,
    COALESCE(
      t.metadata ->> 'timezone',
      t.metadata ->> 'time_zone',
      t.metadata ->> 'trip_timezone',
      t.metadata -> 'trip' ->> 'timezone'
    ) AS stored_metadata_zone,
    COALESCE(
      t.metadata ->> 'timezone',
      t.metadata ->> 'time_zone',
      t.metadata ->> 'trip_timezone',
      t.metadata -> 'trip' ->> 'timezone',
      s.zone
    ) AS resolved_zone,
    EXISTS (
      SELECT 1
      FROM roamly_bookings b
      WHERE b.trip_id = d.trip_id
        AND b.superseded_by_booking_id IS NULL
        AND (b.start_at IS NOT NULL OR b.check_in_at IS NOT NULL)
    ) AS has_booking_anchor,
    t.start_date,
    CASE
      WHEN t.start_date IS NULL THEN NULL
      WHEN COALESCE(
        t.metadata ->> 'timezone',
        t.metadata ->> 'time_zone',
        t.metadata ->> 'trip_timezone',
        t.metadata -> 'trip' ->> 'timezone',
        s.zone
      ) IS NULL THEN NULL
      ELSE (
        (t.start_date + TIME '09:00') AT TIME ZONE COALESCE(
          t.metadata ->> 'timezone',
          t.metadata ->> 'time_zone',
          t.metadata ->> 'trip_timezone',
          t.metadata -> 'trip' ->> 'timezone',
          s.zone
        )
      ) - (
        (t.start_date + TIME '09:00') AT TIME ZONE 'UTC'
      )
    END AS shift_interval
  FROM roamly_companion_notification_deliveries d
  JOIN roamly_trips t ON t.id = d.trip_id
  LEFT JOIN seed_zones s
    ON s.destination_name = COALESCE(t.destination_name, t.destination_city, t.destination)
  WHERE d.status = 'queued'
    AND d.notification_type IN ('trip_predeparture_7d', 'trip_predeparture_1d')
)
SELECT
  CASE
    WHEN start_date IS NULL THEN 'HELD_UNKNOWN_ZONE'
    WHEN resolved_zone IS NULL THEN 'HELD_UNKNOWN_ZONE'
    WHEN stored_metadata_zone IS NOT NULL THEN 'NOT_AFFECTED_STORED_ZONE'
    WHEN has_booking_anchor THEN 'NOT_AFFECTED_BOOKING_ANCHORED'
    WHEN resolved_zone = 'UTC' OR shift_interval = INTERVAL '0' THEN 'NOT_AFFECTED_UTC_ZONE'
    ELSE 'AFFECTED'
  END AS classification,
  COUNT(*) AS row_count
FROM classified
GROUP BY 1
ORDER BY 1;

-- --- Query 2: briefing ledger (pending/failed) — reported, NOT stuck. ---
-- Pending briefing rows self-correct on the next scheduler run, so they
-- are listed here for completeness and never added to the AFFECTED total.
SELECT
  l.id AS ledger_id,
  l.trip_id,
  COALESCE(t.destination_name, t.destination_city, t.destination, 'unknown destination') AS destination,
  l.status,
  l.scheduled_for,
  l.metadata ->> 'purpose' AS purpose
FROM roamly_communication_ledger l
LEFT JOIN roamly_trips t ON t.id = l.trip_id
WHERE l.status IN ('pending', 'failed')
ORDER BY l.scheduled_for ASC;

-- --- Query 2b: briefing ledger counts (for the headline, kept separate). ---
SELECT status, COUNT(*) AS row_count
FROM roamly_communication_ledger
WHERE status IN ('pending', 'failed')
GROUP BY status
ORDER BY status;
