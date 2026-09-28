import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LEGAL_TRANSITIONS,
  OperationsScheduler,
  budgetAllows,
  createEvidence,
  createOperationsJob,
  dispatchAllowed,
  evidenceSatisfiesCompletion,
  isRegisteredRunner,
  ownerApprovalRequired,
  retryAllowed,
  retryDelaySeconds,
  runRegisteredRunner,
  sanitizeOperationsMetadata,
  assertAuthorityUnchanged,
  transitionOperationsJob
} from "../lib/roamly/opsControlPlane.ts";

const base = createOperationsJob({ role: "GAP_AUDIT_QA", initiatingSignal: "scheduled_check", objective: "Run Phase 1 smoke", subsystem: "operations", runnerId: "phase1.policy-self-check", tokenBudget: 100, financialBudgetUsd: 0 });
assert.equal(transitionOperationsJob(base, "TRIAGED").status, "TRIAGED", "legal transition passes");
assert.throws(() => transitionOperationsJob(base, "COMPLETED"), /ILLEGAL_JOB_TRANSITION/);
assert.throws(() => transitionOperationsJob(transitionOperationsJob(base, "TRIAGED"), "RUNNING"), /ILLEGAL_JOB_TRANSITION/);
assert.throws(() => transitionOperationsJob({ ...base, status: "VALIDATING" }, "DEPLOYING"), /DEPLOYMENT_AUTHORITY_REQUIRED/);
assert.throws(() => assertAuthorityUnchanged(base, { ...base, authorityLevel: "LEVEL_2_DIAGNOSE" }), /JOB_AUTHORITY_IMMUTABLE/);
assert.equal(ownerApprovalRequired("database_migration", "LEVEL_1_OBSERVE"), true, "protected categories require owner approval");
assert.equal(ownerApprovalRequired(null, "LEVEL_4_OWNER_APPROVAL"), true, "Level 4 requires owner approval");
const protectedJob = createOperationsJob({ ...base, scope: { approvalCategory: "database_migration" } });
const protectedPlanned = transitionOperationsJob(transitionOperationsJob(transitionOperationsJob(protectedJob, "TRIAGED"), "PLANNED"), "AWAITING_APPROVAL");
assert.equal(protectedPlanned.status, "AWAITING_APPROVAL");
assert.equal(evidenceSatisfiesCompletion({ ...base, status: "VERIFYING", evidenceRequirements: ["deterministic_check"] }, [], null), false, "missing evidence cannot complete");
const evidence = createEvidence({ jobId: base.id, category: "deterministic_check", source: "phase1-test", result: "pass", summary: "passed" });
assert.equal(evidenceSatisfiesCompletion({ ...base, status: "VERIFYING", evidenceRequirements: ["deterministic_check"] }, [evidence], null), true);
assert.equal(evidenceSatisfiesCompletion({ ...base, status: "VERIFYING", ownerApprovalRequired: true, evidenceRequirements: ["deterministic_check"] }, [evidence], null), false, "approval must be durable and explicit");
assert.throws(() => sanitizeOperationsMetadata({ token: "secret" }), /SENSITIVE_EVIDENCE_KEY_REJECTED/);
assert.throws(() => sanitizeOperationsMetadata({ nested: { value: true } }), /EVIDENCE_VALUE_NOT_SCALAR/);
assert.equal(retryAllowed({ retryCount: 0, maxAttempts: 2 }), true);
assert.equal(retryAllowed({ retryCount: 1, maxAttempts: 2 }), false);
assert.equal(retryDelaySeconds(3), 120);
assert.equal(budgetAllows({ tokenBudget: 10, financialBudgetUsd: 1 }, { tokens: 11, financialCostUsd: 0 }), false);
assert.equal(budgetAllows({ tokenBudget: 10, financialBudgetUsd: 1 }, { tokens: 10, financialCostUsd: 1 }), true);
assert.equal(isRegisteredRunner("phase1.policy-self-check"), true);
assert.equal(isRegisteredRunner("shell:rm -rf"), false, "arbitrary runners are not registered");
assert.equal(runRegisteredRunner("phase1.policy-self-check").metadata.mutatesProduction, false);
const scheduler = new OperationsScheduler();
assert.equal(scheduler.enqueue(base), true);
const duplicate = createOperationsJob({ role: base.role, initiatingSignal: base.initiatingSignal, objective: base.objective, subsystem: base.subsystem, runnerId: base.runnerId });
assert.equal(scheduler.enqueue(duplicate), false, "duplicate jobs are suppressed");
assert.equal(scheduler.acquire(base.id, "operations"), true);
assert.equal(scheduler.acquire(duplicate.id, "operations"), false, "conflicting subsystem jobs cannot overlap");
assert.equal(scheduler.acquire(duplicate.id, "seo"), true, "independent subsystems can proceed");
assert.equal(dispatchAllowed({ ...base, status: "QUEUED" }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 1, financialCostUsd: 0 } }), true);
assert.equal(dispatchAllowed({ ...base, status: "QUEUED", authorityLevel: "LEVEL_2_DIAGNOSE" }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {} }), false, "Phase 1 dispatch is Level 1 only");

const [migration, api, customerRoute, core] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260928000300_roamly_autonomous_operations_phase1.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/roamly/operations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/opsControlPlane.ts", import.meta.url), "utf8")
]);
for (const table of ["roamly_ops_jobs", "roamly_ops_attempts", "roamly_ops_evidence", "roamly_ops_locks", "roamly_ops_owner_decisions"]) assert.match(migration, new RegExp(table));
assert.match(migration, /revoke all on public\.roamly_ops_jobs[\s\S]*authenticated/);
assert.match(api, /requireRoamlyAdmin/);
assert.doesNotMatch(api, /POST|PUT|PATCH|DELETE/);
assert.doesNotMatch(core, /node:child_process|child_process|exec\(|spawn\(|execFile\(/);
assert.match(core, /REGISTERED_RUNNERS/);
assert.doesNotMatch(customerRoute, /roamly_ops_/);
console.log("Roamly Phase 1 operations control-plane checks passed");
