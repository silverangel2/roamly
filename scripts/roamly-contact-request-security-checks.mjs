import assert from "node:assert/strict";
import fs from "node:fs";
import { contactActorHash, isContactRequestWithinLimit, isSameOriginContactRequest, trustedContactClientIp } from "../lib/roamly/contactRequestSecurity.ts";
import { consumeContactRequestQuota } from "../lib/roamly/contactRequestQuota.ts";

const origin = "https://roamlyhq.com";
assert.equal(isSameOriginContactRequest(origin, origin, "same-origin"), true);
assert.equal(isSameOriginContactRequest("https://attacker.example", origin, "cross-site"), false);
assert.equal(isSameOriginContactRequest(null, origin, null), false, "requests without an origin are rejected");
assert.equal(isContactRequestWithinLimit("{}", "2"), true);
assert.equal(isContactRequestWithinLimit("x".repeat(12_289), null), false, "encoded body size is bounded even without content-length");
assert.equal(isContactRequestWithinLimit("{}", "999999"), false, "oversized declared bodies are rejected before JSON parsing");
assert.equal(trustedContactClientIp("203.0.113.8"), "203.0.113.8");
assert.equal(trustedContactClientIp("203.0.113.8, 10.0.0.1"), "203.0.113.8");
assert.equal(trustedContactClientIp("attacker-controlled"), null);
assert.equal(trustedContactClientIp(null), null);
assert.match(contactActorHash("203.0.113.8", "x".repeat(40)) || "", /^[a-f0-9]{64}$/);
assert.equal(contactActorHash("203.0.113.8", "too-short"), null);
assert.notEqual(contactActorHash("203.0.113.8", "x".repeat(40)), contactActorHash("203.0.113.8", "y".repeat(40)), "HMAC keys must domain-separate stored client identities");

const mock = (result) => ({ rpc: async (name, args) => {
  assert.equal(name, "roamly_consume_contact_request_quota");
  assert.match(args.p_actor_hash, /^[a-f0-9]{64}$/);
  return result;
} });
assert.deepEqual(await consumeContactRequestQuota(mock({ data: [{ allowed: true, hour_remaining: 2, day_remaining: 9 }], error: null }), "a".repeat(64)), {
  ok: true, allowed: true, hourRemaining: 2, dayRemaining: 9
});
assert.deepEqual(await consumeContactRequestQuota(mock({ data: [{ allowed: false, retry_after_seconds: 1800 }], error: null }), "a".repeat(64)), {
  ok: true, allowed: false, retryAfterSeconds: 1800
});
assert.deepEqual(await consumeContactRequestQuota(mock({ data: null, error: new Error("missing migration") }), "a".repeat(64)), { ok: false }, "missing quota migration must fail closed");

const route = fs.readFileSync(new URL("../app/api/contact/route.ts", import.meta.url), "utf8");
const form = fs.readFileSync(new URL("../components/contact/ContactForm.tsx", import.meta.url), "utf8");
assert.ok(route.includes("isSameOriginContactRequest("), "contact delivery must be same-origin only");
assert.ok(route.includes("isContactRequestWithinLimit(rawBody"), "contact payloads must be bounded before parsing");
assert.ok(route.includes("body.companyWebsite"), "automated honeypot submissions must not reach email delivery");
assert.ok(form.includes('name="companyWebsite"'), "the customer contact form must include the honeypot field");
assert.ok(route.indexOf("body.companyWebsite") < route.indexOf("const quota = await consumeContactRequestQuota"), "honeypot submissions must not consume support quota");
assert.ok(route.indexOf("const quota = await consumeContactRequestQuota") < route.indexOf("const supportResult = await sendRoamlyEmail"), "quota must be consumed before any email is sent");

const migration = fs.readFileSync(new URL("../supabase/migrations/20260929_roamly_contact_request_rate_limits.sql", import.meta.url), "utf8");
const precheck = fs.readFileSync(new URL("../supabase/checks/20260929_roamly_contact_request_rate_limits_precheck.sql", import.meta.url), "utf8");
const postcheck = fs.readFileSync(new URL("../supabase/checks/20260929_roamly_contact_request_rate_limits_postcheck.sql", import.meta.url), "utf8");
assert.match(migration, /hour_count > 3/);
assert.match(migration, /day_count > 10/);
assert.match(migration, /interval '2 days'/, "hashed identities must have a short retention window");
assert.match(migration, /enable row level security/i);
assert.match(migration, /to service_role/i);
assert.match(migration, /request\.jwt\.claim\.role/, "the SECURITY DEFINER RPC must enforce service-role callers");
assert.match(precheck, /contact quota table absent/);
assert.match(precheck, /contact quota function absent/);
assert.match(postcheck, /service-only security definer RPC exists/);

console.log("Roamly contact request security checks passed.");
