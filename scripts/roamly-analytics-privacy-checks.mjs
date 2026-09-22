import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/roamly/analyticsPrivacy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const sandbox = { exports: {}, module: { exports: {} }, require, URL, String, RegExp };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox);
const { sanitizeAnalyticsPath, analyticsReferrerHost, sanitizeAnalyticsVisitorKey } = sandbox.module.exports;

const tripId = "68d17f58-8c6a-4f29-93a9-63f5d65c6f01";
assert.equal(
  sanitizeAnalyticsPath(`/trip/${tripId}?checkout=success&session_id=cs_test_private#payment`),
  "/trip/:id",
  "analytics path must remove query strings, fragments, and trip UUIDs"
);
assert.equal(sanitizeAnalyticsPath("https://roamlyhq.com/trip/" + tripId + "?token=private"), "/trip/:id");
assert.equal(sanitizeAnalyticsPath("javascript:alert(1)"), null, "unsafe schemes must not become analytics paths");
assert.equal(sanitizeAnalyticsPath("/" + "a".repeat(2050)), null, "oversized paths must be rejected");
assert.equal(
  analyticsReferrerHost("https://travel.example.com/article?email=private#section"),
  "travel.example.com",
  "referrer analytics must retain only the referring hostname"
);
assert.equal(analyticsReferrerHost("javascript:alert(1)"), null);
assert.equal(
  sanitizeAnalyticsVisitorKey("a5c7c6e6-93fd-4aec-9f48-fc6ff3e37b54"),
  "a5c7c6e6-93fd-4aec-9f48-fc6ff3e37b54"
);
assert.equal(sanitizeAnalyticsVisitorKey("trip-id-or-email@example.com"), null);

const route = fs.readFileSync(new URL("../app/api/roamly/events/app/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("url: null"), "app analytics intake must never persist a full URL");
assert.ok(route.includes("referrer: null"), "app analytics intake must never persist a full referrer URL");
assert.ok(route.includes("analyticsReferrerHost(referrer)"), "app analytics intake should preserve only referrer host analytics");

console.log("Roamly analytics privacy checks passed.");
