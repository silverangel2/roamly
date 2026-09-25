import crypto from "node:crypto";

export const GUEST_ITINERARY_COOKIE = "roamly_guest_itinerary";
export const GUEST_ITINERARY_TTL_SECONDS = 7 * 24 * 60 * 60;

type GuestItineraryCookiePayload = {
  purpose: "roamly_guest_itinerary";
  tripId: string;
  userId: string;
  exp: number;
};

function tokenSecret() {
  return process.env.ROAMLY_SESSION_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function signPayload(encodedPayload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function guestItineraryCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_ITINERARY_TTL_SECONDS
  };
}

export function signGuestItineraryCookie(tripId: string, userId: string) {
  const secret = tokenSecret();
  const cleanTripId = tripId.trim();
  const cleanUserId = userId.trim();
  if (!secret || !cleanTripId || !cleanUserId) return "";

  const payload: GuestItineraryCookiePayload = {
    purpose: "roamly_guest_itinerary",
    tripId: cleanTripId,
    userId: cleanUserId,
    exp: Math.floor(Date.now() / 1000) + GUEST_ITINERARY_TTL_SECONDS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyGuestItineraryCookie(token: string | null | undefined) {
  const secret = tokenSecret();
  if (!secret || !token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || token.split(".").length !== 2) return null;
  if (!timingSafeEqual(signature, signPayload(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<GuestItineraryCookiePayload>;
    if (payload.purpose !== "roamly_guest_itinerary") return null;
    if (!payload.tripId || !payload.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { tripId: payload.tripId, userId: payload.userId };
  } catch {
    return null;
  }
}
