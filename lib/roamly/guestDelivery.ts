import crypto from "node:crypto";

/*
 * Guest delivery email (owner law, 2026-10-24): the free itinerary is
 * generated first, and when day 1 is ready the guest page asks "where do
 * I send the rest?" The saved email is three things at once:
 *
 *   1. the delivery address for the rest of the itinerary (sent once,
 *      when the itinerary becomes ready — see the guest-itinerary GET),
 *   2. the one-free-per-email key: a second guest trip cannot claim an
 *      email that already has a free itinerary (409, with a recovery
 *      hint instead of a second free trip), and
 *   3. the magic-link recovery key for cookie loss: the traveler enters
 *      the email, Roamly sends a signed link, and the link restores the
 *      trip in any browser (fresh 7-day cookie).
 *
 * Everything lives in the trip row's existing metadata JSON — no
 * migration. The email is never sent anything the traveler didn't ask
 * for: the delivery email carries their own itinerary, and the recovery
 * email only goes out on an explicit recovery request.
 */

export const GUEST_DELIVERY_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GUEST_DELIVERY_EMAIL_KEY = "guestDeliveryEmail";
export const GUEST_DELIVERY_SAVED_AT_KEY = "guestDeliveryEmailSavedAt";
export const GUEST_DELIVERY_SENT_AT_KEY = "guestDeliverySentAt";

const RECOVERY_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type RecoveryTokenPayload = {
  purpose: "roamly_guest_recovery";
  tripId: string;
  userId: string;
  exp: number;
};

function tokenSecret(): string {
  return process.env.ROAMLY_SESSION_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isValidGuestDeliveryEmail(email: string): boolean {
  return GUEST_DELIVERY_EMAIL_PATTERN.test(email.trim());
}

export function normalizeGuestDeliveryEmail(email: string): string {
  return email.trim().toLowerCase();
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

export function readGuestDeliveryEmail(metadata: unknown): string | null {
  const record = metadataRecord(metadata);
  const value = record?.[GUEST_DELIVERY_EMAIL_KEY];
  return typeof value === "string" && value.trim() ? value : null;
}

export function readGuestDeliverySentAt(metadata: unknown): string | null {
  const record = metadataRecord(metadata);
  const value = record?.[GUEST_DELIVERY_SENT_AT_KEY];
  return typeof value === "string" && value.trim() ? value : null;
}

/** Merge a delivery email into trip metadata, preserving every other key. */
export function withGuestDeliveryEmail(metadata: unknown, email: string): Record<string, unknown> {
  const record = metadataRecord(metadata);
  return {
    ...(record ?? {}),
    [GUEST_DELIVERY_EMAIL_KEY]: normalizeGuestDeliveryEmail(email),
    [GUEST_DELIVERY_SAVED_AT_KEY]: new Date().toISOString()
  };
}

/** Stamp the delivery-sent flag so the ready email goes out exactly once. */
export function withGuestDeliverySent(metadata: unknown): Record<string, unknown> {
  const record = metadataRecord(metadata);
  return {
    ...(record ?? {}),
    [GUEST_DELIVERY_SENT_AT_KEY]: new Date().toISOString()
  };
}

type GuestDeliveryRow = {
  id: string;
  metadata: unknown;
};

/**
 * The one-free-per-email key, as a pure function over candidate rows:
 * returns the OTHER guest trip already holding this email, or null.
 * The route runs this over rows matched by metadata email; the check
 * script covers it with fake rows.
 */
export function findConflictingGuestDeliveryEmail(
  rows: GuestDeliveryRow[],
  tripId: string,
  email: string
): GuestDeliveryRow | null {
  const wanted = normalizeGuestDeliveryEmail(email);
  for (const row of rows) {
    if (row.id === tripId) continue;
    const held = readGuestDeliveryEmail(row.metadata);
    if (held && normalizeGuestDeliveryEmail(held) === wanted) return row;
  }
  return null;
}

export function signGuestRecoveryToken(tripId: string, userId: string): string {
  const secret = tokenSecret();
  const cleanTripId = tripId.trim();
  const cleanUserId = userId.trim();
  if (!secret || !cleanTripId || !cleanUserId) return "";
  const payload: RecoveryTokenPayload = {
    purpose: "roamly_guest_recovery",
    tripId: cleanTripId,
    userId: cleanUserId,
    exp: Math.floor(Date.now() / 1000) + RECOVERY_TOKEN_TTL_SECONDS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyGuestRecoveryToken(token: string | null | undefined): { tripId: string; userId: string } | null {
  const secret = tokenSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;
  if (!timingSafeEqual(signature, signPayload(encodedPayload, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<RecoveryTokenPayload>;
    if (payload.purpose !== "roamly_guest_recovery") return null;
    if (!payload.tripId || !payload.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { tripId: payload.tripId, userId: payload.userId };
  } catch {
    return null;
  }
}

export function guestRecoveryUrl(token: string): string {
  return `https://roamlyhq.com/api/trips/guest-itinerary/recover?token=${encodeURIComponent(token)}`;
}
