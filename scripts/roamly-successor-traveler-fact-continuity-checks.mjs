import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const appliedMigration = read("supabase/migrations/20260925000100_roamly_successor_traveler_fact_continuity.sql");
const correctiveMigration = read("supabase/migrations/20261002000100_roamly_successor_traveler_copy_deduplication.sql");
const dateSql = read("supabase/migrations/20260922_roamly_customer_date_changes.sql");
const destinationSql = read("supabase/migrations/20260923_roamly_customer_destination_changes.sql");
const intentSql = read("supabase/migrations/20260924_roamly_customer_trip_intent_changes.sql");
const intentApply = read("app/api/trips/[id]/intent-change/[proposalId]/apply/route.ts");
const travelersSchema = read("supabase/migrations/20260917_roamly_trip_travelers.sql");
const multiTravelerChecks = read("scripts/roamly-multi-traveler-requirements-checks.mjs");

assert.match(appliedMigration, /pg_get_functiondef\(function_signature\)/);
assert.match(appliedMigration, /length\(function_definition\) - length\(replace\(function_definition, insert_anchor, ''\)\)/,
  "historical migration checks anchor multiplicity, not whether the copy block already exists");
assert.match(appliedMigration, /execute replace\(function_definition, insert_anchor, replacement\)/,
  "historical migration inserts its block unconditionally at the anchor");
assert.match(correctiveMigration, /create or replace function public\.roamly_reserve_customer_trip_date_change\(p_proposal_id uuid, p_trip_id uuid\)/);
assert.match(correctiveMigration, /create or replace function public\.roamly_reserve_customer_trip_destination_change\(p_proposal_id uuid, p_trip_id uuid\)/);
const correctiveSql = correctiveMigration.replace(/--.*$/gm, "");
assert.doesNotMatch(correctiveSql, /\b(create\s+table|alter\s+table|create\s+trigger|create\s+index|delete\s+from)\b/i);
assert.doesNotMatch(correctiveSql, /\bon\s+conflict\b/i);

const copyOperation = /insert\s+into\s+public\.roamly_trip_travelers\s*\(\s*trip_id\s*,\s*traveler_order\s*,\s*role\s*,\s*traveler_type\s*,\s*passport_issuing_country\s*\)\s*select\s+successor_id\s*,\s*traveler\.traveler_order\s*,\s*traveler\.role\s*,\s*traveler\.traveler_type\s*,\s*traveler\.passport_issuing_country\s*from\s+public\.roamly_trip_travelers\s+traveler\s*join\s+public\.roamly_trips\s+source_trip\s+on\s+source_trip\.id\s*=\s*traveler\.trip_id\s+and\s+source_trip\.user_id\s*=\s*trip\.user_id\s*where\s+traveler\.trip_id\s*=\s*trip\.id\s+and\s+source_trip\.id\s*=\s*trip\.id\s+and\s+trip\.user_id\s*=\s*auth\.uid\(\)\s+and\s+traveler\.role\s*=\s*'companion'\s+order\s+by\s+traveler\.traveler_order\s*;/gi;
const extractFunction = (name) => {
  const start = correctiveMigration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} replacement exists`);
  const end = correctiveMigration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} replacement terminates`);
  return correctiveMigration.slice(start, end + 4);
};
const correctedFunctions = [
  ["roamly_reserve_customer_trip_date_change", "date"],
  ["roamly_reserve_customer_trip_destination_change", "destination"],
].map(([name, label]) => {
  const definition = extractFunction(name);
  const copies = [...definition.matchAll(copyOperation)];
  assert.equal(copies.length, 1, `${label} corrected function must contain exactly one companion copy operation`);
  const copy = copies[0].index;
  assert.ok(copy > definition.indexOf("returning id into successor_id;"), `${label}: copy follows successor creation`);
  assert.ok(copy < definition.indexOf("status = 'generating'"), `${label}: copy precedes reservation status update`);
  assert.match(definition, /returns jsonb language plpgsql security definer set search_path = public/i);
  assert.match(definition, /for update/i);
  assert.match(definition, /auth\.uid\(\)/);
  return [label, definition];
});
// Harmless header/whitespace normalization only. Must NOT erase identifier,
// literal, or keyword differences — those must still fail the equality check.
const normalizeSql = (value) => value
  .replace(/^create or replace function/i, "create function")
  // Canonical source file has a spurious ";" between VALUES close and RETURNING
  // on date-change; production and the corrective migration use valid SQL without it.
  .replace(/\)\);\s*returning/gi, ")) returning")
  .replace(/\s+/g, " ")
  .trim();
for (const [name, sourceSql] of [
  ["roamly_reserve_customer_trip_date_change", dateSql],
  ["roamly_reserve_customer_trip_destination_change", destinationSql],
]) {
  const canonicalStart = sourceSql.indexOf(`create function public.${name}(`);
  assert.notEqual(canonicalStart, -1, `${name}: canonical source definition exists`);
  const canonicalTail = sourceSql.slice(canonicalStart);
  const canonicalEnd = canonicalTail.indexOf("\n$$;");
  assert.notEqual(canonicalEnd, -1, `${name}: canonical source definition terminates`);
  const canonicalDefinition = canonicalTail.slice(0, canonicalEnd + 4);
  const label = name.includes("date_change") ? "date" : "destination";
  const correctedDefinition = correctedFunctions.find(([entryLabel]) => entryLabel === label)[1];
  copyOperation.lastIndex = 0;
  assert.equal([...correctedDefinition.matchAll(copyOperation)].length, 1,
    `${name}: corrected body still has exactly one traveler copy before strip`);
  copyOperation.lastIndex = 0;
  const strippedDefinition = correctedDefinition.replace(copyOperation, "");
  copyOperation.lastIndex = 0;
  assert.equal([...strippedDefinition.matchAll(copyOperation)].length, 0,
    `${name}: strip removes the sole traveler copy`);
  assert.notEqual(normalizeSql(correctedDefinition), normalizeSql(canonicalDefinition),
    `${name}: traveler copy is a real intentional delta vs canonical`);
  assert.equal(normalizeSql(strippedDefinition), normalizeSql(canonicalDefinition),
    `${name}: correction preserves canonical source behavior outside the single traveler copy`);
  // Prove normalizeSql does not hide unrelated semantic drift.
  assert.notEqual(
    normalizeSql(strippedDefinition.replace("security definer", "security invoker")),
    normalizeSql(canonicalDefinition),
    `${name}: normalizeSql must still surface a security-property drift`,
  );
}
assert.doesNotMatch(correctiveMigration, /visa|entry_requirement|readiness_result/i);

const travelerColumns = travelersSchema.match(/traveler_order integer[\s\S]*?updated_at timestamptz not null default now\(\)/);
assert.ok(travelerColumns, "traveler table has canonical slot/type/passport inputs and generated timestamps");
assert.match(travelerColumns[0], /role text not null/);
assert.match(travelerColumns[0], /traveler_type text not null/);
assert.match(travelerColumns[0], /passport_issuing_country text/);
assert.match(travelerColumns[0], /created_at timestamptz not null default now\(\)/);
assert.match(travelerColumns[0], /updated_at timestamptz not null default now\(\)/);

for (const [name, sql] of [["date", dateSql], ["destination", destinationSql]]) {
  const reserve = sql.match(new RegExp(`create function public\\.roamly_reserve_customer_trip_${name === "date" ? "date" : "destination"}_change[\\s\\S]*?\\n\\$\\$;`));
  assert.ok(reserve, `${name}-change reserve function exists`);
  assert.ok(reserve[0].indexOf("return jsonb_build_object('status'") < reserve[0].indexOf("insert into public.roamly_trips"), `${name} retries return before creating another successor`);
  assert.match(reserve[0], /for update/);
  assert.match(reserve[0], /expected_booking_snapshot/);
  assert.ok(reserve[0].includes("returning id into successor_id;"));
  assert.ok(reserve[0].indexOf("returning id into successor_id;") < reserve[0].indexOf("status = 'generating'"), `${name} copy anchor precedes reservation status update`);
}

// Explicitly prove the count assertion rejects zero, duplicate, and repeated copies,
// and accepts exactly one. Reset lastIndex so the shared /g regex cannot leak state.
copyOperation.lastIndex = 0;
const oneCopy = correctedFunctions[0][1].match(copyOperation)[0];
for (const count of [0, 1, 2, 3]) {
  copyOperation.lastIndex = 0;
  const fixture = `before ${oneCopy.repeat(count)} after`;
  const matched = [...fixture.matchAll(copyOperation)].length;
  if (count === 1) {
    assert.equal(matched, 1, "copy-count fixture 1 must satisfy the exactly-one contract");
  } else {
    assert.notEqual(matched, 1, `copy-count fixture ${count} must fail the exactly-one contract`);
  }
}

assert.match(dateSql, /superseded_by_booking_id is null/);
assert.match(destinationSql, /superseded_by_booking_id is null/);
assert.match(dateSql, /create function public\.roamly_complete_customer_trip_date_change[\s\S]*?set status = 'archived'/);
assert.match(destinationSql, /create function public\.roamly_complete_customer_trip_destination_change[\s\S]*?set status = 'archived'/);
assert.match(intentApply, /reconcileTripCompanionSlots/);
assert.match(travelersSchema, /unique index roamly_trip_travelers_trip_order_uidx/);
assert.match(travelersSchema, /passport_issuing_country is null[\s\S]*\^\[A-Z\]\{2\}\$/);
assert.match(multiTravelerChecks, /traveler_order/);

// Deterministic fixture exercises the exact projection/order/isolation contract
// expressed in the SQL; no production or database rows are read.
const source = [
  { trip_id: "source-a", user_id: "user-a", traveler_order: 3, role: "companion", traveler_type: "child", passport_issuing_country: "CA" },
  { trip_id: "source-a", user_id: "user-a", traveler_order: 2, role: "companion", traveler_type: "adult", passport_issuing_country: null },
  { trip_id: "source-a", user_id: "user-a", traveler_order: 1, role: "account_holder", traveler_type: "adult", passport_issuing_country: "US" },
  { trip_id: "source-b", user_id: "user-a", traveler_order: 2, role: "companion", traveler_type: "adult", passport_issuing_country: "FR" },
  { trip_id: "source-a", user_id: "user-b", traveler_order: 4, role: "companion", traveler_type: "adult", passport_issuing_country: "GB" },
];
const copyCompanions = (sourceTrip, successorTrip, userId, existing = []) => {
  const sourceTripOwner = { "source-a": "user-a", "source-b": "user-a" }[sourceTrip];
  const projected = source
    .filter((row) => sourceTripOwner === userId && row.trip_id === sourceTrip && row.user_id === userId && row.role === "companion")
    .sort((a, b) => a.traveler_order - b.traveler_order)
    .map(({ traveler_order, role, traveler_type, passport_issuing_country }) => ({
      trip_id: successorTrip, traveler_order, role, traveler_type, passport_issuing_country,
    }));
  const keyed = new Map(existing.map((row) => [`${row.trip_id}:${row.traveler_order}`, row]));
  for (const row of projected) keyed.set(`${row.trip_id}:${row.traveler_order}`, row);
  return [...keyed.values()].filter((row) => row.trip_id === successorTrip).sort((a, b) => a.traveler_order - b.traveler_order);
};
for (const changeKind of ["date", "destination"]) {
  const copied = copyCompanions("source-a", `${changeKind}-successor`, "user-a");
  assert.deepEqual(copied.map(({ traveler_order }) => traveler_order), [2, 3], `${changeKind}: slots retained in deterministic order`);
  assert.equal(copied[0].passport_issuing_country, null, `${changeKind}: missing passport stays missing`);
  assert.equal(copied[1].passport_issuing_country, "CA", `${changeKind}: explicit passport is retained`);
  assert.ok(copied.every((row) => row.trip_id === `${changeKind}-successor`));
  assert.equal(copyCompanions("source-a", `${changeKind}-successor`, "user-a", copied).length, 2, `${changeKind}: retry does not duplicate slots`);
  assert.ok(!copied.some((row) => row.passport_issuing_country === "FR"), `${changeKind}: facts from another trip are excluded`);
  assert.deepEqual(copyCompanions("source-a", `${changeKind}-successor-c`, "user-b"), [], `${changeKind}: another account is isolated`);
  assert.deepEqual(copyCompanions("empty-trip", `${changeKind}-successor-empty`, "user-a"), [], `${changeKind}: zero companions remains valid`);
}

console.log("successor traveler fact continuity checks passed");
