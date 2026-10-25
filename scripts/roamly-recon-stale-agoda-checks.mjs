// Booking Recon stale-sync + Agoda checks (structural, source-level).
// Proves the trip line can no longer say plain "activated" for a stale
// inbox, and that Agoda is a known travel domain. It does not prove a
// live Gmail sync, a backfill, or any production row state.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const domains = read("lib/roamly/travelEmailFiltering.ts");
check("Agoda is a known travel domain", domains.includes('"agoda.com"'));

const gate = read("lib/roamly/gateService.ts");
check("gate view carries lastSyncedAt", gate.includes("lastSyncedAt?: string | null"));
check("gate view populates lastSyncedAt from the row", gate.includes("lastSyncedAt: row.last_synced_at"));

const setup = read("lib/roamly/setupState.ts");
check("setup state exposes gmailLastSyncedAt", setup.includes("gmailLastSyncedAt: string | null"));
check(
  "setup state only reports a sync date when connected",
  setup.includes("gmailLastSyncedAt: gmailConnected ? gmailView?.lastSyncedAt ?? null : null")
);

const lines = read("components/roamly/TripStateLines.tsx");
check("trip lines accept gmailLastSyncedAt", lines.includes("gmailLastSyncedAt?: string | null"));
check("trip lines use the 45-minute honesty window", lines.includes("45 * 60 * 1000"));
check(
  "stale line requires a connected inbox (it never flips connected itself)",
  lines.includes("gmailConnected && Number.isFinite(lastSyncMs)")
);
check("stale line says the inbox was not checked since a date", lines.includes("inbox not checked since"));

const tripPage = read("app/trip/[id]/page.tsx");
check("trip page passes the sync date to the state lines", tripPage.includes("gmailLastSyncedAt={setupState.gmailLastSyncedAt}"));

console.log(`\n${passed} recon stale-sync + Agoda checks passed`);
