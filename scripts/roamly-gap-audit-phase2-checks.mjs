import assert from "node:assert/strict";
import { runGapAuditChecks, observeGapAudit, diagnoseGapAuditFinding } from "../lib/roamly/gapAuditSpecialist.ts";
import { createOperationsJob, dispatchAllowed, transitionOperationsJob } from "../lib/roamly/opsControlPlane.ts";

const healthy = {
  controlPlane: 'allowedAuthorityLevels isRegisteredRunner(job.runnerId) "LEVEL_1_OBSERVE" SENSITIVE_EVIDENCE_KEY_REJECTED EVIDENCE_VALUE_NOT_SCALAR',
  operationsApi: 'requireRoamlyAdmin export async function GET',
  customerRoute: 'export async function POST() { return "customer route"; }'
};
const failure = { ...healthy, operationsApi: 'export async function POST() { return "mutating"; }' };

const healthyObservation = observeGapAudit(healthy);
assert.equal(healthyObservation.findings.length, 0, "healthy checks must not create findings");
assert.equal(healthyObservation.jobs.length, 0, "healthy checks must not create jobs");

const failedObservation = observeGapAudit(failure);
assert.equal(failedObservation.findings.length, 1, "a deterministic failure creates one finding");
assert.equal(failedObservation.jobs.length, 1, "a deterministic failure creates one bounded job");
assert.equal(failedObservation.evidence.length, 1);
assert.equal(failedObservation.jobs[0].authorityLevel, "LEVEL_1_OBSERVE");
assert.equal(failedObservation.jobs[0].runnerId, "phase2.gap-audit.observe");

const duplicateObservation = observeGapAudit(failure, failedObservation.scheduler);
assert.equal(duplicateObservation.jobs.length, 0, "duplicate findings are suppressed by the existing scheduler");
assert.equal(dispatchAllowed({ ...failedObservation.jobs[0], status: "QUEUED" }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, allowedAuthorityLevels: ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"] }), true);
assert.equal(dispatchAllowed({ ...failedObservation.jobs[0], status: "QUEUED", authorityLevel: "LEVEL_3_SAFE_REPAIR" }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, allowedAuthorityLevels: ["LEVEL_1_OBSERVE", "LEVEL_2_DIAGNOSE"] }), false, "specialist cannot escalate to Level 3");

const diagnosisJob = createOperationsJob({ role: "GAP_AUDIT_QA", initiatingSignal: "diagnose", objective: "Diagnose bounded finding", subsystem: "operations_admin", authorityLevel: "LEVEL_2_DIAGNOSE", runnerId: "phase2.gap-audit.diagnose", allowedOperations: ["read_approved_repository_state", "record_deterministic_evidence"] });
const plannedDiagnosis = transitionOperationsJob(transitionOperationsJob(transitionOperationsJob(diagnosisJob, "TRIAGED"), "PLANNED"), "QUEUED");
const diagnosis = diagnoseGapAuditFinding(failedObservation.findings[0], plannedDiagnosis);
assert.equal(diagnosis.authorityLevel, "LEVEL_2_DIAGNOSE");
assert.equal(diagnosis.ownerApprovalRequired, false);
assert.throws(() => diagnoseGapAuditFinding(failedObservation.findings[0], { ...plannedDiagnosis, role: "SEO" }), /GAP_AUDIT_DIAGNOSIS_AUTHORITY_REQUIRED/);
assert.throws(() => diagnoseGapAuditFinding(failedObservation.findings[0], { ...plannedDiagnosis, allowedOperations: ["code_edit"] }), /GAP_AUDIT_DIAGNOSIS_SCOPE_INVALID/);

const source = await import("node:fs/promises").then(({ readFile }) => Promise.all([
  readFile(new URL("../lib/roamly/gapAuditSpecialist.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/roamly/operations/route.ts", import.meta.url), "utf8")
]));
assert.match(source[0], /phase2\.gap-audit\.observe/);
assert.match(source[0], /assertAuthorityUnchanged/);
assert.match(source[1], /requireRoamlyAdmin/);
assert.doesNotMatch(source[0], /child_process|exec\(|spawn\(|shell/);
console.log("Roamly Phase 2 Gap Audit specialist checks passed");
