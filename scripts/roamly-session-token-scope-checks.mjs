import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRoamlySessionToken, verifyRoamlySessionToken } from "../lib/roamly/sessionTokenCore.ts";

const previousSecret = process.env.ROAMLY_SESSION_TOKEN_SECRET;
process.env.ROAMLY_SESSION_TOKEN_SECRET = "test-only-session-scope-secret";
try {
  const scopes = [
    { method: "POST", path: "/api/trips/generate" },
    { method: "GET", path: "/api/trips/owned-trip/generation/status" }
  ];
  const token = createRoamlySessionToken({ id: "user-1", email: "traveler@example.test" }, scopes);
  assert.ok(token);
  assert.equal(verifyRoamlySessionToken(token, { method: "POST", path: "/api/trips/generate" })?.userId, "user-1");
  assert.equal(verifyRoamlySessionToken(token, { method: "GET", path: "/api/trips/owned-trip/generation/status?refresh=1" })?.userId, "user-1");
  assert.equal(verifyRoamlySessionToken(token, { method: "POST", path: "/api/trips/owned-trip/generation/status" }), null, "HTTP method is part of the credential scope");
  assert.equal(verifyRoamlySessionToken(token, { method: "POST", path: "/api/account/email-connections" }), null, "unrelated account endpoints are not authorized");
  assert.equal(verifyRoamlySessionToken(token, { method: "GET", path: "/api/trips/other-trip/generation/status" }), null, "trip progress is bound to the rendered trip id");
  assert.equal(createRoamlySessionToken({ id: "user-1", email: null }, []), "", "unscoped credentials are never issued");

  const legacyPayload = Buffer.from(JSON.stringify({ userId: "user-1", email: null, purpose: "roamly_api", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const legacySignature = createHmac("sha256", process.env.ROAMLY_SESSION_TOKEN_SECRET).update(legacyPayload).digest("base64url");
  assert.equal(verifyRoamlySessionToken(`${legacyPayload}.${legacySignature}`, { method: "POST", path: "/api/trips/generate" }), null, "previous broad tokens are invalidated");

  const [middleware, auth, plan, trip] = await Promise.all([
    readFile(new URL("../middleware.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/roamly/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/plan/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8")
  ]);
  assert.match(middleware, /requestHeaders\.set\("x-roamly-method", request\.method\.toUpperCase\(\)\)/);
  assert.match(auth, /roamlySessionRequestScope\(requestHeaders\)/);
  assert.match(plan, /method: "POST", path: "\/api\/roamly\/price-discovery"/);
  assert.match(trip, /path: `\/api\/trips\/\$\{id\}\/generation\/status`/);
} finally {
  if (previousSecret === undefined) delete process.env.ROAMLY_SESSION_TOKEN_SECRET;
  else process.env.ROAMLY_SESSION_TOKEN_SECRET = previousSecret;
}

console.log("Roamly session token method/path scope checks passed.");
