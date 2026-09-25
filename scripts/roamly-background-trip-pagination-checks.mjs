import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const preTrip = fs.readFileSync(path.join(root, "lib/roamly/preTripReminders.ts"), "utf8");
const lifecycle = fs.readFileSync(path.join(root, "lib/roamly/liveCompanionLifecycle.ts"), "utf8");

assert.match(preTrip, /PRE_TRIP_PROCESSING_PAGE_SIZE\s*=\s*50/);
assert.match(preTrip, /\.order\("start_date",\s*\{ ascending: true \}\)[\s\S]*\.order\("id",\s*\{ ascending: true \}\)/);
assert.match(preTrip, /\.range\(0, PRE_TRIP_PROCESSING_PAGE_SIZE - 1\)/);
assert.match(preTrip, /start_date\.gt\./);
assert.match(preTrip, /id\.gt\./);
assert.doesNotMatch(preTrip, /\.limit\(100\)/);

assert.match(lifecycle, /LIVE_COMPANION_PROCESSING_PAGE_SIZE\s*=\s*100/);
assert.match(lifecycle, /\.order\("start_date",\s*\{ ascending: true, nullsFirst: false \}\)[\s\S]*\.order\("id",\s*\{ ascending: true \}\)/);
assert.match(lifecycle, /\.range\(0, pageSize - 1\)/);
assert.match(lifecycle, /start_date\.gt\./);
assert.match(lifecycle, /id\.gt\./);
assert.doesNotMatch(lifecycle, /\.limit\(500\)/);
assert.match(lifecycle, /pagination cursor did not advance/);

function keysetPages(rows, pageSize) {
  const ordered = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  const pages = [];
  let cursor = null;
  for (;;) {
    const page = ordered.filter((row) => !cursor || row.startDate > cursor.startDate || (row.startDate === cursor.startDate && row.id > cursor.id)).slice(0, pageSize);
    if (!page.length) break;
    pages.push(page);
    const last = page.at(-1);
    assert.ok(!cursor || last.startDate !== cursor.startDate || last.id !== cursor.id, "cursor must advance");
    cursor = { startDate: last.startDate, id: last.id };
    if (page.length < pageSize) break;
  }
  return pages;
}

const preTripRows = Array.from({ length: 205 }, (_, index) => ({
  id: `pre-${String(index).padStart(3, "0")}`,
  startDate: "2026-10-01"
}));
const preTripPages = keysetPages(preTripRows, 50);
assert.equal(preTripPages.flat().length, 205);
assert.equal(new Set(preTripPages.flat().map((row) => row.id)).size, 205);
assert.equal(preTripPages.at(-1).at(-1).id, "pre-204");

const lifecycleRows = Array.from({ length: 505 }, (_, index) => ({
  id: `life-${String(index).padStart(3, "0")}`,
  startDate: index < 3 ? "2026-09-01" : "2026-10-01"
}));
const lifecyclePages = keysetPages(lifecycleRows, 100);
assert.equal(lifecyclePages.flat().length, 505);
assert.equal(new Set(lifecyclePages.flat().map((row) => row.id)).size, 505);
assert.equal(lifecyclePages.at(-1).at(-1).id, "life-504");

const ties = [
  { id: "b", startDate: "2026-10-01" },
  { id: "a", startDate: "2026-10-01" },
  { id: "c", startDate: "2026-10-01" }
];
assert.deepEqual(keysetPages(ties, 2).flat().map((row) => row.id), ["a", "b", "c"]);

assert.match(preTrip, /processedTrips/);
assert.match(lifecycle, /processed: results\.length/);
assert.match(preTrip, /return \{ ok: false as const, error: error\.message, processedTrips, results \}/);
assert.match(lifecycle, /return \{ ok: false as const, error: tripsResult\.error\.message, processed: results\.length, results \}/);

console.log("Roamly background trip pagination checks passed");
