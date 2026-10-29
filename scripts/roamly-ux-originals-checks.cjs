// Originals pass (2026-10-26): source checks for the details the
// owner-supplied originals confirmed. No rendering here — the signed-in
// 390px captures prove the pixels; these checks pin the code shapes.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let passed = 0;
let total = 0;
function check(name, ok) {
  total += 1;
  if (ok) passed += 1;
  else console.log("FAIL:", name);
}

const gate = read("components/roamly/TripSetupGate.tsx");
check("setup footnote is centered (originals: centered, not left)", gate.includes('text-center text-[15px]') && gate.includes("You can still view your full itinerary with limited features."));

const home = read("components/trip/ItineraryHomePanel.tsx");
check("home panel imports VenueThumb + venuePhotoForTitle", home.includes("VenueThumb") && home.includes("venuePhotoForTitle"));
check("home thumbnails gated to venue rows only", home.includes('row.kind === "venue"') && home.includes("HomeRowThumb"));

const live = read("components/trip/LiveTripClient.tsx");
check("live client carries venuePhotos prop", live.includes("venuePhotos?: VenuePhotoMap"));
check("live pre-trip rows render LiveRowThumb", live.includes("LiveRowThumb venuePhotos={venuePhotos} title={row.title}"));
// Owner-10 item 6 supersedes the old full-timeline shape: the
// in-progress Today tab is a featured card + a compact upcoming list
// (time + title + pill, explicitly NO thumbnail), so in-progress rows
// no longer render LiveRowThumb. Pre-trip rows still do (checked
// above). This pins the new shape so a thumbnail creeping back into
// the compact list fails loudly.
check("live in-progress compact rows carry no thumbnail (owner-10 item 6)", live.includes("upcomingActivities.map") && !live.includes("LiveRowThumb venuePhotos={venuePhotos} title={timelineRowTitle("));
check("live pre-trip banner copy matches mock structure", live.includes("Trip hasn&apos;t started yet") && live.includes("These are your planned activities for Day") && live.includes("real-time updates when the trip begins"));
check("live banner icon uses token color (no hardcoded hex)", !live.includes('stroke="#1E88E5"'));

const venues = read("lib/roamly/venuePhotos.ts");
check("venue filter is activity/meal only", venues.includes('kind === "activity" || kind === "meal"'));
check("venue title normalization strips accents", venues.includes("normalize(\"NFD\")") && venues.includes("\\u0300"));

const dirPage = read("app/trip/[id]/directions/[placeId]/page.tsx");
check("directions strip falls back to destination photo", dirPage.includes("destinationPhoto = !stopPhoto") && dirPage.includes("label: destinationLabel"));
check("directions strip passes credit/pageUrl through", dirPage.includes("credit: photo.credit") && dirPage.includes("pageUrl: photo.pageUrl"));
const dirScreen = read("components/trip/DirectionsScreen.tsx");
check("directions strip renders credit line", dirScreen.includes("Photo:") && dirScreen.includes("photo.credit"));

const country = read("components/roamly/CountryInfoPanel.tsx");
check("country cell maps Canada to the real flag glyph", country.includes("🇨🇦") && country.includes('"canada"'));
check("country cell keeps generic outline for other countries", country.includes('cellKey === "country"') && country.includes("M5 21V4"));

const place = read("components/roamly/PlaceDetailPanel.tsx");
check("place title is never hand-shortened (no hardcoded short title)", !place.includes("Musée du marché Sainte-Anne"));

const pipeline = read("lib/roamly/destinationPhoto.ts");
check("pipeline gate requires coords-bearing entities for coords queries", pipeline.includes("if (coords && (!entityCoords || distanceKm(coords, entityCoords) > MAX_COORD_DISTANCE_KM)) continue;"));
// Same gate, rewritten form (owner-10 item 3 variant loop): the first
// variant yielding a scored candidate wins, and score 0 never wins.
check("pipeline rejects zero-evidence matches", pipeline.includes("if (best && best.score > 0) return best;"));

console.log(`${passed}/${total} originals checks passed (root: ${root})`);
process.exit(passed === total ? 0 : 1);
