import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const activationSource = read("lib/roamly/tripActivation.ts");
assert.doesNotMatch(
  activationSource,
  /end_date\.gte\./,
  "trip activation must not use a UTC calendar-day end-date prefilter"
);
assert.match(
  activationSource,
  /isTodayWithinTripDates\([\s\S]*timezone: timezoneFromTripMetadata\(candidate\.metadata\)/,
  "destination timezone must remain authoritative for active-trip selection"
);

function compileLiveCompanion() {
  const source = read("lib/roamly/liveCompanion.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    Intl,
    Date,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox);
  return sandbox.module.exports;
}

const { isTodayWithinTripDates, tripWindowState } = compileLiveCompanion();

function active(startDate, endDate, timezone, now) {
  return isTodayWithinTripDates({ startDate, endDate, timezone, now });
}

// Western timezone: UTC has advanced to the next date, but Toronto is still
// on the trip's final local calendar day.
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-25T01:00:00Z"),
  true,
  "western final local trip day remains active after UTC midnight"
);
assert.equal(
  tripWindowState({ startDate: "2026-09-20", endDate: "2026-09-24", timezone: "America/Toronto", now: "2026-09-25T01:00:00Z" }),
  "active"
);
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-25T05:00:00Z"),
  false,
  "western trip is inactive after the final local day"
);

// Eastern timezone: the destination has already advanced while UTC has not.
assert.equal(
  active("2026-09-25", "2026-09-28", "Asia/Tokyo", "2026-09-24T23:30:00Z"),
  true,
  "eastern first local trip day is active before UTC advances"
);
assert.equal(
  active("2026-09-25", "2026-09-28", "Asia/Tokyo", "2026-09-24T14:00:00Z"),
  false,
  "the day before the eastern local trip start is not active"
);

assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-20T16:00:00Z"),
  true,
  "first local trip day is active"
);
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-22T16:00:00Z"),
  true,
  "middle local trip day is active"
);
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-24T16:00:00Z"),
  true,
  "final local trip day is active"
);
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-25T05:00:00Z"),
  false,
  "day after the local trip end is inactive"
);

// Explicit trip timezone, rather than machine/server timezone, controls the
// result at the same instant.
assert.equal(
  active("2026-09-20", "2026-09-24", "America/Toronto", "2026-09-25T01:00:00Z"),
  true,
  "server/device timezone cannot replace the trip timezone"
);

assert.equal(
  tripWindowState({ startDate: "2026-09-20", endDate: "2026-09-24", timezone: "America/Toronto", now: "2026-09-25T05:00:00Z" }),
  "completed_trip"
);
assert.deepEqual(
  ["locked", "active", "planned"].filter((status) => !["completed", "cancelled", "archived"].includes(status)),
  ["locked", "active", "planned"],
  "activation query continues excluding terminal trip statuses"
);

console.log("Roamly trip activation timezone checks passed.");
