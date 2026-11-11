-- Stage 5 session hardening (2026-11-11) — PREPARED, NOT APPLIED.
--
-- Provenance: stage 5 of the 8-stage remediation plan in the
-- 2026-11-09/10 deep engineering assessment. The evidence for every
-- section is the Stage 3 production truth sweep (all reads taken live
-- 2026-11-10; SWEEP-REPORT.md in the Roamly lane files):
--   §1 — the admin door's brute-force lockout lived only in per-instance
--        memory (app/api/admin/access/route.ts, P1-1 note). This section
--        builds its shared store in the tree's proven quota shape
--        (20261106000200): HMAC actor hashes, service-role-only table
--        and RPCs. The route change ships in code with this bundle; the
--        route degrades to the memory-only limiter until this section
--        is applied, so code and migration may land in either order.
--   §2 — finding F-3: public.roamly_guard_booking_supersession is a
--        SECURITY DEFINER trigger function (defined by
--        20260917_roamly_booking_supersession.sql, which carries NO
--        grant statement for it) holding bare PUBLIC execute. It has
--        zero code callers; sweep probe X-2 flagged it as the only
--        caller-executable definer without auth.uid() in the body.
--   §3 — finding F-6 / census X-3: anon holds the full 7-privilege set
--        on 100 of the 120 live tables, while RLS admits no anon rows
--        on any of them (every applicable policy's qual is
--        identity-bound), so the grants are unreachable through
--        the Data API today — defence-in-depth debt, closed here.
--        The 100 tables are derived arithmetically from the sweep:
--        126 tables created by the chain − 6 proven absent live
--        (affiliate_clicks, affiliate_conversions, concierge_suggestions,
--        house_ad_events, plan_comments, trip_bookings) − 20 proven to
--        hold no anon grant (sophie_contributions, roamly_trip_travelers,
--        the five September customer-change tables
--        roamly_customer_itinerary_edits / _budget_changes /
--        _trip_date_changes / _trip_destination_changes /
--        _trip_intent_changes — each revokes anon in its own migration
--        file — both email rate-limit tables, the six roamly_ops_*
--        internals, roamly_market_prices, both market rate-limit
--        tables, roamly_background_health,
--        roamly_contact_request_rate_limits) = the 100 statements below.
--        authenticated and service_role grants are NOT touched.
--   §4 — finding F-5: booking_segments lost its uniqueness layer when
--        the wallet-era indexes never landed (all 4 booking_segments
--        indexes absent live). Neither the replace RPC
--        (20261024_roamly_replace_booking_segments_auth_binding) nor the
--        wallet normalizer dedupes (booking_id, sequence). This section
--        restores ONLY the unique index, verbatim from
--        20260716_roamly_booking_wallet.sql:122-123.
--
-- PRE-FLIGHT — run hidden_files/stage5-session-hardening/
-- STAGE5-PREFLIGHT-PROBES.sql first and STOP unless every probe reads
-- as expected:
--   P-1 anon-passable policy census returns 0 rows (RLS admits no
--       anon rows — every applicable policy's qual is identity-bound).
--   P-2 anon grant census lists exactly the 100 tables named in §3,
--       and P-2b shows no table privileges granted to PUBLIC.
--   P-3 roamly_guard_booking_supersession still shows PUBLIC execute.
--   P-4 booking_segments duplicate census returns 0 rows. IF P-4
--       RETURNS ROWS, DO NOT RUN §4: production holds duplicate
--       (booking_id, sequence) pairs, the create-unique-index will
--       fail loudly by design, and the dedupe belongs to Stage 6
--       (stored-truth discipline) BEFORE this section is applied.
--       Run §1–§3 without §4 in that case.
-- Ship-moment sequence: pre-flight → decide (§4 in or out) → apply →
-- read-back (STAGE5-READBACK-PROBES.sql, same folder).
-- Rollback: STAGE5-ROLLBACK.sql (same folder) reverses each section.
-- Idempotency: every statement is re-runnable — create-if-not-exists,
-- create-or-replace, and revokes/grants of state already reached are
-- no-ops. If §3 stops midway on a table that drifted out of existence,
-- §1–§2 stand applied; correct the list from a fresh P-2 and re-run.

-- =====================================================================
-- §1 — Admin-door lockout shared store (house quota shape, 20261106000200)
-- =====================================================================

create table if not exists public.roamly_admin_access_rate_limits (
  actor_hash text primary key check (actor_hash ~ '^[a-f0-9]{64}$'),
  fail_count integer not null default 0 check (fail_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists roamly_admin_access_rate_limits_updated_idx
  on public.roamly_admin_access_rate_limits (updated_at);

alter table public.roamly_admin_access_rate_limits enable row level security;
revoke all on table public.roamly_admin_access_rate_limits from public, anon, authenticated;

create or replace function public.roamly_admin_access_lockout(p_actor_hash text)
returns table (
  locked boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
  v_locked_until timestamptz;
begin
  -- Service-role gate, dual-read form (the 20261106000500 correction):
  -- production PostgREST may expose the role only inside the claims JSON.
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid admin access actor hash required';
  end if;

  select locked_until into v_locked_until
  from public.roamly_admin_access_rate_limits
  where actor_hash = p_actor_hash;

  if v_locked_until is null or v_locked_until <= current_time_utc then
    return query select false, 0;
  else
    return query select true,
      greatest(0, ceil(extract(epoch from (v_locked_until - current_time_utc))::numeric)::integer);
  end if;
end;
$$;

revoke all on function public.roamly_admin_access_lockout(text) from public, anon, authenticated;
grant execute on function public.roamly_admin_access_lockout(text) to service_role;

create or replace function public.roamly_record_admin_access_failure(
  p_actor_hash text,
  p_max_attempts integer,
  p_lockout_seconds integer
)
returns table (
  fails integer,
  locked boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_time_utc timestamptz := clock_timestamp();
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
  existing public.roamly_admin_access_rate_limits%rowtype;
  have_existing boolean := false;
  new_fails integer;
  new_locked_until timestamptz;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid admin access actor hash required';
  end if;
  if p_max_attempts is null or p_max_attempts < 1
     or p_lockout_seconds is null or p_lockout_seconds < 1 then
    raise exception 'valid lockout parameters required';
  end if;

  select * into existing
  from public.roamly_admin_access_rate_limits
  where actor_hash = p_actor_hash
  for update;
  have_existing := found;

  -- Already locked: attempts during a lockout never extend it (the
  -- in-memory limiter's semantics — the door answers 429 before a
  -- failure is ever recorded).
  if have_existing and existing.locked_until is not null
     and existing.locked_until > current_time_utc then
    return query select
      existing.fail_count,
      true,
      greatest(0, ceil(extract(epoch from (existing.locked_until - current_time_utc))::numeric)::integer);
    return;
  end if;

  -- A failure after an expired lockout, or after two idle days (the
  -- house retention window), starts a fresh count.
  new_fails := case
    when not have_existing then 1
    when existing.locked_until is not null then 1
    when existing.updated_at < current_time_utc - interval '2 days' then 1
    else existing.fail_count + 1
  end;
  new_locked_until := case
    when new_fails >= p_max_attempts
      then current_time_utc + make_interval(secs => p_lockout_seconds)
    else null
  end;

  insert into public.roamly_admin_access_rate_limits
    (actor_hash, fail_count, locked_until, updated_at)
  values (p_actor_hash, new_fails, new_locked_until, current_time_utc)
  on conflict (actor_hash) do update
    set fail_count = excluded.fail_count,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at;

  -- Retention sweep, house pattern: keep only two days of limiter keys.
  delete from public.roamly_admin_access_rate_limits
  where updated_at < current_time_utc - interval '2 days'
    and actor_hash <> p_actor_hash;

  return query select
    new_fails,
    new_locked_until is not null,
    case when new_locked_until is null then 0 else p_lockout_seconds end;
end;
$$;

revoke all on function public.roamly_record_admin_access_failure(text, integer, integer) from public, anon, authenticated;
grant execute on function public.roamly_record_admin_access_failure(text, integer, integer) to service_role;

create or replace function public.roamly_clear_admin_access_failures(p_actor_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  claims_role text := '';
begin
  if coalesce(current_setting('request.jwt.claims', true), '') like '{%' then
    begin
      claims_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      claims_role := '';
    end;
  end if;

  if jwt_role <> 'service_role' and claims_role <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'valid admin access actor hash required';
  end if;

  delete from public.roamly_admin_access_rate_limits
  where actor_hash = p_actor_hash;
end;
$$;

revoke all on function public.roamly_clear_admin_access_failures(text) from public, anon, authenticated;
grant execute on function public.roamly_clear_admin_access_failures(text) to service_role;

-- =====================================================================
-- §2 — F-3: roamly_guard_booking_supersession loses PUBLIC execute.
-- Trigger firing does not consult the firing role's EXECUTE privilege
-- (PostgreSQL runs trigger functions through the trigger machinery,
-- and this one is SECURITY DEFINER), and the function's own
-- auth.role() check reads the caller's JWT setting, not a grant — so
-- the supersession guard keeps protecting roamly_bookings exactly as
-- before. postgres (the owner) is untouched; service_role is granted
-- explicitly, matching the 20260929000400 hardening pattern.
-- =====================================================================

revoke all on function public.roamly_guard_booking_supersession() from public, anon, authenticated;
grant execute on function public.roamly_guard_booking_supersession() to service_role;

-- =====================================================================
-- §3 — F-6: anon's unreachable full-privilege grants, revoked.
-- One statement per table from the X-3 census derivation (header).
-- RLS admits no anon rows on any of these tables — every applicable
-- policy's qual is identity-bound — so no reachable behaviour
-- changes; this closes the defence-in-depth debt only.
-- =====================================================================

revoke all on table public.booking_change_events from anon;
revoke all on table public.booking_email_suppressions from anon;
revoke all on table public.booking_extraction_results from anon;
revoke all on table public.booking_reconciliation_runs from anon;
revoke all on table public.booking_segments from anon;
revoke all on table public.companion_actions from anon;
revoke all on table public.companion_events from anon;
revoke all on table public.companion_impact_results from anon;
revoke all on table public.companion_repair_proposals from anon;
revoke all on table public.email_connections from anon;
revoke all on table public.email_sync_cursors from anon;
revoke all on table public.email_watch_subscriptions from anon;
revoke all on table public.item_verdicts from anon;
revoke all on table public.itinerary_library_records from anon;
revoke all on table public.itinerary_submissions from anon;
revoke all on table public.live_provider_status_snapshots from anon;
revoke all on table public.roamly_activities from anon;
revoke all on table public.roamly_admin_activity_logs from anon;
revoke all on table public.roamly_admin_settings from anon;
revoke all on table public.roamly_app_events from anon;
revoke all on table public.roamly_booking_monitor_runs from anon;
revoke all on table public.roamly_booking_referrals from anon;
revoke all on table public.roamly_booking_revisions from anon;
revoke all on table public.roamly_bookings from anon;
revoke all on table public.roamly_communication_ledger from anon;
revoke all on table public.roamly_companion_ledger from anon;
revoke all on table public.roamly_companion_notification_deliveries from anon;
revoke all on table public.roamly_companion_preferences from anon;
revoke all on table public.roamly_content_generation_batches from anon;
revoke all on table public.roamly_content_quality_checks from anon;
revoke all on table public.roamly_cron_execution_logs from anon;
revoke all on table public.roamly_cron_locks from anon;
revoke all on table public.roamly_destination_candidates from anon;
revoke all on table public.roamly_destination_pack_builds from anon;
revoke all on table public.roamly_destination_packs from anon;
revoke all on table public.roamly_destination_weather_snapshots from anon;
revoke all on table public.roamly_email_delivery_logs from anon;
revoke all on table public.roamly_email_logs from anon;
revoke all on table public.roamly_email_preferences from anon;
revoke all on table public.roamly_email_templates from anon;
revoke all on table public.roamly_facebook_media_processing from anon;
revoke all on table public.roamly_failed_jobs from anon;
revoke all on table public.roamly_fyi_digest_log from anon;
revoke all on table public.roamly_gate_states from anon;
revoke all on table public.roamly_generation_cost_events from anon;
revoke all on table public.roamly_generation_provider_limits from anon;
revoke all on table public.roamly_generation_rate_limits from anon;
revoke all on table public.roamly_handoff_tokens from anon;
revoke all on table public.roamly_itineraries from anon;
revoke all on table public.roamly_itinerary_days from anon;
revoke all on table public.roamly_itinerary_purchases from anon;
revoke all on table public.roamly_library_trips from anon;
revoke all on table public.roamly_location_settings from anon;
revoke all on table public.roamly_media_library_usage from anon;
revoke all on table public.roamly_notifications from anon;
revoke all on table public.roamly_operational_events from anon;
revoke all on table public.roamly_operational_incidents from anon;
revoke all on table public.roamly_pending_hotel_product_choices from anon;
revoke all on table public.roamly_planning_repair_proposals from anon;
revoke all on table public.roamly_price_discoveries from anon;
revoke all on table public.roamly_profiles from anon;
revoke all on table public.roamly_published_seo_pages from anon;
revoke all on table public.roamly_publishing_attempts from anon;
revoke all on table public.roamly_publishing_jobs from anon;
revoke all on table public.roamly_purge_receipts from anon;
revoke all on table public.roamly_push_subscriptions from anon;
revoke all on table public.roamly_scheduled_posts from anon;
revoke all on table public.roamly_seo_drafts from anon;
revoke all on table public.roamly_social_automation_settings from anon;
revoke all on table public.roamly_social_drafts from anon;
revoke all on table public.roamly_social_media_assets from anon;
revoke all on table public.roamly_social_post_history from anon;
revoke all on table public.roamly_social_posts from anon;
revoke all on table public.roamly_social_queue from anon;
revoke all on table public.roamly_social_settings from anon;
revoke all on table public.roamly_sophie_outbox from anon;
revoke all on table public.roamly_stripe_billing_events from anon;
revoke all on table public.roamly_stripe_webhook_events from anon;
revoke all on table public.roamly_support_messages from anon;
revoke all on table public.roamly_trip_activities from anon;
revoke all on table public.roamly_trip_checklists from anon;
revoke all on table public.roamly_trip_companion_events from anon;
revoke all on table public.roamly_trip_days from anon;
revoke all on table public.roamly_trip_events from anon;
revoke all on table public.roamly_trip_gap_cards from anon;
revoke all on table public.roamly_trip_generation_jobs from anon;
revoke all on table public.roamly_trip_generation_layers from anon;
revoke all on table public.roamly_trip_generation_states from anon;
revoke all on table public.roamly_trip_lifecycle from anon;
revoke all on table public.roamly_trip_payments from anon;
revoke all on table public.roamly_trip_predictions from anon;
revoke all on table public.roamly_trip_usage from anon;
revoke all on table public.roamly_trips from anon;
revoke all on table public.roamly_user_entitlements from anon;
revoke all on table public.social_connections from anon;
revoke all on table public.successful_trip_experience_patterns from anon;
revoke all on table public.travel_email_messages from anon;
revoke all on table public.traveler_preference_events from anon;
revoke all on table public.traveler_profiles from anon;
revoke all on table public.trip_feedback from anon;

-- =====================================================================
-- §4 — F-5: booking_segments (booking_id, sequence) uniqueness restore.
-- Verbatim from 20260716_roamly_booking_wallet.sql:122-123, the file
-- whose index set never landed live (sweep F2 family probes). RUN
-- LAST, and only when pre-flight P-4 returned 0 rows: on a table
-- holding duplicates this statement fails loudly and changes nothing,
-- which is the designed behaviour — Stage 6 dedupes first, then this
-- section is re-run (it is idempotent once the index exists).
-- =====================================================================

create unique index if not exists booking_segments_booking_sequence_uidx
  on public.booking_segments (booking_id, sequence);
