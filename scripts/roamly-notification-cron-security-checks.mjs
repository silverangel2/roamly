import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCronRequestAuthorized } from "../lib/roamly/cronAuth.ts";

const expected = "test-cron-secret";

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized.get(name.toLowerCase()) ?? null };
}

assert.equal(isCronRequestAuthorized(headers(), expected), false, "missing auth is rejected");
assert.equal(
  isCronRequestAuthorized(headers({ authorization: "Bearer wrong" }), expected),
  false,
  "wrong bearer is rejected"
);
assert.equal(
  isCronRequestAuthorized(headers({ authorization: `Bearer ${expected}` }), expected),
  true,
  "correct bearer is accepted"
);
assert.equal(
  isCronRequestAuthorized(headers({ "x-cron-secret": expected }), expected),
  true,
  "existing protected header remains accepted"
);
assert.equal(
  isCronRequestAuthorized(headers({ secret: expected }), expected),
  false,
  "query credentials are not part of the auth contract"
);
assert.equal(
  isCronRequestAuthorized(headers({ authorization: "Bearer wrong", secret: expected }), expected),
  false,
  "query credentials cannot override a wrong header"
);
assert.equal(
  isCronRequestAuthorized(headers({ token: expected, cronSecret: expected }), expected),
  false,
  "arbitrary query credential names cannot authenticate"
);

const route = await readFile("app/api/cron/roamly-notifications/route.ts", "utf8");
assert.doesNotMatch(route, /searchParams\.get\(["'](?:secret|token|cronSecret)["']\)/, "route does not accept query secrets");
assert.match(route, /schedulePreTripReminders/, "cron business handler remains wired");
assert.match(route, /sendScheduledTripNotifications/, "scheduled notification handler remains wired");
assert.match(route, /processQueuedCompanionNotifications/, "Companion queue handler remains wired");

for (const [path, handler] of [
  ["app/api/cron/roamly-booking-monitor/route.ts", "runScheduledBookingMonitor"],
  ["app/api/cron/roamly-live-companion/route.ts", "processLiveCompanionTimeLifecycle"]
]) {
  const affectedRoute = await readFile(path, "utf8");
  assert.doesNotMatch(affectedRoute, /searchParams\.get\(["'](?:secret|token|cronSecret)["']\)/, `${path} rejects query secrets`);
  assert.match(affectedRoute, /isCronRequestAuthorized/, `${path} uses the hardened header-auth helper`);
  assert.match(affectedRoute, /process\.env\.(?:ROAMLY_NOTIFICATION_CRON_SECRET|CRON_SECRET)/, `${path} retains configured secret contract`);
  assert.match(affectedRoute, new RegExp(handler), `${path} keeps its normal handler`);
}

console.log("Cron header-auth security checks passed.");
