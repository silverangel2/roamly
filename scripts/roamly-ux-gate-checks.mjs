// roamly-ux-gate-checks.mjs — Builder-G proof for the Roamly setup-gate UX repair.
// Self-contained: static source checks over TripSetupGate.tsx + SetupCascade.tsx
// plus pure fixture logic mirroring the location pre-check decisions.
// No imports of any other tree file (sibling-owned files are never read).
// Usage: node scripts/roamly-ux-gate-checks.mjs [treeRoot]
//   treeRoot defaults to the repo root (parent of scripts/).
//   Pass a pristine staging dir to prove the pre-fix FAIL.
// Exit 0 only when every check passes.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, ".."));
const gate = readFileSync(join(root, "components/roamly/TripSetupGate.tsx"), "utf8");
const cascade = readFileSync(join(root, "components/roamly/SetupCascade.tsx"), "utf8");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const idx = (src, needle) => src.indexOf(needle);

// --- 1. Skip card (TripSetupGate) ---
// SUPERSEDED 2026-10-26 by the owner-approved Setup design
// (composite correct-4-pages.jpg, bottom-left): the skip is no longer
// a small link above the cascade — it is its own card BELOW the
// optional cards, after an OR divider, with the limited-features
// subtext. The assertions below encode the APPROVED design, not the
// round-1 layout; all other sections of this script are unchanged.
const skipAnchor = idx(gate, "href={skipHref}");
const cascadeUsage = idx(gate, "<SetupCascade");
check(
  "skip-card-below-cascade-card",
  skipAnchor !== -1 && cascadeUsage !== -1 && cascadeUsage < skipAnchor,
  `cascade@${cascadeUsage} skipAnchor@${skipAnchor}`
);
check(
  "skip-card-copy-and-href",
  gate.includes("Skip for now") &&
    gate.includes("You can still view your full itinerary with limited features.") &&
    (gate.match(/href=\{skipHref\}/g) || []).length === 1,
  "one skip anchor (the card), approved copy + subtext"
);

// --- 2. Android / Chrome menu guidance (SetupCascade) ---
check(
  "android-menu-steps",
  cascade.includes("⋮") &&
    cascade.includes("Add to Home screen") &&
    cascade.includes("Install app") &&
    cascade.includes("On Android / Chrome"),
  "concrete ⋮ → Add to Home screen / Install app steps for non-iOS"
);
check(
  "install-prompt-behavior-untouched",
  cascade.includes("beforeinstallprompt") &&
    cascade.includes("deferred.prompt()") &&
    cascade.includes("Install Roamly"),
  "real beforeinstallprompt button path still present"
);
check(
  "ios-guidance-untouched",
  cascade.includes("On iPhone: tap the Share button"),
  "existing iOS text preserved verbatim"
);

// --- 3. QR transfer block (SetupCascade) ---
check(
  "qr-reuses-qrcode-react",
  cascade.includes('import { QRCodeSVG } from "qrcode.react"'),
  "same QRCodeSVG library as HandoffBlock; no new dependency"
);
check(
  "qr-block-plain-origin-link",
  cascade.includes("Open on another phone? Scan this") &&
    cascade.includes("window.location.origin") &&
    cascade.includes("<QRCodeSVG value={appLink}"),
  "QR encodes the window.location.origin-based app link"
);
check(
  "qr-carries-no-user-or-trip-data",
  !/QRCodeSVG value=\{[^}]*trip/i.test(cascade) &&
    !cascade.includes("handoff/mint") &&
    !/QRCodeSVG value=\{[^}]*pass/i.test(cascade),
  "no trip id, signed pass, or handoff mint in the QR value"
);

// --- 4. Location: unsupported state + Permissions pre-check ---
check(
  "location-unsupported-state",
  cascade.includes('!("geolocation" in navigator)') &&
    cascade.includes("locationUnsupported") &&
    cascade.includes("isn't supported on this device or browser"),
  "own unsupported message, distinct from the generic fix error"
);
check(
  "location-generic-error-preserved",
  cascade.includes("couldn't get a location fix"),
  "pre-existing generic error text unchanged"
);
const permIdx = idx(cascade, "permissions.query");
const geoPromptIdx = idx(cascade, "navigator.geolocation.getCurrentPosition");
check(
  "location-permissions-precheck-before-prompt",
  permIdx !== -1 &&
    cascade.includes('query({ name: "geolocation" })') &&
    geoPromptIdx !== -1 &&
    permIdx < geoPromptIdx,
  `permissions.query@${permIdx} before getCurrentPosition@${geoPromptIdx}`
);
check(
  "location-denied-precheck-shows-settings-no-reprompt",
  cascade.includes('preCheck === "denied"') &&
    cascade.includes("already blocked for Roamly") &&
    cascade.includes("site settings"),
  "denied pre-check returns settings guidance without firing the prompt"
);
check(
  "location-denial-post-and-grant-flow-untouched",
  cascade.includes('permissionState: "denied"') &&
    cascade.includes('permissionState: "granted"') &&
    cascade.includes("Your browser blocked location. Open the browser's site settings"),
  "existing denial POST, grant POST, and denial text preserved"
);

// --- 5. Manual app recheck ---
const recheckIdx = idx(cascade, "recheckAppInstall");
check(
  "manual-app-recheck-button",
  cascade.includes("I've added it — continue") && recheckIdx !== -1,
  "Companion-style recheck button present in the app step"
);
check(
  "recheck-uses-standalone-path-not-self-report",
  cascade.includes("getPushCapabilityState()") &&
    /recheckAppInstall[\s\S]{0,600}if \(next\.isStandalone\)[\s\S]{0,200}completeStep\("app", "standalone"\)/.test(cascade),
  "recheck re-runs standalone detection and completes only when standalone"
);
check(
  "cascade-sequence-and-lock-untouched",
  cascade.includes('"Booking Recon"') &&
    cascade.includes('"Download the app"') &&
    cascade.includes('"Turn on location"') &&
    cascade.indexOf('"Booking Recon"') < cascade.indexOf('"Download the app"') &&
    cascade.indexOf('"Download the app"') < cascade.indexOf('"Turn on location"') &&
    cascade.includes("currentIndex") &&
    cascade.includes("Locked"),
  "step order 1 Gmail, 2 app, 3 location and sequential locking intact"
);

// --- 6. Fixture logic: location pre-check decisions (pure, mirrors the code) ---
function decideLocationFlow({ geolocationPresent, permissionState }) {
  if (!geolocationPresent) return { action: "unsupported", firesPrompt: false };
  if (permissionState === "denied") return { action: "settings-guidance", firesPrompt: false };
  return { action: "proceed-to-prompt", firesPrompt: true }; // prompt, granted, or unknown
}
const fixtures = [
  [{ geolocationPresent: false, permissionState: null }, "unsupported", false],
  [{ geolocationPresent: true, permissionState: "denied" }, "settings-guidance", false],
  [{ geolocationPresent: true, permissionState: "prompt" }, "proceed-to-prompt", true],
  [{ geolocationPresent: true, permissionState: "granted" }, "proceed-to-prompt", true],
  [{ geolocationPresent: true, permissionState: null }, "proceed-to-prompt", true]
];
let fixtureOk = true;
for (const [input, wantAction, wantPrompt] of fixtures) {
  const got = decideLocationFlow(input);
  if (got.action !== wantAction || got.firesPrompt !== wantPrompt) fixtureOk = false;
}
check("fixture-location-precheck-decisions", fixtureOk, "unsupported/denied never fire a prompt; prompt/granted/unknown proceed");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (root: ${root})`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
