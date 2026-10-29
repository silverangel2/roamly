// roamly-ux-round2-b-checks.mjs — BUILDER B proof (Round 2 UX repair).
// HIGH 3: day-heading merge (venues / travel legs / activities separated
// at the composition layer). HIGH 4: route-dependent country info
// (domestic trips get no passport/embassy/roaming bullets).
// Runtime checks import the tree's own TS via the alias loader; STATIC
// checks prove the displays actually use the new composition.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-round2-b-checks.mjs
// Run under both TZ=America/Moncton and TZ=UTC (the functions take no
// dates, but the contract requires both runs).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { presentDayHeading, splitMergedDayTitle, isTravelLeg } from "@/lib/roamly/itineraryPresentation.ts";
import { buildCountryInfo, buildDocumentChecklist, filterDomesticCountryInfoReminders } from "@/lib/roamly/tripCompanion.ts";

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

// ---- HIGH 3: day-heading composition ----
{
  const ownerTitle = "Musée du marché Sainte-Anne et du parlement de la province du Canada";
  const heading = presentDayHeading({ title: ownerTitle });
  check("owner title splits into distinct venues", "FIXTURE", heading.kind === "venues" &&
    heading.headings.length === 2 &&
    heading.headings[0] === "Musée du marché Sainte-Anne" &&
    heading.headings[1] === "Parlement de la province du Canada",
    JSON.stringify(heading));
  check("no single heading contains the merged title", "FIXTURE",
    heading.headings.every((h) => h !== ownerTitle && !h.includes(" et du parlement")));
  check("splitMergedDayTitle: English join also splits", "FIXTURE",
    JSON.stringify(splitMergedDayTitle("Old Montreal and the Old Port")) === JSON.stringify(["Old Montreal", "Old Port"]));
  check("single venue stays a single heading", "FIXTURE",
    (() => { const h = presentDayHeading({ title: "Old Port" }); return h.kind === "single" && h.headings.length === 1 && h.headings[0] === "Old Port"; })());
  check("unconfident join is uncertain, not split into invented venues", "FIXTURE",
    (() => { const h = presentDayHeading({ title: "Musée d'art et d'histoire" }); return h.kind === "uncertain" && h.headings.length === 0 && h.needsConfirmation; })(),
    "one venue name containing 'et' must not become two venues");
  const travelDay = presentDayHeading({ title: "Travel, arrival, and first easy local stop" });
  check("travel day heading is labeled Travel", "FIXTURE",
    travelDay.kind === "travel" && travelDay.headings.length === 1 && /^Travel\b/.test(travelDay.headings[0]),
    JSON.stringify(travelDay));
  check("route title is a travel leg, not an activity", "FIXTURE",
    presentDayHeading({ title: "Getting from Saint John to Montreal" }).kind === "travel");
  check("isTravelLeg: travel category is travel, activity category is not", "FIXTURE",
    isTravelLeg({ title: "Drive to the venue", category: "travel" }) === true &&
    isTravelLeg({ title: "Old Port", category: "activity" }) === false &&
    isTravelLeg({ title: "Musée du marché Sainte-Anne", category: "activity" }) === false);
}

// ---- HIGH 3: displays use the composition (STATIC) ----
{
  const timeline = read("components/roamly/CurrentDayTimeline.tsx");
  check("CurrentDayTimeline renders presentDayHeading, not the raw title", "STATIC",
    timeline.includes("presentDayHeading") && timeline.includes("dayHeadings.map"));
  check("CurrentDayTimeline labels travel activities", "STATIC",
    timeline.includes("isTravelLeg") && timeline.includes(">Travel<"));
  check("CurrentDayTimeline uncertain heading falls back, never merges", "STATIC",
    timeline.includes('kind === "uncertain"'));
  const dayPlan = read("components/trip/ItineraryDayPlan.tsx");
  check("DayTimelineCard renders presentDayHeading venues + Travel badge", "STATIC",
    dayPlan.includes("presentDayHeading") && dayPlan.includes("dayHeadings.map") && dayPlan.includes("itemIsTravel"));
  const guest = read("components/plan/GuestFreeItinerary.tsx");
  check("GuestFreeItinerary renders presentDayHeading venues", "STATIC",
    guest.includes("presentDayHeading"));
}

// ---- HIGH 4: route-dependent country info ----
{
  const domestic = buildCountryInfo("Canada", "Montreal", { originCountry: "Canada", crossBorder: false });
  check("domestic trip: zero passport/embassy/roaming bullets", "FIXTURE",
    domestic.routeType === "domestic" && domestic.reminders.every((r) => !CROSS_BORDER.test(r)) && domestic.reminders.length > 0,
    JSON.stringify(domestic));
  check("domestic summary names no embassy", "FIXTURE", !/embassy/i.test(domestic.summary || ""));
  const intl = buildCountryInfo("France", "Paris", { originCountry: "Canada", crossBorder: true });
  check("international trip: applicable set present", "FIXTURE",
    intl.routeType === "international" &&
    intl.reminders.some((r) => /passport/i.test(r)) &&
    intl.reminders.some((r) => /roaming|eSIM/i.test(r)) &&
    intl.reminders.some((r) => /embassy|consulate/i.test(r)),
    JSON.stringify(intl));
  const unknown = buildCountryInfo("Canada", "Montreal");
  check("unknown route: no cross-border bullets invented", "FIXTURE",
    unknown.routeType === "unknown" && unknown.reminders.every((r) => !CROSS_BORDER.test(r)),
    JSON.stringify(unknown));
  check("render guard strips cross-border bullets from a stored domestic record", "FIXTURE",
    filterDomesticCountryInfoReminders([
      "Verify entry documents and passport validity.",
      "Confirm local emergency numbers before you travel."
    ]).length === 1);
  const domesticDocs = buildDocumentChecklist({
    destination_country: "Canada", destination_city: "Montreal", origin_country: "Canada",
    origin: "Saint John", destination: "Montreal, Canada", metadata: null
  });
  check("domestic document checklist: no passport/visa lines", "FIXTURE",
    domesticDocs.every((d) => !CROSS_BORDER.test(d)), JSON.stringify(domesticDocs));
}

// ---- HIGH 4: builder + render wiring (STATIC) ----
{
  const companion = read("lib/roamly/tripCompanion.ts");
  check("schedule passes the trip's own origin/cross-border info to buildCountryInfo", "STATIC",
    companion.includes("originCountry: crossBorderInfo.origin_country") && companion.includes("crossBorder: crossBorderInfo.cross_border"));
  check("buildCountryInfo derives domestic from normalized origin/destination", "STATIC",
    companion.includes("normalizeCountry(route?.originCountry)") && companion.includes("isDomestic"));
  const eventPage = read("app/trip/[id]/event/[eventId]/page.tsx");
  check("event sheet filters stored domestic records at render", "STATIC",
    eventPage.includes('routeType === "domestic"') && eventPage.includes("passport|embassy|consulate|roaming"));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (TZ=${process.env.TZ || "unset"})`);
if (failed.length) {
  console.log("FAILED:", failed.map((f) => f.name).join("; "));
  process.exit(1);
}
