import assert from "node:assert/strict";
import {
  SPECIALIST_PROFILES,
  SPECIALIST_MAX_AUTHORITY,
  SPECIALIST_NETWORK_POLICY,
  SAFE_REPAIR_MAX_AUTHORITY,
  LEVEL_3_SAFE_REPAIR_ROLES,
  SAFE_REPAIR_ALLOWED_OPERATIONS,
  SAFE_REPAIR_FORBIDDEN_OPERATIONS,
  SAFE_REPAIR_CONSTRAINTS,
  SAFE_REPAIR_DEPLOY_EVIDENCE,
  roleMayReachLevel3,
  specialistMayReachLevel3,
  createSafeRepairJob,
  assertSafeRepairDeployReady
} from "../lib/roamly/specialistOrganization.ts";
import {
  OWNER_APPROVAL_CATEGORIES,
  AUTONOMY_LEVELS,
  revenueImpact
} from "../lib/roamly/opsControlPlane.ts";
import { PHASE3_MAX_AUTHORITY } from "../lib/roamly/adrianLucaOrchestration.ts";

/**
 * Smarter-specialists policy gate: every specialist has a money mission,
 * the LEVEL_3 grant is scoped to gap auditor + executive secretary only,
 * and all LEVEL_4 owner-approval gates stay intact.
 */

console.log("[policy] smarter-specialists money missions + level-3 grant");

// 1. Every specialist carries a non-empty money mission (<=280 chars).
const profiles = Object.values(SPECIALIST_PROFILES);
assert.equal(profiles.length, 7, "all 7 specialist profiles must be registered");
for (const profile of profiles) {
  assert.ok(typeof profile.moneyMission === "string" && profile.moneyMission.trim().length > 0, `${profile.role} must have a money mission`);
  assert.ok(profile.moneyMission.length <= 280, `${profile.role} money mission must fit in 280 chars`);
}
console.log("  PASS all 7 specialists have money missions");

// 2. Default ceiling stays LEVEL_2; only the gap audit profile reaches LEVEL_3.
assert.equal(SPECIALIST_MAX_AUTHORITY, "LEVEL_2_DIAGNOSE", "default specialist ceiling must stay LEVEL_2_DIAGNOSE");
assert.equal(SAFE_REPAIR_MAX_AUTHORITY, "LEVEL_3_SAFE_REPAIR", "safe-repair ceiling must be LEVEL_3_SAFE_REPAIR");
assert.deepEqual([...LEVEL_3_SAFE_REPAIR_ROLES].sort(), ["EXECUTIVE_SECRETARY", "GAP_AUDIT_QA"], "level-3 grant is scoped to gap auditor + executive secretary only");
for (const profile of profiles) {
  const mayReach = specialistMayReachLevel3(profile.id);
  if (profile.id === "GAP_AUDIT_QA_RELIABILITY") {
    assert.ok(mayReach, "gap audit profile must be the only one that may reach LEVEL_3");
    assert.equal(profile.maxAuthority, "LEVEL_3_SAFE_REPAIR", "gap audit profile maxAuthority must be LEVEL_3_SAFE_REPAIR");
  } else {
    assert.ok(!mayReach, `${profile.id} must NOT reach LEVEL_3`);
    assert.equal(profile.maxAuthority, "LEVEL_2_DIAGNOSE", `${profile.id} maxAuthority must stay LEVEL_2_DIAGNOSE`);
  }
}
assert.ok(roleMayReachLevel3("GAP_AUDIT_QA"), "GAP_AUDIT_QA role may reach level 3");
assert.ok(roleMayReachLevel3("EXECUTIVE_SECRETARY"), "EXECUTIVE_SECRETARY role may reach level 3");
assert.ok(!roleMayReachLevel3("SEO"), "SEO role must not reach level 3");
console.log("  PASS level-3 grant is scoped to gap auditor + executive secretary");

// 3. Phase-3 orchestration ceiling is now LEVEL_3 (per-role gates still apply).
assert.equal(PHASE3_MAX_AUTHORITY, "LEVEL_3_SAFE_REPAIR", "phase-3 ceiling must be LEVEL_3_SAFE_REPAIR");
assert.ok(AUTONOMY_LEVELS.indexOf("LEVEL_3_SAFE_REPAIR") < AUTONOMY_LEVELS.indexOf("LEVEL_4_OWNER_APPROVAL"), "LEVEL_3 must rank below LEVEL_4");
console.log("  PASS phase-3 ceiling raised to LEVEL_3_SAFE_REPAIR, LEVEL_4 still above it");

// 4. All 12 LEVEL_4 owner-approval gates stay intact and are all forbidden in safe repair.
assert.equal(OWNER_APPROVAL_CATEGORIES.length, 12, "all 12 owner-approval gates must exist");
for (const category of OWNER_APPROVAL_CATEGORIES) {
  assert.ok(SAFE_REPAIR_FORBIDDEN_OPERATIONS.includes(category), `safe repair must forbid ${category}`);
}
assert.ok(SAFE_REPAIR_FORBIDDEN_OPERATIONS.includes("spending"), "safe repair must forbid spending");
assert.ok(SAFE_REPAIR_FORBIDDEN_OPERATIONS.includes("customer_data_access"), "safe repair must forbid customer data access");
assert.equal(SPECIALIST_NETWORK_POLICY, "NONE", "specialist network policy must stay NONE — no new network calls");
console.log("  PASS all 12 LEVEL_4 gates intact and forbidden inside safe repair");

// 5. Safe-repair constraints are bounded: small, revertible, validated before deploy.
assert.ok(SAFE_REPAIR_CONSTRAINTS.maxFilesChanged <= 5, "safe repair must touch at most 5 files");
assert.ok(SAFE_REPAIR_CONSTRAINTS.maxLinesChanged <= 200, "safe repair must change at most 200 lines");
assert.equal(SAFE_REPAIR_CONSTRAINTS.mustBeRevertible, true, "safe repair must be revertible");
assert.equal(SAFE_REPAIR_CONSTRAINTS.requiresValidationBeforeDeploy, true, "safe repair must validate before deploy");
assert.ok(SAFE_REPAIR_CONSTRAINTS.noMigrations, "safe repair must never include migrations");
assert.ok(SAFE_REPAIR_CONSTRAINTS.noSecrets, "safe repair must never touch secrets");
assert.ok(SAFE_REPAIR_CONSTRAINTS.noSpending, "safe repair must never spend");
assert.ok(SAFE_REPAIR_CONSTRAINTS.noCustomerFinancialTruth, "safe repair must never change customer financial truth");
assert.deepEqual([...SAFE_REPAIR_DEPLOY_EVIDENCE].sort(), ["build", "deterministic_check", "typecheck"], "deploy requires deterministic check + typecheck + build evidence");
assert.ok(SAFE_REPAIR_ALLOWED_OPERATIONS.includes("run_bounded_validation"), "safe repair may run bounded validation");
assert.ok(!SAFE_REPAIR_ALLOWED_OPERATIONS.includes("deploy"), "deploy itself is never an allowed safe-repair operation");
console.log("  PASS safe-repair job type is bounded, revertible, validation-before-deploy");

// 6. Safe-repair job lifecycle: create -> validate evidence -> deploy-ready; misuse rejected.
const job = createSafeRepairJob({
  role: "GAP_AUDIT_QA",
  initiatingSignal: "deterministic_check:customer_route_isolation",
  objective: "Safe repair: isolate customer routes from ops internals.",
  subsystem: "routing",
  allowedFiles: ["app/trip/[id]/page.tsx"],
  estimatedLinesChanged: 40,
  acceptanceCriteria: ["Re-run the failed deterministic check with a passing result."],
  findingId: "GAP-customer_route_isolation"
});
assert.equal(job.authorityLevel, "LEVEL_3_SAFE_REPAIR", "safe-repair job must carry LEVEL_3 authority");
assert.equal(job.runnerId, "phase2.gap-audit.safe-repair", "gap audit safe-repair job must use the registered runner");
assert.equal(job.scope.safeRepair, true, "safe-repair job must be flagged in scope");
const { createEvidence } = await import("../lib/roamly/opsControlPlane.ts");
const passingEvidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: job.id, category, source: "smarter-specialists-policy-check", result: "pass", summary: `${category} passed` })
);
assert.doesNotThrow(() => assertSafeRepairDeployReady(job, passingEvidence), "job with all passing evidence must be deploy-ready");
assert.throws(
  () => assertSafeRepairDeployReady(job, passingEvidence.slice(0, 1)),
  /SAFE_REPAIR_EVIDENCE_MISSING/,
  "job missing typecheck/build evidence must not be deploy-ready"
);
assert.throws(() => createSafeRepairJob({
  role: "SEO", initiatingSignal: "x", objective: "y", subsystem: "z",
  allowedFiles: ["a.ts"], estimatedLinesChanged: 1, acceptanceCriteria: ["ok"], findingId: "F-1"
}), /SAFE_REPAIR_ROLE_NOT_GRANTED/, "SEO must not create safe-repair jobs");
assert.throws(() => createSafeRepairJob({
  role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "y", subsystem: "z",
  allowedFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"], estimatedLinesChanged: 1, acceptanceCriteria: ["ok"], findingId: "F-1"
}), /SAFE_REPAIR_TOO_MANY_FILES/, "safe-repair must reject jobs touching more than 5 files");
assert.throws(() => createSafeRepairJob({
  role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "y", subsystem: "z",
  allowedFiles: ["a.ts"], estimatedLinesChanged: 1, acceptanceCriteria: ["ok"], findingId: "F-1", approvalCategory: "spending"
}), /SAFE_REPAIR_OWNER_APPROVAL_CATEGORY_FORBIDDEN/, "safe-repair must reject jobs carrying an owner-approval category");
console.log("  PASS safe-repair job lifecycle validated, misuse rejected");

// 7. revenueImpact fabrication guard: never invent metrics.
const impact = revenueImpact("high", "Broken checkout kills bookings.");
assert.equal(impact.level, "high", "revenueImpact must return the level");
assert.throws(() => revenueImpact("high", "Costs us $4,200 a month."), /FABRICATION/, "dollar amounts must be rejected");
assert.throws(() => revenueImpact("high", "Loses 30% of trials."), /FABRICATION/, "percentage figures must be rejected");
assert.throws(() => revenueImpact("high", ""), /RATIONALE_REQUIRED/, "empty rationale must be rejected");
console.log("  PASS revenueImpact fabrication guard holds");

console.log("[policy] smarter-specialists policy gate passed.");
