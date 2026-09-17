import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.ROAMLY_SESSION_TOKEN_SECRET = "local-only-booking-evidence-secret";
const { createBookingEvidenceToken, verifyBookingEvidenceToken } = await import("../lib/roamly/bookingEvidenceToken.ts");
const booking = { booking_type: "flight", confirmation_number: "ABC123" };
const token = createBookingEvidenceToken({ userId: "user-1", tripId: "trip-1", booking });

assert.ok(token);
assert.deepEqual(verifyBookingEvidenceToken(token, { userId: "user-1", tripId: "trip-1" }), booking);
assert.equal(verifyBookingEvidenceToken(`${token}x`, { userId: "user-1", tripId: "trip-1" }), null);
assert.equal(verifyBookingEvidenceToken(token.split(".")[0], { userId: "user-1", tripId: "trip-1" }), null);
assert.equal(verifyBookingEvidenceToken(token, { userId: "user-2", tripId: "trip-1" }), null);
assert.equal(verifyBookingEvidenceToken(token, { userId: "user-1", tripId: "trip-2" }), null);

const expiredPayload = Buffer.from(JSON.stringify({ userId: "user-1", tripId: "trip-1", exp: Date.now() - 1, booking }), "utf8").toString("base64url");
const expiredSignature = crypto.createHmac("sha256", process.env.ROAMLY_SESSION_TOKEN_SECRET).update(expiredPayload).digest("base64url");
assert.equal(verifyBookingEvidenceToken(`${expiredPayload}.${expiredSignature}`, { userId: "user-1", tripId: "trip-1" }), null);

console.log("Booking evidence token behavioral checks passed (tamper, signature, ownership, and expiry rejection).");
