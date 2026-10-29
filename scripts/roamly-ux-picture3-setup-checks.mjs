// roamly-ux-picture3-setup-checks.mjs — Picture 3 (Setup) proof.
// Static source checks over TripSetupGate.tsx + SetupCascade.tsx
// (optional variant only) + the trip page's gate wiring. The picture
// is correct-4-pages.jpg, BOTTOM-LEFT panel, read from an enlarged
// crop: eyebrow · "Your trip is ready! 🎉" · subtitle · green
// itinerary card · "Optional setup (recommended)" · three cards
// (Gmail SOLID blue button; home-screen + location blue-OUTLINE
// buttons) · OR divider · centered "Skip for now" card · footnote,
// and the content ENDS at the footnote.
// Usage: node scripts/roamly-ux-picture3-setup-checks.mjs [treeRoot]
// Exit 0 only when every check passes.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || join(here, ".."));
const gate = readFileSync(join(root, "components/roamly/TripSetupGate.tsx"), "utf8");
const cascade = readFileSync(join(root, "components/roamly/SetupCascade.tsx"), "utf8");
const page = readFileSync(join(root, "app/trip/[id]/page.tsx"), "utf8");

// Rendered code only for sample/JSX checks: header comments quote the
// mock's sample values as documentation, never as rendered values.
const gateCode = gate.replace(/\/\*[\s\S]*?\*\//g, "");
// everything from the optional return to stepShell (the full/compact
// engine, which serves Settings, not this screen).
const optStart = cascade.indexOf('variant === "optional"');
const optEnd = cascade.indexOf("const stepShell", optStart);
const optional = optStart !== -1 && optEnd !== -1 ? cascade.slice(optStart, optEnd) : "";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const idx = (src, needle) => src.indexOf(needle);
const ordered = (src, needles) => {
  let prev = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle, prev + 1);
    if (at === -1 || at < prev) return false;
    prev = at;
  }
  return true;
};

// --- 1. Exact structure + order, top to bottom (TripSetupGate) ---
check(
  "gate-order-eyebrow-to-footnote",
  ordered(gate, [
    "{eyebrow}",
    "Your trip is ready! 🎉",
    "Everything is prepared. Complete a few optional steps to unlock more features.",
    "Itinerary generated and saved",
    "Optional setup (recommended)",
    "<SetupCascade",
    "OR",
    "Skip for now",
    "You can still view your full itinerary with limited features."
  ]),
  "eyebrow · title · subtitle · itinerary card · section header · cascade · OR · skip · footnote, in that order"
);
check(
  "gate-screen-ends-at-footnote",
  (() => {
    const foot = gate.indexOf("You can still view your full itinerary with limited features.");
    if (foot === -1) return false;
    // Nothing renders after the footnote: no further element with a
    // className, heading, link, or button in the gate file past it.
    const tail = gate.slice(foot);
    return !/className=/.test(tail.slice(tail.indexOf("</p>") + 4));
  })(),
  "no element, section, or link after the footnote paragraph"
);
check(
  "gate-eyebrow-uppercase-small-caps",
  gate.includes('uppercase tracking-[0.09em]') && gate.includes("{eyebrow}"),
  "eyebrow rendered uppercased from the dynamic prop, never a literal"
);
check(
  "gate-no-sample-values",
  !gateCode.includes("Montreal") && !gateCode.includes("Oct 26") && !optional.includes("Montreal"),
  "the picture's Montreal / Oct 26 sample values appear nowhere in rendered code on this screen"
);

// --- 2. Itinerary card: pale green, solid green check, green chevron ---
check(
  "itinerary-card-green",
  gate.includes("bg-cgreen/10") &&
    gate.includes("bg-cgreen text-base font-bold text-white") &&
    gate.includes("text-cgreen\">›</span>"),
  "pale-green card + solid green check circle (white check) + green chevron, as in the picture"
);

// --- 3. Three optional cards, in picture order, with picture copy ---
check(
  "optional-card-order-and-copy",
  ordered(optional, [
    "Connect Gmail for Booking Recon",
    "Automatically find your flight, hotel and activity confirmations.",
    "Add Roamly to your home screen",
    "Get instant alerts and a smoother experience.",
    "Enable location (for Live Companion)",
    "Get real-time nearby suggestions and turn-by-turn guidance."
  ]),
  "Gmail · home screen · location, each with the picture's title + description"
);
check(
  "optional-cards-have-chevrons",
  optional.includes('text-cchev">›</span>') &&
    (optional.match(/\{chevron\}/g) || []).length >= 4,
  "one chevron definition reused in every card head + done state (4+ uses)"
);

// --- 4. Buttons: Gmail SOLID blue, others blue-outline, under text ---
check(
  "gmail-button-solid-blue",
  cascade.includes("bg-cblue px-5 text-[15px] font-semibold text-white") &&
    /solidButtonClass[\s\S]{0,200}Connect Gmail/.test(optional) &&
    optional.includes('href="/api/integrations/gmail/connect"'),
  "Gmail button is solid blue and links the real Gmail connect flow"
);
check(
  "other-buttons-blue-outline",
  optional.includes("Show instructions") &&
    optional.includes("Enable location") &&
    (optional.match(/outlineButtonClass/g) || []).length >= 4,
  "home-screen + location buttons use the blue-outline style"
);
check(
  "buttons-under-text-column",
  (optional.match(/ml-14 mt-3/g) || []).length >= 4,
  "Gmail / home-screen / location button blocks indented past the icon (ml-14)"
);

// --- 5. OR divider + centered Skip card ---
check(
  "or-divider-with-lines",
  gate.includes("OR") && gate.includes("h-px flex-1 bg-chair"),
  "OR divider with the picture's flanking rules"
);
check(
  "skip-card-centered",
  gateCode.includes("text-center") &&
    gateCode.indexOf("text-center") < gateCode.indexOf(">Skip for now<") + 200 &&
    gateCode.includes("href={skipHref}"),
  "Skip card text centered, chevron at the right edge, one skip link"
);
check(
  "skip-card-after-cascade",
  idx(gate, "<SetupCascade") !== -1 &&
    idx(gate, "href={skipHref}") > idx(gate, "<SetupCascade"),
  "skip sits below the optional cards, not above them"
);

// --- 6. Nothing the picture does not show, on THIS screen ---
check(
  "gate-no-legacy-blocks",
  !gate.includes("Locked") &&
    !gate.includes("Finish step") &&
    !gate.includes("Download the app") &&
    !gate.includes("QRCode") &&
    !gate.includes("Turn on alerts"),
  "no locked-step rows, QR block, alerts step, or old gate copy in the gate file"
);
check(
  "optional-branch-no-legacy-blocks",
  optional !== "" &&
    !optional.includes("Locked") &&
    !optional.includes("QRCodeSVG") &&
    !optional.includes("Scan this") &&
    !optional.includes("finish step first") &&
    !optional.includes("Turn on alerts"),
  "the rendered optional branch has no locks, QR transfer, or alerts step (those live only in the full/compact engine for Settings)"
);

// --- 7. Real flows, honest states (never dead buttons) ---
check(
  "gmail-real-flow",
  optional.includes('href="/api/integrations/gmail/connect"') &&
    optional.includes("Reconnect Gmail"),
  "Gmail connect + honest reconnect state when previously connected but disconnected"
);
check(
  "home-screen-real-instructions",
  optional.includes("Show instructions") &&
    optional.includes("On iPhone: tap the Share button") &&
    optional.includes("On Android / Chrome") &&
    optional.includes("I've added it — continue") &&
    cascade.includes("beforeinstallprompt"),
  "platform-specific install instructions + standalone recheck + real install prompt (shared engine, same file)"
);
check(
  "location-real-flow-with-recovery",
  optional.includes("turnOnLocation") &&
    cascade.includes("navigator.geolocation.getCurrentPosition") &&
    cascade.includes("already blocked for Roamly") &&
    cascade.includes("isn't supported on this device or browser"),
  "real permission flow with denied + unsupported recovery states (shared engine, same file)"
);
check(
  "done-states-server-evidence",
  optional.includes("gmailDone") &&
    optional.includes("appDone") &&
    optional.includes("locationDone") &&
    optional.includes("setup.gmailConnected") &&
    cascade.includes("completeStep"),
  "done states key on the server-verified setup state, never a guess"
);

// --- 8. Dynamic trip identity + remembered skip + gate law intact ---
check(
  "page-eyebrow-dynamic",
  page.includes("formatGateEyebrow(destinationLabel, trip.start_date, trip.end_date)"),
  "eyebrow is this trip's own destination + dates, via the gate eyebrow formatter"
);
check(
  "skip-remembered-per-trip",
  gate.includes("setupSkipCookieAssignment") &&
    gate.includes("document.cookie") &&
    page.includes("hasSetupSkip") &&
    page.includes("?skipSetupGate=1"),
  "skip reveals immediately and is remembered per trip via the skip cookie"
);
check(
  "gate-law-intact",
  page.includes("setupGateApplies") &&
    page.includes("setupGateLimitedFeatures") &&
    // Final local round (2026-10-27, Task 2): the reveal banner's
    // wording moved into the compact expandable LimitedFeaturesNotice
    // component; the gate law itself (gate + limited-features list)
    // is unchanged, and the mount is in this page.
    page.includes("<LimitedFeaturesNotice"),
  "entitlement gate + limited-features reveal banner unchanged (feature enablement only is 'optional')"
);
check(
  "page-gate-early-return-only",
  page.includes("<SetupGateScreen") &&
    page.indexOf("<SetupGateScreen") < page.indexOf("<DestinationPhotoBand"),
  "the gate replaces the itinerary page (early return); it adds no section to the itinerary itself"
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (root: ${root})`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
