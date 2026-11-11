import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { secretMatchesAny, secretValuesEqual } from "../lib/roamly/secretCompare.ts";
import { cronTokenMatchesAnySecret, isCronRequestAuthorized } from "../lib/roamly/cronAuth.ts";
import {
  adminAccessActorHash,
  clearAdminAccessFailures,
  getAdminAccessLockout,
  recordAdminAccessFailure
} from "../lib/roamly/adminAccessRateLimit.ts";

/*
 * Stage 5 (2026-11-11) hardening pins:
 *  - the shared constant-time compare behaves and every former
 *    plain-equality secret door now routes through it;
 *  - the admin door's shared-store limiter client honours its
 *    degradation contract (values, never throws; junk in -> {ok:false});
 *  - the CSP ships as report-only (full policy) + an enforce header
 *    carrying exactly the four proven directives;
 *  - the prepared migration carries the F-3 revoke, exactly 100 F-6
 *    anon revokes, and the F-5 unique index — and grants anon nothing.
 */

// ---------- secretCompare behaviour ----------
assert.equal(secretValuesEqual("s3cret-value", "s3cret-value"), true, "identical secrets match");
assert.equal(secretValuesEqual("s3cret-value", "s3cret-valuf"), false, "a one-byte difference fails");
assert.equal(secretValuesEqual("short", "short-but-longer"), false, "a length difference fails");
assert.equal(secretValuesEqual("anything", ""), false, "an empty expected secret never matches (fail closed)");
assert.equal(secretValuesEqual("", "configured"), false, "an empty provided value never matches");
assert.equal(secretMatchesAny("second", ["first", "second"]), true, "the list form matches any entry");
assert.equal(secretMatchesAny("second", ["first", ""]), false, "empty list entries are skipped, not matched");
assert.equal(secretMatchesAny("second", []), false, "an empty list never matches (fail closed)");
assert.equal(secretMatchesAny("", ["configured"]), false, "an empty token never matches a list");

// ---------- cronAuth behaviour is unchanged, now on the shared compare ----------
function headers(map) {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}
assert.equal(isCronRequestAuthorized(headers({ authorization: "Bearer cron-secret" }), "cron-secret"), true, "Bearer carrier still works");
assert.equal(isCronRequestAuthorized(headers({ "x-cron-secret": "cron-secret" }), "cron-secret"), true, "x-cron-secret carrier still works");
assert.equal(isCronRequestAuthorized(headers({ authorization: "Bearer wrong" }), "cron-secret"), false, "a wrong secret fails");
assert.equal(isCronRequestAuthorized(headers({ authorization: "Bearer cron-secret" }), ""), false, "an unconfigured door fails closed");
assert.equal(cronTokenMatchesAnySecret("worker-b", ["worker-a", "worker-b"]), true, "the rotation list matches its second entry");
assert.equal(cronTokenMatchesAnySecret("worker-c", ["worker-a", "worker-b"]), false, "an unlisted token fails");

// ---------- wiring pins: no plain-equality secret compare survives ----------
const [genRoute, socialRoute, gmailRoute, cronAuthSource] = await Promise.all([
  readFile(new URL("../app/api/cron/roamly-itinerary-generation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/roamly-social-autopost/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/webhooks/gmail/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/cronAuth.ts", import.meta.url), "utf8")
]);
assert.match(genRoute, /cronTokenMatchesAnySecret\(token, secrets\)/, "generation cron compares through the helper");
assert.doesNotMatch(genRoute, /secrets\.includes\(token\)/, "generation cron no longer uses Array.includes on the secret");
assert.match(socialRoute, /cronTokenMatchesAnySecret\(token, expectedSecrets\)/, "social cron compares through the helper");
assert.doesNotMatch(socialRoute, /expectedSecrets\.includes\(token\)/, "social cron no longer uses Array.includes on the secret");
assert.match(gmailRoute, /secretValuesEqual\(request\.headers\.get\("x-roamly-gmail-webhook-secret"\)/, "gmail webhook compares through the helper");
assert.doesNotMatch(gmailRoute, /=== secret/, "gmail webhook no longer compares the secret with ===");
assert.match(cronAuthSource, /from "@\/lib\/roamly\/secretCompare"/, "cronAuth delegates to the shared compare module");

// ---------- admin-door shared-store client ----------
const HASH_SECRET = "s".repeat(40);
assert.equal(adminAccessActorHash("not-an-ip", HASH_SECRET), null, "a non-IP actor hashes to null (memory-only fallback)");
assert.equal(adminAccessActorHash("203.0.113.7", "short"), null, "a short secret hashes to null");
assert.match(adminAccessActorHash("203.0.113.7", HASH_SECRET), /^[a-f0-9]{64}$/, "a valid actor hash is 64 hex chars");
assert.notEqual(
  adminAccessActorHash("203.0.113.7", HASH_SECRET),
  adminAccessActorHash("203.0.113.8", HASH_SECRET),
  "different IPs hash differently"
);

function fakeAdmin(script) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      const step = script[name];
      if (!step) return { data: null, error: { message: "unexpected rpc" } };
      return typeof step === "function" ? step(args) : step;
    }
  };
}

const HASH = "a".repeat(64);
{
  const admin = fakeAdmin({ roamly_admin_access_lockout: { data: [{ locked: true, retry_after_seconds: 812 }], error: null } });
  assert.deepEqual(await getAdminAccessLockout(admin, HASH), { ok: true, locked: true, retryAfterSeconds: 812 }, "a locked verdict passes through");
  assert.deepEqual(admin.calls[0], ["roamly_admin_access_lockout", { p_actor_hash: HASH }], "the lockout RPC gets the actor hash only");
}
{
  const admin = fakeAdmin({ roamly_admin_access_lockout: { data: null, error: { message: "db down" } } });
  assert.deepEqual(await getAdminAccessLockout(admin, HASH), { ok: false }, "an RPC error degrades to {ok:false}, never a throw");
}
{
  const admin = fakeAdmin({ roamly_admin_access_lockout: { data: [{ locked: "yes" }], error: null } });
  assert.deepEqual(await getAdminAccessLockout(admin, HASH), { ok: false }, "a malformed verdict degrades to {ok:false}");
}
{
  const admin = fakeAdmin({});
  assert.deepEqual(await getAdminAccessLockout(admin, "not-a-hash"), { ok: false }, "a malformed hash is refused before any RPC");
  assert.equal(admin.calls.length, 0, "no RPC fires for a malformed hash");
}
{
  const admin = fakeAdmin({
    roamly_record_admin_access_failure: { data: [{ fails: 5, locked: true, retry_after_seconds: 900 }], error: null },
    roamly_clear_admin_access_failures: { data: null, error: null }
  });
  assert.deepEqual(
    await recordAdminAccessFailure(admin, HASH, 5, 900),
    { ok: true, fails: 5, locked: true, retryAfterSeconds: 900 },
    "the fifth failure reports the lock"
  );
  assert.deepEqual(
    admin.calls[0][1],
    { p_actor_hash: HASH, p_max_attempts: 5, p_lockout_seconds: 900 },
    "the door's own limits are the RPC parameters"
  );
  assert.deepEqual(await clearAdminAccessFailures(admin, HASH), { ok: true }, "a successful sign-in clears the shared counter");
}

// ---------- admin route wiring: shared layer consulted, memory kept ----------
const adminRoute = await readFile(new URL("../app/api/admin/access/route.ts", import.meta.url), "utf8");
assert.match(adminRoute, /getAdminAccessLockout/, "the door reads the shared lockout");
assert.match(adminRoute, /recordAdminAccessFailure/, "the door records failures to the shared store");
assert.match(adminRoute, /clearAdminAccessFailures/, "the door clears the shared store on success");
assert.match(adminRoute, /Math\.max\(lockoutRemainingMs\(ip\), await sharedLockoutRemainingMs\(store\)\)/, "the stricter of memory and store wins");
assert.match(adminRoute, /new Map<string, \{ fails: number; lockedUntil: number \}>/, "the in-memory fallback limiter is still in place");

// ---------- CSP: report-only full policy + four-directive enforce set ----------
const nextConfig = (await import("../next.config.ts")).default;
const headerBlocks = await nextConfig.headers();
const main = headerBlocks.find((block) => block.source === "/(.*)");
assert.ok(main, "the global header block exists");
const byKey = new Map(main.headers.map((entry) => [entry.key, entry.value]));
assert.equal(byKey.get("X-Frame-Options"), "DENY", "the pre-existing framing posture is untouched");

const reportOnly = byKey.get("Content-Security-Policy-Report-Only");
assert.ok(reportOnly, "the report-only CSP is present");
for (const needle of [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://tpwdgt.com https://scripts.stay22.com",
  "style-src 'self' 'unsafe-inline'",
  "tiles.openfreemap.org",
  "supabase.co",
  "frame-src 'self' https://tpwdgt.com https://booking.stay22.com",
  "worker-src 'self' blob:"
]) {
  assert.ok(reportOnly.includes(needle), `report-only policy includes: ${needle}`);
}

const enforced = byKey.get("Content-Security-Policy");
assert.equal(
  enforced,
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "the enforce header carries exactly the four proven directives"
);
assert.ok(!enforced.includes("script-src"), "script-src stays report-only until nonces land");

// Enforce-set premises, re-proven against the current tree: no <base>,
// <object> or <embed> element anywhere, and every literal form action
// is same-origin.
const premiseFiles = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith(".tsx")) premiseFiles.push(path);
  }
}
await collect(new URL("../app", import.meta.url).pathname);
await collect(new URL("../components", import.meta.url).pathname);
for (const path of premiseFiles) {
  const source = await readFile(path, "utf8");
  assert.doesNotMatch(source, /<base[\s>]/, `${path} has no <base> element`);
  assert.doesNotMatch(source, /<object[\s>]/, `${path} has no <object> element`);
  assert.doesNotMatch(source, /<embed[\s>]/, `${path} has no <embed> element`);
  for (const match of source.matchAll(/<form[^>]*\saction="([^"]+)"/g)) {
    assert.ok(match[1].startsWith("/"), `${path} form action ${match[1]} is same-origin`);
  }
}

// ---------- the prepared migration ----------
const migration = await readFile(
  new URL("../supabase/migrations/20261111000200_roamly_stage5_hardening.sql", import.meta.url),
  "utf8"
);
assert.match(migration, /revoke all on function public\.roamly_guard_booking_supersession\(\) from public, anon, authenticated;/, "F-3 revoke is present");
assert.match(migration, /grant execute on function public\.roamly_guard_booking_supersession\(\) to service_role;/, "F-3 keeps service_role execute");
const anonRevokes = migration.match(/^revoke all on table public\.[a-z0-9_]+ from anon;$/gm) || [];
assert.equal(anonRevokes.length, 100, "F-6 revokes anon's grants on exactly the census' 100 tables");
assert.doesNotMatch(migration, /grant[^;]*\bto anon\b/, "the migration grants anon nothing");
const tableRevokes = migration.match(/^revoke all on table public\.[a-z0-9_]+ from [^;]+;$/gm) || [];
assert.equal(
  tableRevokes.filter((line) => line.includes("authenticated")).length,
  1,
  "exactly one table revoke names authenticated: the brand-new §1 limiter table (house lock-down); no existing table's authenticated grants are touched"
);
assert.ok(
  migration.includes("create unique index if not exists booking_segments_booking_sequence_uidx\n  on public.booking_segments (booking_id, sequence);"),
  "F-5 restores the wallet file's unique index verbatim"
);
for (const rpc of ["roamly_admin_access_lockout", "roamly_record_admin_access_failure", "roamly_clear_admin_access_failures"]) {
  assert.ok(migration.includes(`create or replace function public.${rpc}`), `the admin limiter RPC exists: ${rpc}`);
  assert.ok(migration.includes(`grant execute on function public.${rpc}`), `the admin limiter RPC is granted: ${rpc}`);
}
assert.match(migration, /STAGE5-PREFLIGHT-PROBES\.sql/, "the migration header points at the pre-flight probes");
assert.match(migration, /STAGE5-ROLLBACK\.sql/, "the migration header points at the rollback file");

console.log("roamly-stage5-hardening-checks: PASS");
