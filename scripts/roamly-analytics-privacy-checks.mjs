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
const {
  sanitizeAnalyticsPath,
  analyticsReferrerHost,
  sanitizeAnalyticsVisitorKey,
  sanitizeAnalyticsEventMetadata,
  sanitizeAnalyticsEventType,
  sanitizeAnalyticsLanguage,
  sanitizeAnalyticsPlatform
} = sandbox.module.exports;

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
assert.equal(sanitizeAnalyticsEventType("booking_link_clicked"), "booking_link_clicked");
assert.equal(sanitizeAnalyticsEventType("arbitrary_event_with_personal_data"), null, "unknown client event names must be rejected");
assert.deepEqual(
  JSON.parse(JSON.stringify(sanitizeAnalyticsEventMetadata({
    destination: "Lisbon",
    origin: "Halifax",
    startDate: "2026-10-01",
    budgetAmount: 8000,
    totalEstimateCents: 435678,
    tripId,
    error: "provider response includes private detail",
    tripType: "multi_city",
    budgetStatus: "within_budget",
    daysCount: 12,
    travelersCount: 2,
    rooms: 1,
    budgetIncludesHotel: true,
    category: "hotel",
    provider: "Booking.com",
    hasAffiliateUrl: true
  }))),
  { tripType: "multi_city", budgetStatus: "within_budget", category: "hotel", provider: "booking.com", daysCount: "5+", travelersCount: "2", rooms: "1", budgetIncludesHotel: true, hasAffiliateUrl: true },
  "only low-sensitivity categories, coarse counts, and booleans may survive analytics sanitization"
);
assert.equal(sanitizeAnalyticsLanguage("en-CA"), "en-ca");
assert.equal(sanitizeAnalyticsLanguage("person@example.com"), null);
assert.equal(sanitizeAnalyticsPlatform("MacIntel"), "macos");
assert.equal(sanitizeAnalyticsPlatform("custom device string"), null);

const route = fs.readFileSync(new URL("../app/api/roamly/events/app/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("url: null"), "app analytics intake must never persist a full URL");
assert.ok(route.includes("referrer: null"), "app analytics intake must never persist a full referrer URL");
assert.ok(route.includes("analyticsReferrerHost(referrer)"), "app analytics intake should preserve only referrer host analytics");
assert.ok(route.includes("8_192"), "analytics requests must have a small hard size limit");
assert.ok(route.includes('request.headers.get("sec-fetch-site") === "cross-site"'), "cross-site event submissions must be rejected");
assert.ok(route.includes("sanitizeAnalyticsEventMetadata(body.metadata)"), "server-side metadata must be allowlisted before persistence");
assert.ok(route.includes("title: null"), "client-supplied document titles must not be persisted");

const planner = fs.readFileSync(new URL("../components/plan/TripPlanForm.tsx", import.meta.url), "utf8");
assert.ok(!planner.includes("trackPlanEvent(\"origin_selected\", { origin:"), "planner must not send exact origin values to analytics");
assert.ok(!planner.includes("trackPlanEvent(\"destination_selected\", { destination:"), "planner must not send exact destination values to analytics");
assert.ok(!planner.includes("budgetAmount: payload.budgetAmount"), "planner must not send exact budget values to analytics");
assert.ok(!planner.includes("startDate,\n        endDate,"), "planner must not send exact trip dates to analytics");

console.log("Roamly analytics privacy checks passed.");
