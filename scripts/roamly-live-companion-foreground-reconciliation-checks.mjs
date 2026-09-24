import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("components/trip/LiveTripClient.tsx");
const page = read("app/trip/[id]/live/page.tsx");
const core = read("lib/roamly/liveCompanion.ts");

assert.match(client, /useRouter/);
assert.match(client, /router\.refresh\(\)/, "resume must refresh canonical server-rendered props");
assert.match(client, /document\.visibilityState !== "visible"/, "hidden lifecycle events must not refresh");
assert.match(client, /addEventListener\("pageshow", onResume\)/);
assert.match(client, /addEventListener\("visibilitychange", onResume\)/);
assert.match(client, /foregroundRefreshTimerRef/);
assert.match(client, /setTimeout\(\(\) =>/);
assert.match(client, /lastForegroundRefreshRef/);
assert.match(client, /setItems\(activities\)/, "server prop changes must replace authoritative activity state");

const resumeSection = client.slice(client.indexOf("const reconcileForeground"), client.indexOf("// Resume foreground sensing"));
assert.doesNotMatch(resumeSection, /fetch\(/, "resume reconciliation must not invoke a notification lifecycle endpoint");
assert.doesNotMatch(resumeSection, /sendCompanionNotification|queueCompanionNotification/);
assert.match(client, /setLocation\(/, "foreground reconciliation must preserve local location state");
assert.match(client, /setPermission\(/, "foreground reconciliation must preserve local permission state");

assert.match(page, /const dayActivities = activitiesByDay\[currentDay\]/, "server page must load current destination-local day data");
assert.match(page, /activities=\{dayActivities\}/);
assert.match(page, /bookingDetails=\{bookingDetails\}/, "current booking truth must flow through refreshed props");
assert.match(client, /applyVerifiedBookingOverride/, "booking timing remains rehydrated from canonical booking props");
assert.match(core, /completed.*checked_in.*skipped.*missed.*expired.*cancelled/);
assert.match(client, /tripWindowState/);
assert.match(client, /companionEnabled/);

const intervalMatches = client.match(/setInterval\(/g) || [];
assert.equal(intervalMatches.length, 1, "foreground reconciliation must not add polling");
assert.match(client, /setInterval\(\(\) => setNowTick/);

console.log("Roamly Live Companion foreground reconciliation checks passed.");
