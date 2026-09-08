export const PURCHASE_ACTIVATION_GRACE_MS = 15 * 60 * 1000;
export const GENERATION_SCHEDULER_CADENCE_MS = 5 * 60 * 1000;
export const GENERATION_MAX_RETRIES = 3;

export type PurchaseActivationCandidate = {
  status?: string | null;
  billing_state?: string | null;
  purchase_type?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

export type ActivationTripState = {
  status?: string | null;
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
  tracking_unlocked?: boolean | null;
  tracking_unlock_source?: string | null;
  live_companion_unlocked?: boolean | null;
};

const INACTIVE_TRIP_STATUSES = new Set(["archived", "cancelled", "completed"]);

function validTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function purchaseActivationAgeMs(purchase: PurchaseActivationCandidate, nowMs: number) {
  const paidAt = validTime(purchase.paid_at) ?? validTime(purchase.created_at);
  return paidAt === null ? null : Math.max(0, nowMs - paidAt);
}

export function purchaseActivationIsEligible(
  purchase: PurchaseActivationCandidate,
  trip: ActivationTripState | null | undefined,
  nowMs: number,
  graceMs = PURCHASE_ACTIVATION_GRACE_MS
) {
  if (!trip || purchase.status !== "paid") return false;
  if (["refunded", "disputed", "revoked"].includes(purchase.billing_state || "")) return false;
  if (!purchase.purchase_type || !["itinerary_unlock", "tracking_addon", "bundle"].includes(purchase.purchase_type)) return false;
  if (INACTIVE_TRIP_STATUSES.has(trip.status || "")) return false;
  const age = purchaseActivationAgeMs(purchase, nowMs);
  return age !== null && age >= graceMs;
}

export function activationStateIsCorrect(purchase: PurchaseActivationCandidate, trip: ActivationTripState) {
  if (purchase.purchase_type === "tracking_addon") {
    return trip.tracking_unlocked === true && trip.tracking_unlock_source === "paid" && trip.live_companion_unlocked === true;
  }
  const itinerary = purchase.purchase_type === "bundle"
    ? trip.itinerary_payment_status === "bundled" && trip.itinerary_unlock_source === "bundle"
    : trip.itinerary_payment_status === "paid" && trip.itinerary_unlock_source === "paid";
  if (!itinerary) return false;
  if (purchase.purchase_type === "bundle") {
    return trip.tracking_unlocked === true && trip.tracking_unlock_source === "bundle" && trip.live_companion_unlocked === true;
  }
  return true;
}

export type GenerationDetectorJob = {
  id?: string;
  status?: string | null;
  retry_count?: number | null;
  next_attempt_at?: string | null;
  lease_expires_at?: string | null;
  completed_at?: string | null;
  dead_lettered_at?: string | null;
};

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
}

export type GenerationStuckReason = "expired_lease" | "retry_exhausted" | "overdue_retry";

export function generationStuckReason(
  job: GenerationDetectorJob,
  nowMs: number,
  cadenceMs = GENERATION_SCHEDULER_CADENCE_MS,
  maxRetries = GENERATION_MAX_RETRIES
): GenerationStuckReason | null {
  if (job.completed_at || job.status === "completed" || job.status === "cancelled") return null;
  if (job.status === "running") {
    const lease = timestamp(job.lease_expires_at);
    return lease !== null && nowMs >= lease + cadenceMs ? "expired_lease" : null;
  }
  if (job.status === "failed" && (job.dead_lettered_at || (job.retry_count || 0) >= maxRetries)) return "retry_exhausted";
  if (["queued", "waiting", "failed"].includes(job.status || "")) {
    const nextAttempt = timestamp(job.next_attempt_at);
    return nextAttempt !== null && nowMs >= nextAttempt + cadenceMs ? "overdue_retry" : null;
  }
  return null;
}

export function generationTripIsComplete(trip: { status?: string | null; itinerary_status?: string | null; itinerary_generated_at?: string | null } | null | undefined) {
  return Boolean(trip && (trip.itinerary_generated_at || trip.itinerary_status === "generated" || trip.status === "completed"));
}
