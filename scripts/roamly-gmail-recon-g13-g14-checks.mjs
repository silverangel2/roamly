// Gmail reconciliation G13 (skip/quarantine) + G14 (reauth classification)
// checks — RUNTIME proof with synthetic fixtures only.
//
// No real email content, subjects, tokens, or user rows are used here:
// message ids, senders, and bodies are invented fixture strings, and
// the "tokens" are ciphertext produced inside this process under a
// throwaway test-only encryption key. No network is touched: Gmail is
// a local fetch stub and Supabase is an in-memory fake store.
// It does not prove any production row state (see PACKET-SECTION.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

// Test-only environment: no live Supabase admin client, no Build 2
// lane, no AI extraction client — every seam below stays local.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ROAMLY_BUILD2_ENABLED;
delete process.env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED;
delete process.env.ROAMLY_BUILD2_GATES_ENABLED;

const {
  decryptToken,
  encryptToken,
  syncGmailConnection,
  TokenDecryptError,
  isTokenDecryptFailure,
  GMAIL_SYNC_QUARANTINE_REASON
} = await import("../lib/roamly/emailConnections.ts");
const { createSupabaseAdminClient } = await import("../lib/supabase/admin.ts");
assert.equal(createSupabaseAdminClient(), null, "admin client must be null in this fixture run (no live calls)");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------- fake store
function makeStore(connection) {
  const tables = {
    email_connections: [connection],
    email_sync_cursors: [],
    travel_email_messages: [],
    booking_extraction_results: [],
    roamly_bookings: [],
    roamly_trips: []
  };
  return tables;
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

function metadataMessage(id, subject) {
  return {
    id,
    snippet: "Fixture snippet",
    internalDate: String(Date.parse("2026-10-05T10:00:00Z")),
    payload: {
      headers: [
        { name: "From", value: "Fixture Travel <bookings@fixture-travel.test>" },
        { name: "Subject", value: subject },
        { name: "Date", value: new Date("2026-10-05T10:00:00Z").toUTCString() }
      ]
    }
  };
}

function fullMessage(id, body) {
  return {
    id,
    payload: {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/plain", body: { data: b64url(body) } }]
    }
  };
}

// ---------------------------------------------------------------- G13 runtime
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";
const fixtureAccess = encryptToken("fixture-access-token");
const fixtureRefresh = encryptToken("fixture-refresh-token");
const g13Connection = {
  id: "conn-fixture-g13",
  user_id: "user-fixture-g13",
  provider: "gmail",
  encrypted_access_token: fixtureAccess,
  encrypted_refresh_token: fixtureRefresh,
  token_expiry: new Date(Date.now() + 3600_000).toISOString(),
  granted_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  connection_status: "connected",
  email_address: "fixture@fixture-travel.test",
  last_synced_at: null,
  sync_lease_token: null,
  sync_lease_expires_at: null
};
const g13Tables = makeStore({ ...g13Connection });
const g13FetchCalls = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  g13FetchCalls.push(url.pathname + url.search);
  const messageMatch = url.pathname.match(/\/messages\/([^/]+)$/);
  if (messageMatch) {
    const id = decodeURIComponent(messageMatch[1]);
    if (url.searchParams.get("format") === "metadata") {
      // The poison message: its metadata fetch fails, mid-batch.
      if (id === "fixture-msg-poison") {
        return new Response(JSON.stringify({}), { status: 500 });
      }
      const subject = id === "fixture-msg-1" ? "Fixture booking confirmation" : "Fixture booking confirmation";
      return new Response(JSON.stringify(metadataMessage(id, subject)), { status: 200 });
    }
    const code = id === "fixture-msg-1" ? "FIXTURE-11111" : "FIXTURE-33333";
    const day = id === "fixture-msg-1" ? "2026-11-05" : "2026-11-06";
    return new Response(
      JSON.stringify(fullMessage(id, `Fixture hotel booking confirmation. Confirmation code ${code}. Check-in ${day}.`)),
      { status: 200 }
    );
  }
  // No cursor yet: the lookback list is the batch, poison in the middle.
  return new Response(
    JSON.stringify({
      historyId: "fixture-history-after-poison",
      messages: [{ id: "fixture-msg-1" }, { id: "fixture-msg-poison" }, { id: "fixture-msg-3" }]
    }),
    { status: 200 }
  );
};

const g13 = await syncGmailConnection({ supabase: makeSupabase(g13Tables), userId: "user-fixture-g13" });
check("G13: sync succeeds despite one failing message", g13.ok === true && g13.error === null);
check("G13: no processing-retry error is returned", g13.error !== "GMAIL_BOOKING_PROCESSING_RETRY");
check("G13: all three messages counted as processed", g13.processed === 3);
check("G13: exactly one message quarantined", g13.quarantined === 1);
const g13Cursor = g13Tables.email_sync_cursors[0];
check(
  "G13: cursor advances PAST the poison message",
  g13Cursor?.history_id_or_delta_token === "fixture-history-after-poison"
);
const g13Travel = g13Tables.travel_email_messages;
const poisonRows = g13Travel.filter((row) => row.provider_message_id === "fixture-msg-poison");
check("G13: poison message recorded exactly once (upsert key holds)", poisonRows.length === 1);
check(
  "G13: poison row is an error/quarantine row, not a silent drop",
  poisonRows[0]?.processing_result === "error" &&
    Array.isArray(poisonRows[0]?.filter_reasons) &&
    poisonRows[0].filter_reasons.includes(GMAIL_SYNC_QUARANTINE_REASON)
);
check(
  "G13: neighbouring messages were processed, not quarantined",
  g13Travel.some((row) => row.provider_message_id === "fixture-msg-1" && row.processing_result !== "error") &&
    g13Travel.some((row) => row.provider_message_id === "fixture-msg-3" && row.processing_result !== "error")
);
check(
  "G13: poison message produced no booking extraction",
  !g13Tables.booking_extraction_results.some((row) => row.email_message_id === poisonRows[0]?.id)
);
check(
  "G13: connection last_synced_at advances (sync not stuck on error)",
  typeof g13Tables.email_connections[0].last_synced_at === "string"
);
// The email-imports route's exact quarantined filters, run against the
// fixture store: the quarantined row is what that route returns.
const visibleQuarantined = g13Travel.filter(
  (row) => row.user_id === "user-fixture-g13" && row.provider === "gmail" && row.processing_result === "error"
);
check("G13: quarantined row matches the email-imports visibility filters", visibleQuarantined.length === 1);

// ---------------------------------------------------------------- G14 runtime
// Scenario A: encryption key removed after tokens were stored.
async function runG14Scenario(label, setupKey) {
  const tables = makeStore({
    id: `conn-fixture-g14-${label}`,
    user_id: `user-fixture-g14-${label}`,
    provider: "gmail",
    encrypted_access_token: fixtureAccess,
    encrypted_refresh_token: fixtureRefresh,
    token_expiry: new Date(Date.now() - 3600_000).toISOString(),
    granted_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    connection_status: "connected",
    email_address: "fixture@fixture-travel.test",
    last_synced_at: "2026-10-01T00:00:00Z",
    sync_lease_token: null,
    sync_lease_expires_at: null
  });
  setupKey();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fixture fetch must not be called on the decrypt-failure path");
  };
  const outcome = await syncGmailConnection({
    supabase: makeSupabase(tables),
    userId: `user-fixture-g14-${label}`
  });
  const row = tables.email_connections[0];
  check(`G14 (${label}): outcome is REAUTH, not a retry`, outcome.ok === false && outcome.error === "GMAIL_REAUTH_REQUIRED");
  check(`G14 (${label}): retry path is NOT taken`, outcome.error !== "GMAIL_TOKEN_REFRESH_RETRY");
  check(`G14 (${label}): row is disconnected (release did not flip it back to error)`, row.connection_status === "disconnected");
  check(`G14 (${label}): disconnected_at is set`, typeof row.disconnected_at === "string");
  check(
    `G14 (${label}): tokens are NOT nulled by the reauth marking`,
    row.encrypted_access_token === fixtureAccess && row.encrypted_refresh_token === fixtureRefresh
  );
  check(`G14 (${label}): no provider call or retry loop happens`, fetchCalls === 0);
}

await runG14Scenario("key-removed", () => {
  delete process.env.ROAMLY_TOKEN_ENCRYPTION_KEY;
});
await runG14Scenario("key-rotated", () => {
  process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key-rotated";
});

// Direct decrypt classification, all three shapes.
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key";
check("G14: encrypt/decrypt round-trips under the current key", decryptToken(encryptToken("fixture-plain")) === "fixture-plain");
delete process.env.ROAMLY_TOKEN_ENCRYPTION_KEY;
let missingKeyError = null;
try {
  decryptToken(fixtureAccess);
} catch (error) {
  missingKeyError = error;
}
check("G14: missing key throws a typed decrypt error", missingKeyError instanceof TokenDecryptError);
check("G14: missing-key error carries the decrypt code", isTokenDecryptFailure(missingKeyError));
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "fixture-test-only-key-rotated";
let rotatedError = null;
try {
  decryptToken(fixtureAccess);
} catch (error) {
  rotatedError = error;
}
check("G14: rotated key (tag mismatch) throws the same typed error", rotatedError instanceof TokenDecryptError);
check("G14: rotated-key error classifies as decrypt failure", isTokenDecryptFailure(rotatedError));
check("G14: an ordinary error does NOT classify as decrypt failure", isTokenDecryptFailure(new Error("boom")) === false);

// ---------------------------------------------------------------- code-level
const connections = read("lib/roamly/emailConnections.ts");
check("G14: sync catch classifies decrypt failures as reauth", connections.includes("isTokenDecryptFailure(error)"));
check(
  "G14: reauth marking sets disconnected + disconnected_at",
  (() => {
    const body = connections.slice(
      connections.indexOf("async function markGmailReauthorizationRequired"),
      connections.indexOf("async function recoverGmailHistoryCursor")
    );
    return body.includes('connection_status: "disconnected"') && body.includes("disconnected_at") && !body.includes("encrypted_");
  })()
);
check(
  "G14: release guard cannot overwrite disconnected back to error",
  connections.includes('.neq("connection_status", "disconnected")')
);
check("G13: quarantine writes the existing travel table on the existing key", connections.includes('from("travel_email_messages")') && connections.includes('onConflict: "email_connection_id,provider,provider_message_id"'));
check("G13: quarantine uses the existing error result value", connections.includes('processing_result: "error"'));
check("G13: loop quarantines a retryable message instead of stalling", connections.includes("quarantineGmailTravelMessage"));
check("G13: sync still returns a retry when the quarantine write itself fails", connections.includes("else retryable = true;"));

const gate = read("lib/roamly/gateService.ts");
check("gate view excludes disconnected rows", gate.includes('.neq("connection_status", "disconnected")'));
const setup = read("lib/roamly/setupState.ts");
check(
  "disconnected row is not gmailConnected (only CONNECTED/RECONCILIATION_ARMED count)",
  setup.includes('gmailView?.state === "CONNECTED" || gmailView?.state === "RECONCILIATION_ARMED"')
);
const tripLines = read("components/roamly/TripStateLines.tsx");
check(
  "trip line for a disconnected row says not activated — connect Gmail",
  tripLines.includes("not activated —") && tripLines.includes("connect Gmail")
);
const cascade = read("components/roamly/SetupCascade.tsx");
check(
  "setup cascade shows the disconnected (not activated) line for a once-connected account",
  cascade.includes("currently disconnected, so Booking Recon is not activated.")
);
const importsRoute = read("app/api/trips/[id]/bookings/email-imports/route.ts");
check(
  "email-imports route returns quarantined error rows separately from imports",
  importsRoute.includes('from("travel_email_messages")') &&
    importsRoute.includes('eq("processing_result", "error")') &&
    importsRoute.includes("quarantined")
);
const panel = read("components/roamly/GmailImportPanel.tsx");
check(
  "import panel renders the quarantined section",
  panel.includes("Kept aside, not deleted") && panel.includes("setQuarantined")
);

console.log(`\n${passed} Gmail recon G13+G14 checks passed`);
console.log("NOTE: fixture proof only — production proof on any real account row is NOT established by this script.");
