// Legacy extraction credibility checks (Workstream B regression suite).
// evaluateExtractionCredibility re-judges STORED booking_extraction_results
// rows at read time. The stored overall_confidence is never trusted: a
// GitHub notification row stored at 0.97 and a promo row stored at 1.00
// must both come back NOT credible, with the reason codes asserted — not
// just the boolean. A genuine provider row (real code, real provider)
// stays credible, including when the code lives only in
// field_confidence_json and when the provider name is a garbled fragment.
// Run: node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//        scripts/roamly-legacy-extraction-credibility-checks.mjs   (TZ-safe: pure module)
import assert from "node:assert/strict";
import { evaluateExtractionCredibility } from "../lib/roamly/extractionCredibility.ts";

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}
function reasonsEq(name, actual, expected) {
  assert.deepEqual(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---- GitHub notification row stored at 0.97: NOT credible ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.97,
    sender: "GitHub <notifications@github.com>",
    subject: "[repo] Pull request review requested",
    extracted_booking_json: { provider: "Github", title: "[repo] Pull request review requested", confirmationCode: "GH12345" }
  });
  eq("GitHub row at stored 0.97 is not credible", v.credible, false);
  reasonsEq("GitHub row reasons are exactly [non_booking_sender]", v.reasons, ["non_booking_sender"]);
}
{
  // Same class with NO linked message row: the stored provider name
  // ("Github", derived from the sender domain at extraction time) is
  // the trace and must still fire the same reason.
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.97,
    extracted_booking_json: { provider: "Github", title: "Some notification", confirmationCode: "GH12345" }
  });
  eq("GitHub row without joined sender is not credible", v.credible, false);
  reasonsEq("GitHub provider-trace reasons are exactly [non_booking_sender]", v.reasons, ["non_booking_sender"]);
}
{
  // Sender domain arriving via the joined message's filter facts.
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.91,
    extracted_booking_json: { provider: "Some Travel", title: "Your booking confirmation", confirmationCode: "AB12345" },
    message: { sender: null, subject: null, extracted_booking_facts: { senderDomain: "github.com" } }
  });
  eq("GitHub row via senderDomain fact is not credible", v.credible, false);
  check("GitHub senderDomain fact yields non_booking_sender", v.reasons.includes("non_booking_sender"));
}

// ---- Promo row stored at 1.00: NOT credible ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 1.0,
    subject: "Fly Premium for less this holiday season",
    extracted_booking_json: { provider: "Air Canada", title: "Fly Premium for less this holiday season" }
  });
  eq("promo row at stored 1.00 is not credible", v.credible, false);
  check("promo row yields promotional_subject", v.reasons.includes("promotional_subject"));
  check("promo row also lacks a code", v.reasons.includes("missing_confirmation_code"));
}

// ---- QA TEST-RMLY row stored at 1.00: NOT credible ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 1.0,
    extracted_booking_json: {
      provider: "Roamly QA Test Provider",
      title: "Roamly QA Test Stay — Montreal",
      confirmationCode: "TEST-RMLY-1024-MTL2",
      metadata: { qa_test: true }
    }
  });
  eq("QA TEST-RMLY row at stored 1.00 is not credible", v.credible, false);
  reasonsEq("QA row reasons are exactly [test_or_qa_record]", v.reasons, ["test_or_qa_record"]);
}

// ---- 1.00 row with NO confirmation code anywhere: NOT credible ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 1.0,
    extracted_booking_json: { provider: "Agoda", title: "Your booking confirmation" }
  });
  eq("no-code row at stored 1.00 is not credible", v.credible, false);
  reasonsEq("no-code row reasons are exactly [missing_confirmation_code]", v.reasons, ["missing_confirmation_code"]);
  eq("no-code row reports confirmationCode null", v.confirmationCode, null);
}

// ---- Code-shaped LABEL word is not a code ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 1.0,
    extracted_booking_json: { provider: "Agoda", title: "Your booking confirmation", confirmationCode: "CONFIRMATION" }
  });
  eq("label-word code row is not credible", v.credible, false);
  check("label-word code yields invalid_confirmation_code", v.reasons.includes("invalid_confirmation_code"));
}

// ---- Subscription/notification row: NOT credible ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.95,
    subject: "Your subscription renewal notice",
    extracted_booking_json: { provider: "Some Service", title: "Your subscription renewal notice", confirmationCode: "SUB12345" }
  });
  eq("subscription row is not credible", v.credible, false);
  check("subscription row yields non_booking_notification", v.reasons.includes("non_booking_notification"));
}

// ---- Missing provider: NOT credible even with a genuine-looking code ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 1.0,
    extracted_booking_json: { title: "Your booking confirmation", confirmationCode: "AGD8X42K" }
  });
  eq("missing-provider row is not credible", v.credible, false);
  check("missing-provider row yields missing_provider", v.reasons.includes("missing_provider"));
  eq("missing-provider row reports provider null", v.provider, null);
}

// ---- Genuine Agoda-style row: credible (positive controls) ----
{
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.9,
    extracted_booking_json: { provider: "Agoda", title: "Your booking confirmation", confirmationCode: "AGD8X42K" }
  });
  eq("genuine Agoda row is credible", v.credible, true);
  reasonsEq("genuine Agoda row has no reasons", v.reasons, []);
  eq("genuine Agoda row reports its code", v.confirmationCode, "AGD8X42K");
  eq("genuine Agoda row reports its provider", v.provider, "Agoda");
}
{
  // Stored confidence must have ZERO effect in either direction.
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.01,
    extracted_booking_json: { provider: "Agoda", title: "Your booking confirmation", confirmationCode: "AGD8X42K" }
  });
  eq("genuine row stays credible even at stored 0.01", v.credible, true);
}
{
  // Code stored ONLY in field_confidence_json still counts.
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.9,
    extracted_booking_json: { provider: "Agoda", title: "Your booking confirmation" },
    field_confidence_json: { confirmation_code: { value: "AGD8X42K", confidence: 0.9 } }
  });
  eq("code only in field_confidence_json is credible", v.credible, true);
  eq("field-confidence code is the reported code", v.confirmationCode, "AGD8X42K");
}
{
  // No provider allowlist: a garbled domain-derived fragment with a
  // genuine code survives (smaller legitimate providers must not die).
  const v = evaluateExtractionCredibility({
    overall_confidence: 0.9,
    extracted_booking_json: { provider: "Sg Booking", title: "Your booking confirmation", confirmationCode: "SG998877" }
  });
  eq("garbled-fragment provider with genuine code is credible", v.credible, true);
}
{
  // camelCase row aliases (extractedBookingJson / fieldConfidenceJson).
  const v = evaluateExtractionCredibility({
    extractedBookingJson: { provider: "Agoda", title: "Your booking confirmation" },
    fieldConfidenceJson: { confirmation_code: { value: "AGD8X42K" } }
  });
  eq("camelCase stored-row aliases are honoured", v.credible, true);
}

console.log(`\n${passed} legacy-extraction-credibility checks passed`);
