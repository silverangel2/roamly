// Deterministic web-push-ACCEPTED checks for the REAL companion dispatcher
// (lib/roamly/pushServer.ts sendScheduledTripNotifications) against an
// in-process PostgREST fake, closing the one path the burst (29/29) and
// safeguards (46/46) rounds could not exercise ("case (e) PARTIAL"): the
// literal push-ACCEPTED terminal write (status=shown carrying the shared
// companionEventEmailMetadataPatch).
//
// The blocker was endpoint validation: normalizePushEndpoint
// (lib/roamly/pushEndpoint.ts, imported by pushServer.ts) admits only real
// browser push hosts, so no harness subscription could ever be accepted
// without contacting a real external push service. The shipped fix is a
// test-only seam in that validator:
//
//   ROAMLY_PUSH_TEST_SEAM=1  (exact value "1"; OFF by default)
//
// When ON, validation ADDITIONALLY admits loopback endpoints only
// (localhost / 127.0.0.1 / ::1, http or https, explicit port allowed).
// When OFF, behaviour is the old allowlist exactly.
//
// Layer honesty — what is real vs simulated in this suite:
//   REAL: the shipped dispatcher, the shipped endpoint validator (seam
//     included), the shipped web-push library performing real VAPID
//     signing and real payload encryption, and a real HTTPS POST over a
//     real TLS socket to the fake push endpoint (the web-push library
//     always dials https.request, so the fake is an https server; its
//     certificate is signed by a throwaway test CA injected via
//     NODE_EXTRA_CA_CERTS, the safeguards suite's pattern).
//   SIMULATED: the push SERVICE itself (a local https server on
//     127.0.0.1 that records requests and answers 201 / 500), Supabase
//     (the in-process PostgREST fake from the prior rounds), and the
//     email provider (the shipped capture provider, as in prior rounds).
//   No external host is ever contacted: the only endpoints seeded for
//   dispatcher runs point at the local fake, and real-host strings appear
//   ONLY in pure normalizePushEndpoint unit checks (no network I/O).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID, generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Throwaway test CA + server cert for the local fake push endpoint
// (web-push dials TLS; Node only reads NODE_EXTRA_CA_CERTS at start, so
// re-exec once with it set — same pattern as the safeguards suite).
if (!process.env.ROAMLY_PUSH_ACCEPTED_CA) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamly-push-ca-"));
  const run = (args) => execFileSync("openssl", args, { stdio: "pipe" });
  run(["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(dir, "ca-key.pem"), "-out", path.join(dir, "ca.pem"), "-days", "3650", "-nodes", "-subj", "/CN=Roamly Push Test CA"]);
  run(["req", "-newkey", "rsa:2048", "-keyout", path.join(dir, "server-key.pem"), "-out", path.join(dir, "server.csr"), "-nodes", "-subj", "/CN=localhost"]);
  fs.writeFileSync(path.join(dir, "san.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\n");
  run(["x509", "-req", "-in", path.join(dir, "server.csr"), "-CA", path.join(dir, "ca.pem"), "-CAkey", path.join(dir, "ca-key.pem"), "-CAcreateserial", "-out", path.join(dir, "server-cert.pem"), "-days", "3650", "-extfile", path.join(dir, "san.cnf")]);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, "ca.pem"), ROAMLY_PUSH_ACCEPTED_CA: dir }
  });
  process.exit(child.status ?? 1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROAMLY_TEST_ROOT ? path.resolve(process.env.ROAMLY_TEST_ROOT) : path.resolve(here, "..");

// ---------------------------------------------------------------------------
// In-process PostgREST fake (burst-suite pattern, copied verbatim in shape).
// ---------------------------------------------------------------------------
function createFakeSupabase() {
  const state = {
    users: new Map(),
    tables: new Map()
  };
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
      if (op === "in") {
        // PostgREST list filter: key=in.(a,b,c) — used by the shipped
        // code to disable invalid/expired subscriptions. (Extension to
        // the prior rounds' fake, which lacked this operator.)
        const list = value.replace(/^\(|\)$/g, "").split(",").map((item) => item.trim().replace(/^"|"$/g, ""));
        if (!list.includes(String(actual))) return false;
      }
      if (!["eq", "neq", "is", "lt", "lte", "gt", "gte", "in"].includes(op)) {
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
      const rows = table(decodeURIComponent(rest[1]));
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
    reset() {
      state.users.clear();
      state.tables.clear();
    },
    listen() {
      return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

// ---------------------------------------------------------------------------
// Local fake push service: a real HTTPS server on 127.0.0.1. Mode "accept"
// answers 201 (a push service acceptance); mode "fail" answers 500.
// Every request is recorded so the suite can prove all push traffic went
// to this fake and nowhere else.
// ---------------------------------------------------------------------------
function createFakePushService() {
  const caDir = process.env.ROAMLY_PUSH_ACCEPTED_CA;
  const service = { mode: "accept", hits: [], server: null, port: 0 };
  service.server = https.createServer(
    { key: fs.readFileSync(path.join(caDir, "server-key.pem")), cert: fs.readFileSync(path.join(caDir, "server-cert.pem")) },
    (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        service.hits.push({
          method: req.method,
          url: req.url,
          host: req.headers.host || "",
          authorization: req.headers.authorization || "",
          contentEncoding: req.headers["content-encoding"] || "",
          bodyLength: Buffer.concat(chunks).length
        });
        res.writeHead(service.mode === "accept" ? 201 : 500);
        res.end();
      });
    }
  );
  service.listen = () => new Promise((resolve) => service.server.listen(0, "127.0.0.1", () => { service.port = service.server.address().port; resolve(service.port); }));
  service.close = () => new Promise((resolve) => service.server.close(resolve));
  service.endpoint = (token) => `https://127.0.0.1:${service.port}/push/${token}`;
  return service;
}

// ---------------------------------------------------------------------------
// Key material: a real VAPID keypair for the shipped configureWebPush, and
// a real recipient (subscription) keypair so web-push payload encryption
// runs for real.
// ---------------------------------------------------------------------------
function ecJwk(keyObject) {
  return keyObject.export({ format: "jwk" });
}
function uncompressedPointBase64url(jwk) {
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url")
  ]).toString("base64url");
}
const vapidKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const VAPID_PUBLIC = uncompressedPointBase64url(ecJwk(vapidKeys.publicKey));
const VAPID_PRIVATE = Buffer.from(ecJwk(vapidKeys.privateKey).d, "base64url").toString("base64url");
function newSubscriptionKeys() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    p256dh: uncompressedPointBase64url(ecJwk(pair.publicKey)),
    auth: randomBytes(16).toString("base64url")
  };
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
const pushService = createFakePushService();
await pushService.listen();

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID_PUBLIC;
process.env.VAPID_PRIVATE_KEY = VAPID_PRIVATE;
delete process.env.VAPID_SUBJECT;
process.env.ROAMLY_EMAIL_PROVIDER = "smtp";
process.env.ROAMLY_SMTP_HOST = "127.0.0.1";
process.env.ROAMLY_SMTP_PORT = "1";
process.env.ROAMLY_SMTP_USER = "sender@roamlyhq.com";
process.env.ROAMLY_SMTP_PASSWORD = "stub-password";
process.env.ROAMLY_SMTP_SECURE = "false";
process.env.ROAMLY_FROM_EMAIL = "support@roamlyhq.com";
process.env.ROAMLY_EMAIL_CAPTURE_ENABLED = "true"; // email provider accepts
delete process.env.ROAMLY_DAILY_TEST_EMAIL;

function seamOn() { process.env.ROAMLY_PUSH_TEST_SEAM = "1"; }
function seamOff() { delete process.env.ROAMLY_PUSH_TEST_SEAM; }
seamOff();

const pushServer = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);
const { sendScheduledTripNotifications } = pushServer;
const pushEndpoint = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushEndpoint.ts")).href);
const { normalizePushEndpoint } = pushEndpoint;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_EMAIL = "traveler@roamlyhq.com";
const iso = (ms) => new Date(ms).toISOString();
const dateOnly = (ms) => iso(ms).slice(0, 10);

function seedUser() {
  fake.state.users.set(USER_ID, { id: USER_ID, email: USER_EMAIL, created_at: iso(Date.now() - 86400_000) });
}
function seedTrip(tripId, now) {
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
    metadata: {},
    destination: "Banff",
    destination_name: "Banff",
    destination_city: "Banff",
    created_at: iso(now - 86400_000)
  });
}
function seedEvent({ id, tripId, now, metadata = {}, type = "one_week_before" }) {
  fake.table("roamly_trip_companion_events").push({
    id,
    user_id: USER_ID,
    trip_id: tripId,
    booking_id: null,
    event_type: type,
    title: `${type} reminder`,
    body: `${type} body`,
    status: "scheduled",
    scheduled_for: iso(now - 3600_000),
    completed_at: null,
    metadata: { generatedBy: "roamly_companion", ...metadata },
    created_at: iso(now - 86400_000)
  });
}
function seedSubscription(id, endpoint) {
  const keys = newSubscriptionKeys();
  fake.table("roamly_push_subscriptions").push({
    id,
    user_id: USER_ID,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    enabled: true,
    created_at: iso(Date.now() - 86400_000)
  });
}
function getEvent(id) {
  return fake.table("roamly_trip_companion_events").find((event) => event.id === id);
}
function getSubscription(id) {
  return fake.table("roamly_push_subscriptions").find((sub) => sub.id === id);
}
function notificationsFor(eventId) {
  return fake.table("roamly_notifications").filter((row) => row.event_id === eventId);
}
function dispatcherEmailLogs(tripId) {
  return fake.table("roamly_email_logs").filter(
    (row) => row.trip_id === tripId && String(row.metadata?.type || "") === "trip_reminder"
  );
}
function emailKeysOf(metadata) {
  return Object.keys(metadata || {}).filter((key) => key.startsWith("email")).sort();
}
function resetWorld() {
  fake.reset();
  seedUser();
  pushService.hits.length = 0;
  pushService.mode = "accept";
}

// --- P0: endpoint validation matrix (pure function, no network I/O) --------
{
  const REAL_HOSTS = [
    "https://fcm.googleapis.com/fcm/send/example-token",
    "https://updates.push.services.mozilla.com/wpush/v2/example-token",
    "https://web.push.apple.com/Qabc123",
    "https://wns2-notify.notify.windows.com/w/?token=example"
  ];
  const LOCAL_HTTPS = `https://127.0.0.1:${pushService.port}/push/token-a`;

  seamOff();
  check("P0 seam OFF: real allowlisted hosts are admitted exactly as before",
    REAL_HOSTS.every((endpoint) => normalizePushEndpoint(endpoint) === endpoint));
  check("P0 seam OFF: loopback endpoints are rejected exactly as before",
    normalizePushEndpoint(LOCAL_HTTPS) === null &&
      normalizePushEndpoint("https://localhost:8443/push") === null &&
      normalizePushEndpoint("https://[::1]:8443/push") === null &&
      normalizePushEndpoint("http://127.0.0.1:3000/push") === null);
  check("P0 seam OFF: junk / spoofed / malformed endpoints are rejected",
    normalizePushEndpoint("https://attacker.example/push") === null &&
      normalizePushEndpoint("https://fcm.googleapis.com.attacker.example/push") === null &&
      normalizePushEndpoint("http://fcm.googleapis.com/fcm/send/x") === null &&
      normalizePushEndpoint("https://fcm.googleapis.com:8443/push") === null &&
      normalizePushEndpoint("https://user:pass@fcm.googleapis.com/push") === null &&
      normalizePushEndpoint("https://192.168.1.10/push") === null);

  seamOn();
  check("P0 seam ON: loopback endpoints (127.0.0.1 / localhost / ::1, https and http, explicit port) are admitted",
    normalizePushEndpoint(LOCAL_HTTPS) === LOCAL_HTTPS &&
      normalizePushEndpoint(`https://localhost:${pushService.port}/push/token-a`) === `https://localhost:${pushService.port}/push/token-a` &&
      normalizePushEndpoint(`https://[::1]:${pushService.port}/push/token-a`) === `https://[::1]:${pushService.port}/push/token-a` &&
      normalizePushEndpoint("http://127.0.0.1:3000/push") === "http://127.0.0.1:3000/push");
  check("P0 seam ON: real allowlisted hosts are still admitted, with their rules unchanged (port / http still rejected)",
    REAL_HOSTS.every((endpoint) => normalizePushEndpoint(endpoint) === endpoint) &&
      normalizePushEndpoint("https://fcm.googleapis.com:8443/push") === null &&
      normalizePushEndpoint("http://fcm.googleapis.com/fcm/send/x") === null);
  check("P0 seam ON: no non-local host is widened in — external, LAN, lookalike and credentialed endpoints stay rejected",
    normalizePushEndpoint("https://attacker.example/push") === null &&
      normalizePushEndpoint("https://localhost.attacker.example/push") === null &&
      normalizePushEndpoint("https://127.0.0.1.attacker.example/push") === null &&
      normalizePushEndpoint("https://192.168.1.10/push") === null &&
      normalizePushEndpoint("https://0.0.0.0/push") === null &&
      normalizePushEndpoint(`https://user:pass@127.0.0.1:${pushService.port}/push`) === null &&
      normalizePushEndpoint(`https://127.0.0.1:${pushService.port}/push#fragment`) === null);

  // The gate is a single explicit exact value: anything else stays OFF.
  for (const value of ["true", "yes", "enabled", "0", "", " 1x"]) {
    process.env.ROAMLY_PUSH_TEST_SEAM = value;
    check(`P0 seam gate: ROAMLY_PUSH_TEST_SEAM=${JSON.stringify(value)} does NOT enable the seam`,
      normalizePushEndpoint(LOCAL_HTTPS) === null);
  }
  seamOff();
  check("P0 seam helper: the shipped seam predicate is exported and reports OFF by default",
    typeof pushEndpoint.isRoamlyPushTestSeamEnabled === "function" && pushEndpoint.isRoamlyPushTestSeamEnabled() === false);
}

// --- P1: push ACCEPTED — the literal terminal write (the case (e) gap) -----
let acceptedEmailKeys = null;
let acceptedEventSnapshot = null;
{
  resetWorld();
  seamOn();
  const now = Date.now();
  const tripId = "tp111111-1111-4111-8111-111111111111";
  const eventId = "ep111111-1111-4111-8111-111111111111";
  const subId = "sp111111-1111-4111-8111-111111111111";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  seedSubscription(subId, pushService.endpoint("token-p1"));

  const result = await sendScheduledTripNotifications();
  const event = getEvent(eventId);
  const hits = [...pushService.hits];
  check("P1 accepted: dispatcher reports the push as sent",
    result.ok === true && result.sent === 1 && result.processed === 1,
    JSON.stringify(result));
  check("P1 accepted: ALL push traffic went to the local fake — exactly one POST, VAPID-signed, encrypted payload, local host only",
    hits.length === 1 &&
      hits[0].method === "POST" &&
      hits[0].url === "/push/token-p1" &&
      hits[0].host === `127.0.0.1:${pushService.port}` &&
      hits[0].authorization.startsWith("vapid t=") &&
      hits[0].contentEncoding === "aes128gcm" &&
      hits[0].bodyLength > 0,
    JSON.stringify(hits));
  check("P1 accepted: terminal write is status=shown with completed_at set",
    event.status === "shown" && typeof event.completed_at === "string" && event.completed_at.length > 0,
    `status=${event.status}`);
  check("P1 accepted: the shown write persists the shared email patch (emailSentAt + emailAttempts=1 + provider_accepted + claim id)",
    typeof event.metadata?.emailSentAt === "string" && event.metadata.emailSentAt.length > 0 &&
      event.metadata?.emailAttempts === 1 &&
      event.metadata?.emailDeliveryState === "provider_accepted" &&
      typeof event.metadata?.emailClaimId === "string" && event.metadata.emailClaimId.length > 0 &&
      event.metadata?.emailAttemptCountedClaimId === event.metadata?.emailClaimId,
    JSON.stringify(event.metadata));
  check("P1 accepted: exactly one email was delivered for the event and the in-app row records push_status=sent",
    dispatcherEmailLogs(tripId).length === 1 &&
      notificationsFor(eventId).length === 1 &&
      notificationsFor(eventId)[0].push_status === "sent" &&
      typeof notificationsFor(eventId)[0].sent_at === "string",
    `push_status=${notificationsFor(eventId)[0]?.push_status}`);
  check("P1 accepted: the local subscription was NOT disabled as invalid",
    getSubscription(subId).enabled === true);
  acceptedEmailKeys = emailKeysOf(event.metadata);
  acceptedEventSnapshot = { ...event.metadata };

  // Later runs: the event is terminal — nothing is resent, ever.
  await sendScheduledTripNotifications();
  check("P1 accepted: a later dispatcher run resends nothing (no second push, no second email, stamp unchanged)",
    pushService.hits.length === 1 &&
      dispatcherEmailLogs(tripId).length === 1 &&
      getEvent(eventId).metadata?.emailSentAt === acceptedEventSnapshot.emailSentAt &&
      getEvent(eventId).status === "shown");
}

// --- P2: push FAILED — same persisted email family on the reschedule path --
{
  resetWorld();
  seamOn();
  pushService.mode = "fail";
  const now = Date.now();
  const tripId = "tp222222-2222-4222-8222-222222222222";
  const eventId = "ep222222-2222-4222-8222-222222222222";
  const subId = "sp222222-2222-4222-8222-222222222222";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  seedSubscription(subId, pushService.endpoint("token-p2"));

  const result = await sendScheduledTripNotifications();
  const event = getEvent(eventId);
  check("P2 failed: dispatcher reports no push sent and the fake still received exactly one (local) attempt",
    result.ok === true && result.sent === 0 && pushService.hits.length === 1 &&
      pushService.hits[0].host === `127.0.0.1:${pushService.port}`,
    JSON.stringify(result));
  check("P2 failed: terminal write is the reschedule path (status=scheduled, pushAttempts=1)",
    event.status === "scheduled" && event.metadata?.pushAttempts === 1,
    `status=${event.status} pushAttempts=${event.metadata?.pushAttempts}`);
  check("P2 failed: the reschedule write persists the same email patch family (emailSentAt + attempts=1 + provider_accepted + claim id)",
    typeof event.metadata?.emailSentAt === "string" &&
      event.metadata?.emailAttempts === 1 &&
      event.metadata?.emailDeliveryState === "provider_accepted" &&
      typeof event.metadata?.emailClaimId === "string" &&
      event.metadata?.emailAttemptCountedClaimId === event.metadata?.emailClaimId);
  check("P2 parity: push-ACCEPTED and push-FAILED terminal writes carry the identical email metadata key set",
    acceptedEmailKeys !== null &&
      JSON.stringify(emailKeysOf(event.metadata)) === JSON.stringify(acceptedEmailKeys),
    `accepted=[${acceptedEmailKeys}] failed=[${emailKeysOf(event.metadata)}]`);
  check("P2 failed: the in-app row records push_status=failed",
    notificationsFor(eventId).length === 1 && notificationsFor(eventId)[0].push_status === "failed",
    `push_status=${notificationsFor(eventId)[0]?.push_status}`);
}

// --- P3: push-retry cap exemption on the push-ACCEPTED path -----------------
{
  resetWorld();
  seamOn();
  const now = Date.now();
  const tripId = "tp333333-3333-4333-8333-333333333333";
  const eventId = "ep333333-3333-4333-8333-333333333333";
  const subId = "sp333333-3333-4333-8333-333333333333";
  const priorStamp = iso(now - 3600_000);
  seedTrip(tripId, now);
  // The event already delivered the trip's email and is well past the
  // push-retry cap. Without the Defect-5 exemption the dispatcher would
  // retire it to shown WITHOUT sending push; with it, push is attempted.
  seedEvent({
    id: eventId,
    tripId,
    now,
    metadata: {
      pushAttempts: pushServer.SCHEDULED_PUSH_MAX_ATTEMPTS + 2,
      emailSentAt: priorStamp,
      emailAttempts: 1,
      emailDeliveryState: "provider_accepted"
    }
  });
  seedSubscription(subId, pushService.endpoint("token-p3"));

  await sendScheduledTripNotifications();
  const event = getEvent(eventId);
  check("P3 cap exemption: past the push cap, the emailed event is NOT retired silently — push is actually sent to the local fake",
    pushService.hits.length === 1 && pushService.hits[0].url === "/push/token-p3",
    `hits=${pushService.hits.length}`);
  check("P3 cap exemption: the accepted push lands the event shown, its email stamp/attempts are untouched, and no second email is sent",
    event.status === "shown" &&
      event.metadata?.emailSentAt === priorStamp &&
      event.metadata?.emailAttempts === 1 &&
      event.metadata?.pushAttempts === pushServer.SCHEDULED_PUSH_MAX_ATTEMPTS + 2 &&
      dispatcherEmailLogs(tripId).length === 0,
    `status=${event.status} logs=${dispatcherEmailLogs(tripId).length}`);
}

// --- P4: seam OFF — the same localhost endpoint is rejected (safety proof) --
{
  resetWorld();
  seamOff();
  const now = Date.now();
  const tripId = "tp444444-4444-4444-8444-444444444444";
  const eventId = "ep444444-4444-4444-8444-444444444444";
  const subId = "sp444444-4444-4444-8444-444444444444";
  seedTrip(tripId, now);
  seedEvent({ id: eventId, tripId, now });
  seedSubscription(subId, pushService.endpoint("token-p4"));

  const result = await sendScheduledTripNotifications();
  const event = getEvent(eventId);
  check("P4 seam OFF: the local fake receives NOTHING — the localhost endpoint never passes validation",
    pushService.hits.length === 0, `hits=${pushService.hits.length}`);
  check("P4 seam OFF: the unsupported subscription is dropped (disabled), exactly as before the seam existed",
    getSubscription(subId).enabled === false);
  check("P4 seam OFF: terminal behaviour is the before-state — no shown write; the event reschedules as a push failure (pushAttempts=1) while its delivered email stamp persists",
    result.sent === 0 &&
      event.status === "scheduled" &&
      event.metadata?.pushAttempts === 1 &&
      typeof event.metadata?.emailSentAt === "string" &&
      notificationsFor(eventId)[0]?.push_status === "no_subscription",
    `status=${event.status} push_status=${notificationsFor(eventId)[0]?.push_status}`);
}

seamOff();
await fake.close();
await pushService.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\ncompanion push-accepted checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`failing: ${failed.map((entry) => entry.name).join(" | ")}`);
  process.exit(1);
}
console.log("companion push-accepted checks passed");
assert.ok(true);
