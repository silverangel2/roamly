// Deterministic safeguards checks for the companion email state machine
// (Safeguards 1+2, 2026-10-31) running the REAL dispatcher
// (lib/roamly/pushServer.ts sendScheduledTripNotifications) against an
// in-process PostgREST fake with failure injection, plus a controllable
// fake SMTP server for provider-outcome control:
//   capture ON   -> provider accepts (log status "captured")
//   SMTP accept  -> provider accepts over real SMTP (log status "sent")
//   SMTP reject  -> explicit 550 rejection (positive non-delivery)
//   SMTP drop    -> socket destroyed after DATA (outcome UNKNOWN)
//   SMTP port 1  -> connection refused (positive non-delivery)
// Safeguard 1: claim/ownership failure fails CLOSED; durable delivery
// states; ambiguous outcomes are held and reconciled by claim id, never
// blindly resent; stale pre-provider claims are reclaimable.
// Safeguard 2: generation boundaries (created_at vs emailSentAt).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// lib/roamly/email.ts sends via Google Workspace SMTP with requireTLS,
// so the fake SMTP server below must complete a REAL STARTTLS upgrade
// with a certificate the client trusts. Generate a throwaway test CA
// once and re-exec this suite with NODE_EXTRA_CA_CERTS pointing at it
// (Node only reads that variable at process start). Test-only material,
// generated fresh in a temp dir on every run; never leaves the machine.
if (!process.env.ROAMLY_SAFEGUARDS_CA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamly-test-ca-"));
  const run = (args) => execFileSync("openssl", args, { stdio: "pipe" });
  run(["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "ca-key.pem"), "-out", path.join(dir, "ca.pem"), "-days", "3650", "-nodes", "-subj", "/CN=Roamly Test CA"]);
  run(["req", "-newkey", "rsa:2048", "-keyout", path.join(dir, "server-key.pem"), "-out", path.join(dir, "server.csr"), "-nodes", "-subj", "/CN=localhost"]);
  fs.writeFileSync(path.join(dir, "san.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  run(["x509", "-req", "-in", path.join(dir, "server.csr"), "-CA", path.join(dir, "ca.pem"), "-CAkey", path.join(dir, "ca-key.pem"), "-CAcreateserial", "-out", path.join(dir, "server-cert.pem"), "-days", "3650", "-extfile", path.join(dir, "san.cnf")]);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, "ca.pem"), ROAMLY_SAFEGUARDS_CA: dir }
  });
  process.exit(child.status ?? 1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROAMLY_TEST_ROOT ? path.resolve(process.env.ROAMLY_TEST_ROOT) : path.resolve(here, "..");

// ---------------------------------------------------------------------------
// PostgREST fake (burst-suite pattern) + failure injection hook.
// failHook({ method, table, body, params }) -> true responds 500, so a
// test can deterministically break one exact write/read in the flow.
// ---------------------------------------------------------------------------
function createFakeSupabase() {
  const state = { users: new Map(), tables: new Map() };
  let failHook = null;
  const table = (name) => {
    if (!state.tables.has(name)) state.tables.set(name, []);
    return state.tables.get(name);
  };
  function accessor(row, key) {
    const jsonMatch = /^(.+)->>(.+)$/.exec(key);
    if (jsonMatch) {
      const parent = row[jsonMatch[1]];
      return parent && typeof parent === "object" ? parent[jsonMatch[2]] : undefined;
    }
    return row[key];
  }
  function matches(row, params) {
    for (const [key, raw] of params.entries()) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const dot = raw.indexOf(".");
      const op = dot > 0 ? raw.slice(0, dot) : "eq";
      const value = dot > 0 ? raw.slice(dot + 1) : raw;
      const actual = accessor(row, key);
      if (op === "eq" && String(actual) !== value) return false;
      if (op === "neq" && String(actual) === value) return false;
      if (op === "is") {
        if (value === "null" && actual !== null && actual !== undefined) return false;
        if (value === "true" && actual !== true) return false;
        if (value === "false" && actual !== false) return false;
      }
      if (op === "lt" && !(String(actual) < value)) return false;
      if (op === "lte" && !(String(actual) <= value)) return false;
      if (op === "gt" && !(String(actual) > value)) return false;
      if (op === "gte" && !(String(actual) >= value)) return false;
      if (!["eq", "neq", "is", "lt", "lte", "gt", "gte"].includes(op)) {
        throw new Error(`fake supabase: unsupported filter operator "${op}"`);
      }
    }
    return true;
  }
  function applyOrder(rows, params) {
    const order = params.get("order");
    if (!order) return rows;
    const keys = order.split(",").map((part) => {
      const [col, dir] = part.split(".");
      return { col, desc: dir === "desc" };
    });
    return [...rows].sort((a, b) => {
      for (const { col, desc } of keys) {
        const av = accessor(a, col);
        const bv = accessor(b, col);
        if (av === bv) continue;
        if (av === null || av === undefined) return desc ? -1 : 1;
        if (bv === null || bv === undefined) return desc ? 1 : -1;
        const cmp = String(av) < String(bv) ? -1 : 1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  function respond(req, res, status, rows) {
    const accept = String(req.headers.accept || "");
    const wantsObject = accept.includes("application/vnd.pgrst.object+json");
    let body;
    if (wantsObject && Array.isArray(rows)) {
      body = rows.length === 1 ? rows[0] : rows;
    } else {
      body = rows;
    }
    const text = body === undefined || body === null ? "" : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fake.local");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;

      const adminUser = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(url.pathname);
      if (adminUser && req.method === "GET") {
        const user = state.users.get(decodeURIComponent(adminUser[1]));
        if (!user) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: "user_not_found", message: "User not found" }));
        }
        return respond(req, res, 200, { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", user_metadata: {}, created_at: user.created_at });
      }

      const rest = /^\/rest\/v1\/(.+)$/.exec(url.pathname);
      if (!rest) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ code: "not_found", message: `no fake route for ${req.method} ${url.pathname}` }));
      }
      const tableName = decodeURIComponent(rest[1]);
      if (failHook && failHook({ method: req.method, table: tableName, body, params: url.searchParams })) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ code: "injected", message: "injected failure" }));
      }
      const rows = table(tableName);
      const params = url.searchParams;
      const prefer = String(req.headers.prefer || "");
      const wantsRepresentation = prefer.includes("return=representation");

      if (req.method === "GET") {
        let out = rows.filter((row) => matches(row, params));
        out = applyOrder(out, params);
        const limit = Number(params.get("limit"));
        if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
        return respond(req, res, 200, out);
      }
      if (req.method === "POST") {
        const incoming = Array.isArray(body) ? body : [body];
        const stored = incoming.map((row) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...row
        }));
        rows.push(...stored);
        if (!wantsRepresentation) {
          res.writeHead(201);
          return res.end("");
        }
        return respond(req, res, 201, stored);
      }
      if (req.method === "PATCH") {
        const targets = rows.filter((row) => matches(row, params));
        for (const row of targets) Object.assign(row, body || {});
        if (!wantsRepresentation) {
          res.writeHead(204);
          return res.end("");
        }
        return respond(req, res, 200, targets);
      }
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "method", message: "unsupported" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "fake_error", message: error instanceof Error ? error.message : String(error) }));
    }
  });
  return {
    state,
    table,
    setFailHook(fn) { failHook = fn; },
    reset() { state.users.clear(); state.tables.clear(); failHook = null; },
    listen() { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); },
    close() { return new Promise((resolve) => server.close(resolve)); }
  };
}

// ---------------------------------------------------------------------------
// Fake SMTP server: mode "accept" (250 after DATA, message recorded),
// "reject" (550 at RCPT), "drop" (socket destroyed after DATA — the
// client sees a dropped connection, the outcome is genuinely unknown).
// ---------------------------------------------------------------------------
function createFakeSmtp() {
  const smtp = { mode: "accept", messages: [], server: null, port: 0 };
  const caDir = process.env.ROAMLY_SAFEGUARDS_CA;
  const serverKey = fs.readFileSync(path.join(caDir, "server-key.pem"));
  const serverCert = fs.readFileSync(path.join(caDir, "server-cert.pem"));
  smtp.server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let dataBuf = "";
    let active = socket;
    let tlsActive = false;
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          dataBuf += line + "\r\n";
          if (line === ".") {
            inData = false;
            if (smtp.mode === "drop") { active.destroy(); return; }
            smtp.messages.push(dataBuf);
            active.write("250 2.0.0 OK queued\r\n");
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          active.write(tlsActive
            ? "250-fake greets\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n"
            : "250-fake greets\r\n250-AUTH PLAIN LOGIN\r\n250-STARTTLS\r\n250 OK\r\n");
        } else if (upper.startsWith("STARTTLS")) {
          active.write("220 2.0.0 Ready to start TLS\r\n", () => {
            socket.removeAllListeners("data");
            const tlsSocket = new tls.TLSSocket(socket, { isServer: true, key: serverKey, cert: serverCert });
            tlsSocket.on("data", onData);
            tlsSocket.on("error", () => {});
            active = tlsSocket;
            tlsActive = true;
          });
          return;
        }
        else if (upper.startsWith("AUTH PLAIN")) active.write("235 2.7.0 Authentication successful\r\n");
        else if (upper.startsWith("AUTH LOGIN")) active.write("334 VXNlcm5hbWU6\r\n");
        else if (upper.startsWith("MAIL FROM")) active.write("250 2.1.0 OK\r\n");
        else if (upper.startsWith("RCPT TO")) active.write(smtp.mode === "reject" ? "550 5.1.1 Mailbox rejected\r\n" : "250 2.1.5 OK\r\n");
        else if (upper.startsWith("DATA")) { inData = true; dataBuf = ""; active.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
        else if (upper.startsWith("RSET") || upper.startsWith("NOOP")) active.write("250 2.0.0 OK\r\n");
        else if (upper.startsWith("QUIT")) { active.write("221 2.0.0 Bye\r\n"); active.end(); }
        else if (/^[A-Za-z0-9+/=]+$/.test(line) && line.length > 3) active.write("334 UGFzc3dvcmQ6\r\n");
        else active.write("250 OK\r\n");
      }
    };
    socket.write("220 fake ESMTP ready\r\n");
    socket.on("data", onData);
    socket.on("error", () => {});
  });
  smtp.listen = () => new Promise((resolve) => smtp.server.listen(0, "127.0.0.1", () => { smtp.port = smtp.server.address().port; resolve(smtp.port); }));
  smtp.close = () => new Promise((resolve) => smtp.server.close(resolve));
  return smtp;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function note(text) { console.log(`[NOTE] ${text}`); }

const fake = createFakeSupabase();
const port = await fake.listen();
const smtp = createFakeSmtp();
await smtp.listen();

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.ROAMLY_EMAIL_PROVIDER = "smtp";
process.env.ROAMLY_SMTP_HOST = "127.0.0.1";
process.env.ROAMLY_SMTP_PORT = "1";
process.env.ROAMLY_SMTP_USER = "sender@roamlyhq.com";
process.env.ROAMLY_SMTP_PASSWORD = "stub-password";
process.env.ROAMLY_SMTP_SECURE = "false";
process.env.ROAMLY_FROM_EMAIL = "support@roamlyhq.com";
delete process.env.ROAMLY_DAILY_TEST_EMAIL;

function useCapture() {
  process.env.ROAMLY_EMAIL_CAPTURE_ENABLED = "true";
}
function useSmtp(mode) {
  delete process.env.ROAMLY_EMAIL_CAPTURE_ENABLED;
  smtp.mode = mode;
  process.env.ROAMLY_SMTP_PORT = String(smtp.port);
}
function useRefused() {
  delete process.env.ROAMLY_EMAIL_CAPTURE_ENABLED;
  process.env.ROAMLY_SMTP_PORT = "1";
}

const pushServer = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);
const { sendScheduledTripNotifications } = pushServer;
let pushEndpoint = null;
try {
  pushEndpoint = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushEndpoint.ts")).href);
} catch { /* documented below */ }

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_EMAIL = "traveler@roamlyhq.com";
const iso = (ms) => new Date(ms).toISOString();
const dateOnly = (ms) => iso(ms).slice(0, 10);

function seedUser() {
  fake.state.users.set(USER_ID, { id: USER_ID, email: USER_EMAIL, created_at: iso(Date.now() - 86400_000) });
}
function seedTrip(tripId, now, metadata = {}) {
  fake.table("roamly_trips").push({
    id: tripId,
    user_id: USER_ID,
    start_date: dateOnly(now + 3 * 86400_000),
    end_date: dateOnly(now + 6 * 86400_000),
    status: "active",
    itinerary_status: "ready",
    tracking_unlocked: true,
    live_companion_unlocked: true,
    trip_companion_status: "scheduled",
    metadata,
    destination: "Banff",
    destination_name: "Banff",
    destination_city: "Banff",
    created_at: iso(now - 86400_000)
  });
}
function seedEvent({ id, tripId, now, createdMs = null, dueMs = null, status = "scheduled", metadata = {}, type = "one_week_before" }) {
  fake.table("roamly_trip_companion_events").push({
    id,
    user_id: USER_ID,
    trip_id: tripId,
    booking_id: null,
    event_type: type,
    title: `${type} reminder`,
    body: `${type} body`,
    status,
    scheduled_for: iso(dueMs === null ? now - 3600_000 : dueMs),
    completed_at: null,
    metadata: { generatedBy: "roamly_companion", ...metadata },
    created_at: iso(createdMs === null ? now - 86400_000 : createdMs)
  });
}
const STAGE_TYPES = ["one_week_before", "document_check", "country_info", "packing_check", "one_day_before", "countdown_24h", "travel_day_started"];
function seedBurst(tripId, now, { allDue = false } = {}) {
  const created = iso(now - 86400_000);
  STAGE_TYPES.forEach((type, i) => {
    const due = allDue || i < 4;
    fake.table("roamly_trip_companion_events").push({
      id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user_id: USER_ID,
      trip_id: tripId,
      booking_id: null,
      event_type: type,
      title: `${type} reminder`,
      body: `${type} body`,
      status: "scheduled",
      scheduled_for: due ? iso(now - (STAGE_TYPES.length - i) * 1800_000) : iso(now + 26 * 3600_000),
      completed_at: null,
      metadata: { generatedBy: "roamly_companion" },
      created_at: created
    });
  });
}
function rewind(tripId) {
  const nowIso = new Date().toISOString();
  for (const event of fake.table("roamly_trip_companion_events")) {
    if (event.trip_id === tripId && event.status === "scheduled") event.scheduled_for = nowIso;
  }
}
function tripEvents(tripId) {
  return fake.table("roamly_trip_companion_events").filter((event) => event.trip_id === tripId);
}
function getEvent(id) {
  return fake.table("roamly_trip_companion_events").find((event) => event.id === id);
}
function getTrip(tripId) {
  return fake.table("roamly_trips").find((trip) => trip.id === tripId);
}
function deliveryRecord(tripId) {
  return getTrip(tripId)?.metadata?.companionEmailDelivery || null;
}
function dispatcherEmailLogs(tripId) {
  return fake.table("roamly_email_logs").filter(
    (row) => row.trip_id === tripId && String(row.metadata?.type || "") === "trip_reminder"
  );
}
function emailedEvents(tripId) {
  return tripEvents(tripId).filter(
    (event) => typeof event.metadata?.emailSentAt === "string" && event.metadata.emailSentAt.length > 0
  );
}
function resetWorld() {
  fake.reset();
  seedUser();
  smtp.messages.length = 0;
}

// --- G0: state-machine helpers ---------------------------------------------
{
  const classify = pushServer.classifyCompanionEmailResult;
  const record = pushServer.companionEmailDeliveryRecord;
  const block = pushServer.companionTripEmailBlock;
  check("G0 helpers: state-machine helpers are exported",
    typeof classify === "function" && typeof record === "function" && typeof block === "function");
  if (typeof classify === "function") {
    check("G0 helpers: provider outcomes classify distinctly (accepted/rejected/ambiguous/none)",
      classify({ ok: true }) === "accepted" &&
      classify({ ok: false }) === "rejected" &&
      classify({ ok: false, ambiguous: true }) === "ambiguous" &&
      classify(null) === "none");
  }
  if (typeof record === "function") {
    const parsed = record({ companionEmailDelivery: { state: "claimed", claimId: "c1", eventId: "e1", claimedAt: iso(Date.now()), updatedAt: iso(Date.now()) } });
    check("G0 helpers: delivery record parses and garbage is rejected",
      parsed?.claimId === "c1" && record({}) === null && record({ companionEmailDelivery: { state: "bogus" } }) === null);
  }
  if (typeof block === "function") {
    const nowMs = Date.now();
    const base = { eventId: "e-new", eventCreatedAt: iso(nowMs), tripEvents: [], claimEventId: null, nowMs };
    const ambiguous = block({ ...base, delivery: { state: "ambiguous", claimId: "c", eventId: "e-old", claimedAt: iso(nowMs - 3600_000), updatedAt: iso(nowMs - 3600_000) } });
    const stale = block({ ...base, delivery: { state: "claimed", claimId: "c", eventId: "e-old", claimedAt: iso(nowMs - 3600_000), updatedAt: iso(nowMs - 3600_000) } });
    const fresh = block({ ...base, delivery: { state: "claimed", claimId: "c", eventId: "e-old", claimedAt: iso(nowMs), updatedAt: iso(nowMs) } });
    const failed = block({ ...base, delivery: { state: "provider_failed", claimId: "c", eventId: "e-old", claimedAt: iso(nowMs), updatedAt: iso(nowMs) } });
    check("G0 helpers: ambiguous claim blocks everyone (incl. via block fn) and never lapses",
      ambiguous.blocked === true && ambiguous.claimLapsed === false && ambiguous.blockReason === "ambiguous_hold");
    check("G0 helpers: stale claimed record lapses, fresh claimed record blocks, failed record lapses",
      stale.claimLapsed === true && stale.blocked === false &&
      fresh.blocked === true && fresh.blockReason === "claim_live" &&
      failed.claimLapsed === true && failed.blocked === false);
  }
}

// --- G1: claim-write infrastructure error fails CLOSED ----------------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg111111-1111-4111-8111-111111111111";
  const eventId = "eg111111-1111-4111-8111-111111111111";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  useCapture();
  fake.setFailHook(({ method, table }) => method === "PATCH" && table === "roamly_trips");

  await sendScheduledTripNotifications();
  let event = getEvent(eventId);
  check("G1 claim error: zero emails sent while the claim write fails",
    dispatcherEmailLogs(tripId).length === 0, `logs=${dispatcherEmailLogs(tripId).length}`);
  check("G1 claim error: event stays scheduled/retryable with the stable reason recorded, no stamp",
    event.status === "scheduled" &&
      event.metadata?.emailLastClaimError === "EMAIL_CLAIM_UNAVAILABLE" &&
      !event.metadata?.emailSentAt,
    JSON.stringify(event.metadata));
  check("G1 claim error: no delivery was recorded as accepted",
    deliveryRecord(tripId)?.state !== "provider_accepted");

  fake.setFailHook(null);
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = getEvent(eventId);
  const logs = dispatcherEmailLogs(tripId);
  check("G1 recovery: after the claim path recovers, the retry sends exactly once and stamps",
    logs.length === 1 && logs[0].status === "captured" && typeof event.metadata?.emailSentAt === "string");
  check("G1 recovery: one claim id ties the log row, the event and the trip delivery record together",
    logs.length === 1 &&
      typeof logs[0].idempotency_key === "string" && logs[0].idempotency_key.length > 0 &&
      logs[0].idempotency_key === event.metadata?.emailClaimId &&
      logs[0].idempotency_key === deliveryRecord(tripId)?.claimId &&
      deliveryRecord(tripId)?.state === "provider_accepted",
    `log key=${logs[0]?.idempotency_key} event=${event.metadata?.emailClaimId} record=${deliveryRecord(tripId)?.claimId}`);
}

// --- G1b: trip-state load error fails CLOSED ---------------------------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg121212-1212-4121-8121-121212121212";
  const eventId = "eg121212-1212-4121-8121-121212121212";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  useCapture();
  // loadCompanionTripEvents selects exactly id,status,created_at,metadata.
  fake.setFailHook(({ method, table, params }) =>
    method === "GET" && table === "roamly_trip_companion_events" && params.get("select") === "id,status,created_at,metadata");

  await sendScheduledTripNotifications();
  let event = getEvent(eventId);
  check("G1b load error: zero emails sent while trip email state cannot be loaded",
    dispatcherEmailLogs(tripId).length === 0 && event.status === "scheduled" &&
      event.metadata?.emailLastClaimError === "EMAIL_CLAIM_UNAVAILABLE" && !event.metadata?.emailSentAt);

  fake.setFailHook(null);
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = getEvent(eventId);
  check("G1b recovery: later run claims and sends exactly once",
    dispatcherEmailLogs(tripId).length === 1 && typeof event.metadata?.emailSentAt === "string");
}

// --- G2: concurrent race where one claim errors -> exactly one send ----------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg222222-2222-4222-8222-222222222222";
  seedTrip(tripId, now);
  seedBurst(tripId, now, { allDue: true });
  useCapture();
  let tripped = false;
  fake.setFailHook(({ method, table }) => {
    if (!tripped && method === "PATCH" && table === "roamly_trips") { tripped = true; return true; }
    return false;
  });

  await Promise.all([sendScheduledTripNotifications(), sendScheduledTripNotifications()]);
  fake.setFailHook(null);
  check("G2 race+error: exactly one email across racing dispatchers despite one claim erroring",
    dispatcherEmailLogs(tripId).length === 1, `logs=${dispatcherEmailLogs(tripId).length}`);
  check("G2 race+error: exactly one event carries emailSentAt",
    emailedEvents(tripId).length === 1, `emailed=${emailedEvents(tripId).length}`);
  const errored = tripEvents(tripId).filter((e) => e.metadata?.emailLastClaimError === "EMAIL_CLAIM_UNAVAILABLE");
  check("G2 race+error: the errored racer's event failed closed (reason recorded, itself unstamped)",
    errored.length >= 1 && errored.every((e) => !e.metadata?.emailSentAt),
    `errored=${errored.length}`);
  const stuck = tripEvents(tripId).filter((e) => e.status === "processing");
  check("G2 race+error: no event is left stuck in processing", stuck.length === 0);
  rewind(tripId);
  await sendScheduledTripNotifications();
  check("G2 race+error: a later clean run still sends nothing more",
    dispatcherEmailLogs(tripId).length === 1 && emailedEvents(tripId).length === 1);
}

// --- G3: crash-after-claim — stale claim is reclaimable, fresh is not --------
{
  resetWorld();
  const now = Date.now();
  // Trip A: claim persisted 2h ago, event stuck in processing, provider
  // never invoked (no in-flight marker, no log row). Must not wedge.
  const tripA = "tg333333-3333-4333-8333-333333333333";
  const claimerA = "eg333333-3333-4333-8333-333333333333";
  const siblingA = "eg333334-3333-4333-8333-333333333333";
  seedTrip(tripA, now, {
    companionEmailBurstClaim: claimerA,
    companionEmailDelivery: { state: "claimed", claimId: "old-claim-1", eventId: claimerA, claimedAt: iso(now - 2 * 3600_000), updatedAt: iso(now - 2 * 3600_000) }
  });
  seedEvent({ id: claimerA, tripId: tripA, now, status: "processing",
    metadata: { emailDeliveryState: "claimed", emailClaimId: "old-claim-1", emailClaimedAt: iso(now - 2 * 3600_000) } });
  seedEvent({ id: siblingA, tripId: tripA, now, type: "document_check" });
  // Trip B: identical shape but the claim is FRESH — must stay held.
  const tripB = "tg343434-3434-4343-8343-434343434343";
  const claimerB = "eg343434-3434-4343-8343-434343434343";
  const siblingB = "eg343435-3435-4343-8343-434343434343";
  seedTrip(tripB, now, {
    companionEmailBurstClaim: claimerB,
    companionEmailDelivery: { state: "claimed", claimId: "fresh-claim-1", eventId: claimerB, claimedAt: iso(now), updatedAt: iso(now) }
  });
  seedEvent({ id: claimerB, tripId: tripB, now, status: "processing",
    metadata: { emailDeliveryState: "claimed", emailClaimId: "fresh-claim-1", emailClaimedAt: iso(now) } });
  seedEvent({ id: siblingB, tripId: tripB, now, type: "document_check" });
  useCapture();

  await sendScheduledTripNotifications();
  const logsA = dispatcherEmailLogs(tripA);
  check("G3 reclaim: stale pre-provider claim does not wedge the trip — exactly one email is eventually sent",
    logsA.length === 1, `logs=${logsA.length}`);
  check("G3 reclaim: the sent email carries a NEW claim id (the stale claim was released, not adopted)",
    logsA.length === 1 && logsA[0].idempotency_key !== "old-claim-1" && deliveryRecord(tripA)?.claimId === logsA[0].idempotency_key);
  check("G3 reclaim: exactly one stamped event on trip A and nothing left in processing",
    emailedEvents(tripA).length === 1 && tripEvents(tripA).every((e) => e.status !== "processing"));
  check("G3 fresh claim: a fresh claim is NOT reclaimed — no send, claim and claimer untouched",
    dispatcherEmailLogs(tripB).length === 0 &&
      deliveryRecord(tripB)?.claimId === "fresh-claim-1" && deliveryRecord(tripB)?.state === "claimed" &&
      getEvent(claimerB).status === "processing" &&
      !getEvent(siblingB).metadata?.emailSentAt && !getEvent(siblingB).metadata?.emailAttempts);
}

// --- G4: provider timeout/drop -> AMBIGUOUS (held, no resend, no stamp) ------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg444444-4444-4444-8444-444444444444";
  const eventId = "eg444444-4444-4444-8444-444444444444";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  useSmtp("drop");

  await sendScheduledTripNotifications();
  let event = getEvent(eventId);
  const logsAfterDrop = dispatcherEmailLogs(tripId);
  check("G4 timeout: the dropped send is persisted AMBIGUOUS (event + trip record), never stamped",
    event.metadata?.emailDeliveryState === "ambiguous" && !event.metadata?.emailSentAt &&
      deliveryRecord(tripId)?.state === "ambiguous",
    `event state=${event.metadata?.emailDeliveryState} record=${deliveryRecord(tripId)?.state}`);
  check("G4 timeout: the attempt is counted once and the log row carries the ambiguity evidence",
    event.metadata?.emailAttempts === 1 && logsAfterDrop.length === 1 &&
      logsAfterDrop[0].status === "failed" && logsAfterDrop[0].metadata?.delivery_ambiguous === true,
    JSON.stringify(logsAfterDrop.map((r) => ({ s: r.status, amb: r.metadata?.delivery_ambiguous }))));

  // Provider would now accept — an ambiguous claim must STILL not resend.
  useCapture();
  rewind(tripId);
  await sendScheduledTripNotifications();
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = getEvent(eventId);
  check("G4 held: ambiguous slot stays held across later runs — no resend, no stamp, state visibly ambiguous",
    dispatcherEmailLogs(tripId).length === 1 && !event.metadata?.emailSentAt &&
      event.metadata?.emailDeliveryState === "ambiguous" && deliveryRecord(tripId)?.state === "ambiguous" &&
      event.metadata?.emailAttempts === 1);
}

// --- G5 (= B(f)): provider accepted, terminal write lost -> reconcile once --
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg555555-5555-4555-8555-555555555555";
  const mainId = "eg555555-5555-4555-8555-555555555555";
  const sibDue = "eg555556-5556-4555-8555-555555555555";
  const sibFuture = "eg555557-5557-4555-8555-555555555555";
  seedTrip(tripId, now);
  seedEvent({ id: mainId, tripId, now, dueMs: now - 7200_000 });
  seedEvent({ id: sibDue, tripId, now, dueMs: now - 1800_000, type: "document_check" });
  seedEvent({ id: sibFuture, tripId, now, dueMs: now + 26 * 3600_000, type: "packing_check" });
  useCapture();
  let tripped = false;
  fake.setFailHook(({ method, table, body }) => {
    if (!tripped && method === "PATCH" && table === "roamly_trip_companion_events" &&
        typeof body?.metadata?.emailSentAt === "string") { tripped = true; return true; }
    return false;
  });

  await sendScheduledTripNotifications();
  fake.setFailHook(null);
  let main = getEvent(mainId);
  check("G5 crash setup: provider accepted (one log row) but the stamp write was lost — event unstamped, in flight",
    dispatcherEmailLogs(tripId).length === 1 && !main.metadata?.emailSentAt &&
      main.status === "processing" && main.metadata?.emailDeliveryState === "in_flight",
    `status=${main.status} state=${main.metadata?.emailDeliveryState}`);

  rewind(tripId);
  await sendScheduledTripNotifications();
  main = getEvent(mainId);
  const stamp = main.metadata?.emailSentAt;
  check("B(f) recovery: reconciliation completes the stamp exactly once from the claim's log evidence",
    typeof stamp === "string" && main.metadata?.emailDeliveryState === "provider_accepted" &&
      main.metadata?.emailAttempts === 1 && deliveryRecord(tripId)?.state === "provider_accepted");
  check("B(f) recovery: siblings collapsed (incl. the not-yet-due one), exactly one emailed event, no second email",
    getEvent(sibDue).metadata?.emailCollapsed === true && getEvent(sibFuture).metadata?.emailCollapsed === true &&
      emailedEvents(tripId).length === 1 && dispatcherEmailLogs(tripId).length === 1);

  rewind(tripId);
  await sendScheduledTripNotifications();
  main = getEvent(mainId);
  check("B(f) recovery: state stays consistent — stamp value unchanged, still one email after another run",
    main.metadata?.emailSentAt === stamp && dispatcherEmailLogs(tripId).length === 1 && emailedEvents(tripId).length === 1);
}

// --- G6: explicit rejection -> provider_failed, retryable, stamps once -------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg666666-6666-4666-8666-666666666666";
  const eventId = "eg666666-6666-4666-8666-666666666666";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  useSmtp("reject");

  await sendScheduledTripNotifications();
  let event = getEvent(eventId);
  const failLog = dispatcherEmailLogs(tripId)[0];
  check("G6 rejection: explicit 550 is persisted provider_failed (distinct from ambiguous), no stamp, retryable",
    event.metadata?.emailDeliveryState === "provider_failed" && deliveryRecord(tripId)?.state === "provider_failed" &&
      !event.metadata?.emailSentAt && event.status === "scheduled" && event.metadata?.emailAttempts === 1 &&
      failLog?.status === "failed" && failLog?.metadata?.delivery_ambiguous !== true,
    `state=${event.metadata?.emailDeliveryState}`);

  useCapture();
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = getEvent(eventId);
  const logs = dispatcherEmailLogs(tripId);
  check("G6 recovery: the retry sends under a fresh claim id and stamps exactly once",
    logs.length === 2 && logs[1].status === "captured" && logs[1].idempotency_key !== logs[0].idempotency_key &&
      typeof event.metadata?.emailSentAt === "string" && event.metadata?.emailAttempts === 2 &&
      deliveryRecord(tripId)?.state === "provider_accepted");
}

// --- G7: the claim id is carried in the email itself (SMTP header) ------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tg777777-7777-4777-8777-777777777777";
  const eventId = "eg777777-7777-4777-8777-777777777777";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  useSmtp("accept");

  await sendScheduledTripNotifications();
  const event = getEvent(eventId);
  const logs = dispatcherEmailLogs(tripId);
  const claimId = deliveryRecord(tripId)?.claimId;
  check("G7 claim key: SMTP delivery logs as sent with the claim id as its idempotency key",
    logs.length === 1 && logs[0].status === "sent" && logs[0].idempotency_key === claimId &&
      event.metadata?.emailClaimId === claimId && typeof event.metadata?.emailSentAt === "string");
  check("G7 claim key: the delivered message itself carries the claim id header",
    smtp.messages.length === 1 && typeof claimId === "string" &&
      smtp.messages[0].includes(`X-Roamly-Idempotency-Key: ${claimId}`),
    smtp.messages.length ? "message captured" : "no message captured");
}

// --- B(a): a genuinely NEW generation notifies again — exactly once ----------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tb888888-8888-4888-8888-888888888888";
  seedTrip(tripId, now);
  seedBurst(tripId, now, { allDue: true });
  useCapture();

  await sendScheduledTripNotifications();
  const firstClaim = deliveryRecord(tripId)?.claimId;
  check("B(a) setup: burst delivered exactly one email", dispatcherEmailLogs(tripId).length === 1);

  const newId = "eb888888-8888-4888-8888-888888888888";
  seedEvent({ id: newId, tripId, now: Date.now(), createdMs: Date.now(), type: "booking_reminder" });
  await sendScheduledTripNotifications();
  check("B(a) new generation: an event created after the delivery emails exactly once, under its own claim",
    dispatcherEmailLogs(tripId).length === 2 && typeof getEvent(newId).metadata?.emailSentAt === "string" &&
      deliveryRecord(tripId)?.eventId === newId && deliveryRecord(tripId)?.claimId !== firstClaim &&
      emailedEvents(tripId).length === 2);
  rewind(tripId);
  await sendScheduledTripNotifications();
  check("B(a) new generation: the new alert is not re-emailed on later runs",
    dispatcherEmailLogs(tripId).length === 2 && emailedEvents(tripId).length === 2);
}

// --- B(b): collapsed siblings can NEVER email later ---------------------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tb999999-9999-4999-8999-999999999999";
  seedTrip(tripId, now);
  seedBurst(tripId, now); // 4 due now, 3 due later
  useCapture();

  await sendScheduledTripNotifications();
  const futureSibling = tripEvents(tripId).find((e) => e.event_type === "travel_day_started");
  check("B(b) pre-due collapse: a sibling that was NOT due during the send is already emailCollapsed",
    futureSibling.metadata?.emailCollapsed === true, `collapsed=${futureSibling.metadata?.emailCollapsed}`);
  for (let run = 0; run < 3; run += 1) {
    rewind(tripId);
    await sendScheduledTripNotifications();
  }
  const after = tripEvents(tripId).find((e) => e.event_type === "travel_day_started");
  check("B(b) late-due + reschedule paths: the collapsed sibling never emails and keeps its marker across push retries",
    dispatcherEmailLogs(tripId).length === 1 && !after.metadata?.emailSentAt &&
      (after.metadata?.emailAttempts || 0) === 0 && after.metadata?.emailCollapsed === true,
    `attempts=${after.metadata?.emailAttempts} collapsed=${after.metadata?.emailCollapsed}`);
  check("B(b) all siblings: no non-emailed event ever attempted an email",
    tripEvents(tripId).every((e) => emailedEvents(tripId).includes(e) || (e.metadata?.emailAttempts || 0) === 0));
}

// --- B(c): late-arriving events — old generation stays collapsed --------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "tc101010-1010-4101-8101-010101010101";
  const firstId = "ec101010-1010-4101-8101-010101010101";
  seedTrip(tripId, now);
  seedEvent({ id: firstId, tripId, now });
  useCapture();

  await sendScheduledTripNotifications();
  const stampMs = Date.parse(getEvent(firstId).metadata?.emailSentAt);
  check("B(c) setup: first generation delivered", Number.isFinite(stampMs) && dispatcherEmailLogs(tripId).length === 1);

  // Inserted AFTER the send, but its created_at predates the delivery:
  // by the boundary the code enforces (created_at vs emailSentAt) it
  // belongs to the OLD generation.
  const lateOldId = "ec101011-1011-4101-8101-010101010101";
  seedEvent({ id: lateOldId, tripId, now: Date.now(), createdMs: stampMs - 3600_000, type: "packing_check" });
  await sendScheduledTripNotifications();
  check("B(c) late old-generation: created after the send but belonging to the old generation — never emails",
    dispatcherEmailLogs(tripId).length === 1 && !getEvent(lateOldId).metadata?.emailSentAt &&
      getEvent(lateOldId).metadata?.emailCollapsed === true,
    `collapsed=${getEvent(lateOldId).metadata?.emailCollapsed}`);

  const lateNewId = "ec101012-1012-4101-8101-010101010101";
  seedEvent({ id: lateNewId, tripId, now: Date.now(), createdMs: Date.now(), type: "booking_reminder" });
  await sendScheduledTripNotifications();
  check("B(c) late new-generation: created after the delivery instant — notifies exactly once",
    dispatcherEmailLogs(tripId).length === 2 && typeof getEvent(lateNewId).metadata?.emailSentAt === "string");
}

// --- B(d): stale claims vs generations -----------------------------------------
{
  resetWorld();
  const now = Date.now();
  useCapture();
  // d1: an undelivered STALE claim must not block a new-generation event.
  const tripD1 = "td111111-1111-4111-8111-111111111111";
  const ghostId = "ed111111-1111-4111-8111-111111111111";
  seedTrip(tripD1, now, {
    companionEmailBurstClaim: ghostId,
    companionEmailDelivery: { state: "claimed", claimId: "stale-claim-d1", eventId: ghostId, claimedAt: iso(now - 2 * 3600_000), updatedAt: iso(now - 2 * 3600_000) }
  });
  seedEvent({ id: ghostId, tripId: tripD1, now, status: "shown" });
  const newGenId = "ed111112-1112-4111-8111-111111111111";
  seedEvent({ id: newGenId, tripId: tripD1, now: Date.now(), createdMs: Date.now(), type: "booking_reminder" });
  await sendScheduledTripNotifications();
  check("B(d) stale claim: a legitimate new-generation event is not blocked forever by an old stale claim",
    dispatcherEmailLogs(tripD1).length === 1 && typeof getEvent(newGenId).metadata?.emailSentAt === "string" &&
      deliveryRecord(tripD1)?.claimId !== "stale-claim-d1");

  // d2: a delivered generation + a lingering stale claim must not let an
  // old-generation event send.
  resetWorld();
  useCapture();
  const tripD2 = "td121212-1212-4121-8121-121212121212";
  const deliveredId = "ed121212-1212-4121-8121-121212121212";
  const stampT0 = iso(now - 3600_000);
  seedTrip(tripD2, now, {
    companionEmailBurstClaim: deliveredId,
    companionEmailDelivery: { state: "claimed", claimId: "stale-claim-d2", eventId: deliveredId, claimedAt: iso(now - 2 * 3600_000), updatedAt: iso(now - 2 * 3600_000) }
  });
  seedEvent({ id: deliveredId, tripId: tripD2, now, metadata: { emailSentAt: stampT0, emailAttempts: 1 } });
  const lateOldId = "ed121213-1213-4121-8121-121212121212";
  seedEvent({ id: lateOldId, tripId: tripD2, now, createdMs: now - 2 * 3600_000, type: "packing_check" });
  await sendScheduledTripNotifications();
  check("B(d) stale claim: the stale claim does NOT let an old-generation event send after its generation delivered",
    dispatcherEmailLogs(tripD2).length === 0 && !getEvent(lateOldId).metadata?.emailSentAt &&
      getEvent(lateOldId).metadata?.emailCollapsed === true,
    `logs=${dispatcherEmailLogs(tripD2).length} collapsed=${getEvent(lateOldId).metadata?.emailCollapsed}`);
}

// --- B(e): push-accepted path — cap exemption in the dispatcher flow -----------
{
  resetWorld();
  const now = Date.now();
  const tripId = "te131313-1313-4131-8131-131313131313";
  const eventId = "ee131313-1313-4131-8131-131313131313";
  seedTrip(tripId, now);
  // The event delivers its email on the run that takes its push attempts
  // TO the cap; from then on the cap exemption (the emailed event is
  // never retired by SCHEDULED_PUSH_MAX_ATTEMPTS) must keep it scheduled
  // and retrying push, with the email stamp persisted.
  seedEvent({ id: eventId, tripId, now, metadata: { pushAttempts: pushServer.SCHEDULED_PUSH_MAX_ATTEMPTS - 1 } });
  useCapture();

  await sendScheduledTripNotifications();
  let event = getEvent(eventId);
  check("B(e) cap exemption: the delivering run stamps the event and reschedules it at the cap (not retired)",
    dispatcherEmailLogs(tripId).length === 1 && typeof event.metadata?.emailSentAt === "string" &&
      event.status === "scheduled" && event.metadata?.pushAttempts === pushServer.SCHEDULED_PUSH_MAX_ATTEMPTS,
    `status=${event.status} pushAttempts=${event.metadata?.pushAttempts}`);
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = getEvent(eventId);
  check("B(e) cap exemption: past the cap, the emailed event keeps retrying push — still scheduled, pushAttempts grows, email never re-attempted",
    event.status === "scheduled" && event.metadata?.pushAttempts === pushServer.SCHEDULED_PUSH_MAX_ATTEMPTS + 1 &&
      event.metadata?.emailAttempts === 1 && dispatcherEmailLogs(tripId).length === 1,
    `status=${event.status} pushAttempts=${event.metadata?.pushAttempts}`);
  if (pushEndpoint?.normalizePushEndpoint) {
    check("B(e) seam check: harness push endpoints are rejected by normalizePushEndpoint (no test seam exists)",
      pushEndpoint.normalizePushEndpoint("https://127.0.0.1:8443/push") === null &&
        pushEndpoint.normalizePushEndpoint("http://fcm.googleapis.com/fcm/send/x") === null);
    note("B(e) the live web-push-ACCEPTED terminal write (status=shown carrying the shared email patch) cannot be exercised in this harness: normalizePushEndpoint only allows real browser push hosts (fcm.googleapis.com / web.push.apple.com / Mozilla/Windows push), there is no test seam in the shipped code, and sending to a real push host from the harness would be a real external call. The shown path is covered by the shared companionEventEmailMetadataPatch helper checks (burst suite S6) and by the dispatcher-flow cap-exemption checks above; the residual gap is recorded in the results doc.");
  } else {
    note("B(e) pushEndpoint module unavailable in this tree; seam check skipped.");
  }
}

await fake.close();
await smtp.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\ncompanion email safeguards checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`failing: ${failed.map((entry) => entry.name).join(" | ")}`);
  process.exit(1);
}
console.log("companion email safeguards checks passed");
assert.ok(true);
