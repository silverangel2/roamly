import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPurchaseActivationEmailModel, purchaseActivationLogicalKey } from "../lib/roamly/purchaseActivationContent.ts";

const first = purchaseActivationLogicalKey("user-1", "trip-1", "cs_123");
assert.equal(purchaseActivationLogicalKey("user-1", "trip-1", "cs_123"), first, "same checkout reuses one logical identity");
assert.notEqual(purchaseActivationLogicalKey("user-1", "trip-1", "cs_456"), first, "separate checkout occurrence is distinct");
assert.notEqual(purchaseActivationLogicalKey("user-1", "trip-2", "cs_123"), first, "separate trip is distinct");
assert.notEqual(purchaseActivationLogicalKey("user-2", "trip-1", "cs_123"), first, "separate user is distinct");

const rendered = buildPurchaseActivationEmailModel({
  destination: "Montreal",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  features: ["Custom itinerary planning", "Live Trip Companion"],
  liveCompanion: "Included and activated",
  gmailStatus: "Connected",
  tripId: "trip-1",
  appUrl: "https://roamlyhq.com"
});
assert.match(rendered.subject, /trip is activated/i, "activation subject is transactional");
assert.equal(rendered.ctaLabel, "View my trip");
assert.match(JSON.stringify(rendered.summaryItems), /Live Companion/);
assert.match(JSON.stringify(rendered.summaryItems), /Booking email connection.*Connected/);
assert.doesNotMatch(JSON.stringify(rendered), /stripe|supabase|oauth|token|authorization|payment_intent/i, "email omits internal and secret data");
assert.equal(rendered.tripPath, "/trip/trip-1");
const disconnected = buildPurchaseActivationEmailModel({
  destination: "Tokyo",
  features: ["Custom itinerary planning"],
  liveCompanion: "Not included",
  gmailStatus: "Not connected",
  tripId: "trip-2"
});
assert.match(disconnected.intro, /connect your booking email/i, "disconnected Gmail has one useful next-step instruction");

const billing = await readFile("lib/roamly/billing.ts", "utf8");
const communication = await readFile("lib/roamly/purchaseActivationCommunication.ts", "utf8");
assert.match(billing, /checkout\.session\.completed/);
assert.match(billing, /await sendPurchaseActivationCommunication/);
assert.match(communication, /claimCommunication/);
assert.match(communication, /completeCommunication/);
assert.match(communication, /failCommunication/);
assert.match(communication, /PURCHASE_INVALIDATED_BEFORE_SEND/);
assert.match(communication, /uncertainAcceptance/);
assert.match(communication, /stripe_checkout_session_id/);

console.log("Purchase activation communication checks passed.");
