// roamly-ux-final-local-checks.mjs — FINAL LOCAL TASKS ROUND
// (2026-10-27, local only). Pins the three code tasks plus the
// preserved offline safeguards:
//   Task 1 — offline destination images: SW v4 caches allowlisted
//     Wikimedia trip images per user (same isolation as documents);
//     photo components render a Roamly-branded fallback (never a
//     fake/wrong photo) when the photo cannot load, with credit
//     only beside a loaded real photo.
//   Task 2 — compact expandable setup notice: one short collapsed
//     line, full details on tap, same feature strings, Settings route.
//   Task 3 — natural itinerary language: day-open frames state plan
//     facts (real first stop + real time), no judged-time wording.
//   Task 5 — offline safeguards still hold (v4 version, per-user
//     docs/prefs/images caches, sign-out purge incl. images,
//     account-switch deletion incl. images, no token caching).
// Behavior itself is proven headless by scripts/roamly-ux-offline-proof.mjs.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-final-local-checks.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAMES, composeDay, newComposerState } from "@/lib/roamly/engine/frames.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sw = read("public/sw.js");
const band = read("components/trip/DestinationPhotoBand.tsx");
const hero = read("components/roamly/TripHeroCard.tsx");
const notice = read("components/roamly/LimitedFeaturesNotice.tsx");
const homePanel = read("components/trip/ItineraryHomePanel.tsx");
const home = read("app/trip/[id]/page.tsx");
const frames = read("lib/roamly/engine/frames.ts");

// ---- Task 1: offline images ----
check("sw bumped to v4 (old v3 caches purged on activate)",
  sw.includes('ROAMLY_OFFLINE_VERSION = "roamly-offline-v4"') &&
  sw.includes('!n.startsWith(ROAMLY_OFFLINE_VERSION)'));
check("sw images cache is per-user (images-<userId> namespace)",
  sw.includes("ROAMLY_IMAGES_CACHE_PREFIX") && sw.includes("imagesCacheName()") &&
  sw.includes("`${ROAMLY_IMAGES_CACHE_PREFIX}${roamlyUserId"));
check("sw image allowlist is Wikimedia hosts only",
  sw.includes('"upload.wikimedia.org"') && sw.includes('"thumb.wikimedia.org"') &&
  sw.includes("ROAMLY_IMAGE_HOSTS.has(url.hostname)"));
check("sw caches cross-origin images only for image requests with a known user",
  sw.includes('request.destination === "image"') && sw.includes("tripImage(event)") &&
  sw.includes("ROAMLY_IMAGE_HOSTS.has(url.hostname)"));
check("sw image path is network-first with cached fallback (never a fabricated response)",
  sw.includes("async function tripImage") && sw.includes("cache.match(request)") &&
  sw.includes("cache.put(request, response.clone())"));
check("sw image fetch is time-bounded (a stalled fetch fails over to cache/fallback, never a hung gradient)",
  sw.includes("AbortController") && sw.includes("8000") &&
  sw.includes("roamly-offline-image"));
check("sign-out purge deletes images caches with docs + prefs",
  sw.includes("ROAMLY_IMAGES_CACHE_PREFIX") &&
  sw.includes("n.startsWith(ROAMLY_IMAGES_CACHE_PREFIX)") &&
  sw.includes('message.type === "roamly_logout"'));
check("account switch deletes the previous user's images cache",
  sw.includes("caches.delete(`${ROAMLY_IMAGES_CACHE_PREFIX}${prev}`)"));
check("sw still never caches third parties other than allowlisted images",
  sw.includes("url.origin !== self.location.origin") &&
  sw.includes("ROAMLY_IMAGE_HOSTS"));
check("destination band renders a branded fallback on photo failure (no photo, no credit, no broken icon)",
  band.includes('data-testid="roamly-photo-fallback"') && band.includes("Roamly") &&
  band.includes('state === "failed"'));
check("destination band credit renders only with a loaded real photo",
  band.includes('state === "loaded" && credit'));
check("hero card renders a branded fallback panel on photo failure, keeping destination + dates + badge",
  hero.includes('data-testid="roamly-photo-fallback"') && hero.includes("Roamly") &&
  hero.includes("showPhoto ?"));
check("hero credit renders only with a loaded real photo",
  hero.includes('showPhoto && state === "loaded" && photo.credit'));
check("home panel renders a branded fallback when its pipeline photo fails (offline), keeping destination + dates",
  homePanel.includes('data-testid="roamly-photo-fallback"') &&
  homePanel.includes('photo && photoState === "failed"') &&
  homePanel.includes("from-teal-700"));
check("home panel keeps the approved bare header when NO photo exists at all",
  homePanel.includes("border-b border-chair px-4 pb-4"));
check("home panel settles pre-hydration photo failures (no stuck pending gradient)",
  homePanel.includes("photoImgRef") && homePanel.includes("img.complete") &&
  homePanel.includes("naturalWidth > 0"));

// ---- Task 2: compact expandable notice ----
check("notice component exists: one short collapsed line + expand affordance",
  notice.includes('data-testid="limited-features-notice"') &&
  notice.includes("Showing with limited features · Finish setup"));
check("notice expands via native <details> (no invented tap state)",
  notice.includes("<details") && notice.includes("<summary"));
check("notice expanded state carries the full feature list from the caller (never retyped)",
  notice.includes("features.join(\" · \")") && notice.includes("Finish setup") &&
  notice.includes("anytime in Settings to turn everything on."));
check("notice routes to setup (Settings link in the expanded state)",
  notice.includes('href="/account"'));
check("trip home renders the compact notice instead of the long paragraph",
  home.includes("<LimitedFeaturesNotice features={limitedFeatures} />") &&
  !home.includes("Finish setup anytime in"));
check("trip home keeps the same gate condition for the notice",
  home.includes("skipSetupGate && setupState && !setupState.complete"));

// ---- Task 3: natural itinerary language ----
check("dayOpen1 states the real first stop + real time, no 'humane hour'",
  FRAMES.dayOpen1({ dateLong: "Monday, October 26", firstName: "Musée X", firstTime: "09:37", earliest: "09:37" }) ===
    "Monday, October 26 starts with Musée X at 09:37." &&
  !frames.includes("humane hour"));
check("dayOpen2 states the anchor only, no 'walking stays easy'",
  FRAMES.dayOpen2({ dateLong: "Monday, October 26", anchorName: "Musée X" }) ===
    "Monday, October 26 is built around Musée X." &&
  !frames.includes("walking stays easy"));
check("dayOpen3 states start time + anchor, no 'gentle shape' / 'home before dinner'",
  FRAMES.dayOpen3({ dateLong: "Monday, October 26", dayNumber: 2, earliest: "09:37", anchorName: "Musée X" }) ===
    "Day 2 — monday, october 26 — starts at 09:37 with Musée X." &&
  !frames.includes("gentle shape") && !frames.includes("home before dinner"));
check("dayOpenRest states a slow morning, no 'breathing day' / 'good outing'",
  FRAMES.dayOpenRest({ dateLong: "Monday, October 26" }) ===
    "Monday, October 26 starts slowly, with the morning left open." &&
  !frames.includes("breathing day"));
check("dayOpenLight states the plan type only, no 'late start' / 'no rushing'",
  FRAMES.dayOpenLight({ dateLong: "Monday, October 26" }) ===
    "Monday, October 26 is a light day." &&
  !frames.includes("a late start, one or two good stops"));
const day = {
  dayNumber: 1,
  date: "2026-10-26",
  role: "",
  items: [{ type: "stop", name: "Musée X", start: 577, end: 697 }],
  legs: [],
  envelope: null,
  move: undefined,
  endMin: 1200
};
const composed = composeDay(day, { earliestLabel: "09:37", weatherByDate: {}, baseName: "Montreal", hasDietary: false, stay: null }, newComposerState());
check("composeDay day-1 opening is grounded in the plan's real first stop + real time",
  Array.isArray(composed) && composed.length > 0 &&
  composed[0].includes("Musée X") && composed[0].includes("09:37") &&
  !composed.join(" ").includes("humane hour"));

// ---- Task 5: preserved offline safeguards (v4) ----
check("trip documents still network-first in the per-user docs cache",
  sw.includes("tripDocument(event)") && sw.includes("networkFirst(event, request, docsCacheName())"));
check("trip content still cached only while a user id is known",
  sw.includes("if (roamlyUserId)") && sw.includes("without a known user id"));
check("null user report still never downgrades a known user",
  sw.includes("if (!next) return;"));
check("worker source still contains no token/cookie caching logic",
  !sw.includes("set-cookie") && !sw.includes("access_token") && !sw.includes("refresh_token") &&
  !sw.includes("authorization"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
