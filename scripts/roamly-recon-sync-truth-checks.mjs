// Recon sync-truth checks — RUNTIME proof with synthetic fixtures only.
//
// The defect family: a sync that cannot run must say WHY truthfully.
// The Nov 6 live test caught the Gmail sync route answering
// {"ok":true,"skipped":true,"reason":"SYNC_ALREADY_RUNNING"} to a
// traveller with NO connection at all (the lease was claimed before
// the connection check). Block H (consolidation 2026-11-06) added the
// pre-check; this suite pins the pre-check AND the residual paths it
// could not decide — a pre-check read error, a row changing between
// the pre-check and the claim, and a claim UPDATE that fails for a
// non-contention reason — which the claim-failure re-read
// (classifySyncClaimFailure, 2026-11-11) now answers from the row
// that is actually there:
//   no live row            -> *_NOT_CONNECTED (ok:false)
//   live lease held        -> SYNC_ALREADY_RUNNING (ok:true, skipped)
//   live row, no live lease,
//     claim failed         -> GMAIL_SYNC_RETRY / OUTLOOK_SYNC_FAILED
//
// No real email, tokens, or user rows: fixture strings only, tokens
// are ciphertext under a throwaway test-only key, Gmail is a local
// fetch stub, Supabase is an in-memory fake store whose .or() is
// lease-aware (the one place the g13/g14 fake's no-op .or() cannot
// express contention). No network is touched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Test-only environment: no live Supabase admin client, no Build 2
// lane — every seam below stays local (same hygiene as g13/g14).
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ROAMLY_BUILD2_ENABLED;
delete process.env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED;
delete process.env.ROAMLY_BUILD2_GATES_ENABLED;
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";

const { encryptToken, syncGmailConnection, syncOutlookConnection } = await import(
  "../lib/roamly/emailConnections.ts"
);
const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts");
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------- fake store
// state.failSelects: the next N select resolutions on email_connections
//   return an error (a read that hiccups exactly once).
// state.failUpdates: every update on email_connections errors without
//   mutating (a claim that fails for a non-contention reason).
function makeStore(rows, state = {}) {
  return {
    tables: {
      email_connections: rows,
      email_sync_cursors: [],
      travel_email_messages: [],
      booking_extraction_results: [],
      roamly_bookings: [],
      roamly_trips: []
    },
    state: { failSelects: 0, failUpdates: false, ...state }
  };
}

class FakeQuery {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.op = "select";
    this.payload = null;
    this.conflict = null;
    this.single = false;
  }
  select() { return this; }
  eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
  neq(field, value) { this.filters.push((row) => row[field] !== value); return this; }
  or(expression) {
    // Lease-aware for the one .or() this surface uses:
    // "sync_lease_expires_at.is.null,sync_lease_expires_at.lt.<ISO>"
    const alternatives = String(expression).split(",").map((part) => {
      if (part === "sync_lease_expires_at.is.null") return (row) => row.sync_lease_expires_at == null;
      const lt = part.match(/^sync_lease_expires_at\.lt\.(.+)$/);
      if (lt) return (row) => row.sync_lease_expires_at != null && row.sync_lease_expires_at < lt[1];
      return () => true;
    });
    this.filters.push((row) => alternatives.some((f) => f(row)));
    return this;
  }
  gte(field, value) { this.filters.push((row) => row[field] >= value); return this; }
  lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
  order() { return this; }
  limit() { return this; }
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
    const { tables, state } = this.store;
    const rows = tables[this.table];
    if (this.op === "select" && this.table === "email_connections" && state.failSelects > 0) {
      state.failSelects -= 1;
      return { data: null, error: { message: "fixture read failure" } };
    }
    const matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.op === "update") {
      if (this.table === "email_connections" && state.failUpdates) {
        return { data: null, error: { message: "fixture update failure" } };
      }
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
    return { data: this.single ? matched[0] || null : matched, error: null };
  }
}

function makeSupabase(store) {
  return { from: (table) => new FakeQuery(store, table) };
}

const fixtureAccess = encryptToken("fixture-access-token");
const fixtureRefresh = encryptToken("fixture-refresh-token");
function connectionRow(provider, overrides = {}) {
  return {
    id: `conn-fixture-${provider}`,
    user_id: `user-fixture-${provider}`,
    provider,
    encrypted_access_token: fixtureAccess,
    encrypted_refresh_token: fixtureRefresh,
    token_expiry: new Date(Date.now() + 3600_000).toISOString(),
    granted_scopes: [],
    connection_status: "connected",
    email_address: "fixture@fixture-travel.test",
    last_synced_at: null,
    sync_lease_token: null,
    sync_lease_expires_at: null,
    ...overrides
  };
}
const future = () => new Date(Date.now() + 120_000).toISOString();
const past = () => new Date(Date.now() - 120_000).toISOString();

// No provider fetch may happen on any claim-failure path.
globalThis.fetch = async () => {
  throw new Error("fixture fetch must not be called on a claim-failure path");
};

// ---------------------------------------------------------------- Gmail branches
{
  const store = makeStore([]);
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-none" });
  check("Gmail: no connection row -> GMAIL_NOT_CONNECTED", out.ok === false && out.error === "GMAIL_NOT_CONNECTED" && out.processed === 0);
}
{
  const store = makeStore([connectionRow("gmail", { connection_status: "disconnected" })]);
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-fixture-gmail" });
  check("Gmail: only a disconnected row -> GMAIL_NOT_CONNECTED", out.ok === false && out.error === "GMAIL_NOT_CONNECTED");
}
{
  const store = makeStore([
    connectionRow("gmail", { connection_status: "syncing", sync_lease_token: "held-elsewhere", sync_lease_expires_at: future() })
  ]);
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-fixture-gmail" });
  check(
    "Gmail: lease genuinely held -> SYNC_ALREADY_RUNNING (unchanged shape)",
    out.ok === true && out.skipped === true && out.reason === "SYNC_ALREADY_RUNNING" && out.processed === 0
  );
}
{
  const store = makeStore([connectionRow("gmail", { sync_lease_expires_at: past() })], { failUpdates: true });
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-fixture-gmail" });
  check(
    "Gmail: claim UPDATE fails, no lease held -> GMAIL_SYNC_RETRY, never ALREADY_RUNNING",
    out.ok === false && out.error === "GMAIL_SYNC_RETRY" && out.reason !== "SYNC_ALREADY_RUNNING"
  );
}
{
  // THE residual hole: the pre-check read errors, so Block H's
  // pre-check cannot decide; before the re-read existed this exact
  // path answered SYNC_ALREADY_RUNNING to a user with no connection.
  const store = makeStore([], { failSelects: 1 });
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-none" });
  check(
    "Gmail: pre-check read error + no row -> GMAIL_NOT_CONNECTED (residual lie closed)",
    out.ok === false && out.error === "GMAIL_NOT_CONNECTED"
  );
}
{
  // Success path undisturbed: lease free, updates fine, empty
  // lookback list -> a real sync runs and reports ok.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/gmail/v1/users/me/messages") {
      return new Response(JSON.stringify({ historyId: "fixture-history-1", messages: [] }), { status: 200 });
    }
    throw new Error(`unexpected fixture fetch: ${url.pathname}`);
  };
  const store = makeStore([connectionRow("gmail")]);
  const out = await syncGmailConnection({ supabase: makeSupabase(store), userId: "user-fixture-gmail" });
  check("Gmail: free lease -> sync runs, ok with 0 processed on an empty list", out.ok === true && out.error === null && out.processed === 0);
  check("Gmail: successful sync stamps last_synced_at", typeof store.tables.email_connections[0].last_synced_at === "string");
  globalThis.fetch = async () => {
    throw new Error("fixture fetch must not be called on a claim-failure path");
  };
}

// ---------------------------------------------------------------- Outlook branches
{
  const store = makeStore([]);
  const out = await syncOutlookConnection({ supabase: makeSupabase(store), userId: "user-none" });
  check("Outlook: no connection row -> OUTLOOK_NOT_CONNECTED", out.ok === false && out.error === "OUTLOOK_NOT_CONNECTED" && out.processed === 0);
}
{
  const store = makeStore([connectionRow("outlook", { connection_status: "disconnected" })]);
  const out = await syncOutlookConnection({ supabase: makeSupabase(store), userId: "user-fixture-outlook" });
  check("Outlook: only a disconnected row -> OUTLOOK_NOT_CONNECTED", out.ok === false && out.error === "OUTLOOK_NOT_CONNECTED");
}
{
  const store = makeStore([
    connectionRow("outlook", { connection_status: "syncing", sync_lease_token: "held-elsewhere", sync_lease_expires_at: future() })
  ]);
  const out = await syncOutlookConnection({ supabase: makeSupabase(store), userId: "user-fixture-outlook" });
  check(
    "Outlook: lease genuinely held -> SYNC_ALREADY_RUNNING (unchanged shape)",
    out.ok === true && out.skipped === true && out.reason === "SYNC_ALREADY_RUNNING" && out.processed === 0
  );
}
{
  const store = makeStore([connectionRow("outlook", { sync_lease_expires_at: past() })], { failUpdates: true });
  const out = await syncOutlookConnection({ supabase: makeSupabase(store), userId: "user-fixture-outlook" });
  check(
    "Outlook: claim UPDATE fails, no lease held -> OUTLOOK_SYNC_FAILED, never ALREADY_RUNNING",
    out.ok === false && out.error === "OUTLOOK_SYNC_FAILED" && out.reason !== "SYNC_ALREADY_RUNNING"
  );
}
{
  const store = makeStore([], { failSelects: 1 });
  const out = await syncOutlookConnection({ supabase: makeSupabase(store), userId: "user-none" });
  check(
    "Outlook: pre-check read error + no row -> OUTLOOK_NOT_CONNECTED (residual lie closed)",
    out.ok === false && out.error === "OUTLOOK_NOT_CONNECTED"
  );
}

// ---------------------------------------------------------------- static pins
const conn = read("lib/roamly/emailConnections.ts");
check(
  "static: both wrappers classify a failed claim via the re-read",
  (conn.match(/classifySyncClaimFailure\(\{ \.\.\.params, provider: (GMAIL|OUTLOOK)_PROVIDER \}\)/g) || []).length === 2
);
check(
  "static: the unconditional claim-null lie line is gone",
  !conn.includes('if (!lease) return { ok: true as const, skipped: true as const, reason: "SYNC_ALREADY_RUNNING"')
);
for (const provider of ["GMAIL_PROVIDER", "OUTLOOK_PROVIDER"]) {
  const claimAt = conn.indexOf(`claimEmailSync({ ...params, provider: ${provider} })`);
  const classifyAt = conn.indexOf(`classifySyncClaimFailure({ ...params, provider: ${provider} })`);
  check(`static: ${provider} claim is followed by its classification`, claimAt > -1 && classifyAt > claimAt);
}

console.log(`\nrecon-sync-truth: ${passed} checks passed`);
