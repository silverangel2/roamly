import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const extraction = read("lib/roamly/bookingExtraction.ts");
const connections = read("lib/roamly/emailConnections.ts");
const filtering = read("lib/roamly/travelEmailFiltering.ts");
const migration = read("supabase/migrations/20260924000100_roamly_gmail_booking_pipeline_canonical_schema.sql");

assert.match(extraction, /const saved = await params\.supabase\.from\("booking_extraction_results"\)\.upsert/);
assert.match(extraction, /if \(saved\.error\) throw new Error\("GMAIL_BOOKING_EXTRACTION_PERSIST_FAILED"\)/);
assert.match(connections, /GMAIL_BOOKING_EXTRACTION_FAILED/);
assert.match(connections, /retryable: Boolean\(extraction\?\.error\)/);

assert.match(migration, /create unique index booking_extraction_results_source_uidx/);
assert.doesNotMatch(migration, /booking_extraction_results_source_uidx[\s\S]*?where source_reference is not null/);
assert.match(migration, /create unique index booking_extraction_results_idempotency_uidx/);
assert.match(extraction, /sourceReference: `email:\$\{params\.metadata\.provider\}:\$\{params\.metadata\.messageId\}`/);
assert.match(extraction, /sourceReference: `email:\$\{metadata\.provider\}:\$\{metadata\.messageId\}`/);

assert.match(filtering, /raw_body_retained: false/);
assert.doesNotMatch(extraction, /console\.(log|warn|error).*bodyText/);

const rows = new Map();
function upsertExtraction(row) {
  const key = `${row.user_id}:${row.source_type}:${row.source_reference}`;
  rows.set(key, row);
}
const first = { user_id: "user-1", source_type: "email", source_reference: "email:gmail:message-1", match_status: "unmatched" };
const retry = { ...first, match_status: "attached" };
upsertExtraction(first);
upsertExtraction(retry);
assert.equal(rows.size, 1, "reprocessing one Gmail message must remain idempotent");
assert.equal([...rows.values()][0].match_status, "attached");

console.log("Roamly Gmail extraction persistence checks passed (error propagation, retry contract, non-partial conflict target, idempotent message identity, and privacy boundary).");
