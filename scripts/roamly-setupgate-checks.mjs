#!/usr/bin/env node
/* Setup-gate law checks (owner law, 2026-10-24): second-time trigger,
 * preview + skip path, day-1-ready email capture, one-free-per-email
 * keying, magic-link recovery, and disclosure copy. Run: npm run
 * test:setupgate. Pure-function tests use the real modules; UI wiring
 * is proven by structural assertions over the shipped source so a
 * future refactor that drops a block fails loudly here.
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.ROAMLY_SESSION_TOKEN_SECRET = "setupgate-check-secret";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { setupGateApplies, setupGateLimitedFeatures } = await import("../lib/roamly/setupGate.ts");
const guestDelivery = await import("../lib/roamly/guestDelivery.ts");

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function src(rel) {
  return readFileSync(join(root, rel), "utf8");
}
function fullState(overrides = {}) {
  return {
    gmailConnected: true,
    gmailEmail: "a@b.c",
    gmailOnce: true,
    appInstalledOnce: true,
    locationGranted: true,
    locationOnce: true,
    locationEnabled: true,
    complete: true,
    ...overrides
  };
}

// --- 1. Second-time trigger truth table -----------------------------------
check("gate: first trip, setup incomplete -> NO gate", setupGateApplies({ setupComplete: false, hasQaAccess: false, hasPriorTrip: false }) === false);
check("gate: second trip, setup incomplete -> gate", setupGateApplies({ setupComplete: false, hasQaAccess: false, hasPriorTrip: true }) === true);
check("gate: second trip, setup complete -> NO gate", setupGateApplies({ setupComplete: true, hasQaAccess: false, hasPriorTrip: true }) === false);
check("gate: second trip, QA tester -> NO gate (tester-only bypass)", setupGateApplies({ setupComplete: false, hasQaAccess: true, hasPriorTrip: true }) === false);
check("gate: first trip, setup complete -> NO gate", setupGateApplies({ setupComplete: true, hasQaAccess: false, hasPriorTrip: false }) === false);

// --- 2. Limited features use CURRENT capability ---------------------------
check("limits: everything works -> none", setupGateLimitedFeatures(fullState()).length === 0);
const allMissing = setupGateLimitedFeatures(fullState({ gmailConnected: false, gmailOnce: false, appInstalledOnce: false, locationGranted: false, locationOnce: false, locationEnabled: false, complete: false }));
check("limits: all missing -> 3 named", allMissing.length === 3 && allMissing.some((s) => s.includes("Booking Recon")) && allMissing.some((s) => s.includes("Live Companion alerts")) && allMissing.some((s) => s.includes("Companion goes live")));
const gmailOnceButOff = setupGateLimitedFeatures(fullState({ gmailConnected: false, gmailOnce: true, complete: false }));
check("limits: Gmail done once but disconnected -> Booking Recon still limited", gmailOnceButOff.includes("Booking Recon — needs Gmail"));
const locationOff = setupGateLimitedFeatures(fullState({ locationGranted: true, locationOnce: true, locationEnabled: false, complete: false }));
check("limits: location granted but switched off -> companion limited", locationOff.includes("Companion goes live — needs location"));

// --- 3. Guest delivery email: validation, merge, keying --------------------
check("email: valid accepted", guestDelivery.isValidGuestDeliveryEmail("Junel@Example.COM") === true);
check("email: missing @ rejected", guestDelivery.isValidGuestDeliveryEmail("notanemail") === false);
check("email: missing domain rejected", guestDelivery.isValidGuestDeliveryEmail("a@b") === false);
check("email: normalize lowercases+trims", guestDelivery.normalizeGuestDeliveryEmail("  A@B.COM ") === "a@b.com");
const merged = guestDelivery.withGuestDeliveryEmail({ generation: { stage: "x" }, other: 1 }, "Guest@Example.com");
check("email: merge preserves other keys", merged.generation.stage === "x" && merged.other === 1);
check("email: merge stores normalized + savedAt", merged.guestDeliveryEmail === "guest@example.com" && typeof merged.guestDeliveryEmailSavedAt === "string");
check("email: read back", guestDelivery.readGuestDeliveryEmail(merged) === "guest@example.com");
check("email: read absent -> null", guestDelivery.readGuestDeliveryEmail({}) === null && guestDelivery.readGuestDeliveryEmail(null) === null);
const stamped = guestDelivery.withGuestDeliverySent(merged);
check("email: sent flag stamped, email kept", guestDelivery.readGuestDeliverySentAt(stamped) !== null && guestDelivery.readGuestDeliveryEmail(stamped) === "guest@example.com");
const rows = [
  { id: "trip-1", metadata: { guestDeliveryEmail: "a@example.com" } },
  { id: "trip-2", metadata: { guestDeliveryEmail: "b@example.com" } }
];
check("keying: same trip re-save -> no conflict", guestDelivery.findConflictingGuestDeliveryEmail(rows, "trip-1", "a@example.com") === null);
check("keying: other trip same email -> conflict row", guestDelivery.findConflictingGuestDeliveryEmail(rows, "trip-9", "a@example.com")?.id === "trip-1");
check("keying: other trip same email, different case -> conflict", guestDelivery.findConflictingGuestDeliveryEmail(rows, "trip-9", "A@EXAMPLE.COM")?.id === "trip-1");
check("keying: unused email -> no conflict", guestDelivery.findConflictingGuestDeliveryEmail(rows, "trip-9", "c@example.com") === null);

// --- 4. Recovery token ------------------------------------------------------
const token = guestDelivery.signGuestRecoveryToken("trip-1", "user-1");
check("token: signs", typeof token === "string" && token.includes("."));
const verified = guestDelivery.verifyGuestRecoveryToken(token);
check("token: verifies round-trip", verified?.tripId === "trip-1" && verified?.userId === "user-1");
const tampered = `${token.slice(0, -2)}xx`;
check("token: tampered rejected", guestDelivery.verifyGuestRecoveryToken(tampered) === null);
check("token: garbage rejected", guestDelivery.verifyGuestRecoveryToken("not-a-token") === null);
// Wrong-purpose token (same secret, cookie purpose) must NOT verify as recovery.
const cookiePayload = Buffer.from(JSON.stringify({ purpose: "roamly_guest_itinerary", tripId: "trip-1", userId: "user-1", exp: Math.floor(Date.now() / 1000) + 9999 }), "utf8").toString("base64url");
const cookieSig = createHmac("sha256", "setupgate-check-secret").update(cookiePayload).digest("base64url");
check("token: cookie-purpose token rejected as recovery", guestDelivery.verifyGuestRecoveryToken(`${cookiePayload}.${cookieSig}`) === null);
// Expired token rejected.
const expiredPayload = Buffer.from(JSON.stringify({ purpose: "roamly_guest_recovery", tripId: "trip-1", userId: "user-1", exp: Math.floor(Date.now() / 1000) - 60 }), "utf8").toString("base64url");
const expiredSig = createHmac("sha256", "setupgate-check-secret").update(expiredPayload).digest("base64url");
check("token: expired rejected", guestDelivery.verifyGuestRecoveryToken(`${expiredPayload}.${expiredSig}`) === null);
check("token: recovery URL shape", guestDelivery.guestRecoveryUrl(token).startsWith("https://roamlyhq.com/api/trips/guest-itinerary/recover?token="));

// --- 5. Structural wiring ----------------------------------------------------
const guest = src("components/plan/GuestFreeItinerary.tsx");
check("ui: day-1-ready email question present", guest.includes("Where do I send the rest?"));
check("ui: email capture gated on day 1 viewable", guest.indexOf("itinerary.days.length >= 1") !== -1 && guest.indexOf("itinerary.days.length >= 1") < guest.indexOf("data-guest-delivery-email"));
check("ui: email capture does NOT render before days exist (no capture outside the days gate)", !guest.includes("data-guest-delivery-email") || guest.indexOf("data-guest-delivery-email") > guest.indexOf("itinerary.days.length >= 1"));
check("ui: delivery-saved quiet line", guest.includes("data-guest-delivery-saved") && guest.includes("We'll send the rest to"));
check("ui: recovery form on cookie loss", guest.includes("data-guest-recovery") && guest.includes("Send me the link"));
check("ui: companion sign-in requirement in words", guest.includes("Live Companion needs an account"));
const companionOfferAt = guest.indexOf("data-guest-live-companion-offer");
check("ui: companion wording lives inside the ready-only offer", companionOfferAt !== -1 && guest.indexOf("Live Companion needs an account") > companionOfferAt);

const gate = src("components/roamly/TripSetupGate.tsx");
check("ui: gate shows preview day count", gate.includes("dayCount") && gate.includes("saved and waiting behind these steps"));
check("ui: gate has skip-for-now path", gate.includes("Skip for now") && gate.includes("skipHref"));
check("ui: gate names limited features", gate.includes("limitedFeatures"));

const tripPage = src("app/trip/[id]/page.tsx");
check("ui: trip page uses prior-trip trigger", tripPage.includes("hasPriorTrip") && tripPage.includes("setupGateApplies"));
check("ui: trip page honors skip param", tripPage.includes("skipSetupGate") && tripPage.includes("Showing with limited features"));
check("ui: trip page QA bypass intact", tripPage.includes("hasQaAccess: access.hasQaAccess"));

const livePage = src("app/trip/[id]/live/page.tsx");
check("ui: live page uses same trigger + skip", livePage.includes("hasPriorTrip") && livePage.includes("skipSetupGate"));

const planPage = src("app/plan/page.tsx");
check("ui: plan page computes second-time notice", planPage.includes("secondTimeGateNotice") && planPage.includes("hasAnyTrip"));
const form = src("components/plan/TripPlanForm.tsx");
check("ui: plan form discloses gate before generation", form.includes("secondTimeGateNotice") && form.includes("opens behind three quick setup steps"));

const emailRoute = src("app/api/trips/guest-itinerary/email/route.ts");
check("ui: email route enforces one-free-per-email", emailRoute.includes("GUEST_EMAIL_ALREADY_USED") && emailRoute.includes("409"));
const recoverRoute = src("app/api/trips/guest-itinerary/recover/route.ts");
check("ui: recovery endpoint answers generically (no existence leak)", recoverRoute.includes("If that email has a free itinerary"));
const guestRoute = src("app/api/trips/guest-itinerary/route.ts");
check("ui: guest GET returns delivery email + sends once", guestRoute.includes("deliveryEmail") && guestRoute.includes("readGuestDeliverySentAt"));

const ph = src("app/ph/page.tsx");
check("ui: /ph states samples do not carry over", ph.includes("exact stops") && ph.includes("carried over"));

console.log(`\nsetupgate checks: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`FAILURES:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
