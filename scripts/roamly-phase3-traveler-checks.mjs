import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.endsWith(".ts") ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
        }
        return require(id);
      }
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    data
  };
}

const drafts = loadTsModule("lib/roamly/planDraftStorage.ts");
const legacy = JSON.stringify({ ownerUserId: "user-a", destination: "Santorini", currentStep: 4 });
const local = memoryStorage({ [drafts.PLAN_DRAFT_KEY]: legacy });
const session = memoryStorage();
assert.equal(drafts.readRestorablePlanDraft({ userId: null, localStorage: local, sessionStorage: session }), null, "a guest must not restore another account draft");
drafts.clearPlannerDraftOnLogout(local, session);
assert.equal(local.getItem(drafts.PLAN_DRAFT_KEY), null, "logout clears roamly.plan.draft.v1");
const accountKey = drafts.accountPlanDraftKey("user-a");
local.setItem(accountKey, legacy);
assert.equal(drafts.readRestorablePlanDraft({ userId: "user-a", localStorage: local, sessionStorage: session })?.source, "account");
assert.equal(drafts.readRestorablePlanDraft({ userId: "user-b", localStorage: local, sessionStorage: session }), null, "another account cannot read the namespaced draft");
drafts.writeOwnedPlanDraft({ userId: null, raw: JSON.stringify({ step: 0 }), localStorage: local, sessionStorage: session });
assert.equal(session.getItem(drafts.GUEST_PLAN_DRAFT_KEY) != null, true, "guest drafts stay in session storage");
assert.equal(local.getItem(drafts.PLAN_DRAFT_KEY), null, "guest writes do not recreate the shared key");

const status = loadTsModule("lib/roamly/tripStatusDisplay.ts");
const over = status.mapTravelerTripStatus({
  hasItinerary: true,
  readinessState: "ATTENTION_REQUIRED",
  budgetOver: true,
  phase: "upcoming",
  companionUnlocked: true
});
assert.equal(over.badge, "Action needed");
assert.notEqual(over.code, "READY_TO_TRAVEL");
const ready = status.mapTravelerTripStatus({ hasItinerary: true, readinessState: "READY", phase: "upcoming", budgetOver: false });
assert.equal(ready.badge, "Ready");
const unknown = status.mapTravelerTripStatus({ signalsUnknown: true, hasItinerary: true, readinessState: "READY" });
assert.equal(unknown.badge, "UNKNOWN");
assert.notEqual(unknown.code, "READY_TO_TRAVEL");

const titles = loadTsModule("lib/roamly/itineraryPresentation.ts");
assert.equal(titles.looksLikeProviderSearchTitle("flight-search Montreal nightlife"), true);
assert.equal(titles.looksLikeProviderSearchTitle("Montreal, Canada hotel search"), true);
assert.equal(titles.looksLikeProviderSearchTitle("Montreal, Canada events festivals concerts nightlife 2026-10-30 to 2026-11-02"), true);
assert.equal(titles.presentTravelerTitle({ title: "flight-search Montreal", mode: "drive", origin: "Quebec", destination: "Montreal" }).title.startsWith("Drive"), true);
assert.equal(titles.presentTravelerTitle({ title: "Notre-Dame Basilica", mode: "walk" }).title, "Notre-Dame Basilica");
const hotel = titles.presentTravelerTitle({ title: "Hotels in Montreal Old Port", category: "hotel" });
assert.equal(hotel.needsConfirmation, true);
assert.equal(/search/i.test(hotel.title), false);
const stay = titles.presentTravelerTitle({ title: "Montreal, Canada hotel search", category: "hotel" });
assert.equal(/search/i.test(stay.title), false);
assert.match(stay.title, /Stay/);
const events = titles.presentTravelerTitle({ title: "Montreal, Canada events festivals concerts nightlife 2026-10-30 to 2026-11-02", category: "activity" });
assert.equal(/festivals concerts nightlife/i.test(events.title), false);
assert.match(events.title, /Events/);
const buffer = titles.presentTravelerTitle({
  title: "Recommended flight departure buffer",
  mode: "flight",
  suppressFlightFraming: true,
  origin: "Saint John",
  destination: "Montreal"
});
assert.equal(/flight|airport/i.test(buffer.title), false);
assert.equal(titles.cleanTravelerTimeLabel("10:54 p.m.."), "10:54 p.m.");
assert.equal(titles.punctuateTravelerTime("10:54 p.m.").includes("p.m.."), false);
assert.equal(titles.closeTravelerSentence("Last sync Oct 5, 10:54 p.m.").includes("p.m.."), false);
assert.equal(titles.closeTravelerSentence("Last sync Oct 5, 10:54 p.m."), "Last sync Oct 5, 10:54 p.m.");
const route = titles.presentTravelerTitle({
  title: "Saint John to Montreal flight search",
  category: "flight",
  origin: "Saint John",
  destination: "Montreal"
});
assert.equal(route.title, "Getting from Saint John to Montreal");
assert.equal(titles.repairGarbledGettingTo("Getting to Saint John Montreal", "Saint John", "Montreal"), "Getting from Saint John to Montreal");
const airport = titles.presentTravelerTitle({
  title: "Montreal airport",
  suppressFlightFraming: true,
  origin: "Saint John",
  destination: "Montreal"
});
assert.equal(/airport/i.test(airport.title), false);
const bookedAirport = titles.presentGroundTransportText("Billy Bishop Airport lounge");
assert.match(bookedAirport, /lounge/i);
assert.equal(titles.shouldSuppressFlightFraming({ transportationPreference: "flight", hasConfirmedFlight: false }), true);
assert.equal(titles.shouldSuppressFlightFraming({ transportationPreference: "flight", hasConfirmedFlight: true }), false);

const budget = loadTsModule("lib/roamly/budgetPresentation.ts");
const gaps = budget.buildBudgetPresentation({
  budgetAmount: 800,
  currency: "CAD",
  totalEstimateAmount: 1677,
  breakdown: {
    lodging: "",
    food: "",
    activities: "",
    transport: "",
    buffer: "",
    total_estimate: "",
    notes: "",
    budget_status: "over_budget",
    budget_category_confidence: []
  },
  priceDiscovery: { unknownMarketPriceCount: 2, unknownMarketPriceCategories: ["hotel", "activity"] }
});
assert.equal(gaps.status, "BUDGET_UNCERTAIN");
assert.match(gaps.statusDetail, /not treated as zero/);
assert.equal(gaps.pricedLabel === "CAD 0", false);
assert.notEqual(gaps.pricedLabel, "CAD 1,677");
assert.match(gaps.unpricedLabel, /Hotel price|activity/i);

const nav = loadTsModule("lib/roamly/shellNav.ts");
const navHrefs = ["/dashboard", "/plan", "/finds", "/notifications", "/account"];
assert.equal(nav.primaryNavActiveHref("/trip/abc/bookings", navHrefs), "/dashboard");
assert.notEqual(nav.primaryNavActiveHref("/trip/abc/bookings", navHrefs), "/notifications");
assert.equal(nav.primaryNavActiveHref("/notifications", navHrefs), "/notifications");

const notes = loadTsModule("lib/roamly/travelerNotes.ts");
const festival = notes.travelerNoteDisplay("festival if any");
assert.match(festival.constraints.join(" "), /festival/i);
assert.ok(festival.gaps.length > 0);
assert.match(festival.activity, /official event/i);
assert.match(festival.hotel, /stays/i);
assert.equal(notes.noteHotelPreference("festival if any").includes("event"), true);
const ranked = notes.rankChoicesForNotes(
  [{ title: "Old Montreal walk" }, { title: "Official events in Montreal" }],
  "festival if any",
  (item) => item.title
);
assert.match(ranked[0].title, /events/i);

const notificationTrips = loadTsModule("lib/roamly/notificationTrip.ts");
const current = notificationTrips.selectNotificationTrip([
  { id: "old", status: "completed", start_date: "2026-01-01", end_date: "2026-01-04", tracking_unlocked: true },
  { id: "mtl", status: "planned", start_date: "2026-10-30", end_date: "2026-11-02", tracking_unlocked: true, live_companion_unlocked: true }
], new Date("2026-10-05T15:00:00.000Z"));
assert.equal(current.id, "mtl");
assert.equal(notificationTrips.tripCompanionUnlocked(current), true);

const ranking = loadTsModule("lib/roamly/dashboardTripPresentation.ts");
const montreal = { id: "mtl", status: "upcoming", itinerary_locked: true, start_date: "2026-10-20", end_date: "2026-10-24", tracking_unlocked: true, created_at: "2026-09-01T00:00:00.000Z" };
const manila = { id: "mnl", status: "draft", itinerary_locked: false, start_date: "2026-11-01", end_date: "2026-12-08", created_at: "2026-10-04T00:00:00.000Z" };
assert.ok(ranking.compareDashboardTrips(montreal, manila, "2026-10-05T00:00:00.000Z") < 0, "unlocked upcoming trip ranks above a newer draft");

const nextConfig = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
assert.match(nextConfig, /source:\s*"\/alerts"[\s\S]*destination:\s*"\/notifications"/);
const shell = fs.readFileSync(path.join(root, "components/AppShellClient.tsx"), "utf8");
assert.match(shell, /href: "\/notifications"/);
assert.match(shell, /clearPlannerDraftOnLogout/);
assert.doesNotMatch(fs.readFileSync(path.join(root, "components/roamly/DynamicDestinationHero.tsx"), "utf8"), /for life/);
assert.match(fs.readFileSync(path.join(root, "components/roamly/GmailImportPanel.tsx"), "utf8"), /not claiming a 30-minute refresh/);
assert.match(fs.readFileSync(path.join(root, "app/finds/page.tsx"), "utf8"), /FindsEditorialMagazine[\s\S]*FindsQuickBook/);
const generateButton = fs.readFileSync(path.join(root, "components/trip/GenerateLockedItineraryButton.tsx"), "utf8");
assert.match(generateButton, /generationInFlight\.current\) return/);
assert.match(generateButton, /ITINERARY_GENERATING/);
assert.match(generateButton, /router\.refresh\(\)/);

console.log("Roamly phase 3 traveler checks passed.");
