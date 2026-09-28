import assert from "node:assert/strict";
import { createBusinessValueAttribution, createTokenCostAccounting, calculateRoi, canRaiseBudget, customerTruthOptimizationGuard, detectTokenBurn, evaluateBudget, recommendEconomicPolicy, safeFinOpsSummary } from "../lib/roamly/finops.ts";

const base = {
  jobId: "job-1", attemptId: "attempt-1", specialist: "GAP_AUDIT_QA_RELIABILITY", subsystem: "reliability",
  provider: "deterministic", modelOrWorkerClass: "registered-runner", executionClass: "deterministic",
  retryCount: 0, outcome: "completed", evidenceQuality: "acceptable", businessPurpose: "reliability", authoritativeCost: true
};
const known = createTokenCostAccounting({ ...base, inputTokens: 10, outputTokens: 5, cachedTokens: 0, financialCostUsd: 0, durationMs: 20 });
assert.equal(known.inputTokens, 10);
assert.equal(known.financialCostUsd, 0);
assert.equal(createTokenCostAccounting({ ...base, attemptId: "attempt-2" }).financialCostUsd, null, "unknown cost remains UNKNOWN");
assert.equal(createTokenCostAccounting({ ...base, attemptId: "attempt-3" }).provider, "deterministic");
assert.equal(evaluateBudget({ jobTokenCeiling: 0, specialistTokenCeiling: 0, providerTokenCeiling: 0, dailyTokenCeiling: 0, weeklyTokenCeiling: 0, monthlyTokenCeiling: 0, retryCeiling: 1, financialCeilingUsd: 0, ownerApprovalRequired: false }, { tokens: 0, financialCostUsd: 0, retryCount: 0 }, "deterministic", "deterministic").decision, "ALLOW");
assert.equal(evaluateBudget({ jobTokenCeiling: 0, specialistTokenCeiling: 0, providerTokenCeiling: 0, dailyTokenCeiling: 0, weeklyTokenCeiling: 0, monthlyTokenCeiling: 0, retryCeiling: 1, financialCeilingUsd: 0, ownerApprovalRequired: false }, { tokens: 1, financialCostUsd: 0, retryCount: 0 }, "deterministic", "deterministic").decision, "BLOCK_BUDGET_EXCEEDED");
assert.equal(evaluateBudget({ jobTokenCeiling: 100, specialistTokenCeiling: 100, providerTokenCeiling: 100, dailyTokenCeiling: 100, weeklyTokenCeiling: 100, monthlyTokenCeiling: 100, retryCeiling: 1, financialCeilingUsd: 0, ownerApprovalRequired: false }, { tokens: null, financialCostUsd: null, retryCount: 0 }, "model", "openai").decision, "BLOCK_BUDGET_EXCEEDED");
assert.equal(recommendEconomicPolicy({ deterministicSufficient: true, reusableEvidence: false, requestedProvider: "openai", executionClass: "model", policy: { jobTokenCeiling: 100, specialistTokenCeiling: 100, providerTokenCeiling: 100, dailyTokenCeiling: 100, weeklyTokenCeiling: 100, monthlyTokenCeiling: 100, retryCeiling: 1, financialCeilingUsd: 100, ownerApprovalRequired: false }, usage: { tokens: null, financialCostUsd: null, retryCount: 0 } }).decision, "USE_DETERMINISTIC_RUNNER");
assert.equal(recommendEconomicPolicy({ deterministicSufficient: false, reusableEvidence: true, requestedProvider: "openai", executionClass: "model", policy: { jobTokenCeiling: 100, specialistTokenCeiling: 100, providerTokenCeiling: 100, dailyTokenCeiling: 100, weeklyTokenCeiling: 100, monthlyTokenCeiling: 100, retryCeiling: 1, financialCeilingUsd: 100, ownerApprovalRequired: false }, usage: { tokens: null, financialCostUsd: null, retryCount: 0 } }).decision, "REUSE_EXISTING_EVIDENCE");
const confirmed = createBusinessValueAttribution({ status: "CONFIRMED_REVENUE", amountUsd: 100, evidenceReference: "stripe:confirmed", causation: "direct", confidence: "authoritative" });
assert.equal(calculateRoi(10, confirmed).ratio, 10);
assert.equal(calculateRoi(null, confirmed).status, "UNKNOWN");
assert.throws(() => createBusinessValueAttribution({ status: "UNKNOWN", amountUsd: 1, evidenceReference: null, causation: "unknown", confidence: "unknown" }), /UNKNOWN_VALUE/);
assert.throws(() => createBusinessValueAttribution({ status: "CONFIRMED_REVENUE", amountUsd: 1, evidenceReference: null, causation: "attributed", confidence: "supported" }), /CONFIRMED_REVENUE/);
assert.equal(customerTruthOptimizationGuard("token ceiling for reliability job"), true);
assert.equal(customerTruthOptimizationGuard("optimize candidate selection by commission"), false);
const findings = detectTokenBurn([known, { ...known, recordId: "duplicate", attemptId: "attempt-2", retryCount: 1, evidenceQuality: "insufficient" }], { deterministicRunnerAvailable: true });
assert.ok(findings.some((finding) => finding.code === "DUPLICATE_EXECUTION"));
assert.ok(findings.some((finding) => finding.code === "RETRY_BURN"));
assert.ok(findings.some((finding) => finding.code === "LOW_VALUE_EVIDENCE"));
assert.equal(canRaiseBudget({ id: "job-1", tokenBudget: 0, financialBudgetUsd: 0 }, { tokenBudget: 1, financialBudgetUsd: 1 }), false);
assert.equal(canRaiseBudget({ id: "job-1", tokenBudget: 0, financialBudgetUsd: 0 }, { tokenBudget: 1, financialBudgetUsd: 1 }, { jobId: "job-1", decision: "approved", requestedCategory: "spending" }), true);
assert.equal(canRaiseBudget({ id: "job-1", tokenBudget: 0, financialBudgetUsd: 0 }, { tokenBudget: 1, financialBudgetUsd: 1 }, { jobId: "job-1", decision: "approved", requestedCategory: "security_sensitive" }), false);
assert.equal(canRaiseBudget({ id: "job-1", tokenBudget: 0, financialBudgetUsd: 0 }, { tokenBudget: 1, financialBudgetUsd: 1 }, { jobId: "job-2", decision: "approved", requestedCategory: "spending" }), false);
assert.equal(safeFinOpsSummary({ finops: { provider: "openai", costStatus: "UNKNOWN" } }).costStatus, "UNKNOWN");
console.log("Roamly Phase 7 FinOps checks passed");
