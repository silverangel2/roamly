// Roamly backfill paging checks — RUNTIME proof with synthetic fixtures only.
//
// The Sep-16 Agoda mail was missed live 2026-10-25 because "Search older
// mail" took ONE messages.list page (newest 50). A noisy inbox fills that
// page with newer mail and the 39-day-old confirmation is never seen.
// This script proves paging fixes that, with a fixture inbox of 65 newer
// matching mails ahead of one Sep-16-dated Agoda-shaped mail.
//
// No real email content, subjects, tokens, or user rows are used here:
// every id, sender, and body is an invented fixture string, and the
// "tokens" are ciphertext produced inside this process under a throwaway
// test-only encryption key. No network is touched: Gmail is a local fetch
// stub and Supabase is an in-memory fake store. It does not prove any
// production row state; the live proof is the owner tapping the action
// on his own account and seeing his real Sep-16 mail in review.
//
// Run modes (same script, same fixture):
//   post-fix (default): import the fixed lib from this tree — all pass.
//   pre-fix: PAGING_LIB_ROOT=<pristine tree> with ROAMLY_TEST_ROOT set
//     to the same pristine tree — the old-mail assertion FAILS, which
//     IS the pre-fix repro (one page never reaches the old mail).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const treeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const libRoot = process.env.PAGING_LIB_ROOT || treeRoot;
const read = (p) => readFileSync(path.join(libRoot, p), "utf8");

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
  GMAIL_OLDER_SEARCH_MAX_SCANNED,
  encryptToken
} = await import(pathToFileURL(path.join(libRoot, "lib/roamly/emailConnections.ts")).href);
const { createSupabaseAdminClient } = await import(pathToFileURL(path.join(libRoot, "lib/supabase/admin.ts")).href);
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

// Pre-fix mode (PAGING_PRISTINE_RUN=1): only the shared checks run, so
// the failure lands on the old mail being missed — not on a missing
// constant. Post-fix mode runs every check.
const isPristineRun = process.env.PAGING_PRISTINE_RUN === "1";

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
  in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; }
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
const fixedToday = new Date("2026-10-25T12:00:00Z");
const window = olderGmailSearchWindow(fixedToday);
check("older window spans 90 days back from the trigger date", window.after === "2026/07/27");
check("older window ends tomorrow so today's mail is included", window.before === "2026/10/26");
check("older window constant is 90 days", GMAIL_OLDER_SEARCH_DAYS === 90);
check("older page size is 50 messages per list call", GMAIL_OLDER_SEARCH_MAX_MESSAGES === 50);
if (!isPristineRun) {
  check("older scan bound is 1000 messages per run", GMAIL_OLDER_SEARCH_MAX_SCANNED === 1000);
}
const query = olderGmailSearchQuery(window);
check("older query carries the window", query.includes("after:2026/07/27") && query.includes("before:2026/10/26"));
check("older query keeps the original travel keywords", query.includes("confirmation") && query.includes("reservation") && query.includes("itinerary") && query.includes("check-in"));
if (!isPristineRun) {
  check("older query adds booking/confirmation wording booking mails use", query.includes("confirmed") && query.includes("booking") && query.includes("check-out"));
}

const dayMs = 24 * 60 * 60 * 1000;
const mailDay = Date.parse("2026-09-16T00:00:00Z");
check("Sep-16 mail is OUTSIDE the 30-day lookback", mailDay < fixedToday.getTime() - 30 * dayMs);
check("Sep-16 mail is INSIDE the 90-day window", mailDay >= Date.parse("2026-07-27T00:00:00Z") && mailDay < Date.parse("2026-10-26T00:00:00Z"));

// ---------------------------------------------------------------- runtime
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";
const connection = {
  id: "conn-fixture-paging",
  user_id: "user-fixture-paging",
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
    user_id: "user-fixture-paging",
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
// Five page-1 ids already processed (must be skipped, never re-fetched);
// one page-1 id quarantined (must be retried, per G13).
for (let i = 1; i <= 5; i += 1) {
  tables.travel_email_messages.push({
    id: `fake-seen-${i}`,
    user_id: "user-fixture-paging",
    email_connection_id: "conn-fixture-paging",
    provider: "gmail",
    provider_message_id: `fixture-msg-new-${String(i).padStart(3, "0")}`,
    processing_result: "relevant"
  });
}
tables.travel_email_messages.push({
  id: "fake-quarantined-1",
  user_id: "user-fixture-paging",
  email_connection_id: "conn-fixture-paging",
  provider: "gmail",
  provider_message_id: "fixture-msg-new-006",
  processing_result: "error"
});

const page1Ids = Array.from({ length: 50 }, (_, i) => `fixture-msg-new-${String(i + 1).padStart(3, "0")}`);
const page2Ids = Array.from({ length: 14 }, (_, i) => `fixture-msg-new-${String(51 + i).padStart(3, "0")}`);
page2Ids.push("fixture-msg-agoda-old");

const agodaBody = [
  "Hotel: Empire Suites",
  "Destination: Montreal, Canada",
  "Check-in: 2026-10-30 15:00",
  "Check-out: 2026-11-02 11:00",
  "Confirmation number: FIXTURE-AGODA-16092",
  "Total price: CAD 322.47",
  "Provider: Fixture Agoda"
].join("\n");

const fetchCalls = [];
const metadataFetched = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  fetchCalls.push(url.pathname + url.search);
  const messageMatch = url.pathname.match(/\/messages\/([^/]+)$/);
  if (messageMatch) {
    const id = decodeURIComponent(messageMatch[1]);
    if (url.searchParams.get("format") === "metadata") {
      metadataFetched.push(id);
      const isAgoda = id === "fixture-msg-agoda-old";
      return new Response(JSON.stringify({
        id,
        snippet: isAgoda ? "Your booking is confirmed!" : "Save 20% this week. Shop now.",
        internalDate: String(Date.parse(isAgoda ? "2026-09-16T10:00:00Z" : "2026-10-20T10:00:00Z")),
        payload: {
          headers: [
            { name: "From", value: isAgoda ? "Agoda <bookings@agoda.com>" : "Promo <promo@promo.test>" },
            { name: "Subject", value: isAgoda ? "Your booking is confirmed!" : "Special offer" },
            { name: "Date", value: new Date(isAgoda ? "2026-09-16T10:00:00Z" : "2026-10-20T10:00:00Z").toUTCString() }
          ]
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id,
      payload: {
        mimeType: "multipart/mixed",
        parts: [{ mimeType: "text/plain", body: { data: b64url(id === "fixture-msg-agoda-old" ? agodaBody : "Save 20% this week. Shop now.") } }]
      }
    }), { status: 200 });
  }
  // The list call: page 1 holds 50 newer ids; page 2 holds the old mail.
  // Gmail returns newest first, so a single-page search never sees it.
  const pageToken = url.searchParams.get("pageToken");
  if (!pageToken) {
    return new Response(JSON.stringify({ messages: page1Ids.map((id) => ({ id })), nextPageToken: "page-2" }), { status: 200 });
  }
  return new Response(JSON.stringify({ messages: page2Ids.map((id) => ({ id })) }), { status: 200 });
};

const result = await searchOlderGmail({ supabase: makeSupabase(tables), userId: "user-fixture-paging" });
check("paged search succeeds", result.ok === true && result.error === null);
check("paged search reports its window", typeof result.window?.after === "string" && typeof result.window?.before === "string");
if (!isPristineRun) {
  check("paged search used the second page (pageToken sent)", fetchCalls.some((call) => call.includes("pageToken=page-2")));
  check("paged search scanned all 65 fixture ids", result.scanned === 65);
  check("paged search skipped the 5 already-processed ids", result.skipped === 5);
  check("already-processed ids were never re-fetched", [1, 2, 3, 4, 5].every((i) => !metadataFetched.includes(`fixture-msg-new-${String(i).padStart(3, "0")}`)));
  check("quarantined id was retried, not skipped", metadataFetched.includes("fixture-msg-new-006"));
}
check("old Agoda mail was fetched for processing", metadataFetched.includes("fixture-msg-agoda-old"));

// THE pre-fix repro assertion: on pristine code this fails — the old
// mail is never fetched, so no travel row and no extraction row exist.
const agodaTravelRows = tables.travel_email_messages.filter((row) => row.provider_message_id === "fixture-msg-agoda-old");
check("old Agoda mail recorded exactly once", agodaTravelRows.length === 1);
check("old Agoda mail is not quarantined", agodaTravelRows[0]?.processing_result !== "error");
const agodaExtractionRows = tables.booking_extraction_results.filter((row) => row.email_message_id === agodaTravelRows[0]?.id);
check("old Agoda mail produced exactly one extraction row (review-panel state)", agodaExtractionRows.length === 1);
check("old Agoda mail lands unmatched for traveler review", agodaExtractionRows[0]?.match_status === "unmatched");
check("old Agoda mail produced no auto-attached booking", tables.roamly_bookings.length === 0);
check("sync cursor never written", tables.email_sync_cursors.length === 0);
check("last_synced_at untouched", tables.email_connections[0].last_synced_at === "2026-10-01T00:00:00Z");
check("connection status untouched", tables.email_connections[0].connection_status === "connected");

// ---------------------------------------------------------------- static guards
const libSource = read("lib/roamly/emailConnections.ts");
const fnStart = libSource.indexOf("export async function searchOlderGmail");
assert.ok(fnStart >= 0, "searchOlderGmail exists in lib source");
const fnEnd = libSource.indexOf("\nexport async function", fnStart + 1);
const fnRaw = libSource.slice(fnStart, fnEnd >= 0 ? fnEnd : undefined);
const fnBody = fnRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*$/gm, "$1");
if (!isPristineRun) {
  check("search function pages with nextPageToken", fnBody.includes("nextPageToken"));
  check("search function honors the scan bound", fnBody.includes("GMAIL_OLDER_SEARCH_MAX_SCANNED"));
  check("search function skips already-processed ids", fnBody.includes("travel_email_messages") && fnBody.includes("alreadySeen"));
  check("account page reports scanned + checked counts", read("components/account/EmailConnectionSettings.tsx").includes("Search older mail") && read("components/account/EmailConnectionSettings.tsx").includes("found,"));
}
check("search function never references the sync cursor table", !fnBody.includes("email_sync_cursors"));
check("search function never references last_synced_at", !fnBody.includes("last_synced_at"));
check("search function reuses the shared message pipeline", fnBody.includes("processGmailMessageIds"));
check("search function is traveler-triggered only (no cron import in route)", read("app/api/integrations/gmail/search-older/route.ts").includes("requireUser"));

console.log(`backfill-paging checks: ${passed} passed`);
