import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  STEP_UP_ERROR_CODE,
  STEP_UP_REQUIRED_MESSAGE,
  STEP_UP_WINDOW_SECONDS,
  evaluateStepUp,
  requireFreshAuthentication,
  sessionAuthTimeSeconds
} from "../lib/roamly/stepUp.ts";

/*
 * Stage 5 (2026-11-11): step-up authentication for the billing portal.
 * Proves the freshness verdicts (fresh proceeds, stale is refused,
 * unprovable is refused — fail closed) and pins the route wiring:
 * the check runs BEFORE any billing-portal session is created.
 */

const NOW = 1_800_000_000; // fixed clock for every verdict below

function accessToken(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function user(lastSignInAt) {
  return { id: "user-1", last_sign_in_at: lastSignInAt };
}

const iso = (seconds) => new Date(seconds * 1000).toISOString();

// --- sessionAuthTimeSeconds: the auth_time claim wins over last_sign_in_at.
assert.equal(
  sessionAuthTimeSeconds({ access_token: accessToken({ auth_time: NOW - 60 }) }, user(iso(NOW - 99999))),
  NOW - 60,
  "auth_time claim is the freshness source when present"
);
assert.equal(
  sessionAuthTimeSeconds({ access_token: accessToken({ sub: "user-1" }) }, user(iso(NOW - 120))),
  NOW - 120,
  "last_sign_in_at is the fallback when the token carries no auth_time"
);
assert.equal(
  sessionAuthTimeSeconds({ access_token: "not-a-jwt" }, user(null)),
  null,
  "no claim and no last_sign_in_at means the sign-in time is unprovable"
);
assert.equal(sessionAuthTimeSeconds(null, user(undefined)), null, "no session and no user stamp is unprovable");

// --- evaluateStepUp verdicts.
assert.deepEqual(
  evaluateStepUp({ session: { access_token: accessToken({ auth_time: NOW - 30 }) }, user: user(null), nowSeconds: NOW }),
  { ok: true, authTimeSeconds: NOW - 30 },
  "a sign-in 30 seconds ago proceeds"
);
assert.equal(
  evaluateStepUp({
    session: { access_token: accessToken({ auth_time: NOW - (STEP_UP_WINDOW_SECONDS - 1) }) },
    user: user(null),
    nowSeconds: NOW
  }).ok,
  true,
  "one second inside the window still proceeds"
);
assert.deepEqual(
  evaluateStepUp({
    session: { access_token: accessToken({ auth_time: NOW - STEP_UP_WINDOW_SECONDS }) },
    user: user(null),
    nowSeconds: NOW
  }),
  { ok: false, reason: "stale", authTimeSeconds: NOW - STEP_UP_WINDOW_SECONDS },
  "a sign-in exactly one window old is stale"
);
assert.equal(
  evaluateStepUp({
    session: { access_token: accessToken({ auth_time: NOW - 86400 }) },
    user: user(iso(NOW - 10)),
    nowSeconds: NOW
  }).ok,
  false,
  "a fresh last_sign_in_at never rescues a stale auth_time (the claim is authoritative)"
);
assert.deepEqual(
  evaluateStepUp({ session: null, user: user(null), nowSeconds: NOW }),
  { ok: false, reason: "unknown", authTimeSeconds: null },
  "an unprovable sign-in time fails closed"
);

// --- requireFreshAuthentication against fake Supabase clients.
function fakeSupabase(session, { throws = false } = {}) {
  return {
    auth: {
      async getSession() {
        if (throws) throw new Error("session store unavailable");
        return { data: { session } };
      }
    }
  };
}

assert.equal(
  (await requireFreshAuthentication(fakeSupabase({ access_token: accessToken({ auth_time: Math.floor(Date.now() / 1000) - 5 }) }), user(null))).ok,
  true,
  "route guard proceeds on a fresh session"
);
assert.equal(
  (await requireFreshAuthentication(fakeSupabase({ access_token: accessToken({ auth_time: Math.floor(Date.now() / 1000) - 86400 }) }), user(null))).ok,
  false,
  "route guard refuses a day-old sign-in"
);
assert.equal(
  (await requireFreshAuthentication(fakeSupabase(null, { throws: true }), user(iso(Math.floor(Date.now() / 1000) - 60)))).ok,
  true,
  "a session-store error falls back to the verified user record, not to refusal"
);
assert.equal(
  (await requireFreshAuthentication(fakeSupabase(null), user(null))).ok,
  false,
  "no session and no user stamp refuses"
);

// --- The refusal is a human message in the house error shape.
assert.match(STEP_UP_REQUIRED_MESSAGE, /sign in again/i, "the refusal tells the person what to do");
assert.doesNotMatch(STEP_UP_REQUIRED_MESSAGE, /STEP_UP|403|error/i, "the refusal is not a raw code");
assert.equal(STEP_UP_ERROR_CODE, "STEP_UP_REQUIRED", "the machine code is stable for the client to branch on");

// --- Wiring pin: the billing-portal route checks freshness BEFORE it
// creates the Stripe session, and only after requireUser; a failed
// check returns the house-shaped human refusal with a 403.
const route = await readFile(new URL("../app/api/stripe/billing-portal/route.ts", import.meta.url), "utf8");
const requireUserAt = route.indexOf("requireUser()");
const stepUpAt = route.indexOf("requireFreshAuthentication(");
const portalAt = route.indexOf("createBillingPortalSession(");
assert.ok(requireUserAt >= 0 && stepUpAt > requireUserAt, "step-up runs after authentication");
assert.ok(portalAt > stepUpAt, "step-up runs before the billing portal session is created");
assert.match(
  route,
  /if \(!stepUp\.ok\) \{\s*return NextResponse\.json\(\s*\{ ok: false, error: STEP_UP_ERROR_CODE, message: STEP_UP_REQUIRED_MESSAGE \},\s*\{ status: 403 \}\s*\);\s*\}/,
  "a failed step-up returns the human refusal as a 403 in the house error shape"
);

console.log("roamly-step-up-checks: PASS");
