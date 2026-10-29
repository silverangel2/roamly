/**
 * fyiDigest.ts — server-side customer FYI digest for Roamly.
 *
 * Runs from /api/cron/roamly-fyi-digest (hourly). Reuses the existing email
 * pipe (sendRoamlyEmail + renderEmailTemplate), the in-app notifications queue,
 * and push subscriptions ONLY where one exists (sendPushNotification degrades
 * to "no_subscription" when the user has none).
 *
 * Moments (see fyiDigestCore.ts):
 *  1. check_in_t24    — T-24h from Gmail-sensed flight segments
 *  2. flight_change   — latest segment snapshot vs last sent snapshot
 *  3. itinerary_ready — post-purchase / trip created with trackingUnlocked
 *  4. trip_starting_soon — T-3d reminder
 *  5. upsell_gap      — one trip-gap offer (marketing-consent gated)
 *
 * Guardrails:
 *  - max 1 FYI email per trip per day (dedupe key fyi-email-daily:<trip>:<day>)
 *  - global unsubscribe honored: roamly_email_preferences.unsubscribed_all
 *    suppresses ALL FYI mail. Fail-closed: if preferences can't be read, skip.
 *  - marketing consent honored: upsell_gap requires marketing_enabled = true.
 *  - per-moment dedupe via roamly_fyi_digest_log (unique dedupe_key).
 *    Fail-soft: if the table is missing, the digest continues (logs a warning
 *    and skips dedupe writes) rather than failing the whole run.
 *  - review_ask is a registered moment but NEVER sent by this digest.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  renderEmailTemplate,
  sendRoamlyEmail,
  type EmailTemplateType
} from "@/lib/roamly/email";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import {
  createInAppNotification,
  sendPushNotification
} from "@/lib/roamly/pushServer";
import {
  getCompanionPreferencesForDelivery,
  communicationPreferenceForNotificationType
} from "@/lib/roamly/companionPreferences";
import { tripWindowState } from "@/lib/roamly/liveCompanion";
import {
  BACKGROUND_TIMEZONE_HOLD,
  resolveBackgroundTripTimezone
} from "@/lib/roamly/backgroundNotificationTimezone";
import {
  FLIGHT_CHANGE_LOOKBACK_MINUTES,
  UPSELL_GAP_EMAIL_COOLDOWN_DAYS,
  UPSELL_TRIP_EMAIL_COOLDOWN_DAYS,
  buildCheckInCopy,
  buildFlightChangeCopy,
  buildItineraryReadyCopy,
  buildTripStartingCopy,
  buildUpsellCopy,
  flightChangeKind,
  fyiDailyEmailCapKey,
  fyiDedupeKey,
  isCheckInT24Window,
  unsubscribeUrl,
  type FlightChangeKind,
  type FlightSegmentLike,
  type FlightSnapshot,
  type FyiCopy,
  type FyiMoment
} from "@/lib/roamly/fyiDigestCore";
import { detectAndOfferTripGaps, type GapOfferResult } from "@/lib/roamly/tripGapWatcher";

const LOCK_NAME = "roamly-fyi-digest";
const LOCK_MINUTES = 55;
const MAX_TRIPS_PER_RUN = 200;

type DigestResult = {
  ok: boolean;
  skipped?: string;
  error?: string;
  processed?: number;
  sent?: { email: number; push: number; inApp: number };
  moments?: Array<{ tripId: string; moment: FyiMoment; result: string }>;
  /** Trips held this run because their zone could not be resolved. */
  heldTrips?: string[];
};

type EmailPreferences = {
  marketingEnabled: boolean;
  unsubscribedAll: boolean;
  unsubscribeToken: string;
};

type TripRow = {
  id: string;
  user_id: string;
  title: string | null;
  destination?: string | null;
  destination_name: string | null;
  destination_city?: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  itinerary_locked: boolean | null;
  tracking_unlocked: boolean | null;
  live_companion_unlocked: boolean | null;
  metadata: unknown;
  updated_at: string | null;
};

type BookingRow = {
  id: string;
  user_id: string;
  trip_id: string;
  title: string | null;
  booking_type: string | null;
  booking_status: string | null;
  flight_number: string | null;
  start_at: string | null;
  end_at: string | null;
  origin: string | null;
  destination: string | null;
  gate: string | null;
  terminal: string | null;
  updated_at: string | null;
};

type SegmentRow = {
  booking_id: string;
  origin: string | null;
  destination: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  provider: string | null;
  service_number: string | null;
  terminal: string | null;
  gate: string | null;
  status: string | null;
};

async function acquireLock(admin: SupabaseClient) {
  const now = new Date();
  const lockOwner = randomUUID();
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  await admin.from("roamly_cron_locks").upsert(
    { lock_name: LOCK_NAME, locked_until: new Date(0).toISOString(), locked_by: null, updated_at: now.toISOString() },
    { onConflict: "lock_name", ignoreDuplicates: true }
  );
  const result = await admin
    .from("roamly_cron_locks")
    .update({ locked_until: lockedUntil, locked_by: lockOwner, updated_at: now.toISOString() })
    .eq("lock_name", LOCK_NAME)
    .lte("locked_until", now.toISOString())
    .select("lock_name,locked_by")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message };
  return { ok: true as const, acquired: result.data?.locked_by === lockOwner, lockOwner };
}

async function releaseLock(admin: SupabaseClient, lockOwner: string) {
  await admin
    .from("roamly_cron_locks")
    .update({ locked_until: new Date(0).toISOString(), locked_by: null, updated_at: new Date().toISOString() })
    .eq("lock_name", LOCK_NAME)
    .eq("locked_by", lockOwner);
}

/**
 * Fail-soft log: when the migration hasn't been applied yet (table missing),
 * dedupe writes are skipped and the run continues. Missing dedupe can cause a
 * repeat send; the per-day email cap + idempotency keys keep that bounded.
 */
async function logMoment(
  admin: SupabaseClient,
  params: {
    userId: string;
    tripId: string;
    moment: FyiMoment;
    dedupeKey: string;
    channel: "email" | "push" | "in_app" | "skipped";
    snapshot?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<{ ok: boolean; deduplicated: boolean }> {
  try {
    const result = await admin.from("roamly_fyi_digest_log").insert({
      user_id: params.userId,
      trip_id: params.tripId,
      moment: params.moment,
      dedupe_key: params.dedupeKey,
      channel: params.channel,
      snapshot_json: params.snapshot || {},
      metadata_json: params.metadata || {}
    });
    if (result.error) {
      if (result.error.code === "23505") return { ok: true, deduplicated: true };
      if (result.error.code === "42P01") return { ok: true, deduplicated: false }; // table missing — fail soft
      return { ok: false, deduplicated: false };
    }
    return { ok: true, deduplicated: false };
  } catch {
    return { ok: true, deduplicated: false };
  }
}

async function readLastSnapshot(
  admin: SupabaseClient,
  dedupeKey: string
): Promise<Record<string, unknown> | null> {
  try {
    const result = await admin
      .from("roamly_fyi_digest_log")
      .select("snapshot_json")
      .eq("dedupe_key", dedupeKey)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error || !result.data) return null;
    return (result.data as { snapshot_json?: Record<string, unknown> | null }).snapshot_json || null;
  } catch {
    return null;
  }
}

/**
 * Snapshot baseline for flight_change: the digest observes the latest booking
 * row and compares it against the last snapshot it recorded. The baseline row
 * is upserted (never inserted twice) so comparisons keep working across runs.
 */
async function writeSnapshotBaseline(
  admin: SupabaseClient,
  params: { userId: string; tripId: string; dedupeKey: string; snapshot: Record<string, unknown> }
): Promise<void> {
  try {
    await admin.from("roamly_fyi_digest_log").upsert(
      {
        user_id: params.userId,
        trip_id: params.tripId,
        moment: "flight_change",
        dedupe_key: params.dedupeKey,
        channel: "snapshot",
        snapshot_json: params.snapshot,
        metadata_json: { baseline: true },
        sent_at: new Date().toISOString()
      },
      { onConflict: "dedupe_key" }
    );
  } catch {
    // fail-soft: comparison degrades to no-alert for this run
  }
}

/** Anti-spam: was an upsell email sent for this trip (+gap) within `days`? */
async function recentUpsellSent(
  admin: SupabaseClient,
  params: { tripId: string; gapType?: string; days: number }
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - params.days * 86_400_000).toISOString();
    let query = admin
      .from("roamly_fyi_digest_log")
      .select("id")
      .eq("trip_id", params.tripId)
      .eq("moment", "upsell_gap")
      .eq("channel", "email")
      .gte("sent_at", since)
      .limit(1);
    if (params.gapType) query = query.eq("metadata_json->>gap_type", params.gapType);
    const result = await query.maybeSingle();
    if (result.error) return false;
    return Boolean(result.data);
  } catch {
    return false; // fail-soft: allow the send; dedupe keys still guard duplicates
  }
}

async function loadEmailPreferences(admin: SupabaseClient, userId: string): Promise<EmailPreferences | null> {
  try {
    const result = await admin
      .from("roamly_email_preferences")
      .select("marketing_enabled,unsubscribed_all,unsubscribe_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) return null; // fail closed: unreadable preferences => no email
    if (!result.data) {
      return { marketingEnabled: false, unsubscribedAll: false, unsubscribeToken: "" };
    }
    const row = result.data as { marketing_enabled?: boolean | null; unsubscribed_all?: boolean | null; unsubscribe_token?: string | null };
    return {
      marketingEnabled: row.marketing_enabled === true,
      unsubscribedAll: row.unsubscribed_all === true,
      unsubscribeToken: typeof row.unsubscribe_token === "string" ? row.unsubscribe_token : ""
    };
  } catch {
    return null;
  }
}

async function ensureUnsubscribeToken(admin: SupabaseClient, userId: string): Promise<string> {
  const existing = await loadEmailPreferences(admin, userId);
  if (existing && existing.unsubscribeToken) return existing.unsubscribeToken;
  const token = randomUUID();
  try {
    await admin.from("roamly_email_preferences").upsert(
      { user_id: userId, unsubscribe_token: token, updated_at: new Date().toISOString() },
      { onConflict: "user_id", ignoreDuplicates: false }
    );
  } catch {
    // fail-soft: footer link may be empty, send still proceeds
  }
  return token;
}

type ConsentCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

async function checkMomentConsent(params: {
  admin: SupabaseClient;
  userId: string;
  tripId: string;
  moment: FyiMoment;
  notificationType: string;
  requiresMarketing: boolean;
}): Promise<ConsentCheck> {
  const prefs = await loadEmailPreferences(params.admin, params.userId);
  if (!prefs) return { allowed: false, reason: "email_preferences_unavailable" };
  if (prefs.unsubscribedAll) return { allowed: false, reason: "unsubscribed_all" };
  if (params.requiresMarketing && !prefs.marketingEnabled) {
    return { allowed: false, reason: "marketing_consent_missing" };
  }
  // Honor the traveler's own communication preferences (Junel's priority order:
  // confirmed booking / hard requirement beats any recommendation).
  const preferenceKey = communicationPreferenceForNotificationType(params.notificationType);
  if (preferenceKey) {
    const companion = await getCompanionPreferencesForDelivery({
      supabase: params.admin,
      userId: params.userId,
      tripId: params.tripId
    });
    if (!companion) return { allowed: false, reason: "communication_preferences_unavailable" };
    if (!companion[preferenceKey]) return { allowed: false, reason: `preference_disabled:${preferenceKey}` };
  }
  return { allowed: true };
}

function emailTemplateForMoment(moment: FyiMoment): EmailTemplateType {
  switch (moment) {
    case "check_in_t24": return "fyi_check_in";
    case "flight_change": return "fyi_flight_change";
    case "itinerary_ready": return "fyi_itinerary_ready";
    case "trip_starting_soon": return "fyi_trip_starting";
    case "upsell_gap": return "fyi_upsell_gap";
    case "review_ask": return "fyi_review_ask";
  }
}

/** Review-ask moments are owned by the review pipeline — never sent by the digest. */
function assertDigestSendable(moment: FyiMoment) {
  if (moment === "review_ask") {
    throw new Error("review_ask is owned by the review pipeline, not the FYI digest.");
  }
}

async function sendFyiMoment(params: {
  admin: SupabaseClient;
  userId: string;
  tripId: string;
  moment: FyiMoment;
  notificationType: string;
  dedupeKey: string;
  copy: FyiCopy;
  destination: string;
  requiresMarketing: boolean;
  pushEnabled: boolean;
  snapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  now: Date;
}): Promise<{ result: string; email: boolean; push: boolean; inApp: boolean }> {
  const { admin, userId, tripId, moment } = params;
  assertDigestSendable(moment);

  const consent = await checkMomentConsent({
    admin,
    userId,
    tripId,
    moment,
    notificationType: params.notificationType,
    requiresMarketing: params.requiresMarketing
  });
  if (!consent.allowed) {
    await logMoment(admin, { userId, tripId, moment, dedupeKey: `${params.dedupeKey}:skipped:${consent.reason}`, channel: "skipped", metadata: params.metadata });
    return { result: `skipped:${consent.reason}`, email: false, push: false, inApp: false };
  }

  // Claim the per-moment dedupe key. 23505 => already sent.
  const claim = await logMoment(admin, {
    userId, tripId, moment, dedupeKey: params.dedupeKey, channel: "in_app", snapshot: params.snapshot, metadata: params.metadata
  });
  if (!claim.ok) return { result: "log_failed", email: false, push: false, inApp: false };
  if (claim.deduplicated) return { result: "deduplicated", email: false, push: false, inApp: false };

  // 1. In-app notification (always — powers the notifications page + companion).
  const inApp = await createInAppNotification(admin, {
    userId,
    tripId,
    type: params.notificationType,
    title: params.copy.title,
    body: params.copy.body,
    actionUrl: params.copy.actionUrl,
    metadata: { fyi_moment: moment, ...(params.metadata || {}) }
  });
  const notificationId = (inApp.data as { id?: string } | null)?.id || null;

  // 2. Push — only where a subscription exists (sendPushNotification handles that).
  let pushed = false;
  if (params.pushEnabled && notificationId) {
    try {
      const pushResult = await sendPushNotification(
        admin,
        userId,
        {
          type: params.notificationType,
          title: params.copy.title,
          body: params.copy.body,
          tripId,
          actionUrl: params.copy.actionUrl
        },
        { sendEmail: false, notificationId, createNotification: false }
      );
      pushed = pushResult.ok === true && (pushResult.sent || 0) > 0;
    } catch {
      pushed = false;
    }
  }

  // 3. Email — max 1 FYI email per trip per day.
  let emailed = false;
  const dailyCapKey = fyiDailyEmailCapKey(tripId, params.now);
  const capClaim = await logMoment(admin, {
    userId, tripId, moment, dedupeKey: dailyCapKey, channel: "email", metadata: { cap: true, for_moment: moment }
  });
  if (capClaim.ok && !capClaim.deduplicated) {
    const userResult = await admin.auth.admin.getUserById(userId);
    const to = userResult.data?.user?.email?.trim() || "";
    if (to) {
      const token = await ensureUnsubscribeToken(admin, userId);
      const template = renderEmailTemplate(emailTemplateForMoment(moment), {
        subject: params.copy.subject,
        preheader: params.copy.body.slice(0, 120),
        message: params.copy.body,
        tripTitle: null,
        destination: params.destination,
        actionUrl: params.copy.actionUrl,
        ctaLabel: params.copy.actionLabel,
        managePreferencesUrl: token ? unsubscribeUrl(token) : undefined,
        managePreferencesLabel: token ? "Unsubscribe from Roamly emails" : undefined
      });
      const emailResult = await sendRoamlyEmail({
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
        userId,
        tripId,
        notificationId,
        idempotencyKey: params.dedupeKey,
        metadata: { type: "fyi_digest", template: emailTemplateForMoment(moment), fyi_moment: moment, ...(params.metadata || {}) }
      });
      emailed = emailResult.ok;
    }
  }

  return { result: "sent", email: emailed, push: pushed, inApp: Boolean(notificationId) };
}

function segmentLike(booking: BookingRow, segment: SegmentRow): FlightSegmentLike {
  return {
    bookingId: booking.id,
    tripId: booking.trip_id,
    userId: booking.user_id,
    flightNumber: segment.service_number || booking.flight_number,
    provider: segment.provider,
    origin: segment.origin || booking.origin,
    destination: segment.destination || booking.destination,
    departureTime: segment.departure_time || booking.start_at,
    arrivalTime: segment.arrival_time || booking.end_at,
    terminal: segment.terminal || booking.terminal,
    gate: segment.gate || booking.gate,
    status: segment.status
  };
}

function snapshotOf(booking: BookingRow): FlightSnapshot {
  return {
    bookingStatus: booking.booking_status,
    startAt: booking.start_at,
    endAt: booking.end_at,
    gate: booking.gate,
    terminal: booking.terminal
  };
}

async function eligibleTrips(admin: SupabaseClient, now: Date): Promise<TripRow[]> {
  const result = await admin
    .from("roamly_trips")
    .select("id,user_id,title,destination,destination_name,destination_city,start_date,end_date,status,itinerary_locked,tracking_unlocked,live_companion_unlocked,metadata,updated_at")
    .not("user_id", "is", null)
    .not("start_date", "is", null)
    .in("status", ["locked", "planned", "active"])
    .order("start_date", { ascending: true })
    .limit(MAX_TRIPS_PER_RUN);
  if (result.error) throw new Error(result.error.message);
  return (result.data || []) as TripRow[];
}

function tripIsCompanionEligible(trip: TripRow) {
  return trip.itinerary_locked === true && (trip.tracking_unlocked === true || trip.live_companion_unlocked === true);
}

async function processTrip(admin: SupabaseClient, trip: TripRow, now: Date) {
  type TripOutcome = { tripId: string; moment: FyiMoment; result: string; email: boolean; push: boolean; inApp: boolean };
  const outcomes: TripOutcome[] = [];
  const destination = getTripDestinationLabel({ destination_name: trip.destination_name, metadata: trip.metadata }) || "your trip";
  // Notification-timezone round (2026-10-27): the digest window uses
  // the SAME resolution as Live/Alerts (the trip row now carries its
  // destination columns). An unknown zone HOLDS the whole trip for
  // this run — no moment is evaluated on a guessed window — and the
  // hold is recorded in the digest result's heldTrips.
  const resolution = resolveBackgroundTripTimezone(trip);
  if (!resolution.zone) return { outcomes, held: true as const, holdReason: BACKGROUND_TIMEZONE_HOLD };
  const timezone = resolution.zone;
  const window = tripWindowState({ startDate: trip.start_date, endDate: trip.end_date, timezone, now });

  // --- Moment 4: trip starting soon (T-3d, 60–84h out) ---
  if (tripIsCompanionEligible(trip) && trip.start_date) {
    const startMs = Date.parse(`${trip.start_date}T00:00:00`);
    if (Number.isFinite(startMs)) {
      const hoursOut = (startMs - now.getTime()) / 3_600_000;
      if (hoursOut >= 60 && hoursOut <= 84) {
        const copy = buildTripStartingCopy(destination, trip.start_date, trip.id);
        const sent = await sendFyiMoment({
          admin, userId: trip.user_id, tripId: trip.id,
          moment: "trip_starting_soon",
          notificationType: "trip_predeparture_1d",
          dedupeKey: fyiDedupeKey("trip_starting_soon", trip.id, trip.start_date),
          copy, destination,
          requiresMarketing: false,
          pushEnabled: true,
          now
        });
        outcomes.push({ tripId: trip.id, moment: "trip_starting_soon", result: sent.result, email: sent.email, push: sent.push, inApp: sent.inApp });
      }
    }
  }

  // --- Moment 3: itinerary ready (tracking unlocked recently, no FYI yet) ---
  if (trip.tracking_unlocked === true || trip.live_companion_unlocked === true) {
    const updatedAt = trip.updated_at ? Date.parse(trip.updated_at) : NaN;
    const recentlyUnlocked = Number.isFinite(updatedAt) && now.getTime() - updatedAt <= 25 * 3_600_000;
    if (recentlyUnlocked) {
      const copy = buildItineraryReadyCopy(destination, trip.id);
      const sent = await sendFyiMoment({
        admin, userId: trip.user_id, tripId: trip.id,
        moment: "itinerary_ready",
        notificationType: "booking_confirmed",
        dedupeKey: fyiDedupeKey("itinerary_ready", trip.id, "tracking_unlocked"),
        copy, destination,
        requiresMarketing: false,
        pushEnabled: true,
        metadata: { itinerary_locked: trip.itinerary_locked === true },
        now
      });
      outcomes.push({ tripId: trip.id, moment: "itinerary_ready", result: sent.result, email: sent.email, push: sent.push, inApp: sent.inApp });
    }
  }

  // Only look at bookings for trips that are upcoming or active.
  if (window !== "future_trip" && window !== "active") return { outcomes, held: false as const, holdReason: null };

  const bookingsResult = await admin
    .from("roamly_bookings")
    .select("id,user_id,trip_id,title,booking_type,booking_status,flight_number,start_at,end_at,origin,destination,gate,terminal,updated_at")
    .eq("trip_id", trip.id)
    .eq("user_id", trip.user_id)
    .eq("booking_type", "flight")
    .in("booking_status", ["booked", "paid", "reserved", "cancelled"])
    .not("flight_number", "is", null);
  if (bookingsResult.error) return { outcomes, held: false as const, holdReason: null };
  const bookings = (bookingsResult.data || []) as BookingRow[];
  if (!bookings.length) return { outcomes, held: false as const, holdReason: null };

  const bookingIds = bookings.map((booking) => booking.id);
  const segmentsResult = await admin
    .from("booking_segments")
    .select("booking_id,origin,destination,departure_time,arrival_time,provider,service_number,terminal,gate,status")
    .in("booking_id", bookingIds)
    .order("sequence", { ascending: true });
  const segments = (segmentsResult.data || []) as SegmentRow[];
  const segmentsByBooking = new Map<string, SegmentRow[]>();
  for (const segment of segments) {
    const list = segmentsByBooking.get(segment.booking_id) || [];
    list.push(segment);
    segmentsByBooking.set(segment.booking_id, list);
  }

  for (const booking of bookings) {
    const bookingSegments = segmentsByBooking.get(booking.id) || [];
    // --- Moment 1: check-in T-24h per segment ---
    for (const segment of bookingSegments) {
      const like = segmentLike(booking, segment);
      if (!isCheckInT24Window(like.departureTime, now)) continue;
      if (String(segment.status || "").toLowerCase() === "cancelled") continue;
      const copy = buildCheckInCopy(like, trip.id);
      const sent = await sendFyiMoment({
        admin, userId: trip.user_id, tripId: trip.id,
        moment: "check_in_t24",
        notificationType: "check_in_reminder",
        dedupeKey: fyiDedupeKey("check_in_t24", trip.id, `${booking.id}:${like.departureTime}`),
        copy, destination,
        requiresMarketing: false,
        pushEnabled: true,
        snapshot: { departure_time: like.departureTime, flight_number: like.flightNumber },
        metadata: { booking_id: booking.id, source: "booking_segment" },
        now
      });
      outcomes.push({ tripId: trip.id, moment: "check_in_t24", result: sent.result, email: sent.email, push: sent.push, inApp: sent.inApp });
    }

    // --- Moment 2: flight changed / disruption ---
    // Compare the latest booking snapshot against the last recorded snapshot.
    // First observation only writes the baseline — never invents a change.
    if (booking.updated_at) {
      const updatedMs = Date.parse(booking.updated_at);
      if (Number.isFinite(updatedMs) && now.getTime() - updatedMs <= FLIGHT_CHANGE_LOOKBACK_MINUTES * 60_000) {
        const current = snapshotOf(booking);
        const snapshotKey = fyiDedupeKey("flight_change", trip.id, booking.id);
        const previous = (await readLastSnapshot(admin, snapshotKey)) as unknown as FlightSnapshot | null;
        if (!previous) {
          await writeSnapshotBaseline(admin, {
            userId: trip.user_id,
            tripId: trip.id,
            dedupeKey: snapshotKey,
            snapshot: current as unknown as Record<string, unknown>
          });
        } else {
          const kind: FlightChangeKind | null = flightChangeKind(previous, current);
          if (kind) {
            const like = bookingSegments.length
              ? segmentLike(booking, bookingSegments[0])
              : segmentLike(booking, {
                  booking_id: booking.id, origin: null, destination: null, departure_time: null,
                  arrival_time: null, provider: null, service_number: null, terminal: null, gate: null, status: null
                });
            const copy = buildFlightChangeCopy(like, trip.id, kind, current);
            const notificationType = kind === "cancelled" ? "flight_cancelled" : kind === "delayed" ? "flight_delay" : "booking_changed";
            const sent = await sendFyiMoment({
              admin, userId: trip.user_id, tripId: trip.id,
              moment: "flight_change",
              notificationType,
              dedupeKey: `${snapshotKey}:${kind}`,
              copy, destination,
              requiresMarketing: false,
              pushEnabled: kind === "cancelled" || kind === "delayed",
              snapshot: current as unknown as Record<string, unknown>,
              metadata: { booking_id: booking.id, change_kind: kind },
              now
            });
            outcomes.push({ tripId: trip.id, moment: "flight_change", result: sent.result, email: sent.email, push: sent.push, inApp: sent.inApp });
            if (sent.result === "sent") {
              await writeSnapshotBaseline(admin, {
                userId: trip.user_id,
                tripId: trip.id,
                dedupeKey: snapshotKey,
                snapshot: current as unknown as Record<string, unknown>
              });
            }
          }
        }
      }
    }
  }

  // --- Moment 5: trip-gap upsell (marketing-consent gated, one offer) ---
  // Anti-spam: max 1 upsell email per gap per trip per 30 days, and max 1
  // upsell email per trip per 7 days across gaps. Upsell never pushes.
  if (tripIsCompanionEligible(trip) && (window === "future_trip" || window === "active")) {
    const gapResult: GapOfferResult = await detectAndOfferTripGaps({ supabase: admin, trip, userId: trip.user_id }).catch(() => ({ ok: false as const, error: "gap_watcher_failed" }));
    if (gapResult.ok && gapResult.offer && gapResult.gap) {
      const offer = gapResult.offer;
      const perGapCooldown = await recentUpsellSent(admin, { tripId: trip.id, gapType: gapResult.gap, days: UPSELL_GAP_EMAIL_COOLDOWN_DAYS });
      const perTripCooldown = await recentUpsellSent(admin, { tripId: trip.id, days: UPSELL_TRIP_EMAIL_COOLDOWN_DAYS });
      if (!perGapCooldown && !perTripCooldown) {
        const copy = buildUpsellCopy({
          gapTitle: offer.title,
          gapDescription: offer.description,
          destination,
          tripId: trip.id,
          ctaUrl: offer.href,
          ctaLabel: offer.ctaLabel,
          disclosure: offer.disclosure
        });
        const sent = await sendFyiMoment({
          admin, userId: trip.user_id, tripId: trip.id,
          moment: "upsell_gap",
          notificationType: "fyi_upsell_gap",
          dedupeKey: fyiDedupeKey("upsell_gap", trip.id, offer.type),
          copy: { ...copy, actionUrl: offer.href, actionLabel: offer.ctaLabel },
          destination,
          requiresMarketing: true,
          pushEnabled: false, // upsell never pushes — email + in-app only (anti-spam)
          metadata: { gap_type: offer.type, provider: offer.providerLabel },
          now
        });
        outcomes.push({ tripId: trip.id, moment: "upsell_gap", result: sent.result, email: sent.email, push: sent.push, inApp: sent.inApp });
      } else {
        outcomes.push({
          tripId: trip.id,
          moment: "upsell_gap",
          result: perGapCooldown ? "skipped:upsell_gap_cooldown" : "skipped:upsell_trip_cooldown",
          email: false, push: false, inApp: false
        });
      }
    }
  }

  return { outcomes, held: false as const, holdReason: null };
}

export async function processFyiDigest(params: { now?: Date } = {}): Promise<DigestResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, error: "Supabase service role is not configured." };
  const now = params.now || new Date();

  const lock = await acquireLock(admin);
  if (!lock.ok) return { ok: false, error: lock.error };
  if (!lock.acquired) return { ok: true, skipped: "FYI digest is already running." };

  try {
    const trips = await eligibleTrips(admin, now);
    const moments: Array<{ tripId: string; moment: FyiMoment; result: string }> = [];
    const heldTrips: string[] = [];
    let email = 0;
    let push = 0;
    let inApp = 0;

    for (const trip of trips) {
      if (!trip.user_id) continue;
      try {
        const { outcomes, held } = await processTrip(admin, trip, now);
        if (held) heldTrips.push(trip.id);
        for (const outcome of outcomes) {
          moments.push({ tripId: outcome.tripId, moment: outcome.moment, result: outcome.result });
          if (outcome.result === "sent") {
            if (outcome.email) email += 1;
            if (outcome.push) push += 1;
            if (outcome.inApp) inApp += 1;
          }
        }
      } catch (error) {
        moments.push({
          tripId: trip.id,
          moment: "check_in_t24",
          result: `error:${error instanceof Error ? error.message : "trip_failed"}`
        });
      }
    }

    return { ok: true, processed: trips.length, sent: { email, push, inApp }, moments, heldTrips };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "FYI digest failed." };
  } finally {
    if (lock.ok && lock.acquired) await releaseLock(admin, lock.lockOwner);
  }
}
