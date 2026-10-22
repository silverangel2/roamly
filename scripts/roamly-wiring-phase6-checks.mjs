// Phase 6 checks (DESIGN-PRODUCTION.md Phase 6 proof):
//   A — the shadow entry-gates proof (26/26) re-run against the WIRED
//       TS gate machine (lib/roamly/gateMachine.ts): install popup,
//       minimize-never-clears, self-report flips nothing, denied
//       blocks with ALERTS_REQUIRED, re-check path, Gmail-only refusal,
//       desktop carries no gate, handoff descriptor law.
//   B — server attestation (gateService.ts): evidence evaluation into
//       the Phase 1 GateStateDTO; READY only with detected install +
//       granted alerts + a server-verified push subscription; the
//       DTO parser's READY/consent laws hold against forged records.
//   C — generate-route enforcement (enforceGenerationGate): flag off
//       inert; desktop no gate; mobile without attestation refused
//       (INSTALL_REQUIRED, then ALERTS_REQUIRED once installed);
//       green attestation passes.
//   D — handoff pass lifecycle (handoffTokens.ts + in-memory M6
//       store): mint stores hash only (10-min TTL); first redemption
//       binds + burns; second refused (used); expired refused;
//       tampered signature refused WITHOUT burning; session cookie
//       verifies and is trip-bound.
//   E — statics: enforcement wired into the generate route; the gate
//       components are mobile-gated; migrations carry the READY law
//       and the hash-only token store.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  ALERTS_BANNER_LINE,
  ALERTS_BLOCK_MESSAGE,
  EMAIL_REFUSAL_MESSAGE,
  GMAIL_ONLY_MESSAGE,
  INSTALL_BLOCK_MESSAGE,
  createEmailGate,
  createFlowGuard,
  createInstallGate,
  desktopHandoff
} from "@/lib/roamly/gateMachine.ts";
import {
  InMemoryGateStore,
  enforceGenerationGate,
  evaluateGateEvidence
} from "@/lib/roamly/gateService.ts";
import {
  HANDOFF_TTL_MS,
  InMemoryHandoffStore,
  createHandoffSessionCookieValue,
  mintHandoffPass,
  redeemHandoffPass,
  verifyHandoffSessionCookie
} from "@/lib/roamly/handoffTokens.ts";
import { isHandoffTokenDTO, parseGateStateDTO } from "@/lib/roamly/engine/types.ts";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  if (!cond) console.error(`FAIL ${results.length}. ${name} ${detail}`);
  else console.log(`ok ${results.length}. ${name}`);
}

const AT = "2026-10-21T18:52:00.000Z";

/* ================= A — the shadow 26, against the wired machine ===== */

const iosInstall = createInstallGate({ platform: "ios" });
const iosEmail = createEmailGate();
const iosGuard = createFlowGuard({ installGate: iosInstall, emailGate: iosEmail, device: "mobile" });

iosInstall.dispatch({ type: "enter" });
assert("A1 install: entering the mobile flow presents the persistent popup (PROMPT, sheet)",
  iosInstall.state === "PROMPT" && iosInstall.surface === "sheet");

let step = iosGuard.canProceedToItinerary();
assert("A2 install: itinerary flow is BLOCKED before install, reason INSTALL_REQUIRED",
  step.status === "BLOCKED" && step.proceeds === false && step.reason === "INSTALL_REQUIRED" && step.message === INSTALL_BLOCK_MESSAGE);

iosInstall.dispatch({ type: "tapLater" });
assert("A3 install: Later minimizes to the banner and the gate STAYS red",
  iosInstall.state === "MINIMIZED" && iosInstall.surface === "banner" && iosInstall.bannerLine() === "Install Roamly to continue"
  && !iosInstall.isGreen() && iosGuard.canProceedToItinerary().status === "BLOCKED");

iosInstall.dispatch({ type: "tapBanner" });
assert("A4 install: tapping the banner reopens the popup — dismissal never clears the gate",
  iosInstall.state === "PROMPT" && iosInstall.surface === "sheet");

iosInstall.dispatch({ type: "tapInstall" });
assert("A5 install: iPhone path is GUIDED with numbered steps, flow still blocked",
  iosInstall.state === "GUIDED" && iosInstall.guidedKind === "numbered-steps"
  && iosGuard.canProceedToItinerary().status === "BLOCKED");

const selfReport = iosInstall.dispatch({ type: "selfReportInstalled" });
assert("A6 install: self-report (\"I installed it\") does NOT flip the gate — detection only",
  selfReport.flipped === false && selfReport.reason === "DETECTION_REQUIRED" && iosInstall.state === "GUIDED");

iosInstall.dispatch({ type: "standaloneDetected" });
assert("A7 install: standalone detection passes through INSTALLED_DETECTED to NOTIFY_ASK",
  iosInstall.history.includes("INSTALLED_DETECTED") && iosInstall.state === "NOTIFY_ASK");

iosInstall.dispatch({ type: "notifyGranted" });
assert("A8 install+alerts: alerts granted -> READY, gate green",
  iosInstall.state === "READY" && iosInstall.alerts === true && iosInstall.isGreen());

const andInstall = createInstallGate({ platform: "android", nativePromptAvailable: true });
const andEmail = createEmailGate();
const andGuard = createFlowGuard({ installGate: andInstall, emailGate: andEmail, device: "mobile" });
andInstall.dispatch({ type: "enter" });
andInstall.dispatch({ type: "tapInstall" });
assert("A9 install: Android with a native prompt available is GUIDED via the native prompt",
  andInstall.state === "GUIDED" && andInstall.guidedKind === "native-prompt");

andInstall.dispatch({ type: "standaloneDetected" });
const denied = andInstall.dispatch({ type: "notifyDenied" });
step = andGuard.canProceedToItinerary();
assert("A10 alerts: DENIED -> NOTIFY_DENIED — gate stays RED, flow BLOCKED (no READY)",
  andInstall.state === "NOTIFY_DENIED" && andInstall.alerts === false && denied.green === false
  && !andInstall.isGreen() && step.status === "BLOCKED" && step.proceeds === false);

assert("A11 alerts: proceed is impossible in NOTIFY_DENIED — reason ALERTS_REQUIRED with the plain message",
  step.reason === "ALERTS_REQUIRED" && step.message === ALERTS_BLOCK_MESSAGE);

andInstall.dispatch({ type: "tapSettingsSteps" });
step = andGuard.canProceedToItinerary();
assert("A12 alerts: guided-enable shows the phone-settings path and the gate stays blocked",
  andInstall.state === "GUIDED_ENABLE" && andInstall.settingsPath().includes("Settings")
  && step.status === "BLOCKED" && step.reason === "ALERTS_REQUIRED");

const selfAlerts = andInstall.dispatch({ type: "selfReportAlertsOn" });
assert("A13 alerts: self-report (\"I turned them on\") flips NOTHING — a permission re-check is required",
  selfAlerts.flipped === false && selfAlerts.reason === "PERMISSION_STATE_REQUIRED"
  && andInstall.state === "GUIDED_ENABLE" && !andInstall.isGreen());

const recheckDenied = andInstall.dispatch({ type: "permissionRecheck", permission: "denied" });
step = andGuard.canProceedToItinerary();
assert("A14 alerts: re-check with permission STILL denied at OS level -> still blocked, no workaround",
  recheckDenied.flipped === false && recheckDenied.alerts === false && !andInstall.isGreen()
  && step.status === "BLOCKED" && step.reason === "ALERTS_REQUIRED");

andInstall.dispatch({ type: "tapLater" });
step = andGuard.canProceedToItinerary();
assert("A15 alerts: Later on the alerts step minimizes to the persistent banner — \"Turn on trip alerts to continue\"",
  andInstall.state === "MINIMIZED" && andInstall.surface === "banner"
  && andInstall.bannerLine() === ALERTS_BANNER_LINE && !andInstall.isGreen()
  && step.status === "BLOCKED" && step.reason === "ALERTS_REQUIRED");

andInstall.dispatch({ type: "tapBanner" });
assert("A16 alerts: tapping the banner reopens the alerts step in its blocked (denied) form",
  andInstall.state === "NOTIFY_DENIED" && andInstall.surface === "sheet" && !andInstall.isGreen());

const recheckGranted = andInstall.dispatch({ type: "permissionRecheck", permission: "granted" });
step = andGuard.canProceedToItinerary();
assert("A17 alerts: re-check reading GRANTED from the platform permission state -> READY, flow proceeds",
  recheckGranted.flipped === true && andInstall.state === "READY" && andInstall.alerts === true
  && andInstall.isGreen() && step.status === "OK" && step.proceeds === true);

const refusal1 = iosGuard.attemptReconciliationLeg({ facts: [{ kind: "flight" }] });
assert("A18 gmail: reconciliation leg REFUSES while no Gmail is connected — Gmail-specific plain message, zero facts run",
  refusal1.ran === false && refusal1.aligned === 0 && refusal1.refusal === EMAIL_REFUSAL_MESSAGE
  && refusal1.refusal.includes("Gmail") && /booking confirmations only/.test(refusal1.refusal));

iosEmail.dispatch({ type: "ask" });
iosEmail.dispatch({ type: "decline" });
assert("A19 gmail: declining returns to NOT_CONNECTED and the refusal stands",
  iosEmail.state === "NOT_CONNECTED" && iosGuard.canRunReconciliation().ok === false);

const altAttempt = iosEmail.dispatch({ type: "connect", provider: "outlook", at: AT });
assert("A20 gmail: provider is FIXED to Gmail (Google OAuth) — an Outlook connect attempt is refused GMAIL_ONLY and the gate does not move",
  iosEmail.provider === "gmail" && iosEmail.providerOptions.length === 1 && iosEmail.providerOptions[0] === "gmail"
  && iosEmail.authMethod === "google-oauth" && altAttempt.refused === true && altAttempt.reason === "GMAIL_ONLY"
  && altAttempt.message === GMAIL_ONLY_MESSAGE && iosEmail.state === "NOT_CONNECTED" && !iosEmail.isGreen());

iosEmail.dispatch({ type: "ask" });
iosEmail.dispatch({ type: "connect", at: AT });
assert("A21 gmail: connecting Gmail records consent scoped to booking confirmations only in Gmail, then arms reconciliation",
  iosEmail.consent?.scope === "booking-confirmations-only-in-gmail" && iosEmail.consent?.provider === "gmail"
  && iosEmail.consent?.recordedAt === AT && iosEmail.state === "RECONCILIATION_ARMED" && iosEmail.isGreen());

step = iosGuard.canProceedToItinerary();
const leg = iosGuard.attemptReconciliationLeg({ facts: [{ kind: "flight", ref: "AC1847" }, { kind: "hotel", ref: "HL-2214" }] });
assert("A22 all gates green: the itinerary proceeds AND the owner chain first leg runs (2 facts aligned)",
  step.status === "OK" && step.proceeds === true && leg.ran === true && leg.aligned === 2);

const deskInstall = createInstallGate({ platform: "desktop" });
const deskGuard = createFlowGuard({ installGate: deskInstall, emailGate: createEmailGate(), device: "desktop" });
const deskStep = deskGuard.canProceedToItinerary();
assert("A23 desktop: NO install gate in desktop planning — companion unavailable there, gate applies on mobile",
  deskStep.status === "NO_INSTALL_GATE_ON_DESKTOP" && deskStep.proceeds === true
  && deskStep.companionAvailable === false && deskStep.companionGateAppliesOn === "mobile");

const deskEnter = deskInstall.dispatch({ type: "enter" });
assert("A24 desktop: the install/gate surface never presents on desktop (no popup, no banner)",
  deskEnter.applicable === false && deskInstall.state === "NOT_INSTALLED" && deskInstall.surface === "none");

const handoff = desktopHandoff("trip:halifax-2026-10-23");
assert("A25 desktop handoff: planning ends with QR + emailed link, no companion UI on desktop, gates run on the phone",
  handoff.surface === "desktop-planning" && handoff.companionUiOnDesktop === false
  && handoff.channels.includes("qr-code") && handoff.channels.includes("emailed-link")
  && handoff.gatesRunOn === "mobile" && handoff.serverSideRegardless.includes("reconciliation"));

assert("A26 qr pass: signed, short-lived (minutes), single-use token bound to account + trip; scan binds the phone session even if never signed in; fallbacks = emailed link to the connected Gmail, then plain sign-in",
  handoff.qrPass.token.signed === true && handoff.qrPass.token.singleUse === true
  && handoff.qrPass.token.burnsAfterFirstUse === true && handoff.qrPass.token.ttlMinutes > 0 && handoff.qrPass.token.ttlMinutes < 60
  && handoff.qrPass.token.boundTo.includes("account") && handoff.qrPass.token.boundTo.includes("trip")
  && handoff.qrPass.shownAt.includes("end-of-desktop-planning") && handoff.qrPass.shownAt.includes("desktop-trip-page")
  && /never signed in/.test(handoff.qrPass.onScan) && /fresh code/.test(handoff.qrPass.expiredOrUsed)
  && /Gmail/.test(handoff.qrPass.fallbacksInOrder[0]) && /sign-in/.test(handoff.qrPass.fallbacksInOrder[1])
  && handoff.emailedLinkTo === "connected-gmail" && handoff.postTripReviewEmailTo === "connected-gmail");

/* ================= B — server attestation =========================== */

const NOW = "2026-10-21T22:00:00.000Z";
const gmailNone = { state: "NOT_CONNECTED", connectionRef: null, grantedScope: null, emailAddress: null, syncInitialized: false };
const gmailArmed = {
  state: "RECONCILIATION_ARMED",
  connectionRef: "conn-1",
  grantedScope: "https://www.googleapis.com/auth/gmail.readonly",
  emailAddress: "traveler@gmail.com",
  syncInitialized: true
};

const storeB = new InMemoryGateStore();
let record = await evaluateGateEvidence(storeB, {
  userId: "user-1", deviceId: "dev-1", platform: "ios",
  evidence: { standaloneDetected: false, notificationPermission: "default" },
  gmail: gmailNone, now: NOW
});
assert("B1 attestation: no standalone detection -> NOT_INSTALLED record, valid DTO, flow not allowed",
  record.installState === "NOT_INSTALLED" && record.flowAllowed === false && parseGateStateDTO(record).ok);

record = await evaluateGateEvidence(storeB, {
  userId: "user-1", deviceId: "dev-1", platform: "ios",
  evidence: { standaloneDetected: true, notificationPermission: "granted", pushEndpoint: "https://push.example/1" },
  gmail: gmailNone, now: NOW
});
assert("B2 attestation: granted claim WITHOUT a server-side push subscription does NOT turn green (NOTIFY_ASK)",
  record.installState === "NOTIFY_ASK" && record.flowAllowed === false && record.installDetectedAt === NOW);

storeB.seedSubscription("user-1", "https://push.example/1");
record = await evaluateGateEvidence(storeB, {
  userId: "user-1", deviceId: "dev-1", platform: "ios",
  evidence: { standaloneDetected: true, notificationPermission: "granted", pushEndpoint: "https://push.example/1" },
  gmail: gmailArmed, now: NOW
});
assert("B3 attestation: detected install + granted + verified subscription -> READY, flow allowed, install time kept",
  record.installState === "READY" && record.flowAllowed === true && record.installDetectedAt === NOW
  && record.alertsPermission === "granted" && parseGateStateDTO(record).ok);
assert("B4 attestation: armed Gmail refresh records the consent scope + connection ref on the gate record",
  record.gmailState === "RECONCILIATION_ARMED" && record.gmailConsentScope === "booking-confirmations-only-in-gmail"
  && record.gmailConnectionRef === "conn-1");

const storeB2 = new InMemoryGateStore();
const deniedRecord = await evaluateGateEvidence(storeB2, {
  userId: "user-2", deviceId: "dev-2", platform: "android",
  evidence: { standaloneDetected: true, notificationPermission: "denied" },
  gmail: gmailNone, now: NOW
});
assert("B5 attestation: denied permission -> NOTIFY_DENIED, red, alerts recorded as denied",
  deniedRecord.installState === "NOTIFY_DENIED" && deniedRecord.flowAllowed === false && deniedRecord.alertsPermission === "denied");

const forgedReady = parseGateStateDTO({
  userId: "u", deviceId: "d", platform: "ios", installState: "READY",
  alertsPermission: "granted", alertsCheckedAt: NOW, installDetectedAt: null,
  gmailState: "NOT_CONNECTED", gmailConnectionRef: null, gmailConsentScope: null,
  flowAllowed: true, updatedAt: NOW
});
assert("B6 DTO law: a forged READY record without a detected install is invalid on its face",
  forgedReady.ok === false);

const forgedArmed = parseGateStateDTO({
  userId: "u", deviceId: "d", platform: "ios", installState: "NOT_INSTALLED",
  alertsPermission: null, alertsCheckedAt: null, installDetectedAt: null,
  gmailState: "RECONCILIATION_ARMED", gmailConnectionRef: "c", gmailConsentScope: null,
  flowAllowed: false, updatedAt: NOW
});
assert("B7 DTO law: RECONCILIATION_ARMED without a recorded consent scope is invalid",
  forgedArmed.ok === false);

/* ================= C — generate-route enforcement =================== */

const FLAG_ON = { ROAMLY_BUILD2_GATES_ENABLED: "true" };
const storeC = new InMemoryGateStore();

let decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "mobile", deviceId: "dev-9" }, env: {} });
assert("C1 enforcement: flag OFF -> mobile flow passes (inert, pre-Build-2 behavior)", decision.ok === true);

decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "desktop", deviceId: null }, env: FLAG_ON });
assert("C2 enforcement: desktop flow carries NO gate even with the flag on", decision.ok === true);

decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: null, env: FLAG_ON });
assert("C3 enforcement: legacy request without flow context carries no gate", decision.ok === true);

decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "mobile", deviceId: null }, env: FLAG_ON });
assert("C4 enforcement: mobile flow with no device id is refused INSTALL_REQUIRED (403)",
  decision.ok === false && decision.error === "INSTALL_REQUIRED" && decision.status === 403);

decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "mobile", deviceId: "dev-9" }, env: FLAG_ON });
assert("C5 enforcement: mobile flow with no attestation on file is refused INSTALL_REQUIRED",
  decision.ok === false && decision.error === "INSTALL_REQUIRED");

await evaluateGateEvidence(storeC, {
  userId: "user-9", deviceId: "dev-9", platform: "android",
  evidence: { standaloneDetected: true, notificationPermission: "default" },
  gmail: gmailNone, now: NOW
});
decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "mobile", deviceId: "dev-9" }, env: FLAG_ON });
assert("C6 enforcement: installed but alerts not granted -> refused ALERTS_REQUIRED (guard names the owed half)",
  decision.ok === false && decision.error === "ALERTS_REQUIRED" && decision.message === ALERTS_BLOCK_MESSAGE);

storeC.seedSubscription("user-9");
await evaluateGateEvidence(storeC, {
  userId: "user-9", deviceId: "dev-9", platform: "android",
  evidence: { standaloneDetected: true, notificationPermission: "granted" },
  gmail: gmailNone, now: NOW
});
decision = await enforceGenerationGate({ store: storeC, userId: "user-9", context: { surface: "mobile", deviceId: "dev-9" }, env: FLAG_ON });
assert("C7 enforcement: green (READY) attestation passes — the job may be created", decision.ok === true);

decision = await enforceGenerationGate({ store: null, userId: "user-9", context: { surface: "mobile", deviceId: "dev-9" }, env: FLAG_ON });
assert("C8 enforcement: no store (M1 unreachable) refuses closed — never a silent pass",
  decision.ok === false && decision.error === "INSTALL_REQUIRED");

/* ================= D — handoff pass lifecycle ======================= */

const HANDOFF_ENV = { ROAMLY_HANDOFF_SECRET: "phase6-check-secret" };
const storeD = new InMemoryHandoffStore();
const T0 = "2026-10-21T22:00:00.000Z";

let mintThrew = false;
try {
  await mintHandoffPass(new InMemoryHandoffStore(), { userId: "u", tripId: "t", origin: "https://roamlyhq.com", now: T0, env: {} });
} catch (error) {
  mintThrew = error instanceof Error && error.message === "HANDOFF_NOT_CONFIGURED";
}
assert("D1 handoff: minting without ROAMLY_HANDOFF_SECRET is unavailable — no fallback secret", mintThrew);

const minted = await mintHandoffPass(storeD, {
  userId: "user-1", tripId: "trip-1", origin: "https://roamlyhq.com/", now: T0, env: HANDOFF_ENV
});
assert("D2 handoff: minted record is a valid M6 DTO with a 10-minute TTL",
  isHandoffTokenDTO(minted.record)
  && Date.parse(minted.record.expiresAt) - Date.parse(minted.record.createdAt) === HANDOFF_TTL_MS
  && HANDOFF_TTL_MS === 600_000);
assert("D3 handoff: the URL carries the one-time token; the store holds ONLY its sha256 hash",
  minted.url === `https://roamlyhq.com/handoff/${minted.token}`
  && minted.record.tokenHash === createHash("sha256").update(minted.token.split(".")[1]).digest("hex")
  && !JSON.stringify(minted.record).includes(minted.token.split(".")[1]));

const redeemed = await redeemHandoffPass(storeD, { token: minted.token, now: "2026-10-21T22:04:00.000Z", env: HANDOFF_ENV });
assert("D4 handoff: first redemption succeeds and binds account + trip",
  redeemed.ok === true && redeemed.userId === "user-1" && redeemed.tripId === "trip-1");

const cookie = createHandoffSessionCookieValue(
  { userId: "user-1", tripId: "trip-1", deviceId: "phone-1" },
  { now: "2026-10-21T22:04:00.000Z", env: HANDOFF_ENV }
);
const binding = verifyHandoffSessionCookie(cookie, { now: "2026-10-21T22:05:00.000Z", env: HANDOFF_ENV });
assert("D5 handoff: the phone-session binding cookie verifies and is bound to the same account + trip + device",
  binding !== null && binding.userId === "user-1" && binding.tripId === "trip-1" && binding.deviceId === "phone-1");
assert("D6 handoff: the binding cookie does not verify under a different secret",
  verifyHandoffSessionCookie(cookie, { now: "2026-10-21T22:05:00.000Z", env: { ROAMLY_HANDOFF_SECRET: "other-secret" } }) === null);

const second = await redeemHandoffPass(storeD, { token: minted.token, now: "2026-10-21T22:05:00.000Z", env: HANDOFF_ENV });
assert("D7 handoff: second redemption of the burned pass is refused (used)",
  second.ok === false && second.reason === "used");

const minted2 = await mintHandoffPass(storeD, {
  userId: "user-1", tripId: "trip-1", origin: "https://roamlyhq.com", now: T0, env: HANDOFF_ENV
});
const expired = await redeemHandoffPass(storeD, { token: minted2.token, now: "2026-10-21T22:10:00.001Z", env: HANDOFF_ENV });
assert("D8 handoff: redemption after the 10-minute TTL is refused (expired)",
  expired.ok === false && expired.reason === "expired");

const minted3 = await mintHandoffPass(storeD, {
  userId: "user-2", tripId: "trip-2", origin: "https://roamlyhq.com", now: T0, env: HANDOFF_ENV
});
const parts = minted3.token.split(".");
const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].endsWith("A") ? "B" : "A"}`;
const tampered = await redeemHandoffPass(storeD, { token: tamperedToken, now: "2026-10-21T22:02:00.000Z", env: HANDOFF_ENV });
assert("D9 handoff: a tampered signature is refused (tampered)",
  tampered.ok === false && tampered.reason === "tampered");
const genuineAfterTamper = await redeemHandoffPass(storeD, { token: minted3.token, now: "2026-10-21T22:03:00.000Z", env: HANDOFF_ENV });
assert("D10 handoff: the tamper attempt did NOT burn the genuine pass — it still redeems",
  genuineAfterTamper.ok === true && genuineAfterTamper.userId === "user-2");

const malformed = await redeemHandoffPass(storeD, { token: "not-a-pass", now: T0, env: HANDOFF_ENV });
const unknown = await redeemHandoffPass(storeD, {
  token: `v1.${"A".repeat(43)}.AAAA`, now: T0, env: HANDOFF_ENV
});
assert("D11 handoff: malformed and unknown passes are refused (invalid)",
  malformed.ok === false && malformed.reason === "invalid" && unknown.ok === false && unknown.reason === "invalid");

/* ================= E — statics ====================================== */

const routeSource = readFileSync(new URL("../lib/roamly/tripGenerationRoute.ts", import.meta.url), "utf8");
assert("E1 statics: the generate route enforces the gate beside the billing gate, before job creation",
  routeSource.includes("enforceGenerationGate") && routeSource.includes("gateFlowContextFromBody")
  && routeSource.indexOf("enforceGenerationGate") < routeSource.indexOf("ensureDurableGenerationQueue"));

const entryGateSource = readFileSync(new URL("../components/roamly/EntryGate.tsx", import.meta.url), "utf8");
const handoffBlockSource = readFileSync(new URL("../components/roamly/HandoffBlock.tsx", import.meta.url), "utf8");
assert("E2 statics: EntryGate is mobile-only and HandoffBlock desktop-only (both self-limit by surface)",
  entryGateSource.includes("isSupportedMobileEnvironment") && entryGateSource.includes("if (!applicable) return null")
  && handoffBlockSource.includes("if (isMobile === null || isMobile) return null")
  && !entryGateSource.includes("CompanionInstallStep"));

const m1 = readFileSync(new URL("../supabase/migrations/20261022_roamly_build2_gate_states.sql", import.meta.url), "utf8");
const m6 = readFileSync(new URL("../supabase/migrations/20261022_roamly_handoff_tokens.sql", import.meta.url), "utf8");
assert("E3 statics: M1 carries the READY law as a DB check; M6 stores hash only with used_at burn + expiry",
  m1.includes("roamly_gate_states_ready_law_check") && m1.includes("flow_allowed")
  && m6.includes("token_hash") && m6.includes("used_at") && m6.includes("expires_at")
  && !/^\s*token\s+text/m.test(m6));

const machineSource = readFileSync(new URL("../lib/roamly/gateMachine.ts", import.meta.url), "utf8");
assert("E4 statics: no alternate-mailbox provider exists in the wired gate machine (Gmail fixed)",
  machineSource.includes('providerOptions: ["gmail"]') && !/outlook|yahoo|icloud|imap/i.test(machineSource.replace(/Outlook connect attempt/g, "")));

/* ================= verdict ========================================== */

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} assertions PASS — verdict ${passed === results.length ? "PASS" : "FAIL"}`);
if (passed !== results.length) process.exit(1);
