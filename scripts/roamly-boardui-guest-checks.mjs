// BoardUI guest itinerary checks (2026-11-10, hard-apply batch 9).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface, judged against the familiar apps — never against the old
// Roamly version. Batch 9 converts the GUEST FREE ITINERARY face
// (components/plan/GuestFreeItinerary.tsx) — the shop window a
// stranger judges the whole product by — onto the BoardUI primitives
// and tokens.
//
// This suite pins:
//   (1) THE CONVERSION — the face rides BuiCard / BuiButton /
//       BuiButtonLink / BuiNotice / BuiFieldError and the token
//       classes only: no slate, no legacy ink/mist/cloud recipes,
//       no raw hex, no black anywhere in the file;
//   (2) THE DAY FACE — day panels on the token wash, and the batch-1
//       timeline rail (time column, dot-and-line spine) in place of
//       the old plain-text stop lines; the guest view model carries
//       no photos, so no photo slot is faked;
//   (3) THE CONTRACTS, BYTE-PRESERVED — the one-free-itinerary flow's
//       endpoints, the polling backoff, the day-1 email-capture gate,
//       the recovery path, the account-wall + companion-offer order
//       and wording, every CTA destination (planAuthUrl login/signup
//       with the resume path), and the sponsored rel on every
//       affiliate exit;
//   (4) FACE LAW — no internal vocabulary on the guest face: the
//       file carries no payment plumbing words, no progress-bar
//       language, nothing a stranger should never see.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const root = path.resolve(new URL("..", import.meta.url).pathname);

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const guest = read("components/plan/GuestFreeItinerary.tsx");

/* ---- 1. The conversion rides the primitives + tokens only ---- */
ok(guest.includes('from "@/components/boardui/Card"') && guest.includes("BuiCard"), "1a: BuiCard imported and used");
ok(guest.includes('from "@/components/boardui/Button"') && guest.includes("BuiButton") && guest.includes("BuiButtonLink"), "1b: BuiButton + BuiButtonLink imported and used");
ok(guest.includes('from "@/components/boardui/Notice"') && guest.includes("BuiNotice"), "1c: BuiNotice imported and used");
ok(guest.includes('from "@/components/boardui/Field"') && guest.includes("BuiFieldError"), "1d: BuiFieldError imported and used");
ok(guest.includes("<BuiCard data-guest-free-itinerary"), "1e: the root shell is a BuiCard carrying the guest marker");
ok(!/slate-\d/.test(guest), "1f: zero slate utilities left in the file");
ok(!guest.includes("text-ink") && !guest.includes("bg-mist") && !guest.includes("border-cloud"), "1g: legacy ink/mist/cloud recipes gone");
ok(!guest.includes("shadow-soft") && !guest.includes("shadow-sm"), "1h: legacy shadows gone (primitives carry the elevation)");
ok(!/#[0-9a-fA-F]{3,8}\b/.test(guest), "1i: zero raw hex literals in the file");
ok(!/bg-black|text-black|border-black|#000\b/.test(guest), "1j: no black anywhere (ink is navy-slate)");
ok(!guest.includes("#f7fbfb"), "1k: the hand-mixed pale tint is gone (token wash instead)");
ok((guest.match(/bg-csoft/g) || []).length === 3, "1l: recovery + delivery + account-wall panels ride the bg-csoft token wash");
ok(guest.includes('tone="error"') && guest.includes("translateText(error)"), "1m: the load error renders as a human BuiNotice, words unchanged");

/* ---- 2. The day face: token panels + the timeline rail ---- */
ok(guest.includes("rounded-bui-panel bg-cbg p-4"), "2a: day + booking sections ride the token panel recipe");
ok(guest.includes("lastTimelineIndex"), "2b: the rail knows its last rendered stop (connector stops there)");
ok(guest.includes("rounded-full bg-cblue") && guest.includes("bg-chair"), "2c: rail dots are brand blue on a hairline spine");
ok(guest.includes("w-20 shrink-0 whitespace-nowrap"), "2d: the time rail is one fixed column, times never wrap");
ok(guest.includes("if (!displayTitle.trim()) return null;"), "2e: empty-title stops are still skipped (noise is not a plan line)");
ok(guest.includes("presentDayHeading") && guest.includes("presentTravelerTitle"), "2f: venue headings + traveller titles still derive from the presentation layer");
ok(!guest.includes("photo") && !guest.includes("unsplash"), "2g: no photo slot is faked — the guest view model carries no photos");

/* ---- 3. Contracts byte-preserved ---- */
ok(guest.includes('const PLAN_RESUME_PATH = "/plan?resumePlan=1&continueGenerate=1";'), "3a: the resume path is byte-identical");
ok(guest.includes('planAuthUrl("/login")') && guest.includes('planAuthUrl("/signup")'), "3b: auth CTAs still build through planAuthUrl");
ok(guest.includes('fetch("/api/trips/guest-itinerary"'), "3c: the guest read endpoint is unchanged");
ok(guest.includes('fetch("/api/trips/guest-itinerary/email"') && guest.includes('fetch("/api/trips/guest-itinerary/recover"'), "3d: email capture + recovery endpoints unchanged");
ok(guest.includes("Math.min(30000, 3000 * 2 **"), "3e: the polling backoff law is untouched");
ok(
  guest.indexOf("itinerary.days.length >= 1") !== -1 && guest.indexOf("itinerary.days.length >= 1") < guest.indexOf("data-guest-delivery-email"),
  "3f: the email capture still gates on day 1 being viewable"
);
ok(guest.includes('itinerary?.status === "ready" && itinerary.days.length > 0'), "3g: the offer + wall still gate on a ready itinerary with days");
ok(
  guest.indexOf("data-guest-live-companion-offer") !== -1 && guest.indexOf("data-guest-live-companion-offer") < guest.indexOf("data-guest-account-wall"),
  "3h: the companion offer still precedes the account wall"
);
ok(guest.includes("This is an offer only. Nothing is unlocked yet."), "3i: the offer honesty line is verbatim");
ok(guest.includes("Sign in to save this itinerary, purchase Live Companion, or buy paid packs."), "3j: the wall headline is verbatim");
ok(guest.includes('"Sign in to save"') && guest.includes('"Create an account"') && guest.includes('"Add Live Companion"'), "3k: the three CTA labels are verbatim");
ok(guest.includes('"Where do I send the rest?"') && guest.includes("We'll send the rest to") && guest.includes('"Send me the link"'), "3l: capture + recovery wording verbatim");
ok(guest.includes("GUEST_ACCOUNT_WALL.map") && guest.includes('from "lucide-react"') && guest.includes("<Check"), "3m: the wall list renders every entitlement with the Lucide check");
ok((guest.match(/rel="noopener noreferrer sponsored"/g) || []).length === 3, "3n: all three affiliate exits keep the sponsored rel (card CTA, timeline link, flight search)");
ok(guest.includes("Booking links may earn Roamly a commission at no extra cost to you."), "3o: the affiliate disclosure line is verbatim");
ok(guest.includes("Stay picks matched to your budget") && guest.includes("itinerary.stays.length ?"), "3p: the budget-matched stays gate is intact");
ok(guest.includes("GUEST_NO_FLIGHTS_TEXT") && guest.includes("itinerary.flightSearchUrl") && guest.includes("Flights & getting there"), "3q: the honest empty-flights section is intact");
ok(guest.includes("busy={emailSaving}") && guest.includes("busy={recoveryBusy}"), "3r: both submit buttons ride the busy pattern (double-submit impossible)");
ok(guest.includes('aria-describedby="guest-delivery-email-error"') && guest.includes('id="guest-delivery-email-error"'), "3s: the delivery error slot is wired to its field (reserved space, submit never moves)");

/* ---- 4. Face law: nothing internal on the stranger's face ---- */
ok(!/\/api\/stripe|\/live-companion|checkout|progressbar|percent/i.test(guest), "4a: no payment plumbing, no progress-bar language anywhere in the file");
ok(!guest.includes("provenance") && !guest.includes("evidence tier") && !guest.includes("CONFIRMED"), "4b: no internal evidence vocabulary renders for guests");

/* ---- 5. The shared piece TripPlanForm depends on is unbroken ---- */
const planForm = read("components/plan/TripPlanForm.tsx");
ok(planForm.includes('import { GUEST_ITINERARY_PATH } from "@/lib/roamly/guestItineraryView";'), "5a: TripPlanForm still imports the guest path from the untouched view model");
ok(guest.includes('from "@/lib/roamly/guestItineraryView"'), "5b: the component still reads its view model from the same module");

console.log(`\nboardui-guest: ${count} checks passed`);
