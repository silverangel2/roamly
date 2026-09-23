import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const MAX_CONTACT_REQUEST_BYTES = 12_288;

export function trustedContactClientIp(forwardedFor: string | null) {
  if (typeof forwardedFor !== "string" || forwardedFor.length > 256) return null;
  const candidate = forwardedFor.split(",", 1)[0].trim();
  return isIP(candidate) ? candidate : null;
}

export function contactActorHash(ip: string, secret: string | undefined) {
  if (!isIP(ip) || !secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`roamly-contact-rate-v1:${ip}`).digest("hex");
}

export function isSameOriginContactRequest(origin: string | null, expectedOrigin: string, fetchSite: string | null) {
  if (fetchSite?.toLowerCase() === "cross-site") return false;
  return origin === expectedOrigin;
}

export function isContactRequestWithinLimit(rawBody: string, declaredLength: string | null) {
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_CONTACT_REQUEST_BYTES) return false;
  }
  return new TextEncoder().encode(rawBody).byteLength <= MAX_CONTACT_REQUEST_BYTES;
}
