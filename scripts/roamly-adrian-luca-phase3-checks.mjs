import assert from "node:assert/strict";
import { adrianTriage, lucaDispatchAllowed, lucaPlan } from "../lib/roamly/adrianLucaOrchestration.ts";
import { OperationsScheduler, createOperationsJob, dispatchAllowed } from "../lib/roamly/opsControlPlane.ts";

const scheduler = new OperationsScheduler();
const signal = { signalId: "signal-1", source: "deterministic_check", code: "gap.audit.failed", objective: "Diagnose bounded deterministic failure", subsystem: "operations_control_plane", specialist: "GAP_AUDIT_QA_RELIABILITY", requestedAuthority: "LEVEL_2_DIAGNOSE", tokenBudget: 0, financialBudgetUsd: 0, attemptCeiling: 1 };
const triage = adrianTriage(signal, scheduler, Date.parse("2026-09-28T12:00:00Z"));
assert.equal(triage.accepted, true, "valid signal is triaged");
assert.equal(triage.job?.authorityLevel, "LEVEL_2_DIAGNOSE");
assert.equal(triage.job?.runnerId, "phase2.gap-audit.diagnose");
assert.equal(triage.job?.tokenBudget, 0);

assert.equal(adrianTriage(signal, scheduler).accepted, false, "duplicate signal is suppressed");
assert.equal(adrianTriage({ ...signal, specialist: "SEO" }, new OperationsScheduler()).reason, "UNKNOWN_SPECIALIST");
assert.equal(adrianTriage({ ...signal, requestedAuthority: "LEVEL_3_SAFE_REPAIR" }, new OperationsScheduler()).reason, "AUTHORITY_EXCEEDS_PHASE3_POLICY");
assert.equal(adrianTriage({ ...signal, tokenBudget: 1 }, new OperationsScheduler()).reason, "BUDGET_EXCEEDS_SPECIALIST_POLICY");
assert.equal(adrianTriage({ ...signal, approvalCategory: "database_migration" }, new OperationsScheduler()).ownerApprovalRequired, true, "owner-gated work is identified");

const plan = lucaPlan(triage.job, {}, []);
assert.equal(plan.ready, true);
assert.deepEqual(plan.orderedSteps, ["verify_dependencies", "acquire_subsystem_lock", "run_registered_specialist", "record_deterministic_evidence", "validate_completion"]);
assert.equal(plan.authorityCeiling, triage.job.authorityLevel);
assert.equal(plan.tokenBudget, triage.job.tokenBudget);
assert.deepEqual(plan.evidenceRequirements, triage.job.evidenceRequirements);
assert.equal(lucaDispatchAllowed(plan, triage.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), true);

const dependencyJob = createOperationsJob({ ...triage.job, id: undefined, dependencies: ["dependency-1"] });
const blockedPlan = lucaPlan({ ...dependencyJob, status: "QUEUED" }, { "dependency-1": "RUNNING" }, []);
assert.equal(blockedPlan.ready, false);
assert.equal(blockedPlan.blockedReason, "DEPENDENCY_NOT_COMPLETED");
const lockPlan = lucaPlan({ ...dependencyJob, status: "QUEUED", dependencies: [] }, {}, [dependencyJob.subsystem]);
assert.equal(lockPlan.ready, false);
assert.equal(lockPlan.blockedReason, "SUBSYSTEM_LOCK_CONFLICT");
assert.equal(dispatchAllowed({ ...triage.job, status: "QUEUED", ownerApprovalRequired: true }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, allowedAuthorityLevels: ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"] }), false);
assert.equal(lucaDispatchAllowed({ ...plan, tokenBudget: 1 }, triage.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 1, financialCostUsd: 0 } }), false, "plan cannot bypass job budget");
assert.equal(lucaDispatchAllowed({ ...plan, authorityCeiling: "LEVEL_3_SAFE_REPAIR" }, triage.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), true, "plan metadata cannot grant authority beyond the job");

const source = await import("node:fs/promises").then(({ readFile }) => Promise.all([
  readFile(new URL("../lib/roamly/adrianLucaOrchestration.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8")
]));
assert.match(source[0], /SPECIALIST_REGISTRY/);
assert.match(source[0], /LEVEL_2_DIAGNOSE/);
assert.doesNotMatch(source[0], /child_process|exec\(|spawn\(|shell/);
assert.doesNotMatch(source[1], /roamly_ops_|adrianLucaOrchestration/);
console.log("Roamly Adrian/Luca Phase 3 checks passed");
