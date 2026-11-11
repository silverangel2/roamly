// Stage 6 checks — Outlook sync success-claim ordering (H-5,
// 2026-11-11).
//
// The H-5 tree-wide audit found one live claim-before-proof site:
// syncOutlookConnectionUnlocked claimed success unconditionally —
// per-message processing was swallowed (.catch(() => null)), the
// delta cursor advanced past failed messages (losing them for
// good), and last_synced_at was stamped regardless of either
// checkpoint write's result. Its Gmail sibling in the same file
// already had the correct discipline (process → retryable check →
// checked cursor upsert → checked stamp → only then ok:true).
// The Outlook path now mirrors it, and this suite pins the
// ordering behaviourally: real module, stubbed Microsoft Graph
// fetch, in-memory fake store, throwaway test encryption key.
// No real mail, tokens, or user rows; no network.
import assert from "node:assert/strict";

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ROAMLY_BUILD2_ENABLED;
delete process.env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED;
delete process.env.ROAMLY_BUILD2_GATES_ENABLED;

const { encryptToken, syncOutlookConnection } = await import("../lib/roamly/emailConnections.ts");
const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts");
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let count = 0;
function check(name, condition) {
  count += 1;
  assert.ok(condition, name);
  console.log(`ok - ${name}`);
}

/* ------------------------------------------------ fake store */
function makeFake(tables, injectedErrors = {}) {
  class FakeQuery {
    constructor(table) {
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
    is(field, value) { this.filters.push((row) => (row[field] ?? null) === value); return this; }
    in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; }
    gte(field, value) { this.filters.push((row) => row[field] >= value); return this; }
    lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
    or() { return this; }
    order() { return this; }
    limit(n) { this.limitN = n; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    upsert(payload, opts) { this.op = "upsert"; this.payload = payload; this.conflict = opts?.onConflict ? opts.onConflict.split(",") : null; return this; }
    maybeSingle() { this.single = true; return this; }
    single() { this.single = true; return this; }
    then(resolve, reject) {
      try { resolve(this.exec()); } catch (error) { reject(error); }
    }
    exec() {
      const injected = injectedErrors[`${this.table}:${this.op}`];
      if (injected) return { data: null, error: injected };
      const rows = tables[this.table] || (tables[this.table] = []);
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
        const existing = key.length ? rows.find((row) => key.every((field) => row[field] === this.payload[field])) : undefined;
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
  return { from: (table) => new FakeQuery(table) };
}

/* ------------------------------------------------ fixtures */
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";
const USER = "user-stage6-outlook";
function makeTables() {
  return {
    email_connections: [{
      id: "conn-stage6-outlook",
      user_id: USER,
      provider: "outlook",
      encrypted_access_token: encryptToken("fixture-access-token"),
      encrypted_refresh_token: encryptToken("fixture-refresh-token"),
      token_expiry: new Date(Date.now() + 3600_000).toISOString(),
      granted_scopes: ["Mail.Read"],
      connection_status: "connected",
      email_address: "fixture@fixture-travel.test",
      last_synced_at: null,
      sync_lease_token: null,
      sync_lease_expires_at: null
    }],
    email_sync_cursors: [],
    travel_email_messages: [],
    booking_extraction_results: [],
    booking_email_suppressions: [],
    roamly_bookings: [],
    roamly_trips: []
  };
}

const DELTA_LINK = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=fixture-next";
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "graph.microsoft.com") {
    return new Response(JSON.stringify({
      value: [{
        id: "outlook-msg-1",
        subject: "Your hotel booking confirmation",
        from: { emailAddress: { address: "bookings@fixture-travel.test", name: "Fixture Travel" } },
        receivedDateTime: "2026-11-01T10:00:00.000Z",
        bodyPreview: "Fixture hotel booking confirmation. Confirmation code FIXTURE-22222. Check-in 2026-11-05."
      }],
      "@odata.deltaLink": DELTA_LINK
    }), { status: 200 });
  }
  throw new Error(`unexpected fetch in fixture run: ${url.hostname}`);
};

/* PASS: every message accounted for — cursor + stamp may land */
{
  const tables = makeTables();
  const result = await syncOutlookConnection({ supabase: makeFake(tables), userId: USER });
  check("PASS: sync reports success only after full processing", result.ok === true && result.error === null);
  check("PASS: the message was processed", result.processed === 1);
  check("PASS: the message record was saved", tables.travel_email_messages.length === 1);
  check(
    "PASS: the delta cursor advanced to the served delta link",
    tables.email_sync_cursors.length === 1 && tables.email_sync_cursors[0].history_id_or_delta_token === DELTA_LINK
  );
  check("PASS: last_synced_at was stamped", typeof tables.email_connections[0].last_synced_at === "string");
}

/* FAIL-RECORD: a message cannot be recorded — no claim, no cursor */
{
  const tables = makeTables();
  const fake = makeFake(tables, { "travel_email_messages:upsert": { message: "record boom" } });
  const result = await syncOutlookConnection({ supabase: fake, userId: USER });
  check("FAIL-RECORD: sync reports a retryable failure, not success", result.ok === false && result.error === "OUTLOOK_BOOKING_PROCESSING_RETRY");
  check("FAIL-RECORD: the delta cursor did NOT advance past the failed message", tables.email_sync_cursors.length === 0);
  check("FAIL-RECORD: last_synced_at was NOT stamped", tables.email_connections[0].last_synced_at === null);
}

/* FAIL-CURSOR: processing fine, cursor write fails — still no claim */
{
  const tables = makeTables();
  const fake = makeFake(tables, { "email_sync_cursors:upsert": { message: "cursor boom" } });
  const result = await syncOutlookConnection({ supabase: fake, userId: USER });
  check("FAIL-CURSOR: sync reports the checkpoint failure", result.ok === false && result.error === "OUTLOOK_CURSOR_CHECKPOINT_FAILED");
  check("FAIL-CURSOR: last_synced_at was NOT stamped", tables.email_connections[0].last_synced_at === null);
}

console.log(`Stage 6 outlook-sync-checkpoint checks passed (${count} checks).`);
