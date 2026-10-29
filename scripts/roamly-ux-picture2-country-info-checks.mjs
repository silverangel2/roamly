// roamly-ux-picture2-country-info-checks.mjs — Picture 2 overhaul proof.
// Country Info screen rebuilt literally against
// screenshots-latest/correct-4-pages.jpg, TOP-RIGHT panel:
// header (back chevron, COUNTRY INFO eyebrow, destination, date
// line, bookmark + ellipsis) → tabs Overview / Entry & Travel /
// Transport / Safety → photo hero with weather overlay card →
// "Key information" grid (icon + label + value lines, six cells) →
// "Travel notes for this trip" checklist card → full-width
// "See full itinerary" button, and nothing below it. Values are
// always real and dynamic; the picture's sample weather, flag,
// language, and power values are never copied as live data.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-picture2-country-info-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCountryInfoPanelModel } from "@/lib/roamly/countryInfoPanel.ts";

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
const MOCK_SAMPLES = ["12°C", "8–14°C", "8-14°C", "Partly cloudy", "Type A/B", "120V", "60Hz", "Eastern Time", "French (main)", "English (widely)"];

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

const noDatesTrip = {
  id: "trip-nodates",
  destination: "Montreal, Canada",
  destination_city: "Montreal",
  destination_country: "Canada",
  start_date: null,
  end_date: null,
  metadata: {}
};

const montreal = buildCountryInfoPanelModel(montrealTrip, null);
const noDates = buildCountryInfoPanelModel(noDatesTrip, null);
const component = read("components/roamly/CountryInfoPanel.tsx");
const page = read("app/trip/[id]/country-info/page.tsx");

// ---- Model: picture-shaped values, real sources only ----
check("grid valueLines split the parenthesised tail to a second line", "FIXTURE",
  JSON.stringify(montreal.grid.find((c) => c.key === "city")?.valueLines) ===
    JSON.stringify(["Montreal", "(Québec)"]) &&
  JSON.stringify(montreal.grid.find((c) => c.key === "currency")?.valueLines) ===
    JSON.stringify(["Canadian Dollar", "(CAD)"]) &&
  JSON.stringify(montreal.grid.find((c) => c.key === "country")?.valueLines) ===
    JSON.stringify(["Canada"]),
  JSON.stringify(montreal.grid.map((c) => [c.key, c.valueLines])));
check("timezone valueLines carry the offset as the second line", "FIXTURE",
  (() => {
    const lines = montreal.grid.find((c) => c.key === "timezone")?.valueLines;
    return Boolean(lines) && lines.length === 2 && lines[1].includes("UTC-04:00");
  })(), JSON.stringify(montreal.grid.find((c) => c.key === "timezone")?.valueLines));
check("unavailable cells have null valueLines (language + power gaps)", "FIXTURE",
  montreal.grid.find((c) => c.key === "language")?.valueLines === null &&
  montreal.grid.find((c) => c.key === "power")?.valueLines === null);
check("weather avg label is derived from the trip's own dates", "FIXTURE",
  montreal.weather.avgLabel === "Oct 26 – 30 avg.",
  montreal.weather.avgLabel || "null");
check("weather avg label is null without usable trip dates", "FIXTURE",
  noDates.weather.avgLabel === null);
check("model carries zero picture sample values as live data", "FIXTURE",
  !MOCK_SAMPLES.some((sample) => JSON.stringify(montreal).includes(sample)),
  "mock samples checked against the full model JSON");
check("domestic notes are exactly the picture's four, in order", "FIXTURE",
  JSON.stringify(montreal.notes) === JSON.stringify([
    "Check your government-issued ID for domestic travel.",
    "Confirm your flight or bus schedule and allow extra time for potential delays.",
    "Check weather and pack appropriate clothing.",
    "Save local emergency number: 911."
  ]), JSON.stringify(montreal.notes));

// ---- Component: picture inventory, top to bottom ----
check("header: back chevron link to this trip + COUNTRY INFO eyebrow", "STATIC",
  component.includes('aria-label="Back to itinerary"') &&
  component.includes("href={model.itineraryHref}") &&
  component.includes(">COUNTRY INFO<"));
check("header: bookmark + ellipsis icons present", "STATIC",
  component.includes("BookmarkIcon") && component.includes("•••"));
check("header: no From-origin line on this screen", "STATIC",
  !component.includes("From {model.originLabel}") &&
  !component.includes("model.originLabel"));
check("tabs: four ids from the tab set, one panel at a time", "STATIC",
  component.includes("COUNTRY_INFO_TABS.map") &&
  component.includes('data-tab-id={tab.id}') &&
  component.includes('data-panel-id="overview"') &&
  component.includes('data-panel-id="entry-travel"') &&
  component.includes('data-panel-id="transport"') &&
  component.includes('data-panel-id="safety"'));
check("photo hero: weather overlay card with message + avg label", "STATIC",
  component.includes("data-weather-overlay") &&
  component.includes("model.weather.message") &&
  component.includes("model.weather.avgLabel"));
check("photo hero: no standalone weather paragraph outside the photo", "STATIC",
  !component.includes("mb-5 rounded-xl bg-cbg px-4 py-3"));
check("grid: icon per cell + valueLines rendering (first bold, rest plain)", "STATIC",
  component.includes("GridIcon cellKey={cell.key}") &&
  component.includes("cell.valueLines") &&
  component.includes("cell.valueLines[0]") &&
  component.includes("cell.valueLines.slice(1)"));
check("grid: six cells in the picture's order via the model grid", "STATIC",
  component.includes("model.grid.map((cell)") &&
  JSON.stringify(montreal.grid.map((c) => c.key)) ===
    JSON.stringify(["country", "city", "timezone", "currency", "language", "power"]));
check("notes: checklist inside a light card, no summary paragraph", "STATIC",
  component.includes("rounded-2xl bg-cbg px-4 py-4") &&
  component.includes("<CheckList items={model.notes} />") &&
  !component.includes("model.notesSummary"));
check("button: full-width See full itinerary with right-edge chevron", "STATIC",
  component.includes("See full itinerary") &&
  component.includes("absolute right-4") &&
  component.includes("justify-center"));
check("component: never renders mock sample temperatures or facts", "STATIC",
  !MOCK_SAMPLES.some((sample) => component.includes(sample)));
check("component: photo still unmounts on error (load guarantee)", "STATIC",
  component.includes('onError={() => setPhotoState("failed")}') &&
  component.includes('photoState !== "failed"'));
check("component: screen ends at the button (no block after it in Overview)", "STATIC",
  (() => {
    const overview = (component.split('data-panel-id="overview"')[1] || "").split('activeTab === "entry-travel"')[0];
    const afterButton = overview.split("See full itinerary")[1] || "";
    return !afterButton.includes("<h2") && !afterButton.includes("<section") && !afterButton.includes("CheckList");
  })());
check("page: per-user bundle load + photo pipeline + panel render unchanged", "STATIC",
  page.includes("getTripBundle(supabase, current.user.id, id)") &&
  page.includes("getDestinationPhoto({") &&
  page.includes("<CountryInfoPanel") &&
  page.includes("buildCountryInfoPanelModel(trip, destinationPhoto)"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ""}`);
if (failed.length) {
  for (const failure of failed) console.log(`FAILED: ${failure.name}`);
  process.exitCode = 1;
}
