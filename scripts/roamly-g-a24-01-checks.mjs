import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { readFile } from "node:fs/promises";
import { createBookingEvidenceToken, verifyBookingEvidenceToken } from "../lib/roamly/bookingEvidenceToken.ts";
import jiti from "jiti";

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveRoamlyAlias(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(process.cwd(), request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

const load = jiti(import.meta.url, { interopDefault: true });
const { normalizeExtractedBooking } = load("../lib/roamly/bookings.ts");
const { serializeTripBookingRecord } = load("../lib/roamly/bookingWallet.ts");

process.env.ROAMLY_SESSION_TOKEN_SECRET = "local-only-g-a24-01-secret";

const extracted = normalizeExtractedBooking({
  booking_type: "flight",
  provider_name: "Example Air",
  title: "Example flight",
  confirmation_number: "ABC123",
  origin: "YUL",
  destination: "YYZ",
  start_date: "2026-10-01",
  raw_extracted_text: "PRIVATE SCREENSHOT TRANSCRIPT",
  metadata: {
    raw_text: "PRIVATE NESTED TRANSCRIPT",
    sourceReference: "upload:test"
  },
  extraction_confidence: "high"
});

assert.equal(extracted.provider_name, "Example Air");
assert.equal(extracted.confirmation_number, "ABC123");
assert.equal(extracted.origin, "YUL");
assert.equal(extracted.destination, "YYZ");
assert.equal("raw_extracted_text" in extracted, false);
assert.equal("raw_text" in extracted.metadata, false);
assert.equal(extracted.metadata.sourceReference, "upload:test");

const evidenceToken = createBookingEvidenceToken({
  userId: "user-1",
  tripId: "trip-1",
  booking: extracted
});
assert.ok(evidenceToken);
const tokenPayload = JSON.parse(Buffer.from(evidenceToken.split(".")[0], "base64url").toString("utf8"));
assert.equal("raw_extracted_text" in tokenPayload.booking, false);
assert.equal("raw_text" in tokenPayload.booking.metadata, false);
assert.equal(verifyBookingEvidenceToken(evidenceToken, { userId: "user-1", tripId: "trip-1" }).confirmation_number, "ABC123");

const serialized = serializeTripBookingRecord({
  id: "booking-1",
  user_id: "user-1",
  trip_id: "trip-1",
  booking_type: "flight",
  booking_status: "confirmed",
  provider_name: "Example Air",
  provider_booking_id: "provider-1",
  confirmation_number: "ABC123",
  title: "Example flight",
  origin: "YUL",
  destination: "YYZ",
  raw_extracted_text: "PRIVATE LEGACY TRANSCRIPT",
  metadata: {
    rawExtractedText: "PRIVATE LEGACY METADATA TRANSCRIPT",
    recommendationId: "recommendation-1",
    airlineCode: "EA"
  },
  reservation_requirements: {
    baggage: "1 carry-on",
    raw_extracted_text: "PRIVATE LEGACY REQUIREMENTS TRANSCRIPT"
  },
  created_at: "2026-09-28T00:00:00.000Z",
  updated_at: "2026-09-28T00:00:00.000Z"
});

assert.equal(serialized.confirmation_code, "ABC123");
assert.equal(serialized.provider, "Example Air");
assert.equal(serialized.recommendation_id, "recommendation-1");
assert.equal(serialized.reservation_requirements.baggage, "1 carry-on");
assert.equal("raw_extracted_text" in serialized, false);
assert.equal("metadata" in serialized, false);
assert.equal("rawExtractedText" in serialized.reservation_requirements, false);

const [extractRoute, confirmRoute, bookingRoute, bookingWallet] = await Promise.all([
  readFile(new URL("../app/api/roamly/bookings/extract/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/bookings/confirm/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/bookings/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/bookingWallet.ts", import.meta.url), "utf8")
]);
assert.doesNotMatch(extractRoute, /rawExtractedText|raw_extracted_text/);
assert.doesNotMatch(confirmRoute, /rawExtractedText|raw_extracted_text/);
assert.doesNotMatch(bookingRoute, /select\("\*"\)/);
assert.match(bookingRoute, /listTripBookings/);
assert.match(bookingWallet, /export function serializeTripBookingRecord/);

console.log("G-A24-01 booking evidence minimization checks passed.");
