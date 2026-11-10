// BoardUI account + secondary checks (2026-11-09, hard-apply batch 7).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface, judged against the familiar apps. Batch 7 completes the
// account home and the secondary pages, and closes the audit's
// Axis-2 toast finding: TWO toast systems existed (BuiToast vs the
// Jakob round's components/roamly/Toast.tsx). One system now.
//
// This suite pins the batch-7 conversion:
//   (1) ONE toast system — components/roamly/Toast.tsx is deleted
//       with zero importers; AppShellClient mounts BuiToastProvider;
//       DeleteTripButton consumes useBuiToastOptional with its
//       behaviour (8s Undo window, 6s warning toast) verbatim; the
//       four per-surface BuiToast users are untouched;
//   (2) the account settings forms (EmailConnectionSettings,
//       LocationTrackingSettings) ride BuiCard/BuiButton/BuiNotice
//       with every endpoint, label and status word preserved, and
//       the SetupCascade "Booking Recon is activated / not
//       activated" wording is byte-untouched (setup law);
//   (3) the share surface (page shell, ItineraryShareForm,
//       HandoffLanding) rides the primitives + the BuiField pattern
//       with every submit message verbatim;
//   (4) the secondary pages (notifications shell, explore, event,
//       place, directions, feedback, country-info) ride the
//       primitives with their words and handlers preserved.
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

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

function walkSources(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkSources(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* (1) ONE toast system                                                */
/* ------------------------------------------------------------------ */

console.log("(1) one toast system: legacy retired, BuiToastProvider at the shell");

ok(!exists("components/roamly/Toast.tsx"), "1a: components/roamly/Toast.tsx is deleted");
const legacyImporters = [...walkSources("app"), ...walkSources("components"), ...walkSources("lib")].filter((rel) =>
  /from\s+["'][^"']*roamly\/Toast["']/.test(read(rel))
);
ok(legacyImporters.length === 0, `1b: zero importers of the retired toast (found: ${legacyImporters.join(", ") || "none"})`);

const shell = read("components/AppShellClient.tsx");
ok(shell.includes('import { BuiToastProvider } from "@/components/boardui/Toast";'), "1c: the shell imports BuiToastProvider");
ok(shell.includes("<BuiToastProvider>") && shell.includes("</BuiToastProvider>"), "1d: the shell mounts BuiToastProvider around the content");
ok(!shell.includes("ToastProvider } from \"@/components/roamly/Toast\""), "1e: the shell no longer imports the retired provider");

const boarduiToast = read("components/boardui/Toast.tsx");
ok(boarduiToast.includes("export function BuiToastProvider("), "1f: BuiToastProvider is exported from the BoardUI toast");
ok(boarduiToast.includes("export function useBuiToastOptional("), "1g: useBuiToastOptional is exported from the BoardUI toast");
ok(boarduiToast.includes('warning: "bg-cred"'), "1h: the warning tone carries the retired system's cred dot");
ok(boarduiToast.includes('options.tone ?? "info"'), "1i: the provider's default tone is info (the retired default's blue dot)");
ok(boarduiToast.includes("onDismiss={() => dismissToast(toast.id)}") && boarduiToast.includes("current && current.id === id ? null : current"), "1i2: the provider dismisses by id — an expired toast's stale dismiss can never clear its successor (the Undo → failure-toast chain)");

const deleteButton = read("components/trip/DeleteTripButton.tsx");
ok(deleteButton.includes('import { useBuiToastOptional } from "@/components/boardui/Toast";'), "1j: DeleteTripButton consumes the BoardUI toast hook");
ok(deleteButton.includes("const UNDO_WINDOW_MS = 8000;"), "1k: the Undo window is still 8000ms");
ok(deleteButton.includes('toastContext.toast({ message, tone: "warning", durationMs: 6000 });'), "1l: the failure toast call is verbatim (warning tone, 6000ms)");
ok(deleteButton.includes("durationMs: UNDO_WINDOW_MS,") && deleteButton.includes("window.setTimeout(() => {"), "1m: the deferred commit still fires on the Undo window lapse");
ok(deleteButton.includes("if (!toastContext) {"), "1n: the no-provider immediate-delete fallback still stands");

for (const rel of [
  "components/account/AccountProfileForm.tsx",
  "components/account/TravelerMemorySettings.tsx",
  "components/companion/BookingAddedToast.tsx",
  "components/roamly/CompanionControlCard.tsx"
]) {
  ok(read(rel).includes('import { BuiToast, useBuiToast } from "@/components/boardui/Toast";'), `1o: per-surface BuiToast user untouched: ${rel}`);
}

/* ------------------------------------------------------------------ */
/* (2) Account settings forms                                          */
/* ------------------------------------------------------------------ */

console.log("(2) account settings: primitives on, behaviour and wording preserved");

const email = read("components/account/EmailConnectionSettings.tsx");
ok(email.includes('import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";'), "2a: email settings import the BoardUI buttons");
ok(email.includes('import { BuiCard } from "@/components/boardui/Card";') && email.includes('import { BuiNotice } from "@/components/boardui/Notice";'), "2b: email settings import BuiCard + BuiNotice");
ok(!/slate-|rose-|amber-/.test(email), "2c: no slate/rose/amber classes remain in email settings");
ok(email.includes('connectPath: "/api/integrations/gmail/connect"') && email.includes('syncPath: "/api/integrations/gmail/sync"') && email.includes('disconnectPath: "/api/integrations/gmail/disconnect"'), "2d: the Gmail endpoints are unchanged");
ok(email.includes("connected · Last sync") && email.includes('"Not connected"'), "2e: the connection status words are preserved");
ok(email.includes("Gmail sync hasn't worked since"), "2f: the persistent-failure line is preserved");
ok(email.includes('id="email-settings"'), "2g: the email-settings anchor survives");

const location = read("components/account/LocationTrackingSettings.tsx");
ok(location.includes('import { BuiNotice } from "@/components/boardui/Notice";'), "2h: location settings import BuiNotice");
ok(!/bg-gradient|from-cyan-500|from-orange-400|to-rose-400|slate-/.test(location), "2i: the off-token gradients and slate classes are gone");
ok(location.includes('"Trip sensing on"') && location.includes('"Trip sensing off"') && location.includes('"Notifications on"') && location.includes('"Notifications off"'), "2j: the toggle labels are preserved");
ok(location.includes("locationTrackingEnabled: Boolean(next.location_tracking_enabled)") && location.includes('method: "PATCH"'), "2k: the save call and its body keys are unchanged");
ok(location.includes('"/api/roamly/location/settings"'), "2l: the settings endpoint is unchanged");

const cascade = read("components/roamly/SetupCascade.tsx");
ok(cascade.includes("Booking Recon is activated") && cascade.includes("Booking Recon is not activated"), "2m: the Booking Recon activated / not activated wording stands verbatim (setup law untouched)");

const accountPage = read("app/account/page.tsx");
ok((accountPage.match(/<BuiCard id=/g) || []).length === 4, "2n: the four account detail views ride BuiCard shells");

/* ------------------------------------------------------------------ */
/* (3) Share surface                                                   */
/* ------------------------------------------------------------------ */

console.log("(3) share: page shell, form pattern, handoff ground");

const sharePage = read("app/trips/share/page.tsx");
ok(sharePage.includes('import { BuiNotice } from "@/components/boardui/Notice";'), "3a: the share page renders its load error through BuiNotice");
ok(!sharePage.includes("#B92C44"), "3b: the raw red hex is gone from the share page");

const shareForm = read("components/trip/ItineraryShareForm.tsx");
ok(shareForm.includes('import { BuiFieldError, useBuiField, type BuiField } from "@/components/boardui/Field";'), "3c: the share form imports the BoardUI field pattern");
ok(shareForm.includes("function ShareField(") && shareForm.includes("function ShareSelectField(") && shareForm.includes("function ShareAreaField("), "3d: the Share field family exists");
ok(shareForm.includes('useBuiField((value) => (value.trim() ? "" : "Destination is required."))'), "3e: destination validates on blur with the submit message verbatim");
for (const message of [
  "Choose the completed trip you want to share.",
  "Rate at least one booked item from your trip.",
  "Each rated item needs a star rating or a verdict.",
  "This trip was already shared. One submission per completed trip."
]) {
  ok(shareForm.includes(message), `3f: submit message preserved: ${message}`);
}
ok(!shareForm.includes("#e8dfd0") && !shareForm.includes("accent-[#087BFF]"), "3g: the raw hexes are gone from the share form");
ok(shareForm.includes("accent-cblue"), "3h: the consent checkbox wears the brand token");
ok(shareForm.includes('fetchWithSupabaseAuth("/api/itinerary-submissions"'), "3i: the submission endpoint is unchanged");
ok((shareForm.match(/<BuiCard/g) || []).length >= 5, "3j: the share form's sections and states ride BuiCard");

const handoff = read("components/roamly/HandoffLanding.tsx");
ok(handoff.includes('className="min-h-screen bg-cbg"') && !handoff.includes("#f2f6f4"), "3k: the handoff landing ground is the cbg token");

/* ------------------------------------------------------------------ */
/* (4) Secondary pages                                                 */
/* ------------------------------------------------------------------ */

console.log("(4) secondary pages: shells on primitives, words preserved");

const notifications = read("app/notifications/page.tsx");
ok(notifications.includes('import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";') && notifications.includes('import { BuiCard } from "@/components/boardui/Card";'), "4a: the notifications shell imports the primitives");
ok(notifications.includes("Notifications need an account.") && notifications.includes("No current trip to show."), "4b: the shell state headings are preserved");
ok(notifications.includes('<BuiButton type="submit" variant="ghost"'), "4c: Mark all read rides BuiButton inside its server-action form");
ok(notifications.includes("async function markAllNotificationsRead()"), "4d: the mark-all-read server action is unchanged");

const explore = read("components/roamly/ExploreDiscovery.tsx");
ok(!explore.includes("#F2F6FC") && !explore.includes("#e8dfd0") && !/slate-/.test(explore), "4e: explore's raw hexes and slate classes are gone");
ok(explore.includes('import { BuiButtonLink } from "@/components/boardui/Button";'), "4f: explore's internal CTAs ride BuiButtonLink");
ok(explore.includes("function externalDetailsLabel(") && explore.includes("View details for"), "4g: the external exit still names its destination (A20)");

const feedback = read("components/trip/TripFeedbackForm.tsx");
ok(feedback.includes('import { BuiCard } from "@/components/boardui/Card";') && feedback.includes('import { BuiButton } from "@/components/boardui/Button";') && feedback.includes('import { BuiNotice } from "@/components/boardui/Notice";'), "4h: the feedback form imports the primitives");
ok(!/slate-|text-red-600/.test(feedback), "4i: the feedback form's slate classes and raw red are gone");
ok(feedback.includes("function ScoreSelect(") && feedback.includes("FeedbackSelectField"), "4j: ScoreSelect rides the field pattern");
ok(feedback.includes("feedbackType: mode") && feedback.includes("wouldUseRoamlyAgain: wouldUseAgain"), "4k: the feedback submission body is unchanged");
ok(feedback.includes('type="number"') && feedback.includes('inputMode="numeric"'), "4l: Trip day stays a numeric quantity with the numeric keypad");

const eventPage = read("app/trip/[id]/event/[eventId]/page.tsx");
ok((eventPage.match(/<BuiCard interactive/g) || []).length === 2, "4m: the event sheet's two link rows ride BuiCard interactive");
ok(eventPage.includes("See the full itinerary") && eventPage.includes("Open the full country info page"), "4n: the event sheet's link labels are preserved");

for (const rel of ["app/trip/[id]/place/[placeId]/page.tsx", "app/trip/[id]/directions/[placeId]/page.tsx"]) {
  const pageSource = read(rel);
  ok(pageSource.includes('import { BuiCard } from "@/components/boardui/Card";') && pageSource.includes('<BuiCard className="mt-4 p-5">'), `4o: the not-found state rides BuiCard: ${rel}`);
}

const countryPanel = read("components/roamly/CountryInfoPanel.tsx");
ok(countryPanel.includes("<BuiButtonLink") && countryPanel.includes("See full itinerary") && countryPanel.includes("absolute right-4"), "4p: the country panel's closing CTA rides BuiButtonLink with the picture's right-edge chevron kept");
const countryPage = read("app/trip/[id]/country-info/page.tsx");
ok(countryPage.includes('<BuiCard className="bui-enter rounded-bui-panel p-4 sm:p-5">'), "4q: the country-info page shell rides BuiCard");

console.log(`\nboardui-account: ${count} checks passed`);
