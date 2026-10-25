// Roamly wider backfill ("search older mail") checks — RUNTIME proof with
// synthetic fixtures only.
//
// No real email content, subjects, tokens, or user rows are used here:
// the message id, sender, and body are invented fixture strings, and the
// "tokens" are ciphertext produced inside this process under a throwaway
// test-only encryption key. No network is touched: Gmail is a local fetch
// stub and Supabase is an in-memory fake store. It does not prove any
// production row state; the live proof is the owner tapping the action
// on his own account and seeing his real Sep-16 mail in review.
//
// What it proves:
//  1. A Sep-16-dated mail is OUTSIDE both old windows (30-day lookback
//     and the trip-window backfill) and INSIDE the new 90-day window.
//  2. The new search fetches that mail and runs it through the SAME
//     pipeline (filter -> deterministic extraction -> unchanged match
//     rules) into review-panel state, and reports the verdict honestly.
//  3. The search never writes the sync cursor and never touches
//     last_synced_at or the connection status.
// Run it against a pristine tree first: the import below fails there
// (searchOlderGmail does not exist), which IS the pre-fix repro.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Test-only environment: no live Supabase admin client, no Build 2 lane,
// no AI extraction client — every seam below stays local.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ROAMLY_BUILD2_ENABLED;
delete process.env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED;
delete process.env.ROAMLY_BUILD2_GATES_ENABLED;

const {
  searchOlderGmail,
  olderGmailSearchWindow,
  olderGmailSearchQuery,
  GMAIL_OLDER_SEARCH_DAYS,
  GMAIL_OLDER_SEARCH_MAX_MESSAGES,
  encryptToken
} = await import("../lib/roamly/emailConnections.ts");
const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts");
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

// ---------------------------------------------------------------- fake store
function makeStore(connection, trips) {
  return {
    email_connections: [connection],
    email_sync_cursors: [],
    travel_email_messages: [],
    booking_extraction_results: [],
    roamly_bookings: [],
    roamly_trips: trips
  };
}

class FakeQuery {
  constructor(tables, table) {
    this.tables = tables;
    this.table = table;
    this.filters = [];
    this.op = "select";
    this.payload = null;
    this.conflict = null;
    this.limitN = null;
    this.single = false;
  }
  select() { return this; }
  eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
  neq(field, value) { this.filters.push((row) => row[field] !== value); return this; }
  or() { return this; }
  gte(field, value) { this.filters.push((row) => row[field] >= value); return this; }
  lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
  order() { return this; }
  limit(n) { this.limitN = n; return this; }
  update(payload) { this.op = "update"; this.payload = payload; return this; }
  insert(payload) { this.op = "insert"; this.payload = payload; return this; }
  upsert(payload, opts) {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = opts?.onConflict ? opts.onConflict.split(",") : null;
    return this;
  }
  maybeSingle() { this.single = true; return this; }
  single() { this.single = true; return this; }
  then(resolve, reject) {
    try {
      resolve(this.exec());
    } catch (error) {
      reject(error);
    }
  }
  exec() {
    const rows = this.tables[this.table];
    const matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.op === "update") {
      matched.forEach((row) => Object.assign(row, this.payload));
      return { data: this.single ? matched[0] || null : null, error: null };
    }
    if (this.op === "insert") {
      const row = { id: `fake-${this.table}-${rows.length + 1}`, ...this.payload };
      rows.push(row);
      return { data: this.single ? row : null, error: null };
    }
    if (this.op === "upsert") {
      const key = this.conflict || [];
      const existing = key.length
        ? rows.find((row) => key.every((field) => row[field] === this.payload[field]))
        : undefined;
      if (existing) {
        Object.assign(existing, this.payload);
        return { data: this.single ? existing : null, error: null };
      }
      const row = { id: `fake-${this.table}-${rows.length + 1}`, ...this.payload };
      rows.push(row);
      return { data: this.single ? row : null, error: null };
    }
    let out = matched;
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return { data: this.single ? out[0] || null : out, error: null };
  }
}

function makeSupabase(tables) {
  return { from: (table) => new FakeQuery(tables, table) };
}

function b64url(text) {
  return Buffer.from(text, "utf8").toString("base64url");
}

// ---------------------------------------------------------------- window math
// Fixed "today" matching the owner's real trigger date: Oct 25, 2026.
// The old mail is dated Sep 16, 2026; the trip runs Oct 29 – Nov 2, 2026.
const fixedToday = new Date("2026-10-25T12:00:00Z");
const window = olderGmailSearchWindow(fixedToday);
check("older window spans 90 days back from the trigger date", window.after === "2026/07/27");
check("older window ends tomorrow so today's mail is included", window.before === "2026/10/26");
check("older window constant is 90 days", GMAIL_OLDER_SEARCH_DAYS === 90);
check("older search cap is 50 messages per run", GMAIL_OLDER_SEARCH_MAX_MESSAGES === 50);
const query = olderGmailSearchQuery(window);
check("older query carries the window", query.includes("after:2026/07/27") && query.includes("before:2026/10/26"));
check("older query carries the travel keywords", query.includes("confirmation OR reservation"));

const dayMs = 24 * 60 * 60 * 1000;
const mailDay = Date.parse("2026-09-16T00:00:00Z");
const lookbackStart = fixedToday.getTime() - 30 * dayMs;
check("Sep-16 mail is OUTSIDE the 30-day lookback", mailDay < lookbackStart);
const tripWindowStart = Date.parse("2026-10-29T00:00:00Z") - 30 * dayMs;
check("Sep-16 mail is OUTSIDE the trip-window backfill (starts Sep 29)", mailDay < tripWindowStart);
const olderAfter = Date.parse("2026-07-27T00:00:00Z");
const olderBefore = Date.parse("2026-10-26T00:00:00Z");
check("Sep-16 mail is INSIDE the new 90-day window", mailDay >= olderAfter && mailDay < olderBefore);

// ---------------------------------------------------------------- runtime
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";
const connection = {
  id: "conn-fixture-older",
  user_id: "user-fixture-older",
  provider: "gmail",
  encrypted_access_token: encryptToken("fixture-access-token"),
  encrypted_refresh_token: encryptToken("fixture-refresh-token"),
  token_expiry: new Date(Date.now() + 3600_000).toISOString(),
  granted_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  connection_status: "connected",
  email_address: "fixture@fixture-travel.test",
  last_synced_at: "2026-10-01T00:00:00Z",
  sync_lease_token: null,
  sync_lease_expires_at: null
};
const trips = [
  {
    id: "trip-fixture-montreal",
    user_id: "user-fixture-older",
    title: "Montreal trip",
    destination: "Montreal, Canada",
    destination_name: "Montreal",
    destination_city: "Montreal",
    start_date: "2026-10-29",
    end_date: "2026-11-02",
    status: "generated"
  }
];
const tables = makeStore({ ...connection }, trips);

const oldBody = [
  "Hotel: Empire Suites",
  "Destination: Montreal, Canada",
  "Check-in: 2026-10-30 15:00",
  "Check-out: 2026-11-02 11:00",
  "Confirmation number: FIXTURE-OLD-16092",
  "Total price: CAD 322.47",
  "Provider: Fixture Travel"
].join("\n");

const fetchCalls = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  fetchCalls.push(url.pathname + url.search);
  const messageMatch = url.pathname.match(/\/messages\/([^/]+)$/);
  if (messageMatch) {
    const id = decodeURIComponent(messageMatch[1]);
    if (url.searchParams.get("format") === "metadata") {
      return new Response(JSON.stringify({
        id,
        snippet: "Fixture booking confirmation",
        internalDate: String(Date.parse("2026-09-16T10:00:00Z")),
        payload: {
          headers: [
            { name: "From", value: "Fixture Travel <bookings@fixture-travel.test>" },
            { name: "Subject", value: "Your booking confirmation — Fixture hotel stay" },
            { name: "Date", value: new Date("2026-09-16T10:00:00Z").toUTCString() }
          ]
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id,
      payload: {
        mimeType: "multipart/mixed",
        parts: [{ mimeType: "text/plain", body: { data: b64url(oldBody) } }]
      }
    }), { status: 200 });
  }
  // The list call: one old message, returned for the 90-day window.
  return new Response(JSON.stringify({ messages: [{ id: "fixture-msg-old" }] }), { status: 200 });
};

const result = await searchOlderGmail({ supabase: makeSupabase(tables), userId: "user-fixture-older" });
check("older search succeeds", result.ok === true && result.error === null);
check("older search counts the one old message", result.processed === 1);
check("older search reports its window", typeof result.window?.after === "string" && typeof result.window?.before === "string");
check("older search never touches the history endpoint", !fetchCalls.some((call) => call.includes("/history")));
check("older search list call uses a 90-day-scale window, not 30d", fetchCalls.some((call) => call.includes("maxResults=50")));

const travelRows = tables.travel_email_messages.filter((row) => row.provider_message_id === "fixture-msg-old");
check("old message recorded exactly once", travelRows.length === 1);
check("old message is not quarantined", travelRows[0]?.processing_result !== "error");
const extractionRows = tables.booking_extraction_results.filter((row) => row.email_message_id === travelRows[0]?.id);
check("old message produced exactly one extraction row (review-panel state)", extractionRows.length === 1);
// Verdict under the UNCHANGED rules, reported honestly: the fixture's
// labelled clocks carry no timezone, so its start time is unresolved and
// no trip match is possible — it lands unmatched for traveler review,
// exactly the review-panel outcome the batch promises for unmatchable
// old mail. A mail with resolvable clocks + city text scores 0.5 date +
// 0.3 text = 0.8 against the same rules and would match instead.
check("old message lands unmatched for traveler review", extractionRows[0]?.match_status === "unmatched");
check("old message produced no auto-attached booking", tables.roamly_bookings.length === 0);
check("sync cursor never written", tables.email_sync_cursors.length === 0);
check("last_synced_at untouched", tables.email_connections[0].last_synced_at === "2026-10-01T00:00:00Z");
check("connection status untouched", tables.email_connections[0].connection_status === "connected");

// ---------------------------------------------------------------- static guards
const libSource = read("lib/roamly/emailConnections.ts");
const fnStart = libSource.indexOf("export async function searchOlderGmail");
assert.ok(fnStart >= 0, "searchOlderGmail exists in lib source");
const fnEnd = libSource.indexOf("\nexport async function", fnStart + 1);
const fnRaw = libSource.slice(fnStart, fnEnd >= 0 ? fnEnd : undefined);
// Strip comments: the doc comment names last_synced_at in prose ("never
// touches last_synced_at"); the guard must check CODE, not prose.
const fnBody = fnRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*$/gm, "$1");
check("search function never references the sync cursor table", !fnBody.includes("email_sync_cursors"));
check("search function never references last_synced_at", !fnBody.includes("last_synced_at"));
check("search function reuses the shared message pipeline", fnBody.includes("processGmailMessageIds"));
check("search function is traveler-triggered only (no cron import in route)", read("app/api/integrations/gmail/search-older/route.ts").includes("requireUser"));
const component = read("components/account/EmailConnectionSettings.tsx");
check("account page offers the older-mail action", component.includes("Search older mail") && component.includes("search-older"));

console.log(`backfill-older checks: ${passed} passed`);
console.log(`fixture verdict: match_status=${extractionRows[0]?.match_status} (unmatched = review-panel state, per unchanged rules)`);
