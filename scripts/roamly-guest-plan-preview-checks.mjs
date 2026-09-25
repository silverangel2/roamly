import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
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
      process,
      URL,
      URLSearchParams,
      Buffer,
      Date,
      setTimeout,
      clearTimeout,
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const local = path.join(path.dirname(file), id);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith("node:")) return require(id.slice(5));
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

process.env.ROAMLY_SESSION_TOKEN_SECRET = "guest-itinerary-test-secret";
const { publicGuestItineraryView, GUEST_FREE_ITINERARY_DISCLAIMER, GUEST_ACCOUNT_WALL, GUEST_ITINERARY_PATH } = loadTsModule("lib/roamly/guestItineraryView.ts");
const { signGuestItineraryCookie, verifyGuestItineraryCookie } = loadTsModule("lib/roamly/guestItineraryAccess.ts");

const fullJson = {
  trip_title: "Montreal long weekend",
  destination_summary: "Three days in Montreal.",
  generation_note: "Generated through Roamly staged AI generation.",
  booking_suggestions: [{ title: "Hotel checkout", affiliate_url: "https://example.test/book", estimated_cost_min: 120 }],
  daily_itinerary: [
    {
      day_number: 1,
      date: "2026-10-10",
      title: "Old Montreal",
      morning: "Arrive and walk the old port.",
      afternoon: "Notre-Dame Basilica.",
      evening: "Dinner in the Latin Quarter.",
      food: ["Schwartz's"],
      estimated_cost: 80,
      live_timeline: [{ time_label: "09:00", title: "Old Port", description: "https://maps.example/secret" }]
    },
    {
      day_number: 2,
      date: "2026-10-11",
      title: "Plateau",
      morning: "Mount Royal lookout.",
      afternoon: "Mile End wander.",
      evening: "Local show.",
      food: [],
      live_timeline: []
    }
  ]
};

const ready = publicGuestItineraryView({
  tripTitle: "Draft",
  destination: "Montreal",
  itineraryStatus: "generated",
  fullJson
});
assert.equal(ready.status, "ready");
assert.equal(ready.disclaimer, GUEST_FREE_ITINERARY_DISCLAIMER);
assert.equal(ready.days.length, 2);
assert.equal(ready.days[0].title, "Old Montreal");
assert.equal(ready.days[0].afternoon, "Notre-Dame Basilica.");
assert.equal(ready.days[1].morning, "Mount Royal lookout.");
assert.equal(ready.days[0].timeline[0].title, "Old Port");
assert.equal(JSON.stringify(ready.continuesBehindAccount), JSON.stringify(GUEST_ACCOUNT_WALL));
const readyJson = JSON.stringify(ready);
assert.doesNotMatch(readyJson, /https?:\/\//i);
assert.doesNotMatch(readyJson, /affiliate_url|booking_suggestions|checkout/i);
assert.equal("estimated_cost" in ready.days[0], false);

const building = publicGuestItineraryView({
  destination: "Montreal",
  tripStatus: "generating",
  metadata: {
    generation: {
      status: "generating",
      generatedDays: {
        "2": { day_number: 2, title: "Day two", morning: "Market", afternoon: "Museum", evening: "River" },
        "1": { day_number: 1, title: "Day one", morning: "Arrival", afternoon: "Basilica", evening: "Dinner" }
      }
    }
  }
});
assert.equal(building.status, "building");
assert.equal(JSON.stringify(building.days.map((day) => day.dayNumber)), JSON.stringify([1, 2]));
assert.equal(building.days[1].title, "Day two");

const failed = publicGuestItineraryView({ tripStatus: "failed", metadata: { generation: { status: "failed" } } });
assert.equal(failed.status, "failed");
assert.equal(failed.days.length, 0);

const token = signGuestItineraryCookie("trip-1", "user-1");
assert.equal(verifyGuestItineraryCookie(token)?.tripId, "trip-1");
assert.equal(verifyGuestItineraryCookie(token)?.userId, "user-1");
assert.equal(verifyGuestItineraryCookie(`${token}x`), null);
assert.equal(verifyGuestItineraryCookie("not-a-token"), null);
const expiredBody = Buffer.from(JSON.stringify({
  purpose: "roamly_guest_itinerary",
  tripId: "trip-1",
  userId: "user-1",
  exp: 1
}), "utf8").toString("base64url");
const expiredSignature = crypto.createHmac("sha256", process.env.ROAMLY_SESSION_TOKEN_SECRET).update(expiredBody).digest("base64url");
assert.equal(verifyGuestItineraryCookie(`${expiredBody}.${expiredSignature}`), null);

const planForm = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");
const guestPage = fs.readFileSync(path.join(root, "components/plan/GuestFreeItinerary.tsx"), "utf8");
const guestRoute = fs.readFileSync(path.join(root, "app/api/trips/guest-itinerary/route.ts"), "utf8");
const generateRoute = fs.readFileSync(path.join(root, "app/api/trips/generate/route.ts"), "utf8");

assert.match(planForm, /fetch\("\/api\/trips\/guest-itinerary"/);
assert.match(planForm, /requestGuestFreeItinerary\(generationPayload\)/);
assert.match(planForm, /submitPlan\(generationPayload\)/);
assert.match(planForm, /const PLAN_RESUME_PATH = "\/plan\?resumePlan=1&continueGenerate=1"/);
assert.match(
  planForm,
  /if \(!sessionUser && !apiAuthToken\) return;[\s\S]*resumeGenerateAttempted\.current = true;[\s\S]*void submitPlanRef\.current\?\.\(\)/
);
assert.doesNotMatch(planForm, /data-guest-day-preview|buildGuestDayPreview|showGuestDayPreview/);
assert.match(planForm, /redirectToLoginForGeneration\(\)/);
assert.match(planForm, /router\.push\(planLoginUrl\(\)\)/);

const generateHandler = planForm.slice(planForm.indexOf('fetchWithSupabaseAuth("/api/trips/generate"'));
const unauthenticatedGenerate = generateHandler.slice(
  generateHandler.indexOf("if (response.status === 401)"),
  generateHandler.indexOf("if (response.ok && data?.tripId)")
);
assert.match(unauthenticatedGenerate, /requestGuestFreeItinerary\(generationPayload\)/);
assert.doesNotMatch(unauthenticatedGenerate, /redirectToLoginForGeneration\(\)/);

assert.match(guestPage, /data-guest-free-itinerary/);
assert.match(guestPage, /data-guest-account-wall/);
assert.match(guestPage, /fetch\("\/api\/trips\/guest-itinerary"/);
assert.match(guestPage, /Create an account to save this itinerary, continue beyond this free itinerary, or unlock Live Companion and paid packs\./);
assert.match(guestPage, /const PLAN_RESUME_PATH = "\/plan\?resumePlan=1&continueGenerate=1"/);
assert.match(guestPage, /Sign up to save/);
assert.doesNotMatch(guestPage, /checkout|progressbar|percent/i);

assert.match(guestRoute, /admin\.auth\.admin\.createUser/);
assert.match(guestRoute, /email_confirm:\s*true/);
assert.match(guestRoute, /roamly_guest_itinerary:\s*true/);
assert.match(guestRoute, /@example\.com/);
assert.match(guestRoute, /generateTripForActor/);
assert.match(guestRoute, /eq\("user_id", access\.userId\)/);
assert.match(guestRoute, new RegExp(`previewUrl: ${GUEST_ITINERARY_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|GUEST_ITINERARY_PATH`));
assert.doesNotMatch(guestRoute, /searchParams/);
assert.match(generateRoute, /export async function generateTripForActor/);
assert.match(generateRoute, /const auth = await requireUser\(\)/);
assert.ok(
  generateRoute.indexOf("const auth = await requireUser()") < generateRoute.indexOf("return generateTripForActor(request, auth, requestId)"),
  "authenticated generate still requires a user before running the shared handler"
);

console.log("PASS: guests receive the free itinerary before login, and resume still generates after login");
