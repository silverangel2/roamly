import assert from "node:assert/strict";
import { createWorkerAssignment, SimulatedWorkerAdapter, WorkerLeaseRegistry } from "../lib/roamly/workerExecution.ts";
import { createOperationsJob, evidenceSatisfiesCompletion } from "../lib/roamly/opsControlPlane.ts";

const job = createOperationsJob({ role: "GAP_AUDIT_QA", initiatingSignal: "phase4_test", objective: "Run safe worker smoke", subsystem: "operations_worker", authorityLevel: "LEVEL_1_OBSERVE", status: "QUEUED", runnerId: "phase4.worker-contract-smoke", allowedOperations: ["read_approved_repository_state"], allowedFiles: ["lib/roamly/opsControlPlane.ts"], forbiddenOperations: ["production_mutation", "arbitrary_command"], evidenceRequirements: ["deterministic_check"], tokenBudget: 0, financialBudgetUsd: 0, maxAttempts: 1, cooldownUntil: null });
const plan = { jobId: job.id, specialist: "GAP_AUDIT_QA_RELIABILITY", authorityCeiling: "LEVEL_1_OBSERVE", allowedOperations: job.allowedOperations, forbiddenOperations: job.forbiddenOperations, evidenceRequirements: job.evidenceRequirements, acceptanceCriteria: ["deterministic evidence"], retryCeiling: 1, tokenBudget: 0, financialBudgetUsd: 0, ready: true };
const assignment = createWorkerAssignment({ job, plan, repository: "silverangel2/roamly", repositoryRevision: "9084539fd979e01ddfa06c966dcfaf37469e9ab1", executionTimeoutMs: 1000 });
assert.equal(assignment.network, "NONE");
assert.deepEqual(assignment.secrets, []);
assert.equal(assignment.repositoryRevision, "9084539fd979e01ddfa06c966dcfaf37469e9ab1");
const adapter = new SimulatedWorkerAdapter();
const success = await adapter.execute(assignment, { actualRevision: assignment.repositoryRevision });
assert.equal(success.state, "completed");
assert.equal(success.workspaceState, "DESTROYED");
assert.equal(success.evidence.cleanupState, "DESTROYED");
assert.equal(success.operationsEvidence.length, 1);
assert.equal(Object.hasOwn(success.operationsEvidence[0].metadata, "secrets"), false);
assert.throws(() => createWorkerAssignment({ job, plan, repository: "silverangel2/roamly", repositoryRevision: "latest" }), /IMMUTABLE_REVISION/);
assert.equal((await adapter.execute(assignment, { actualRevision: "different-sha" })).error, "WORKER_REVISION_MISMATCH");
assert.equal((await adapter.execute({ ...assignment, runnerId: "shell:rm -rf" }, { actualRevision: assignment.repositoryRevision })).error, "WORKER_RUNNER_NOT_REGISTERED");
assert.equal((await adapter.execute(assignment, { actualRevision: assignment.repositoryRevision, forceTimeout: true })).state, "failed");
assert.equal((await adapter.execute(assignment, { actualRevision: assignment.repositoryRevision, cancel: true })).state, "cancelled");
assert.equal((await adapter.execute(assignment, { actualRevision: assignment.repositoryRevision, cleanupFailure: true })).error, "WORKSPACE_CLEANUP_FAILED");
assert.equal((await adapter.execute({ ...assignment, financialBudgetUsd: 1 }, { actualRevision: assignment.repositoryRevision })).error, "WORKER_CAPABILITY_POLICY_REJECTED");
assert.equal(evidenceSatisfiesCompletion({ ...job, status: "VALIDATING" }, (await adapter.execute(assignment, { actualRevision: assignment.repositoryRevision, forceTimeout: true })).operationsEvidence), false, "failed worker has no completion evidence");
assert.throws(() => createWorkerAssignment({ job: { ...job, authorityLevel: "LEVEL_3_SAFE_REPAIR" }, plan, repository: "silverangel2/roamly", repositoryRevision: "sha-3" }), /AUTHORITY_CEILING/);
assert.throws(() => createWorkerAssignment({ job: { ...job, allowedFiles: ["../outside.ts"] }, plan, repository: "silverangel2/roamly", repositoryRevision: "sha-4" }), /FILE_SCOPE/);
const leases = new WorkerLeaseRegistry();
const first = leases.acquire(assignment, 1000, 10);
assert.ok(first);
assert.equal(leases.acquire({ ...assignment, assignmentId: "other" }, 1001, 10), null);
assert.equal(leases.valid(first, 1010), false);
assert.equal(leases.release(first), true);
const source = await import("node:fs/promises").then(({ readFile }) => Promise.all([
  readFile(new URL("../lib/roamly/workerExecution.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8")
]));
assert.doesNotMatch(source[0], /child_process|exec\(|spawn\(|eval\(/);
assert.doesNotMatch(source[1], /workerExecution|roamly_ops_/);
console.log("Roamly Phase 4 worker execution checks passed");
