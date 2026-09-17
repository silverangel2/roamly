import crypto from "node:crypto";

export type BookingEvidencePayload = Record<string, unknown>;

function tokenSecret() {
  return process.env.ROAMLY_SESSION_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createBookingEvidenceToken(params: { userId: string; tripId: string; booking: BookingEvidencePayload }) {
  const secret = tokenSecret();
  if (!secret) return "";
  const payload = encode(JSON.stringify({ userId: params.userId, tripId: params.tripId, exp: Date.now() + 15 * 60 * 1000, booking: params.booking }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyBookingEvidenceToken(token: string, params: { userId: string; tripId: string }) {
  const secret = tokenSecret();
  if (!secret || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; tripId?: string; exp?: number; booking?: BookingEvidencePayload };
    if (parsed.userId !== params.userId || parsed.tripId !== params.tripId || typeof parsed.exp !== "number" || parsed.exp < Date.now() || !parsed.booking) return null;
    return parsed.booking;
  } catch {
    return null;
  }
}
