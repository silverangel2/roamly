// roamly-ux-round2-b2-checks.mjs — BUILDER B2 proof (Round 2 UX repair).
// Country Info panel: the tabbed page (Overview / Entry & Travel /
// Transport / Safety) built to the owner-approved composite's structure,
// with data from the trip's own record only — never the composite's
// sample values, never invented country facts, weather, or advice.
// Runtime checks import the tree's own TS via the alias loader; STATIC
// checks prove the component/page actually wire the model that way.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2-b2-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC (date/timezone formatting
// must be identical under both: calendar dates parse without a timezone
// shift, and zone offsets are computed for the trip's own start date).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCountryInfoPanelModel,
  currencyDisplayForCountry,
  formatTripDateRange,
  formatTripTimezone,
  rawTripTimezone
} from "@/lib/roamly/countryInfoPanel.ts";
import { COUNTRY_INFO_TABS } from "@/lib/roamly/countryInfoPanelTypes.ts";
import {
  buildCountryInfo,
  filterDomesticCountryInfoReminders
} from "@/lib/roamly/tripCompanion.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, kind, ok, detail = "") {
  results.push({ name, kind, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${kind}] ${name}${detail ? ` — ${detail}` : ""}`);
}
const CROSS_BORDER = /passport|embassy|consulate|roaming|eSIM|visa|entry documents/i;
const MOCK_SAMPLES = ["12°C", "8–14°C", "8-14°C", "Partly cloudy", "Type A/B", "120V", "60Hz"];

const montrealTrip = {
  id: "trip-montreal",
  destination: "Montreal, Canada",
  destination_city: "Montreal",
  destination_country: "Canada",
  destination_region: "Québec",
  origin: "Saint John",
  origin_country: "Canada",
  start_date: "2026-10-26",
  end_date: "2026-10-30",
  transportation_preference: "Mixed",
  metadata: {
    planning: {
      originCountry: "Canada",
      destinationCountry: "Canada",
      destinationCity: "Montreal",
      destinationRegion: "Québec",
      timezone: "America/Toronto",
      transportationPreference: "Mixed"
    }
  }
};

const parisTrip = {
  id: "trip-paris",
  destination: "Paris, France",
  destination_city: "Paris",
  destination_country: "France",
  origin: "New York",
  origin_country: "United States",
  start_date: "2026-11-02",
  end_date: "2026-11-06",
  metadata: { planning: { originCountry: "United States", destinationCountry: "France" } }
};

const unknownTrip = {
  id: "trip-unknown",
  destination: "Mystery Place",
  start_date: null,
  end_date: null,
  metadata: {}
};

const franceDomesticTrip = {
  id: "trip-france-domestic",
  destination: "Paris, France",
  destination_city: "Paris",
  destination_country: "France",
  origin: "Lyon",
  origin_country: "France",
  start_date: "2026-11-02",
  end_date: "2026-11-05",
  metadata: { planning: { originCountry: "France", destinationCountry: "France" } }
};

const montreal = buildCountryInfoPanelModel(montrealTrip, null);
const paris = buildCountryInfoPanelModel(parisTrip, null);
const unknown = buildCountryInfoPanelModel(unknownTrip, null);
const franceDomestic = buildCountryInfoPanelModel(franceDomesticTrip, null);

// ---- Tabs: exactly the composite's four, in order ----
check("tab set is exactly Overview / Entry & Travel / Transport / Safety", "FIXTURE",
  JSON.stringify(COUNTRY_INFO_TABS.map((t) => t.label)) ===
    JSON.stringify(["Overview", "Entry & Travel", "Transport", "Safety"]) &&
  JSON.stringify(COUNTRY_INFO_TABS.map((t) => t.id)) ===
    JSON.stringify(["overview", "entry-travel", "transport", "safety"]),
  JSON.stringify(COUNTRY_INFO_TABS));

// ---- Domestic (Montreal) model ----
check("domestic route derived from the trip's own countries", "FIXTURE",
  montreal.routeType === "domestic", montreal.routeType);
check("domestic notes are the composite's four, in order", "FIXTURE",
  JSON.stringify(montreal.notes) === JSON.stringify([
    "Check your government-issued ID for domestic travel.",
    "Confirm your flight or bus schedule and allow extra time for potential delays.",
    "Check weather and pack appropriate clothing.",
    "Save local emergency number: 911."
  ]), JSON.stringify(montreal.notes));
check("domestic notes carry zero cross-border bullets", "FIXTURE",
  montreal.notes.every((note) => !CROSS_BORDER.test(note)));
check("domestic header identity: destination + dates + origin", "FIXTURE",
  montreal.destinationLabel.includes("Montreal") &&
  montreal.dateRange === "Oct 26 – Oct 30, 2026" &&
  montreal.originLabel === "Saint John",
  `${montreal.destinationLabel} | ${montreal.dateRange} | ${montreal.originLabel}`);
check("domestic grid: country + city with region from the trip record", "FIXTURE",
  montreal.grid.find((c) => c.key === "country")?.value === "Canada" &&
  montreal.grid.find((c) => c.key === "city")?.value === "Montreal (Québec)",
  JSON.stringify(montreal.grid));
check("domestic grid: timezone is computed for the trip start date, not UTC fallback", "FIXTURE",
  (() => {
    const value = montreal.grid.find((c) => c.key === "timezone")?.value;
    return Boolean(value) && value.includes("UTC-04:00") &&
      (value.includes("Eastern") || value.includes("America/Toronto"));
  })(), montreal.grid.find((c) => c.key === "timezone")?.value || "null");
check("domestic grid: currency from the codebase's country map", "FIXTURE",
  montreal.grid.find((c) => c.key === "currency")?.value === "Canadian Dollar (CAD)");
check("domestic grid: language + power are unavailable, never invented", "FIXTURE",
  montreal.grid.find((c) => c.key === "language")?.value === null &&
  montreal.grid.find((c) => c.key === "power")?.value === null &&
  (montreal.grid.find((c) => c.key === "language")?.unavailable || "").toLowerCase().includes("not available") &&
  (montreal.grid.find((c) => c.key === "power")?.unavailable || "").toLowerCase().includes("not available"));
check("weather is an honest unavailable state, never mock temperatures", "FIXTURE",
  montreal.weather.status === "unavailable" &&
  montreal.weather.message.includes("not available") &&
  !MOCK_SAMPLES.some((sample) => JSON.stringify(montreal).includes(sample)));
check("no-photo trip renders a null photo (bare header, never broken image)", "FIXTURE",
  montreal.photo === null);
check("see-full-itinerary links at this trip only", "FIXTURE",
  montreal.itineraryHref === "/trip/trip-montreal");
check("entry tab: domestic ID line + requirements unavailable", "FIXTURE",
  JSON.stringify(montreal.entryTravel.lines) ===
    JSON.stringify(["Check your government-issued ID for domestic travel."]) &&
  montreal.entryTravel.requirementsUnavailable.includes("not available"));
check("safety tab: 911 line first, advisory unavailable", "FIXTURE",
  montreal.safety.lines[0] === "Save local emergency number: 911." &&
  montreal.safety.advisoryUnavailable.includes("not available"));
check("transport tab: preference from the trip record", "FIXTURE",
  montreal.transport.preference === "Mixed" &&
  montreal.transport.scheduleLine.includes("flight or bus schedule") &&
  montreal.transport.schedulesUnavailable.includes("not available"));

// ---- International model ----
check("international route derived from differing countries", "FIXTURE",
  paris.routeType === "international", paris.routeType);
check("international notes keep the applicable cross-border set", "FIXTURE",
  paris.notes.some((n) => /passport/i.test(n)) &&
  paris.notes.some((n) => /roaming/i.test(n)) &&
  paris.notes.some((n) => /embassy/i.test(n)));
check("international notes never carry a literal 911", "FIXTURE",
  paris.notes.every((n) => !n.includes("911")));
check("international grid currency is Euro (EUR)", "FIXTURE",
  paris.grid.find((c) => c.key === "currency")?.value === "Euro (EUR)");

// ---- Unknown route model ----
check("unknown route: no invented cross-border bullets", "FIXTURE",
  unknown.routeType === "unknown" &&
  unknown.notes.every((note) => !CROSS_BORDER.test(note)),
  JSON.stringify(unknown.notes));
check("unknown route: summary says route countries are not confirmed", "FIXTURE",
  unknown.notesSummary.includes("not confirmed"));
check("unknown route: country/city cells are unavailable, not guessed", "FIXTURE",
  unknown.grid.find((c) => c.key === "country")?.value === null &&
  unknown.grid.find((c) => c.key === "city")?.value === null &&
  unknown.dateRange === null);

// ---- Non-Canada domestic: no invented emergency number ----
check("non-Canada domestic keeps the generic emergency line, never 911", "FIXTURE",
  franceDomestic.routeType === "domestic" &&
  franceDomestic.notes.some((n) => n === "Confirm local emergency numbers before you travel.") &&
  franceDomestic.notes.every((n) => !n.includes("911")),
  JSON.stringify(franceDomestic.notes));

// ---- Builder rule (B's logic, carried forward) ----
check("buildCountryInfo domestic via tripCompanion has zero cross-border bullets", "FIXTURE",
  (() => {
    const info = buildCountryInfo("Canada", "Montreal", { originCountry: "Canada", crossBorder: false });
    return info.routeType === "domestic" && info.reminders.every((r) => !CROSS_BORDER.test(r));
  })());
check("stored domestic guard strips cross-border bullets", "FIXTURE",
  JSON.stringify(filterDomesticCountryInfoReminders([
    "Verify entry documents and passport validity.",
    "Check weather and pack appropriate clothing."
  ])) === JSON.stringify(["Check weather and pack appropriate clothing."]));

// ---- Timezone / date / currency helpers ----
check("raw timezone: absent zone is null, never a UTC fallback", "FIXTURE",
  rawTripTimezone({}) === null && rawTripTimezone({ planning: {} }) === null);
check("raw timezone: invalid zone is null, valid zone passes through", "FIXTURE",
  rawTripTimezone({ planning: { timezone: "Not/AZone" } }) === null &&
  rawTripTimezone({ planning: { timezone: "America/Toronto" } }) === "America/Toronto");
check("formatted timezone: Toronto in late October is UTC-04:00", "FIXTURE",
  (() => {
    const value = formatTripTimezone("America/Toronto", "2026-10-26");
    return Boolean(value) && value.includes("UTC-04:00");
  })(), formatTripTimezone("America/Toronto", "2026-10-26") || "null");
check("formatted timezone: null zone is null", "FIXTURE",
  formatTripTimezone(null, "2026-10-26") === null);
check("date range: composite form, same-day form, missing form", "FIXTURE",
  formatTripDateRange("2026-10-26", "2026-10-30") === "Oct 26 – Oct 30, 2026" &&
  formatTripDateRange("2026-10-26", "2026-10-26") === "Oct 26, 2026" &&
  formatTripDateRange(null, null) === null);
check("currency: mapped countries only, unmapped is null (never guessed)", "FIXTURE",
  currencyDisplayForCountry("Canada") === "Canadian Dollar (CAD)" &&
  currencyDisplayForCountry("United States") === "US Dollar (USD)" &&
  currencyDisplayForCountry("France") === "Euro (EUR)" &&
  currencyDisplayForCountry("Japan") === null &&
  currencyDisplayForCountry(null) === null);

// ---- Per-trip isolation ----
check("per-trip isolation: two trips never share id, destination, or link", "FIXTURE",
  montreal.tripId !== paris.tripId &&
  montreal.destinationLabel !== paris.destinationLabel &&
  montreal.itineraryHref === "/trip/trip-montreal" &&
  paris.itineraryHref === "/trip/trip-paris" &&
  !JSON.stringify(montreal).includes("trip-paris") &&
  !JSON.stringify(paris).includes("trip-montreal"));
check("photo passthrough: a real photo survives, null stays null", "FIXTURE",
  (() => {
    const photo = { imageUrl: "https://example.invalid/montreal.jpg", credit: "Example · CC BY-SA 4.0", pageUrl: null };
    const withPhoto = buildCountryInfoPanelModel(montrealTrip, photo);
    return withPhoto.photo?.imageUrl === photo.imageUrl && withPhoto.photo?.credit === photo.credit;
  })());

// ---- Static wiring ----
{
  const component = read("components/roamly/CountryInfoPanel.tsx");
  const page = read("app/trip/[id]/country-info/page.tsx");
  const eventPage = read("app/trip/[id]/event/[eventId]/page.tsx");
  check("component: real tablist rendering the four tab ids from the tab set", "STATIC",
    component.includes('role="tablist"') &&
    component.includes("data-tab-id={tab.id}") &&
    component.includes("COUNTRY_INFO_TABS.map"));
  check("component: grid heading, notes heading, itinerary button text", "STATIC",
    component.includes("Key information") &&
    component.includes("Travel notes for this trip") &&
    component.includes("See full itinerary"));
  check("component: weather unavailable state rendered in the photo block position", "STATIC",
    component.includes("model.weather.message"));
  check("component: imports no server builder (types module only)", "STATIC",
    !component.includes('from "@/lib/roamly/countryInfoPanel"') &&
    component.includes('from "@/lib/roamly/countryInfoPanelTypes"'));
  check("component: photo unmounts on error (load guarantee)", "STATIC",
    component.includes('onError={() => setPhotoState("failed")}') &&
    component.includes('photoState !== "failed"'));
  check("component: never renders mock sample temperatures", "STATIC",
    !component.includes("12°C") && !component.includes("Partly cloudy") && !component.includes("8–14"));
  check("page: per-user bundle load + photo pipeline + panel render", "STATIC",
    page.includes("getTripBundle(supabase, current.user.id, id)") &&
    page.includes("getDestinationPhoto({") &&
    page.includes("<CountryInfoPanel") &&
    page.includes("buildCountryInfoPanelModel(trip, destinationPhoto)"));
  check("page: initial tab comes from the query, validated by the component", "STATIC",
    page.includes("initialTab={requestedTab}"));
  check("event sheet: country_info links onward to this trip's country-info page", "STATIC",
    eventPage.includes('href={`/trip/${id}/country-info`}') &&
    eventPage.includes("Open the full country info page"));
  check("event sheet: domestic guard still present", "STATIC",
    eventPage.includes('info.routeType === "domestic"'));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ""}`);
if (failed.length) {
  for (const failure of failed) console.log(`FAILED: ${failure.name}`);
  process.exitCode = 1;
}
