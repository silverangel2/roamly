import { randomUUID } from "node:crypto";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTripReminderEmail } from "@/lib/roamly/email";
import { communicationPreferenceForNotificationType, getCompanionPreferences, getCompanionPreferencesForDelivery } from "@/lib/roamly/companionPreferences";
import { tripWindowState } from "@/lib/roamly/liveCompanion";
import { resolveBackgroundTripTimezone } from "@/lib/roamly/backgroundNotificationTimezone";
import { bookingLinkedDeliveryState } from "@/lib/roamly/operationalScheduledEvents";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";
import { loadCompanionTripLifecycle } from "@/lib/roamly/companionDeliveryLifecycle";
import { normalizePushEndpoint } from "@/lib/roamly/pushEndpoint";
import { getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { localizeActivityNotification } from "@/lib/roamly/briefingMessages.mjs";
import { recordAppEvent } from "@/lib/roamly/events";

// Email discipline for scheduled companion events (Defect 5 — owner verdict
// 2026-10-23: one reminder = one email). A single event delivers AT MOST ONE
// email, ever: the first successful send stamps metadata.emailSentAt, and no
// later dispatcher run may email that event again — its retries are for
// push/in-app delivery only. A send that FAILS (nothing was delivered) may
// be retried on later runs, bounded by MAX_COMPANION_EVENT_EMAIL_ATTEMPTS
// total attempts; the cap bounds failed attempts, it never licenses a
// second delivered email. Due stage events for the same trip also collapse:
// only the first event that actually emails for a trip in a dispatcher run
// claims the trip's email slot, and any sibling event that was passed over
// because of that collapse is marked (metadata.emailCollapsed) so it never
// bursts its own email on a later retry either. Push behavior is unchanged
// in all cases.
//
// Burst-collapse correction (2026-10-30, daily-test failures 2026-10-27/29/30:
// cumulative rows 1 -> 2 -> 2 -> 2 -> 2 and 1 -> 2 -> 3 -> 3 -> 3 with 2-3
// distinct emailed events): the collapse above was scoped to a single
// dispatcher RUN — the only trip-level state was an in-memory set, and the
// persistent markers were written solely for siblings that happened to be
// due in the same run and exited through the push-failed reschedule path.
// Stage events become due at different times (-7d/-3d/-2d/-1d/0d), so a
// sibling that was not yet due during the emailing run carried no marker
// and legitimately passed companionEventEmailAllowed in a later run. The
// collapse is now persisted at trip level:
//   * a delivered email immediately marks EVERY still-scheduled sibling
//     for the trip emailCollapsed (due or not), and stamps the emailed
//     event on BOTH terminal paths (shown and reschedule);
//   * each event's email decision also consults the trip's persisted
//     state (any coexisting event already carrying emailSentAt blocks it),
//     so a sibling that missed the emailing run entirely — the dispatcher
//     fetches a bounded, globally ordered window — is still suppressed
//     when it is finally processed;
//   * before sending, the event claims the trip's email slot with a
//     compare-and-swap on the trip metadata, so concurrent dispatcher
//     runs (cron overlap, QA dispatch) cannot each email a different
//     sibling of the same trip;
//   * an event created AFTER the trip's email was delivered is a new
//     generation — a legitimate later alert — and is not blocked by the
//     earlier burst (generation is compared by created_at vs the
//     delivered emailSentAt instant).
// emailSentAt is stamped only when the provider result confirms delivery
// (emailResult.ok), never before acceptance.
//
// Email safeguards (2026-10-31): the burst fix above still failed OPEN on
// infrastructure errors (a claim whose PostgREST write errored logged and
// sent anyway) and kept no durable delivery state between "claim" and the
// terminal write, so a crash in that window — or a provider timeout —
// left the outcome unknowable and a resend unsafe. The send path is now a
// small durable state machine, persisted BEFORE the provider call in the
// trip metadata (companionEmailDelivery) and mirrored on the event:
//   claimed            slot CAS-won, state persisted, provider NOT yet
//                      invoked (the in-flight marker below proves it);
//   in_flight          persisted immediately before the provider call —
//                      an in_flight record observed by a later run means
//                      the call's outcome was never persisted: AMBIGUOUS;
//   provider_accepted  provider confirmed; emailSentAt stamped once;
//   provider_failed    provider explicitly rejected (or pre-connect
//                      failure): positive evidence of non-delivery, the
//                      slot is released and the event stays retryable;
//   ambiguous          provider timeout/drop, or an in_flight record
//                      found after the fact: outcome UNKNOWN. The slot
//                      stays held, emailSentAt is NEVER stamped and the
//                      email is NEVER blindly resent; only reconciliation
//                      evidence (an email-log row bearing this claim's
//                      identifier: accepted -> complete the stamp once,
//                      explicitly failed -> back to retryable) moves it;
//   released           a claimed record proven never to have reached the
//                      provider (no in-flight marker, no log evidence,
//                      older than the stale threshold) is released so a
//                      later run can claim and send — a trip is never
//                      wedged forever by a dead claim.
// Every attempt carries a unique per-claim identifier (UUID) persisted
// with the claim, sent with the email (log idempotency_key + message
// header / provider idempotency key where the provider supports one),
// and recorded on the email-log row — the reconciliation key. Claim or
// ownership-establishment failure (trip-state load error, claim read or
// CAS write error, delivery-marker persistence error) now FAILS CLOSED:
// no send of any kind, a stable log reason, and the event is rescheduled
// retryable for a later run.
export const MAX_COMPANION_EVENT_EMAIL_ATTEMPTS = 3;

export function companionEventEmailAttempts(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const value = (metadata as Record<string, unknown>).emailAttempts;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function companionEventEmailSent(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const value = (metadata as Record<string, unknown>).emailSentAt;
  return typeof value === "string" && value.length > 0;
}

export function companionEventEmailAllowed(params: {
  attempts: number;
  emailSent: boolean;
  collapsed: boolean;
  tripAlreadyEmailed: boolean;
}): boolean {
  return (
    !params.emailSent &&
    !params.collapsed &&
    !params.tripAlreadyEmailed &&
    params.attempts < MAX_COMPANION_EVENT_EMAIL_ATTEMPTS
  );
}

/**
 * The email metadata patch for an event's terminal write, shared by BOTH
 * dispatcher exit paths (push-accepted "shown" and push-failed reschedule).
 * Before 2026-10-30 the shown path wrote no metadata at all, so a delivered
 * email's emailSentAt/emailAttempts — and a suppressed sibling's
 * emailCollapsed marker — were silently discarded whenever push succeeded.
 * A stamp is produced only for a DELIVERED send (provider acceptance);
 * a failed attempt records the attempt count and never the stamp.
 */
export function companionEventEmailMetadataPatch(params: {
  emailAttempted: boolean;
  emailDelivered: boolean;
  emailSuppressedByCollapse: boolean;
  emailCollapsed: boolean;
  priorEmailAttempts: number;
  // Safeguards: the durable delivery state for this attempt. When a claim
  // id is supplied the attempt is counted against that claim exactly once
  // (emailAttemptCountedClaimId), so post-crash reconciliation can tell
  // whether the terminal write already recorded the attempt.
  deliveryState?: CompanionEmailDeliveryState | null;
  claimId?: string | null;
  // When a collapse marker is written because a claim is merely LIVE
  // (not yet delivered), the blocking claim's id is recorded as the
  // marker's provenance: if that claim later resolves as failed or
  // released (the generation provably never delivered), the marker is
  // reverted and the sibling keeps its email right. Markers from a
  // delivered generation carry the delivered claim's id (or none) and
  // are never reverted.
  collapseClaimId?: string | null;
}): Record<string, unknown> {
  if (params.emailAttempted) {
    return {
      emailAttempts: params.priorEmailAttempts + 1,
      ...(params.emailDelivered ? { emailSentAt: new Date().toISOString() } : {}),
      ...(params.claimId
        ? {
            emailClaimId: params.claimId,
            emailAttemptCountedClaimId: params.claimId,
            emailDeliveryState: params.deliveryState || (params.emailDelivered ? "provider_accepted" : "provider_failed")
          }
        : {})
    };
  }
  if (params.emailSuppressedByCollapse && !params.emailCollapsed) {
    return {
      emailCollapsed: true,
      ...(params.collapseClaimId ? { emailCollapsedClaimId: params.collapseClaimId } : {})
    };
  }
  return {};
}

const TRIP_EMAIL_CLAIM_METADATA_KEY = "companionEmailBurstClaim";
const TRIP_EMAIL_DELIVERY_METADATA_KEY = "companionEmailDelivery";

/** Stable log reason when claim/ownership establishment fails and the
 * dispatcher fails closed (no send; the event stays retryable). */
export const COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON = "EMAIL_CLAIM_UNAVAILABLE";
/** Stable log reason when a delivery outcome is unknown and held. */
export const COMPANION_EMAIL_DELIVERY_AMBIGUOUS_REASON = "EMAIL_DELIVERY_AMBIGUOUS";
/** A claimed (never-in-flight) record older than this, with no provider
 * or log evidence, is reclaimable: the provider was never invoked. */
export const COMPANION_EMAIL_CLAIM_STALE_MS = 15 * 60_000;
/** An in_flight record younger than this may still be a live provider
 * call in a concurrent run; older than this its outcome is ambiguous. */
export const COMPANION_EMAIL_INFLIGHT_GRACE_MS = 2 * 60_000;

export type CompanionEmailDeliveryState =
  | "claimed"
  | "in_flight"
  | "provider_accepted"
  | "provider_failed"
  | "ambiguous"
  | "released";

export type CompanionEmailDeliveryRecord = {
  state: CompanionEmailDeliveryState;
  claimId: string;
  eventId: string;
  claimedAt: string;
  updatedAt: string;
  emailSentAt?: string;
  lastError?: string;
};

const COMPANION_EMAIL_DELIVERY_STATES: ReadonlySet<string> = new Set([
  "claimed",
  "in_flight",
  "provider_accepted",
  "provider_failed",
  "ambiguous",
  "released"
]);

/** Parse the durable per-trip delivery record out of trip metadata. */
export function companionEmailDeliveryRecord(tripMetadata: unknown): CompanionEmailDeliveryRecord | null {
  const delivery = metadataRecord(metadataRecord(tripMetadata)[TRIP_EMAIL_DELIVERY_METADATA_KEY]);
  if (
    typeof delivery.state !== "string" ||
    !COMPANION_EMAIL_DELIVERY_STATES.has(delivery.state) ||
    typeof delivery.claimId !== "string" ||
    !delivery.claimId ||
    typeof delivery.eventId !== "string" ||
    !delivery.eventId
  ) {
    return null;
  }
  return delivery as unknown as CompanionEmailDeliveryRecord;
}

/**
 * Classify a provider email result for the delivery state machine:
 * "accepted" only on provider confirmation; "ambiguous" when the call
 * ended without a verdict (timeout / dropped connection — delivery
 * unknown); "rejected" on an explicit provider failure (positive
 * evidence of non-delivery); "none" when no send was attempted.
 */
export function classifyCompanionEmailResult(emailResult: unknown): "accepted" | "rejected" | "ambiguous" | "none" {
  if (!emailResult || typeof emailResult !== "object") return "none";
  const result = emailResult as { ok?: unknown; ambiguous?: unknown };
  if (result.ok === true) return "accepted";
  if (result.ok === false) return result.ambiguous === true ? "ambiguous" : "rejected";
  return "none";
}

function deliveryRecordAgeMs(record: { claimedAt?: unknown; updatedAt?: unknown } | null, nowMs: number): number {
  if (!record) return Number.POSITIVE_INFINITY;
  const stamp = typeof record.updatedAt === "string" ? record.updatedAt : record.claimedAt;
  const parsed = typeof stamp === "string" ? Date.parse(stamp) : NaN;
  return Number.isFinite(parsed) ? nowMs - parsed : Number.POSITIVE_INFINITY;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** True when an event already existed at the given instant (same burst
 * generation). A missing/unparseable created_at counts as existed — the
 * safe direction for collapse. An unparseable instant proves nothing. */
function companionEventExistedAt(eventCreatedAt: unknown, isoInstant: unknown): boolean {
  const instant = typeof isoInstant === "string" ? Date.parse(isoInstant) : NaN;
  if (!Number.isFinite(instant)) return false;
  const created = typeof eventCreatedAt === "string" ? Date.parse(eventCreatedAt) : NaN;
  if (!Number.isFinite(created)) return true;
  return created <= instant;
}

type CompanionTripEventRow = {
  id: string;
  status?: unknown;
  created_at?: unknown;
  metadata?: unknown;
};

export type CompanionTripEmailBlockReason =
  | "delivered"
  | "claim_live"
  | "claim_inflight"
  | "ambiguous_hold"
  | null;

/**
 * Persisted per-trip email state for one event's decision. Generation
 * boundary (as shipped in the burst fix, unchanged): an event belongs to
 * a delivered email's generation iff it existed at the delivery instant
 * (created_at <= emailSentAt); an event created after it is a new
 * generation and may email again — exactly once, under its own claim.
 *
 * The event is blocked when:
 *  - a coexisting sibling already delivered this generation's email
 *    ("delivered" — the suppression is permanent: collapse marker);
 *  - another event holds a live claim on the trip's email slot
 *    ("claim_live" / "claim_inflight" — transient hold, no marker);
 *  - a delivery outcome for the trip is UNKNOWN ("ambiguous_hold" —
 *    transient hold for every event, the claimer included: never resend
 *    until reconciliation resolves the held claim).
 * A claim lapses when its delivery FAILED (explicit non-delivery), when
 * it was released, when its event is gone or terminal without a delivery,
 * when it is a stale pre-provider claim (older than the stale threshold,
 * so the provider was never invoked), or when it delivered before this
 * event existed (this event is then a new generation and may claim the
 * slot itself). An ambiguous or in-flight claim NEVER lapses.
 */
export function companionTripEmailBlock(params: {
  eventId: string;
  eventCreatedAt: unknown;
  tripEvents: CompanionTripEventRow[];
  claimEventId: string | null;
  delivery?: CompanionEmailDeliveryRecord | null;
  nowMs?: number;
}): { blocked: boolean; claimLapsed: boolean; blockReason: CompanionTripEmailBlockReason } {
  let blocked = false;
  let claimLapsed = false;
  let blockReason: CompanionTripEmailBlockReason = null;
  for (const other of params.tripEvents) {
    if (other.id === params.eventId) continue;
    if (!companionEventEmailSent(other.metadata)) continue;
    if (companionEventExistedAt(params.eventCreatedAt, metadataRecord(other.metadata).emailSentAt)) {
      blocked = true;
      blockReason = "delivered";
    }
  }
  const delivery = params.delivery || null;
  if (delivery) {
    const nowMs = typeof params.nowMs === "number" ? params.nowMs : Date.now();
    if (delivery.state === "ambiguous" || delivery.state === "in_flight") {
      // Outcome unknown: the slot stays held for EVERY event — the
      // claimer must not resend either — until reconciliation resolves
      // it. In-flight converts to ambiguous; it never lapses.
      blocked = true;
      blockReason = delivery.state === "ambiguous" ? "ambiguous_hold" : "claim_inflight";
    } else if (delivery.state === "provider_accepted") {
      if (delivery.emailSentAt && companionEventExistedAt(params.eventCreatedAt, delivery.emailSentAt)) {
        blocked = true;
        blockReason = "delivered";
      } else {
        // Delivered before this event existed: new generation.
        claimLapsed = true;
      }
    } else if (delivery.state === "provider_failed" || delivery.state === "released") {
      // Positive non-delivery / proven never-sent: the slot is free,
      // including for the failed claimer itself (its retry) — bounded by
      // the per-event attempt cap as before.
      claimLapsed = true;
    } else if (delivery.state === "claimed") {
      if (delivery.eventId === params.eventId) {
        // Our own earlier claim (e.g. an interrupted run rescheduled the
        // event): reclaim it under a fresh claim id. A concurrent run
        // cannot be processing this same event — the per-event claim
        // (scheduled -> processing) already serialised that.
        claimLapsed = true;
      } else if (deliveryRecordAgeMs(delivery, nowMs) > COMPANION_EMAIL_CLAIM_STALE_MS) {
        // Stale pre-provider claim: reclaimable (see state machine).
        claimLapsed = true;
      } else {
        blocked = true;
        blockReason = "claim_live";
      }
    }
    return { blocked, claimLapsed, blockReason };
  }
  if (params.claimEventId && params.claimEventId !== params.eventId) {
    const claimer = params.tripEvents.find((row) => row.id === params.claimEventId);
    if (!claimer) {
      claimLapsed = true;
    } else if (companionEventEmailSent(claimer.metadata)) {
      // A delivered claimer blocks through the delivered check above when
      // this event coexisted with its delivery; otherwise its claim has
      // lapsed for this new-generation event.
      if (!companionEventExistedAt(params.eventCreatedAt, metadataRecord(claimer.metadata).emailSentAt)) {
        claimLapsed = true;
      }
    } else if (claimer.status === "scheduled" || claimer.status === "processing") {
      blocked = true;
      blockReason = "claim_live";
    } else {
      claimLapsed = true;
    }
  }
  return { blocked, claimLapsed, blockReason };
}

async function loadCompanionTripEvents(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<CompanionTripEventRow[] | null> {
  const { data, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("id,status,created_at,metadata")
    .eq("user_id", userId)
    .eq("trip_id", tripId);
  if (error) {
    console.error(`[roamly-notifications] Failed to load companion trip email state for trip ${tripId}: ${error.message}`);
    return null;
  }
  return (data || []) as CompanionTripEventRow[];
}

/**
 * Compare-and-swap claim of a trip's email slot, stored in the trip's
 * metadata together with the durable delivery record (state "claimed",
 * a fresh per-claim identifier, the claiming event, the claim instant).
 * The conditional update only lands when the slot still holds exactly
 * the value the caller observed (or nothing), so two concurrent
 * dispatcher runs cannot both claim it: the loser gets no row back and
 * must not send. Safeguards (2026-10-31): infrastructure errors now fail
 * CLOSED — outcome "error", no send, the event stays retryable — where
 * the burst fix logged and failed open. Only a clean lost race
 * ("blocked") and a landed CAS ("claimed") are non-error outcomes.
 */
async function claimCompanionTripEmailSlot(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  eventId: string;
  previousClaimEventId: string | null;
  previousClaimId: string | null;
}): Promise<{ outcome: "claimed" | "blocked" | "error"; claimId: string | null; claimedAt: string | null }> {
  const { data: tripRow, error } = await params.supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error || !tripRow) {
    console.error(
      `[roamly-notifications] ${COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON} trip=${params.tripId} event=${params.eventId} stage=trip_read${error ? ` error=${error.message}` : " error=trip_missing"}`
    );
    return { outcome: "error", claimId: null, claimedAt: null };
  }
  const metadata = metadataRecord(tripRow.metadata);
  const currentClaim =
    typeof metadata[TRIP_EMAIL_CLAIM_METADATA_KEY] === "string"
      ? (metadata[TRIP_EMAIL_CLAIM_METADATA_KEY] as string)
      : null;
  const currentDelivery = companionEmailDeliveryRecord(metadata);
  if (currentDelivery && currentDelivery.eventId === params.eventId && currentDelivery.state === "claimed") {
    // This event already holds a live claim (an earlier interrupted run
    // of the same event): adopt it — same claim id, no second claim.
    return { outcome: "claimed", claimId: currentDelivery.claimId, claimedAt: currentDelivery.claimedAt };
  }
  if (currentClaim !== params.previousClaimEventId) return { outcome: "blocked", claimId: null, claimedAt: null };
  if (currentDelivery && currentDelivery.claimId !== params.previousClaimId) {
    // The delivery record moved since the caller observed it (another
    // claim/outcome landed in between): the observed state is stale.
    return { outcome: "blocked", claimId: null, claimedAt: null };
  }
  const claimId = randomUUID();
  const claimedAt = new Date().toISOString();
  const record: CompanionEmailDeliveryRecord = {
    state: "claimed",
    claimId,
    eventId: params.eventId,
    claimedAt,
    updatedAt: claimedAt
  };
  const base = params.supabase
    .from("roamly_trips")
    .update({
      metadata: {
        ...metadata,
        [TRIP_EMAIL_CLAIM_METADATA_KEY]: params.eventId,
        [TRIP_EMAIL_DELIVERY_METADATA_KEY]: record
      }
    })
    .eq("id", params.tripId)
    .eq("user_id", params.userId);
  const result = await (currentClaim
    ? base.filter(`metadata->>${TRIP_EMAIL_CLAIM_METADATA_KEY}`, "eq", currentClaim)
    : base.filter(`metadata->>${TRIP_EMAIL_CLAIM_METADATA_KEY}`, "is", null)
  )
    .select("id")
    .maybeSingle();
  if (result.error) {
    console.error(
      `[roamly-notifications] ${COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON} trip=${params.tripId} event=${params.eventId} stage=claim_write error=${result.error.message}`
    );
    return { outcome: "error", claimId: null, claimedAt: null };
  }
  return result.data
    ? { outcome: "claimed", claimId, claimedAt }
    : { outcome: "blocked", claimId: null, claimedAt: null };
}

/**
 * Persist a delivery-state marker on the claiming event (the event is in
 * "processing" while its dispatcher run works on it). Called with state
 * "claimed" BEFORE the provider call and "in_flight" immediately before
 * it. A persistence failure is fail-closed: the caller must not send.
 */
async function persistCompanionEventDeliveryMarker(params: {
  supabase: SupabaseClient;
  eventId: string;
  baseMetadata: Record<string, unknown>;
  state: "claimed" | "in_flight";
  claimId: string;
  claimedAt: string;
}): Promise<boolean> {
  const metadata: Record<string, unknown> = {
    ...params.baseMetadata,
    emailDeliveryState: params.state,
    emailClaimId: params.claimId,
    emailClaimedAt: params.claimedAt,
    ...(params.state === "in_flight" ? { emailProviderCallStartedAt: new Date().toISOString() } : {})
  };
  const { error } = await params.supabase
    .from("roamly_trip_companion_events")
    .update({ metadata })
    .eq("id", params.eventId)
    .eq("status", "processing");
  if (error) {
    console.error(
      `[roamly-notifications] ${COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON} event=${params.eventId} stage=delivery_marker_${params.state} error=${error.message}`
    );
    return false;
  }
  return true;
}

/**
 * Best-effort transition of the trip's durable delivery record (the
 * record must still carry this claim id — a newer claim owns the slot
 * otherwise). Failures are logged, never fatal: the event's own marker
 * and the email-log row still carry the claim, and reconciliation
 * completes the record from that evidence.
 */
async function transitionCompanionTripEmailDelivery(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  claimId: string;
  patch: Partial<CompanionEmailDeliveryRecord>;
}) {
  const { data: tripRow, error } = await params.supabase
    .from("roamly_trips")
    .select("metadata")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error || !tripRow) {
    console.error(
      `[roamly-notifications] Failed to read trip email delivery state for trip ${params.tripId}: ${error?.message || "trip missing"}`
    );
    return;
  }
  const metadata = metadataRecord(tripRow.metadata);
  const current = companionEmailDeliveryRecord(metadata);
  if (!current || current.claimId !== params.claimId) return;
  const { error: updateError } = await params.supabase
    .from("roamly_trips")
    .update({
      metadata: {
        ...metadata,
        [TRIP_EMAIL_DELIVERY_METADATA_KEY]: { ...current, ...params.patch, updatedAt: new Date().toISOString() }
      }
    })
    .eq("id", params.tripId)
    .eq("user_id", params.userId);
  if (updateError) {
    console.error(
      `[roamly-notifications] Failed to persist trip email delivery state for trip ${params.tripId}: ${updateError.message}`
    );
  }
}

/**
 * Persist the collapse for a whole burst: the moment one event delivers
 * the trip's email, every other still-scheduled event for the trip is
 * marked emailCollapsed — including siblings that are not due yet, which
 * the old per-run marking never touched and which therefore emailed when
 * they later became due. Generation-scoped (safeguards): only siblings
 * that existed at the delivery instant (created_at <= deliveredAt)
 * belong to the delivered generation and are collapsed; a sibling
 * created after it is a new generation and keeps its own email right.
 * This matters when the collapse runs late — e.g. reconciliation
 * completing a delivery long after the provider accepted it.
 */
async function collapseCompanionTripEmailSiblings(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  emailedEventId: string;
  deliveredAt?: string | null;
}) {
  const { data, error } = await params.supabase
    .from("roamly_trip_companion_events")
    .select("id,metadata,created_at")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .eq("status", "scheduled");
  if (error) {
    console.error(`[roamly-notifications] Failed to load trip email siblings for trip ${params.tripId}: ${error.message}`);
    return;
  }
  for (const sibling of data || []) {
    if (sibling.id === params.emailedEventId) continue;
    if (params.deliveredAt && !companionEventExistedAt(sibling.created_at, params.deliveredAt)) continue;
    const siblingMetadata = metadataRecord(sibling.metadata);
    if (siblingMetadata.emailCollapsed === true || companionEventEmailSent(siblingMetadata)) continue;
    await params.supabase
      .from("roamly_trip_companion_events")
      .update({ metadata: { ...siblingMetadata, emailCollapsed: true } })
      .eq("id", sibling.id)
      .eq("status", "scheduled");
  }
}

/**
 * Revert PROVISIONAL collapse markers: siblings marked emailCollapsed
 * solely because a claim was live (provenance = that claim's id) get
 * their email right back when the claim resolves as provider_failed or
 * released — the generation provably never delivered, so suppressing
 * them permanently would silently lose the trip's one email. Markers
 * from a delivered generation (different or no provenance) never match.
 */
async function uncollapseCompanionTripEmailSiblingsForClaim(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  claimId: string;
}) {
  const { data, error } = await params.supabase
    .from("roamly_trip_companion_events")
    .select("id,metadata")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .eq("status", "scheduled");
  if (error) return;
  for (const sibling of data || []) {
    const siblingMetadata = metadataRecord(sibling.metadata);
    if (
      siblingMetadata.emailCollapsed === true &&
      siblingMetadata.emailCollapsedClaimId === params.claimId &&
      !companionEventEmailSent(siblingMetadata)
    ) {
      await params.supabase
        .from("roamly_trip_companion_events")
        .update({
          metadata: { ...siblingMetadata, emailCollapsed: false, emailCollapsedClaimId: null }
        })
        .eq("id", sibling.id)
        .eq("status", "scheduled");
    }
  }
}

/**
 * Reconciliation sweep for interrupted companion email deliveries. Runs
 * at the top of every dispatcher run and resolves every event still
 * carrying a non-terminal delivery marker (claimed / in_flight /
 * ambiguous) from durable evidence — the email-log rows bearing the
 * claim identifier:
 *  - an accepted log row (sent/captured) completes the delivery: the
 *    claimer is stamped emailSentAt EXACTLY ONCE (the log's own stamp),
 *    its generation's siblings are collapsed, the trip record completes
 *    — and no second email is ever sent for that claim;
 *  - an explicitly failed log row (no ambiguity marker) is positive
 *    evidence of non-delivery: the attempt is recorded once and the
 *    slot returns to retryable (provider_failed);
 *  - no evidence for a still-"claimed" event older than the stale
 *    threshold proves the provider was never invoked (the in_flight
 *    marker would exist otherwise): the claim is RELEASED and a wedged
 *    event returns to scheduled;
 *  - anything else — an ambiguous log row, an in_flight record, an
 *    ambiguous record with no resolving evidence — stays HELD: no
 *    stamp, no resend, visibly logged with the stable ambiguous reason.
 * Returns counts for observability; never throws.
 */
export async function reconcileCompanionEmailDeliveries(supabase: SupabaseClient) {
  const summary = { completed: 0, released: 0, failed: 0, held: 0 };
  try {
    const nowMs = Date.now();
    for (const state of ["claimed", "in_flight", "ambiguous"] as const) {
      const { data: candidates, error } = await supabase
        .from("roamly_trip_companion_events")
        .select("id,user_id,trip_id,status,created_at,scheduled_for,metadata")
        .filter("metadata->>emailDeliveryState", "eq", state)
        .limit(50);
      if (error) {
        console.error(`[roamly-notifications] Email reconciliation scan failed (${state}): ${error.message}`);
        continue;
      }
      for (const event of candidates || []) {
        if (!event.trip_id) continue;
        const eventMetadata = metadataRecord(event.metadata);
        const claimId = typeof eventMetadata.emailClaimId === "string" ? eventMetadata.emailClaimId : null;
        if (!claimId) continue;
        const markerState = eventMetadata.emailDeliveryState;
        const logsResult = await supabase
          .from("roamly_email_logs")
          .select("id,status,created_at,sent_at,metadata")
          .eq("idempotency_key", claimId)
          .order("created_at", { ascending: true })
          .limit(5);
        if (logsResult.error) continue; // evidence unreadable: hold, never guess
        let logs = logsResult.data || [];
        if (!logs.length) {
          const fallback = await supabase
            .from("roamly_email_logs")
            .select("id,status,created_at,sent_at,metadata")
            .filter("metadata->>companionEmailClaimId", "eq", claimId)
            .order("created_at", { ascending: true })
            .limit(5);
          if (fallback.error) continue;
          logs = fallback.data || [];
        }
        const accepted = logs.find((row) => row.status === "sent" || row.status === "captured");
        const rejected = logs.find(
          (row) => row.status === "failed" && metadataRecord(row.metadata).delivery_ambiguous !== true
        );
        if (accepted) {
          const existingStamp = typeof eventMetadata.emailSentAt === "string" ? eventMetadata.emailSentAt : null;
          const stamp =
            existingStamp ||
            (typeof accepted.sent_at === "string" && accepted.sent_at
              ? accepted.sent_at
              : typeof accepted.created_at === "string" && accepted.created_at
                ? accepted.created_at
                : new Date().toISOString());
          const alreadyCounted = eventMetadata.emailAttemptCountedClaimId === claimId;
          const nextMetadata: Record<string, unknown> = {
            ...eventMetadata,
            emailSentAt: stamp,
            emailDeliveryState: "provider_accepted",
            ...(alreadyCounted
              ? {}
              : {
                  emailAttempts: companionEventEmailAttempts(eventMetadata) + 1,
                  emailAttemptCountedClaimId: claimId
                })
          };
          const { error: stampError } = await supabase
            .from("roamly_trip_companion_events")
            .update({
              metadata: nextMetadata,
              ...(event.status === "processing" ? { status: "scheduled" } : {})
            })
            .eq("id", event.id);
          if (stampError) {
            console.error(
              `[roamly-notifications] Email reconciliation could not complete claim ${claimId} for event ${event.id}: ${stampError.message}`
            );
            continue;
          }
          await transitionCompanionTripEmailDelivery({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            claimId,
            patch: { state: "provider_accepted", emailSentAt: stamp }
          });
          await collapseCompanionTripEmailSiblings({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            emailedEventId: event.id,
            deliveredAt: stamp
          });
          summary.completed += 1;
          continue;
        }
        if (rejected) {
          const alreadyCounted = eventMetadata.emailAttemptCountedClaimId === claimId;
          const { error: failError } = await supabase
            .from("roamly_trip_companion_events")
            .update({
              metadata: {
                ...eventMetadata,
                emailDeliveryState: "provider_failed",
                ...(alreadyCounted
                  ? {}
                  : {
                      emailAttempts: companionEventEmailAttempts(eventMetadata) + 1,
                      emailAttemptCountedClaimId: claimId
                    })
              },
              ...(event.status === "processing" ? { status: "scheduled" } : {})
            })
            .eq("id", event.id);
          if (failError) continue;
          await transitionCompanionTripEmailDelivery({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            claimId,
            patch: { state: "provider_failed", lastError: "provider_rejected_before_crash" }
          });
          await uncollapseCompanionTripEmailSiblingsForClaim({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            claimId
          });
          summary.failed += 1;
          continue;
        }
        // No resolving evidence.
        const markerAgeMs = deliveryRecordAgeMs(
          {
            claimedAt: eventMetadata.emailClaimedAt,
            updatedAt:
              markerState === "in_flight" ? eventMetadata.emailProviderCallStartedAt : eventMetadata.emailClaimedAt
          },
          nowMs
        );
        if (markerState === "claimed" && logs.length === 0 && markerAgeMs > COMPANION_EMAIL_CLAIM_STALE_MS) {
          // Proven never sent: no in-flight marker was ever persisted
          // (the send path persists it, fail-closed, before invoking the
          // provider) and no log row bears the claim. Release the slot
          // and unwedge the event.
          const { error: releaseError } = await supabase
            .from("roamly_trip_companion_events")
            .update({
              metadata: { ...eventMetadata, emailDeliveryState: "released", emailReleasedClaimId: claimId },
              ...(event.status === "processing" ? { status: "scheduled" } : {})
            })
            .eq("id", event.id);
          if (releaseError) continue;
          await transitionCompanionTripEmailDelivery({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            claimId,
            patch: { state: "released" }
          });
          await uncollapseCompanionTripEmailSiblingsForClaim({
            supabase,
            userId: event.user_id,
            tripId: event.trip_id,
            claimId
          });
          summary.released += 1;
          continue;
        }
        if (markerState === "in_flight" || markerState === "ambiguous") {
          const graceMs = markerState === "in_flight" ? COMPANION_EMAIL_INFLIGHT_GRACE_MS : 0;
          if (markerAgeMs > graceMs) {
            if (markerState === "in_flight") {
              await supabase
                .from("roamly_trip_companion_events")
                .update({ metadata: { ...eventMetadata, emailDeliveryState: "ambiguous" } })
                .eq("id", event.id);
              await transitionCompanionTripEmailDelivery({
                supabase,
                userId: event.user_id,
                tripId: event.trip_id,
                claimId,
                patch: { state: "ambiguous", lastError: "provider_outcome_unknown" }
              });
            }
            console.error(
              `[roamly-notifications] ${COMPANION_EMAIL_DELIVERY_AMBIGUOUS_REASON} trip=${event.trip_id} event=${event.id} claim=${claimId} — outcome unknown; slot held, no resend, no stamp`
            );
            summary.held += 1;
          }
          continue;
        }
        // Fresh "claimed" marker inside its stale window: a live or
        // just-interrupted claim — leave it for a later run.
      }
    }
  } catch (error) {
    console.error(
      `[roamly-notifications] Email reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return summary;
}

export type NotificationPayload = {
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  type?: string;
  tripId?: string | null;
  activityId?: string | null;
  tag?: string | null;
  eventId?: string | null;
  appleMapsUrl?: string | null;
  googleMapsUrl?: string | null;
  citymapperUrl?: string | null;
  checkInUrl?: string | null;
  skipUrl?: string | null;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:junel.abellana@gmail.com", publicKey, privateKey);
  return true;
}

function isExpiredSubscriptionError(error: unknown) {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: number }).statusCode)
    : 0;
  return statusCode === 404 || statusCode === 410;
}

function fieldTestUrl(tripId: string, activityId: string | null, action?: string) {
  const url = new URL(`/field-test/${encodeURIComponent(tripId)}`, "https://roamly.invalid");
  if (activityId) url.searchParams.set("activity", activityId);
  if (action) url.searchParams.set("action", action);
  return `${url.pathname}${url.search}`;
}

function activityActionUrl(tripId: string, activityId: string, action: "check-in" | "skip") {
  const route = action === "check-in" ? "/api/roamly/activities/check-in" : "/api/roamly/activities/skip";
  const url = new URL(route, "https://roamly.invalid");
  url.searchParams.set("tripId", tripId);
  url.searchParams.set("activityId", activityId);
  return `${url.pathname}${url.search}`;
}

async function secureNotificationPayload(writer: SupabaseClient, payload: NotificationPayload) {
  const tripId = payload.tripId ? String(payload.tripId).trim() : "";
  if (!tripId) return payload;
  const { data } = await writer.from("roamly_trips").select("metadata").eq("id", tripId).maybeSingle();
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  if (metadata.field_test !== true || metadata.admin_test !== true) return payload;
  const activityId = payload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1] || null;
  return {
    ...payload,
    actionUrl: fieldTestUrl(tripId, activityId),
    checkInUrl: activityId ? activityActionUrl(tripId, activityId, "check-in") : null,
    skipUrl: activityId ? activityActionUrl(tripId, activityId, "skip") : null
  };
}

export async function createInAppNotification(
  supabase: SupabaseClient,
  params: {
    userId: string;
    tripId?: string | null;
    eventId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    actionUrl?: string | null;
    scheduledFor?: string | null;
    status?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const writer = createSupabaseAdminClient() || supabase;
  let title = params.title;
  let body = params.body || "";
  if (params.tripId) {
    const tripResult = await writer.from("roamly_trips").select("metadata").eq("id", params.tripId).eq("user_id", params.userId).maybeSingle();
    if (tripResult.data) {
      const locale = getTripItineraryLanguage(tripResult.data.metadata);
      const localized = localizeActivityNotification(locale, params.type, title, body, params.metadata || {});
      title = localized.title;
      body = localized.body;
    }
  }
  return writer
    .from("roamly_notifications")
    .insert({
      user_id: params.userId,
      trip_id: params.tripId || null,
      event_id: params.eventId || null,
      type: params.type,
      title,
      body: body || null,
      action_url: params.actionUrl || null,
      status: params.status || "unread",
      scheduled_for: params.scheduledFor || null,
      metadata: params.metadata || {}
    })
    .select("id")
    .maybeSingle();
}

export async function sendPushNotification(
  supabase: SupabaseClient,
  userId: string,
  payload: NotificationPayload,
  options: {
    sendEmail?: boolean;
    notificationId?: string | null;
    createNotification?: boolean;
    subscriptionIds?: string[];
    // Durable per-claim identifier for the email leg (companion email
    // safeguards): forwarded to the reminder email so the send carries
    // the claim id in its log row and message headers.
    emailClaimId?: string | null;
    emailAttemptCount?: number | null;
  } = {}
) {
  const writer = createSupabaseAdminClient() || supabase;
  const preferenceKey = communicationPreferenceForNotificationType(payload.type || "");
  if (preferenceKey && payload.tripId) {
    const preferences = await getCompanionPreferencesForDelivery({ supabase: writer, userId, tripId: payload.tripId });
    if (!preferences) return { ok: false, sent: 0, failed: 0, error: "COMMUNICATION_PREFERENCES_UNAVAILABLE" };
    if (!preferences[preferenceKey]) return { ok: true, sent: 0, failed: 0, suppressed: true, error: "COMMUNICATION_PREFERENCE_DISABLED" };
  }
  const actionScopedPayload = payload.type === "activity_start"
    ? { ...payload, appleMapsUrl: null, googleMapsUrl: null, citymapperUrl: null }
    : payload.type === "next_activity"
      ? { ...payload, checkInUrl: null, skipUrl: null }
      : payload;
  const securedPayload = await secureNotificationPayload(writer, actionScopedPayload);
  const configured = configureWebPush();
  const existingNotificationId = options.notificationId ? String(options.notificationId).trim() : "";
  const createNotification = options.createNotification !== false;
  const notification = existingNotificationId
    ? { data: { id: existingNotificationId }, error: null }
    : !createNotification
      ? { data: null, error: null }
    : await createInAppNotification(writer, {
        userId,
        tripId: securedPayload.tripId || null,
        eventId: payload.eventId || null,
        type: securedPayload.type || "trip_reminder",
        title: securedPayload.title,
        body: securedPayload.body || null,
        actionUrl: securedPayload.actionUrl || null,
        status: "unread",
        metadata: { pushConfigured: configured, pushStatus: configured ? "pending" : "not_configured" }
      });
  const notificationId = notification.data?.id || null;
  if (existingNotificationId) {
    await writer
      .from("roamly_notifications")
      .update({
        push_status: configured ? "pending" : "not_configured",
        push_error: null
      })
      .eq("id", existingNotificationId)
      .eq("user_id", userId);
  }
  const emailResult =
    options.sendEmail !== false && notificationId
      ? await sendTripReminderEmail({
          userId,
          tripId: securedPayload.tripId || null,
          notificationId,
          emailClaimId: options.emailClaimId || null,
          emailAttemptCount: options.emailAttemptCount || null
        }).catch((error) => ({
          ok: false,
          status: "failed" as const,
          error:
            error instanceof Error
              ? error.message
              : "Email reminder failed."
        }))
      : null;
  if (!configured) {
    if (notification.data?.id) {
      await writer
        .from("roamly_notifications")
        .update({ push_status: "not_configured", push_error: "Web push is not configured." })
        .eq("id", notification.data.id);
    }
    return { ok: false, error: "Web push is not configured.", notification, emailResult };
  }

  let subscriptionsQuery = writer
    .from("roamly_push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (options.subscriptionIds?.length) subscriptionsQuery = subscriptionsQuery.in("id", options.subscriptionIds);
  const { data: subscriptions, error } = await subscriptionsQuery;
  if (error) {
    if (notification.data?.id) {
      await writer.from("roamly_notifications").update({ push_status: "failed", push_error: error.message }).eq("id", notification.data.id);
    }
    return { ok: false, error: error.message, notification, emailResult };
  }

  if (!subscriptions?.length) {
    if (notification.data?.id) {
      await writer
        .from("roamly_notifications")
        .update({ push_status: "no_subscription", push_error: "No push subscription found." })
        .eq("id", notification.data.id);
    }
    return { ok: false, error: "No push subscription found.", sent: 0, failed: 0, notification, emailResult };
  }

  const validSubscriptions = subscriptions.filter((subscription) => normalizePushEndpoint(subscription.endpoint));
  const invalidSubscriptionIds = subscriptions
    .filter((subscription) => !normalizePushEndpoint(subscription.endpoint))
    .map((subscription) => subscription.id);
  if (invalidSubscriptionIds.length) {
    await writer.from("roamly_push_subscriptions")
      .update({ enabled: false })
      .eq("user_id", userId)
      .in("id", invalidSubscriptionIds);
  }
  if (!validSubscriptions.length) {
    if (notification.data?.id) {
      await writer.from("roamly_notifications")
        .update({ push_status: "no_subscription", push_error: "No supported push subscription found." })
        .eq("id", notification.data.id)
        .eq("user_id", userId);
    }
    return { ok: false, error: "No supported push subscription found.", sent: 0, failed: 0, notification, emailResult };
  }

  const body = JSON.stringify({
    title: securedPayload.title,
    body: securedPayload.body || "",
    tripId: securedPayload.tripId || null,
    eventId: securedPayload.eventId || null,
    eventType: securedPayload.type || null,
    activityId: securedPayload.activityId || securedPayload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1] || null,
    tag: securedPayload.tag || (securedPayload.tripId && (securedPayload.activityId || securedPayload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1])
      ? `roamly-activity-${securedPayload.tripId}-${securedPayload.activityId || securedPayload.actionUrl?.match(/[?&]activity=([^&]+)/)?.[1]}`
      : null),
    actionUrl: securedPayload.actionUrl || "/notifications",
    appleMapsUrl: securedPayload.appleMapsUrl || null,
    googleMapsUrl: securedPayload.googleMapsUrl || null,
    citymapperUrl: securedPayload.citymapperUrl || null,
    checkInUrl: securedPayload.checkInUrl || null,
    skipUrl: securedPayload.skipUrl || null
  });

  const results = await Promise.all(validSubscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: normalizePushEndpoint(subscription.endpoint)!, keys: { p256dh: subscription.p256dh || "", auth: subscription.auth || "" } },
        body
      );
      return { ok: true as const, subscription };
    } catch (error) {
      return { ok: false as const, subscription, error };
    }
  }));

  const failed = results.filter((result) => !result.ok).length;
  const expiredEndpoints = results.filter((result) => !result.ok && isExpiredSubscriptionError(result.error)).map((result) => result.subscription.endpoint);
  if (expiredEndpoints.length) {
    await writer.from("roamly_push_subscriptions").update({ enabled: false }).in("endpoint", expiredEndpoints);
  }
  if (notification.data?.id) {
    const firstFailure = results.find((result) => !result.ok);
    await writer
      .from("roamly_notifications")
      .update({
        sent_at: failed < results.length ? new Date().toISOString() : null,
        push_status: failed < results.length ? "sent" : "failed",
        push_error:
          firstFailure && !firstFailure.ok
            ? firstFailure.error instanceof Error
              ? firstFailure.error.message
              : String(firstFailure.error)
            : null
      })
      .eq("id", notification.data.id);
  }
  return { ok: failed < results.length, failed, sent: results.length - failed, notification, emailResult };
}

export async function markNotificationRead(supabase: SupabaseClient, userId: string, notificationId: string) {
  return supabase
    .from("roamly_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);
}

export async function disablePushSubscription(supabase: SupabaseClient, userId: string, endpoint: string) {
  return supabase
    .from("roamly_push_subscriptions")
    .update({ enabled: false })
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
}

/*
 * Retry discipline for the scheduled-trip scheduler: a push failure used
 * to reschedule the event (+10 min) with no attempt cap, and every retry
 * minted a NEW roamly_notifications row — one row per ~15-min queue run,
 * feeding the 9+ badge forever. Now the in-app row is minted once and
 * reused on retry, and push retries stop after this many attempts: the
 * in-app row already exists by then, so push is best-effort after that
 * and the event is marked shown instead of looping. Scheduling times,
 * delivery semantics and email behavior are unchanged.
 */
export const SCHEDULED_PUSH_MAX_ATTEMPTS = 3;

export async function sendScheduledTripNotifications() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "Supabase service role is not configured." };

  // Resolve interrupted email deliveries from durable evidence before
  // any new send decision (completes accepted claims exactly once,
  // releases proven-unsent stale claims, holds ambiguous ones).
  // Visibility round 2026-10-31: the sweep's counts used to be discarded
  // here. They are now logged AND recorded as an app event (the same
  // channel the admin surfaces read), so held ambiguous claims have a
  // run-level count an operator can see without raw dispatcher logs.
  const reconciliation = await reconcileCompanionEmailDeliveries(supabase);
  console.info(
    `[roamly-notifications] EMAIL_RECONCILIATION completed=${reconciliation.completed} released=${reconciliation.released} failed=${reconciliation.failed} held=${reconciliation.held}`
  );
  try {
    await recordAppEvent(supabase, {
      eventType: "companion_email_reconciliation",
      path: "/api/cron/roamly-notifications",
      metadata: { ...reconciliation }
    });
  } catch {
    // Observability must never break dispatch.
  }

  const now = new Date().toISOString();
  const { data: events, error } = await supabase
    .from("roamly_trip_companion_events")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);

  if (error) return { ok: false, error: error.message };
  let sent = 0;
  let claimFailures = 0;
  const emailedTrips = new Set<string>();
  for (const event of events || []) {
    const claimed = await supabase
      .from("roamly_trip_companion_events")
      .update({ status: "processing" })
      .eq("id", event.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();

    if (claimed.error || !claimed.data) {
      if (claimed.error) {
        // A failed claim (e.g. a status CHECK violation) must never be
        // invisible again: log it and count it in the run summary. A
        // claim that simply matched no row (another run claimed the
        // event first) carries no error and stays a quiet skip.
        claimFailures += 1;
        console.error(
          `[roamly-notifications] Failed to claim companion event ${event.id}: [${claimed.error.code || "unknown"}] ${claimed.error.message || "Unknown claim error."}`
        );
      }
      continue;
    }

    const tripResult = event.trip_id
      ? await supabase
          .from("roamly_trips")
          .select("id,user_id,start_date,end_date,status,tracking_unlocked,live_companion_unlocked,trip_companion_status,metadata,destination,destination_name,destination_city")
          .eq("id", event.trip_id)
          .eq("user_id", event.user_id)
          .maybeSingle()
      : { data: null, error: null };
    if (event.trip_id && tripResult.error) {
      await supabase.from("roamly_trip_companion_events")
        .update({ status: "scheduled", scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() })
        .eq("id", event.id).eq("status", "processing");
      continue;
    }
    if (event.trip_id) {
      const lifecycle = await loadCompanionTripLifecycle(supabase, {
        tripId: event.trip_id,
        userId: event.user_id
      });
      if (lifecycle.state === "unavailable") {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "scheduled", scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
      if (lifecycle.state === "inactive") {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "cancelled", completed_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
    }
    if (event.trip_id && (!tripResult.data?.tracking_unlocked && !tripResult.data?.live_companion_unlocked)) {
      await supabase
        .from("roamly_trip_companion_events")
        .update({ status: "skipped", completed_at: new Date().toISOString() })
        .eq("id", event.id);
      continue;
    }

    // Notification-timezone round (2026-10-27): the completed-trip
    // gate uses the SAME resolution as Live/Alerts (metadata, then
    // the verified destination registry via the trip record — this
    // select previously carried no destination and the gate read a
    // raw, unvalidated metadata timezone). An unknown zone SKIPS the
    // gate instead of completing/cancelling a trip on a guessed
    // window: the event's send time was already fixed at schedule
    // time, so the gate must not destroy state it cannot verify.
    const gateResolution = event.trip_id && tripResult.data ? resolveBackgroundTripTimezone(tripResult.data as { metadata?: unknown; destination?: string | null; destination_name?: string | null; destination_city?: string | null }) : null;
    if (event.trip_id && gateResolution?.zone && tripWindowState({
      startDate: tripResult.data?.start_date,
      endDate: tripResult.data?.end_date,
      timezone: gateResolution.zone,
      now: new Date()
    }) === "completed_trip") {
      await supabase.from("roamly_trips").update({ status: "completed", trip_companion_status: "completed" }).eq("id", event.trip_id);
      await supabase.from("roamly_trip_companion_events").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", event.id);
      continue;
    }
    if (event.booking_id && !event.trip_id) {
      await supabase.from("roamly_trip_companion_events")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", event.id).eq("status", "processing");
      continue;
    }
    if (event.booking_id && event.trip_id) {
      const bookingResult = await supabase
        .from("roamly_bookings")
        .select("id,user_id,trip_id,superseded_by_booking_id,booking_status")
        .eq("id", event.booking_id)
        .eq("user_id", event.user_id)
        .eq("trip_id", event.trip_id)
        .maybeSingle();
      if (bookingResult.error) {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "scheduled", scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
      const bookingState = bookingLinkedDeliveryState({
        delivery: { booking_id: event.booking_id, user_id: event.user_id, trip_id: event.trip_id },
        bookings: bookingResult.data ? [bookingResult.data] : [],
        currentBookingIds: bookingResult.data && isOperationalCurrentBooking(bookingResult.data) &&
          !["cancelled", "refunded"].includes(String(bookingResult.data.booking_status || "").trim().toLowerCase())
          ? new Set([bookingResult.data.id])
          : new Set()
      });
      if (bookingState === "stale") {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "cancelled", completed_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
    }
    if (event.trip_id) {
      const preferences = await getCompanionPreferences({ supabase, userId: event.user_id, tripId: event.trip_id });
      if (!preferences.liveCompanionEnabled) {
        await supabase.from("roamly_trip_companion_events").update({ status: "skipped", completed_at: new Date().toISOString() }).eq("id", event.id);
        continue;
      }
      if (preferences.liveCompanionPausedUntil && new Date(preferences.liveCompanionPausedUntil).getTime() > Date.now()) {
        await supabase.from("roamly_trip_companion_events").update({ status: "scheduled", scheduled_for: preferences.liveCompanionPausedUntil }).eq("id", event.id).eq("status", "processing");
        continue;
      }

      const lifecycle = await loadCompanionTripLifecycle(supabase, {
        tripId: event.trip_id,
        userId: event.user_id
      });
      if (lifecycle.state === "unavailable") {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "scheduled", scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
      if (lifecycle.state === "inactive") {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "cancelled", completed_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
    }

    const eventMetadata = event.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {};
    // Working copy: delivery-state markers persisted during this run are
    // merged in so the terminal write never drops them.
    let workingMetadata: Record<string, unknown> = { ...eventMetadata };
    const activityId = typeof eventMetadata.activityId === "string"
      ? eventMetadata.activityId
      : typeof eventMetadata.activity_id === "string"
        ? eventMetadata.activity_id
        : null;
    const priorEmailAttempts = companionEventEmailAttempts(eventMetadata);
    const emailAlreadySent = companionEventEmailSent(eventMetadata);
    const emailCollapsed = eventMetadata.emailCollapsed === true;
    const tripEmailKey = event.trip_id ? `${event.user_id}:${event.trip_id}` : null;
    let emailSuppressedByCollapse = false;
    const liveEventTypes = new Set(["nearby_activity", "up_next_activity", "departure_reminder", "running_late", "arrival_detected"]);
    const liveNotificationType = event.event_type === "up_next_activity"
      ? "next_activity"
      : event.event_type === "departure_reminder"
        ? "leave_by"
        : event.event_type === "running_late"
          ? "late"
          : event.event_type === "arrival_detected"
            ? "arrival"
            : event.event_type;

    let delivery;
    let priorPushAttempts = 0;
    let emailDeliveryResult: unknown = null;
    let activeEmailClaimId: string | null = null;
    let emailClaimFailed = false;
    let holdClaimId: string | null = null;
    if (event.trip_id && activityId && liveEventTypes.has(event.event_type)) {
      const { liveCompanionNotificationIdentity, queueCompanionNotification, sendCompanionNotificationDelivery } = await import("@/lib/roamly/companionNotifications");
      const queued = await queueCompanionNotification({
        supabase,
        userId: event.user_id,
        tripId: event.trip_id,
        companionEventId: event.id,
        type: liveNotificationType as "nearby_activity" | "next_activity" | "leave_by" | "late" | "arrival",
        priority: "routine",
        title: event.title || "Roamly reminder",
        body: event.body,
        actionUrl: `/trip/${event.trip_id}/live?activity=${encodeURIComponent(activityId)}`,
        metadata: { ...eventMetadata, activityId, send_email: false, source: "scheduler" },
        idempotencyKey: liveCompanionNotificationIdentity({
          userId: event.user_id,
          tripId: event.trip_id,
          activityId,
          eventType: liveNotificationType
        }),
        dedupeParts: [liveCompanionNotificationIdentity({
          userId: event.user_id,
          tripId: event.trip_id,
          activityId,
          eventType: liveNotificationType
        })]
      });
      delivery = queued.ok && queued.delivery?.id
        ? await sendCompanionNotificationDelivery(queued.delivery.id)
        : queued;
      if (queued.ok && "suppressed" in queued && queued.suppressed) {
        await supabase.from("roamly_trip_companion_events")
          .update({ status: "cancelled", completed_at: new Date().toISOString() })
          .eq("id", event.id).eq("status", "processing");
        continue;
      }
    } else {
      // Persisted trip-level collapse (2026-10-30): the in-memory
      // emailedTrips set only covers THIS run. The persisted state —
      // a coexisting sibling's delivered emailSentAt, or a live claim on
      // the trip's email slot — covers every later run, including for
      // siblings that were not due (or not in the fetched window) during
      // the run that sent the trip's email.
      const tripAlreadyEmailedInRun = tripEmailKey ? emailedTrips.has(tripEmailKey) : false;
      let tripEmailBlocked = tripAlreadyEmailedInRun;
      let blockReason: CompanionTripEmailBlockReason = tripAlreadyEmailedInRun ? "delivered" : null;
      let previousClaimEventId: string | null = null;
      let previousClaimId: string | null = null;
      if (tripEmailKey && event.trip_id && !tripEmailBlocked) {
        const tripMetadata = tripResult.data ? metadataRecord(tripResult.data.metadata) : {};
        previousClaimEventId =
          typeof tripMetadata[TRIP_EMAIL_CLAIM_METADATA_KEY] === "string"
            ? (tripMetadata[TRIP_EMAIL_CLAIM_METADATA_KEY] as string)
            : null;
        const observedDelivery = companionEmailDeliveryRecord(tripMetadata);
        previousClaimId = observedDelivery?.claimId || null;
        const tripEvents = await loadCompanionTripEvents(supabase, event.user_id, event.trip_id);
        if (!tripEvents) {
          // Ownership state could not be established: FAIL CLOSED
          // (safeguards). No send of any kind; the event is rescheduled
          // retryable below and a later run can retry the claim.
          emailClaimFailed = true;
          console.error(
            `[roamly-notifications] ${COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON} trip=${event.trip_id} event=${event.id} stage=trip_events_load`
          );
        } else {
          const block = companionTripEmailBlock({
            eventId: event.id,
            eventCreatedAt: event.created_at,
            tripEvents,
            claimEventId: previousClaimEventId,
            delivery: observedDelivery,
            nowMs: Date.now()
          });
          if (block.blocked) {
            tripEmailBlocked = true;
            blockReason = block.blockReason;
            holdClaimId = observedDelivery?.claimId || null;
          }
        }
      }
      // This event's OWN unknown outcome also holds it: an event left
      // in_flight/ambiguous by an interrupted run must never resend —
      // only reconciliation may resolve its claim.
      if (
        !tripEmailBlocked &&
        (eventMetadata.emailDeliveryState === "ambiguous" || eventMetadata.emailDeliveryState === "in_flight")
      ) {
        tripEmailBlocked = true;
        blockReason = "ambiguous_hold";
      }
      // Suppression by a DELIVERED generation is permanent. Suppression
      // by a live claim is marked provisionally (provenance = the
      // blocking claim): final if that claim delivers, reverted if it
      // resolves failed/released. An AMBIGUOUS hold never marks: the
      // outcome is unknown, so nothing permanent may be written from it.
      emailSuppressedByCollapse = tripEmailBlocked && blockReason !== "ambiguous_hold";
      let emailAllowed =
        !emailClaimFailed &&
        companionEventEmailAllowed({
          attempts: priorEmailAttempts,
          emailSent: emailAlreadySent,
          collapsed: emailCollapsed,
          tripAlreadyEmailed: tripEmailBlocked
        });
      if (emailAllowed && tripEmailKey && event.trip_id && tripResult.data) {
        // Claim the trip's email slot (compare-and-swap) BEFORE the
        // provider is called, so a concurrent dispatcher run processing
        // a sibling of this trip right now loses the race and stays
        // silent instead of sending a second email for the burst. The
        // claim persists the durable delivery record ("claimed" + a
        // unique per-claim identifier). A clean lost race holds the
        // email for this run; an infrastructure error FAILS CLOSED.
        const claim = await claimCompanionTripEmailSlot({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          eventId: event.id,
          previousClaimEventId,
          previousClaimId
        });
        if (claim.outcome === "blocked") {
          emailAllowed = false;
          // Learn the winning claim's id for the provisional collapse
          // marker's provenance — unless that claim already resolved as
          // failed/released, in which case this event keeps its right
          // and must not be marked at all.
          const { data: freshTrip } = await supabase
            .from("roamly_trips")
            .select("metadata")
            .eq("id", event.trip_id)
            .eq("user_id", event.user_id)
            .maybeSingle();
          const freshDelivery = freshTrip ? companionEmailDeliveryRecord(freshTrip.metadata) : null;
          if (freshDelivery && freshDelivery.state !== "provider_failed" && freshDelivery.state !== "released") {
            emailSuppressedByCollapse = true;
            holdClaimId = freshDelivery.claimId;
          }
        } else if (claim.outcome === "error") {
          emailAllowed = false;
          emailClaimFailed = true;
        } else {
          activeEmailClaimId = claim.claimId;
          // Persist the claimed marker on the event BEFORE the provider
          // call; if this write fails, fail closed (no send).
          const markerPersisted = await persistCompanionEventDeliveryMarker({
            supabase,
            eventId: event.id,
            baseMetadata: workingMetadata,
            state: "claimed",
            claimId: claim.claimId!,
            claimedAt: claim.claimedAt!
          });
          if (!markerPersisted) {
            emailAllowed = false;
            emailClaimFailed = true;
            activeEmailClaimId = null;
          } else {
            workingMetadata = {
              ...workingMetadata,
              emailDeliveryState: "claimed",
              emailClaimId: claim.claimId,
              emailClaimedAt: claim.claimedAt
            };
          }
        }
      }
      if (emailClaimFailed) {
        // Fail closed: no push, no in-app row, no email. The event goes
        // back to scheduled with the stable reason recorded, so a later
        // run retries the whole delivery once the claim path recovers.
        await supabase
          .from("roamly_trip_companion_events")
          .update({
            status: "scheduled",
            scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString(),
            metadata: {
              ...workingMetadata,
              emailLastClaimError: COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON,
              emailLastClaimErrorAt: new Date().toISOString()
            }
          })
          .eq("id", event.id)
          .eq("status", "processing");
        continue;
      }
      // Attempt cap: once the cap is reached the in-app row from the
      // first attempt already carries the reminder, so stop looping and
      // mark the event shown instead of rescheduling it again. The one
      // exception is the event that delivered the trip's email: its
      // retries are push-only by design (Defect 5 — push keeps retrying
      // on the emailed event), so the cap never retires it.
      priorPushAttempts = typeof eventMetadata.pushAttempts === "number" && Number.isFinite(eventMetadata.pushAttempts)
        ? eventMetadata.pushAttempts
        : 0;
      if (!emailAlreadySent && priorPushAttempts >= SCHEDULED_PUSH_MAX_ATTEMPTS) {
        await supabase
          .from("roamly_trip_companion_events")
          .update({ status: "shown", completed_at: new Date().toISOString() })
          .eq("id", event.id)
          .eq("status", "processing");
        continue;
      }
      // Idempotent in-app row: reuse the row minted on the first attempt
      // instead of inserting a new roamly_notifications row per retry.
      const existingNotification = await supabase
        .from("roamly_notifications")
        .select("id")
        .eq("user_id", event.user_id)
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (emailAllowed && activeEmailClaimId && event.trip_id) {
        // Persist the in-flight marker IMMEDIATELY before the provider
        // call: a later run that finds this marker knows the call's
        // outcome was never persisted (ambiguous) — while a record that
        // never got this marker provably never reached the provider.
        const flightPersisted = await persistCompanionEventDeliveryMarker({
          supabase,
          eventId: event.id,
          baseMetadata: workingMetadata,
          state: "in_flight",
          claimId: activeEmailClaimId,
          claimedAt: typeof workingMetadata.emailClaimedAt === "string" ? workingMetadata.emailClaimedAt : new Date().toISOString()
        });
        if (!flightPersisted) {
          await supabase
            .from("roamly_trip_companion_events")
            .update({
              status: "scheduled",
              scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString(),
              metadata: {
                ...workingMetadata,
                emailLastClaimError: COMPANION_EMAIL_CLAIM_UNAVAILABLE_REASON,
                emailLastClaimErrorAt: new Date().toISOString()
              }
            })
            .eq("id", event.id)
            .eq("status", "processing");
          continue;
        }
        workingMetadata = {
          ...workingMetadata,
          emailDeliveryState: "in_flight",
          emailProviderCallStartedAt: new Date().toISOString()
        };
        await transitionCompanionTripEmailDelivery({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          claimId: activeEmailClaimId,
          patch: { state: "in_flight" }
        });
      }
      delivery = await sendPushNotification(supabase, event.user_id, {
      title: event.title || "Roamly reminder",
      body: event.body,
      // A tap lands on the single-event view — that one event, its
      // details, nothing else (owner alert model, 2026-10-23).
      actionUrl: event.trip_id ? `/trip/${event.trip_id}/event/${event.id}` : "/notifications",
      type: event.event_type,
      tripId: event.trip_id,
      eventId: event.id
      }, {
        sendEmail: emailAllowed,
        notificationId: existingNotification.data?.id || null,
        emailClaimId: activeEmailClaimId,
        emailAttemptCount: priorEmailAttempts + 1
      });
      emailDeliveryResult = "emailResult" in delivery ? delivery.emailResult : null;
    }
    const pushAccepted = "sent" in delivery
      ? delivery.ok && (delivery.sent ?? 0) > 0
      : delivery.ok;
    // One shared email-metadata patch for both terminal paths: the stamp
    // (on provider-confirmed delivery), the attempt count, and the
    // collapse marker must survive whether push was accepted or not.
    const emailAttempted = Boolean(emailDeliveryResult);
    const emailOutcome = classifyCompanionEmailResult(emailDeliveryResult);
    const emailDelivered = emailOutcome === "accepted";
    const emailPatch = companionEventEmailMetadataPatch({
      emailAttempted,
      emailDelivered,
      emailSuppressedByCollapse,
      emailCollapsed,
      priorEmailAttempts,
      deliveryState: !emailAttempted
        ? null
        : emailDelivered
          ? "provider_accepted"
          : emailOutcome === "ambiguous"
            ? "ambiguous"
            : "provider_failed",
      claimId: emailAttempted ? activeEmailClaimId : null,
      collapseClaimId: holdClaimId
    });
    if (emailAttempted && activeEmailClaimId && event.trip_id) {
      // Persist the outcome on the trip's durable delivery record. If
      // this write (or the terminal write below) is lost to a crash,
      // reconciliation rebuilds the same state from the email-log row
      // bearing the claim id — the record is never the only evidence.
      if (emailDelivered) {
        await transitionCompanionTripEmailDelivery({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          claimId: activeEmailClaimId,
          patch: {
            state: "provider_accepted",
            emailSentAt: typeof emailPatch.emailSentAt === "string" ? emailPatch.emailSentAt : new Date().toISOString()
          }
        });
      } else if (emailOutcome === "ambiguous") {
        await transitionCompanionTripEmailDelivery({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          claimId: activeEmailClaimId,
          patch: { state: "ambiguous", lastError: "provider_outcome_unknown" }
        });
        console.error(
          `[roamly-notifications] ${COMPANION_EMAIL_DELIVERY_AMBIGUOUS_REASON} trip=${event.trip_id} event=${event.id} claim=${activeEmailClaimId} — provider outcome unknown; slot held, no resend, no stamp`
        );
      } else {
        await transitionCompanionTripEmailDelivery({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          claimId: activeEmailClaimId,
          patch: {
            state: "provider_failed",
            lastError:
              emailDeliveryResult && typeof emailDeliveryResult === "object" && "error" in emailDeliveryResult
                ? String((emailDeliveryResult as { error?: unknown }).error || "provider_failed")
                : "provider_failed"
          }
        });
        // The generation provably never delivered: give provisionally
        // collapsed siblings their email right back.
        await uncollapseCompanionTripEmailSiblingsForClaim({
          supabase,
          userId: event.user_id,
          tripId: event.trip_id,
          claimId: activeEmailClaimId
        });
      }
    }
    if (emailDelivered && tripEmailKey) {
      // Only a DELIVERED send claims the trip for this run (a failed or
      // ambiguous attempt must not suppress a sibling's own attempt).
      emailedTrips.add(tripEmailKey);
    }
    if (emailDelivered && event.trip_id) {
      // The delivery claims the whole burst, persistently: every other
      // still-scheduled sibling for this trip is marked emailCollapsed
      // now, whether or not it was due in this run.
      await collapseCompanionTripEmailSiblings({
        supabase,
        userId: event.user_id,
        tripId: event.trip_id,
        emailedEventId: event.id,
        deliveredAt: typeof emailPatch.emailSentAt === "string" ? emailPatch.emailSentAt : null
      });
    }
    if (pushAccepted) {
      sent += 1;
      await supabase
        .from("roamly_trip_companion_events")
        .update({
          status: "shown",
          completed_at: new Date().toISOString(),
          ...(Object.keys(emailPatch).length ? { metadata: { ...workingMetadata, ...emailPatch } } : {})
        })
        .eq("id", event.id)
        .eq("status", "processing");
    } else {
      const nextMetadata = { ...workingMetadata, pushAttempts: priorPushAttempts + 1, ...emailPatch };
      await supabase
        .from("roamly_trip_companion_events")
        .update({
          status: "scheduled",
          scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString(),
          metadata: nextMetadata
        })
        .eq("id", event.id)
        .eq("status", "processing");
    }
  }
  return { ok: true, processed: (events || []).length, sent, claimFailures };
}
