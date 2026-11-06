// Live client write-guard checks (Thread B, 2026-10-31) — structural,
// repo style. Proves the per-GPS-fix write storm is guarded and the
// explicit enable path still writes immediately.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.env.ROAMLY_SRC_ROOT
  ? path.resolve(process.env.ROAMLY_SRC_ROOT)
  : path.resolve(new URL("..", import.meta.url).pathname);
const src = fs.readFileSync(path.join(root, "components/trip/LiveTripClient.tsx"), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const handlePosition = src.slice(src.indexOf("const handlePosition"), src.indexOf("const handleError"));
check("handlePosition guards the persistence writes with the 10-minute window",
  handlePosition.includes("lastPersistedOnRef.current >= 10 * 60_000") || handlePosition.includes(">= 10 * 60_000"));
check("both constant-value writes sit inside the guard",
  handlePosition.indexOf("/api/roamly/location/settings") > handlePosition.indexOf("10 * 60_000") &&
  handlePosition.indexOf("/companion/preferences") > handlePosition.indexOf("10 * 60_000"));
check("the location update itself is NOT inside the guard (fixes still flow per event)",
  handlePosition.indexOf("sendLocationUpdate(nextLocation)") > handlePosition.indexOf("/companion/preferences"));
const persistLocationOn = src.slice(src.indexOf("const persistLocationOn"), src.indexOf("const enableLocation"));
check("explicit enable (persistLocationOn) still writes immediately, unguarded",
  persistLocationOn.includes("/api/roamly/location/settings") && !persistLocationOn.includes("lastPersistedOnRef"));

console.log(`\n${passed} live client write-guard checks passed (source root: ${root})`);
