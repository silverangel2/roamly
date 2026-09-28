// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { createEvidence, isRegisteredRunner, runRegisteredRunner, type AutonomyLevel, type DeterministicRunnerResult, type OperationsEvidence, type OperationsJob } from "./opsControlPlane.ts";

export const WORKER_PROVIDERS = ["simulated-local"] as const;
export type WorkerProvider = typeof WORKER_PROVIDERS[number];
export const WORKSPACE_STATES = ["ALLOCATED", "PREPARING", "READY", "RUNNING", "VALIDATING", "RETURNING_EVIDENCE", "DESTROYING", "DESTROYED"] as const;
export type WorkspaceState = typeof WORKSPACE_STATES[number];
export type WorkerResultState = "completed" | "failed" | "blocked" | "cancelled" | "rejected";
export type NetworkCapability = "NONE";

export type WorkerAssignment = {
  assignmentId: string;
  jobId: string;
  attemptId: string;
  specialist: string;
  authorityCeiling: AutonomyLevel;
  objective: string;
  repository: string;
  repositoryRevision: string;
  subsystem: string;
  allowedOperations: string[];
  forbiddenOperations: string[];
  allowedFiles: string[];
  runnerId: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  evidenceRequirements: OperationsJob["evidenceRequirements"];
  tokenBudget: number;
  financialBudgetUsd: number;
  executionTimeoutMs: number;
  maxAttempts: number;
  attemptNumber: number;
  network: NetworkCapability;
  secrets: [];
  provider: WorkerProvider;
};

export type WorkerEvidence = {
  provider: WorkerProvider;
  assignmentId: string;
  jobId: string;
  attemptId: string;
  repositoryRevision: string;
  runnerId: string;
  state: WorkerResultState;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  cleanupState: WorkspaceState;
  resourceUsage: { tokens: number; financialCostUsd: number };
  summary: string;
};

export interface WorkerAdapter {
  execute(assignment: WorkerAssignment, options?: { actualRevision?: string; now?: number; cancel?: boolean; forceTimeout?: boolean; cleanupFailure?: boolean }): Promise<WorkerExecutionResult>;
}

export type WorkerExecutionResult = {
  state: WorkerResultState;
  evidence: WorkerEvidence;
  operationsEvidence: OperationsEvidence[];
  workspaceState: WorkspaceState;
  leaseId: string | null;
  error: string | null;
};

type Lease = { leaseId: string; assignmentId: string; jobId: string; subsystem: string; expiresAt: number; released: boolean };

function id(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function authorityRank(level: AutonomyLevel) { return level === "LEVEL_1_OBSERVE" ? 1 : level === "LEVEL_2_DIAGNOSE" ? 2 : level === "LEVEL_3_SAFE_REPAIR" ? 3 : 4; }

export function createWorkerAssignment(input: {
  job: OperationsJob;
  plan: { jobId: string; specialist: string; authorityCeiling: AutonomyLevel; allowedOperations: string[]; forbiddenOperations: string[]; evidenceRequirements: OperationsJob["evidenceRequirements"]; acceptanceCriteria: string[]; retryCeiling: number; tokenBudget: number; financialBudgetUsd: number; ready: boolean };
  repository: string;
  repositoryRevision: string;
  attemptId?: string;
  attemptNumber?: number;
  executionTimeoutMs?: number;
}): WorkerAssignment {
  const { job, plan } = input;
  if (!plan.ready || plan.jobId !== job.id) throw new Error("WORKER_PLAN_NOT_READY");
  if (authorityRank(job.authorityLevel) > 2 || authorityRank(plan.authorityCeiling) > 2) throw new Error("WORKER_AUTHORITY_CEILING_EXCEEDED");
  if (!job.runnerId || !isRegisteredRunner(job.runnerId)) throw new Error("WORKER_RUNNER_NOT_REGISTERED");
  if (plan.authorityCeiling !== job.authorityLevel || plan.tokenBudget !== job.tokenBudget || plan.financialBudgetUsd !== job.financialBudgetUsd) throw new Error("WORKER_POLICY_MISMATCH");
  if (!input.repositoryRevision || input.repositoryRevision === "main" || input.repositoryRevision === "latest") throw new Error("WORKER_IMMUTABLE_REVISION_REQUIRED");
  if (input.plan.allowedOperations.some((operation) => job.forbiddenOperations.includes(operation)) || input.plan.allowedOperations.some((operation) => !job.allowedOperations.includes(operation))) throw new Error("WORKER_OPERATION_SCOPE_INVALID");
  if (job.allowedFiles.some((file) => file.startsWith("/") || file.split("/").includes(".."))) throw new Error("WORKER_FILE_SCOPE_INVALID");
  const timeout = input.executionTimeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 300_000) throw new Error("WORKER_TIMEOUT_INVALID");
  if (job.retryCount + 1 > job.maxAttempts || (input.attemptNumber || 1) > job.maxAttempts) throw new Error("WORKER_ATTEMPT_LIMIT_EXCEEDED");
  return {
    assignmentId: id("assignment"), jobId: job.id, attemptId: input.attemptId || id("attempt"), specialist: plan.specialist,
    authorityCeiling: job.authorityLevel, objective: job.objective, repository: input.repository, repositoryRevision: input.repositoryRevision,
    subsystem: job.subsystem, allowedOperations: [...plan.allowedOperations], forbiddenOperations: [...plan.forbiddenOperations], allowedFiles: [...job.allowedFiles],
    runnerId: job.runnerId, dependencies: [...job.dependencies], acceptanceCriteria: [...plan.acceptanceCriteria], evidenceRequirements: [...plan.evidenceRequirements],
    tokenBudget: job.tokenBudget, financialBudgetUsd: job.financialBudgetUsd, executionTimeoutMs: timeout, maxAttempts: job.maxAttempts,
    attemptNumber: input.attemptNumber || job.retryCount + 1, network: "NONE", secrets: [], provider: "simulated-local"
  };
}

export class WorkerLeaseRegistry {
  private readonly leases = new Map<string, Lease>();
  acquire(assignment: WorkerAssignment, now = Date.now(), durationMs = assignment.executionTimeoutMs + 5_000) {
    const current = this.leases.get(assignment.subsystem);
    if (current && !current.released) return null;
    const lease = { leaseId: id("lease"), assignmentId: assignment.assignmentId, jobId: assignment.jobId, subsystem: assignment.subsystem, expiresAt: now + durationMs, released: false };
    this.leases.set(assignment.subsystem, lease);
    return lease;
  }
  valid(lease: Lease | null, now = Date.now()) { return Boolean(lease && !lease.released && lease.expiresAt > now && this.leases.get(lease.subsystem)?.leaseId === lease.leaseId); }
  release(lease: Lease | null) { if (!lease) return false; const current = this.leases.get(lease.subsystem); if (!current || current.leaseId !== lease.leaseId || current.released) return false; current.released = true; this.leases.delete(lease.subsystem); return true; }
  expire(lease: Lease | null, now = Date.now()) { return Boolean(lease && lease.expiresAt <= now); }
}

class SimulatedWorkspace {
  state: WorkspaceState = "ALLOCATED";
  readonly assignmentId: string;
  readonly revision: string;
  private readonly cleanupFailure: boolean;
  constructor(assignmentId: string, revision: string, cleanupFailure: boolean) { this.assignmentId = assignmentId; this.revision = revision; this.cleanupFailure = cleanupFailure; }
  prepare(expectedRevision: string) { if (this.revision !== expectedRevision) throw new Error("WORKSPACE_REVISION_MISMATCH"); this.state = "PREPARING"; this.state = "READY"; }
  start() { if (this.state !== "READY") throw new Error("WORKSPACE_NOT_READY"); this.state = "RUNNING"; }
  validate() { this.state = "VALIDATING"; }
  returnEvidence() { this.state = "RETURNING_EVIDENCE"; }
  destroy() { this.state = "DESTROYING"; if (this.cleanupFailure) throw new Error("WORKSPACE_CLEANUP_FAILED"); this.state = "DESTROYED"; }
}

export class SimulatedWorkerAdapter implements WorkerAdapter {
  private readonly leases: WorkerLeaseRegistry;
  private readonly active = new Set<string>();
  constructor(leases = new WorkerLeaseRegistry()) { this.leases = leases; }
  async execute(assignment: WorkerAssignment, options: { actualRevision?: string; now?: number; cancel?: boolean; forceTimeout?: boolean; cleanupFailure?: boolean } = {}): Promise<WorkerExecutionResult> {
    const started = Date.now();
    const now = options.now || Date.now();
    const key = `${assignment.jobId}:${assignment.attemptId}`;
    const base = (state: WorkerResultState, summary: string, workspaceState: WorkspaceState, leaseId: string | null, error: string | null, ops: OperationsEvidence[] = []): WorkerExecutionResult => ({ state, workspaceState, leaseId, error, operationsEvidence: ops, evidence: { provider: assignment.provider, assignmentId: assignment.assignmentId, jobId: assignment.jobId, attemptId: assignment.attemptId, repositoryRevision: assignment.repositoryRevision, runnerId: assignment.runnerId, state, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), durationMs: Date.now() - started, cleanupState: workspaceState, resourceUsage: { tokens: 0, financialCostUsd: 0 }, summary } });
    if (this.active.has(key)) return base("rejected", "Duplicate worker dispatch suppressed.", "DESTROYED", null, "WORKER_DUPLICATE_DISPATCH");
    if (options.actualRevision && options.actualRevision !== assignment.repositoryRevision) return base("rejected", "Worker assignment revision does not match the checked-out revision.", "DESTROYED", null, "WORKER_REVISION_MISMATCH");
    if (assignment.network !== "NONE" || assignment.secrets.length || assignment.financialBudgetUsd > 0) return base("rejected", "Simulated worker policy permits no network, secrets, or paid execution.", "DESTROYED", null, "WORKER_CAPABILITY_POLICY_REJECTED");
    if (!isRegisteredRunner(assignment.runnerId)) return base("rejected", "Runner is not registered.", "DESTROYED", null, "WORKER_RUNNER_NOT_REGISTERED");
    this.active.add(key);
    const lease = this.leases.acquire(assignment, now);
    if (!lease) { this.active.delete(key); return base("rejected", "Worker lease is already owned by another assignment.", "DESTROYED", null, "WORKER_LEASE_CONFLICT"); }
    const workspace = new SimulatedWorkspace(assignment.assignmentId, assignment.repositoryRevision, Boolean(options.cleanupFailure));
    let result = base("failed", "Worker failed before producing evidence.", workspace.state, lease.leaseId, "WORKER_NOT_RUN");
    try {
      if (!this.leases.valid(lease, now)) throw new Error("WORKER_LEASE_EXPIRED");
      workspace.prepare(assignment.repositoryRevision);
      workspace.start();
      if (options.cancel) { result = base("cancelled", "Worker execution cancelled before runner execution.", workspace.state, lease.leaseId, "WORKER_CANCELLED"); return result; }
      if (options.forceTimeout) { await new Promise((resolve) => setTimeout(resolve, Math.min(assignment.executionTimeoutMs, 20))); throw new Error("WORKER_TIMEOUT"); }
      const runner: DeterministicRunnerResult = runRegisteredRunner(assignment.runnerId as never);
      workspace.validate();
      if (!runner.ok) throw new Error("WORKER_RUNNER_FAILED");
      workspace.returnEvidence();
      const evidence = createEvidence({ jobId: assignment.jobId, category: "deterministic_check", source: `worker:${assignment.provider}`, result: "pass", summary: runner.summary, metadata: { runnerId: assignment.runnerId, repositoryRevision: assignment.repositoryRevision, network: "NONE" } });
      result = base("completed", runner.summary, workspace.state, lease.leaseId, null, [evidence]);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "WORKER_FAILED";
      result = base(message === "WORKER_CANCELLED" ? "cancelled" : message === "WORKER_TIMEOUT" ? "failed" : "failed", "Worker did not satisfy deterministic completion.", workspace.state, lease.leaseId, message);
      return result;
    } finally {
      try { workspace.destroy(); result.workspaceState = workspace.state; result.evidence.cleanupState = workspace.state; }
      catch (error) { result.state = "failed"; result.error = error instanceof Error ? error.message : "WORKSPACE_CLEANUP_FAILED"; result.workspaceState = workspace.state; result.evidence.cleanupState = workspace.state; }
      this.leases.release(lease);
      this.active.delete(key);
    }
  }
}
