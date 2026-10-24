// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { assertSafeRepairDeployReady, roleMayReachLevel3, SAFE_REPAIR_CONSTRAINTS, SAFE_REPAIR_DEPLOY_EVIDENCE } from "./specialistOrganization.ts";
import type { OperationsEvidence, OperationsJob } from "./opsControlPlane.ts";

/**
 * Safe-repair packages (LEVEL_3_SAFE_REPAIR, gap auditor only).
 *
 * The Oct 15 finding was that Level-3 repair jobs "ran, marked completed,
 * and changed nothing": the control plane could prepare a repair but had
 * no validated path from a job to a shippable repair. This module is that
 * path — and its boundary:
 *
 * - A package is a PROPOSAL, not an application. It carries the patch
 *   shape (files + line counts), the acceptance criteria, and the
 *   evidence, and it is presented for the NORMAL PR rails with the
 *   owner's merge tap. The bot never pushes, commits, deploys, or applies
 *   the patch itself: `pushed` and `deployed` are always false.
 * - The worker ceiling (opsWorker WORKER_AUTHORITY_CEILING) still excludes
 *   LEVEL_3, and the auto-deploy machinery still ships disabled. Nothing
 *   here executes a repair.
 * - Every LEVEL_4 owner-approval gate stays intact: a package carrying an
 *   approval category, a migration, a secret-bearing path, or a protected
 *   file is refused, as is any package outside the job's allowed files,
 *   over 5 files, or over 200 lines.
 */

export type RepairPatchFile = {
  path: string;
  linesAdded: number;
  linesRemoved: number;
};

export type RepairPackage = {
  jobId: string;
  role: string;
  branch: string;
  title: string;
  body: string;
  files: string[];
  totalLinesChanged: number;
  acceptanceCriteria: string[];
  evidenceSummary: string[];
  state: "AWAITING_APPROVAL";
  revertible: true;
  pushed: false;
  deployed: false;
};

// Database migrations live under a migrations/ directory in this repo.
const MIGRATION_PATH = /(^|\/)migrations\//i;
// Secret-bearing paths, without flagging words that merely contain the
// substring (e.g. executiveSecretary.ts must NOT match "secret").
const SECRET_PATH = /(^|\/)\.env(\.|$)|(^|[^a-zA-Z])secret([^a-zA-Z]|$)|(^|[^a-zA-Z])credential([^a-zA-Z]|$)|(^|\/)id_rsa([^a-zA-Z]|$)|\.(pem|key)$/i;
// Standing house rule: this file is never modified in any release.
const PROTECTED_FILE = "lib/roamly/socialReelGenerator.ts";

export function repairPatchTotalLines(files: readonly RepairPatchFile[]): number {
  return files.reduce((total, file) => total + file.linesAdded + file.linesRemoved, 0);
}

/**
 * Refuse anything outside the bounded safe-repair contract. Each refusal
 * is a distinct error code so the caller can report exactly what was
 * refused and why — never a silent drop, never a partial package.
 */
export function validateRepairPackage(
  job: OperationsJob,
  files: readonly RepairPatchFile[],
  evidence: readonly OperationsEvidence[]
): void {
  if (job.authorityLevel !== "LEVEL_3_SAFE_REPAIR") throw new Error("SAFE_REPAIR_JOB_NOT_GRANTED");
  if (!roleMayReachLevel3(job.role)) throw new Error("SAFE_REPAIR_ROLE_NOT_GRANTED");
  if (job.ownerApprovalRequired) throw new Error("SAFE_REPAIR_OWNER_APPROVAL_REQUIRED");
  if ((job.scope as { safeRepair?: boolean } | null)?.safeRepair !== true) throw new Error("SAFE_REPAIR_SCOPE_FLAG_MISSING");
  if ((job.scope as { approvalCategory?: string | null } | null)?.approvalCategory != null) throw new Error("SAFE_REPAIR_APPROVAL_CATEGORY_FORBIDDEN");
  if (!Array.isArray(files) || files.length === 0) throw new Error("SAFE_REPAIR_SCOPE_EMPTY");
  if (files.length > SAFE_REPAIR_CONSTRAINTS.maxFilesChanged) throw new Error("SAFE_REPAIR_TOO_MANY_FILES");
  const allowed = new Set(job.allowedFiles);
  for (const file of files) {
    if (typeof file.path !== "string" || !file.path) throw new Error("SAFE_REPAIR_FILE_PATH_REQUIRED");
    if (!allowed.has(file.path)) throw new Error("SAFE_REPAIR_FILE_OUT_OF_SCOPE");
    if (MIGRATION_PATH.test(file.path)) throw new Error("SAFE_REPAIR_MIGRATION_FORBIDDEN");
    if (SECRET_PATH.test(file.path)) throw new Error("SAFE_REPAIR_SECRET_FORBIDDEN");
    if (file.path === PROTECTED_FILE) throw new Error("SAFE_REPAIR_PROTECTED_FILE");
    for (const count of [file.linesAdded, file.linesRemoved]) {
      if (!Number.isInteger(count) || count < 0) throw new Error("SAFE_REPAIR_LINES_INVALID");
    }
  }
  if (repairPatchTotalLines(files) > SAFE_REPAIR_CONSTRAINTS.maxLinesChanged) throw new Error("SAFE_REPAIR_TOO_MANY_LINES");
  // Evidence gates: deterministic_check + typecheck + build must all pass
  // for this job, or the package is refused (same gate as deploy readiness).
  assertSafeRepairDeployReady(job, [...evidence]);
}

/**
 * Build the PR-ready package for a validated repair. This performs no
 * push, commit, or deploy: the returned package waits in
 * AWAITING_APPROVAL for the normal PR rails and the owner's merge tap.
 */
export function buildRepairPackage(
  job: OperationsJob,
  files: readonly RepairPatchFile[],
  evidence: readonly OperationsEvidence[]
): RepairPackage {
  validateRepairPackage(job, files, evidence);
  const totalLinesChanged = repairPatchTotalLines(files);
  const evidenceSummary = SAFE_REPAIR_DEPLOY_EVIDENCE.map((category) => {
    const item = evidence.find((entry) => entry.jobId === job.id && entry.category === category);
    return `${category}: ${item ? item.result : "missing"}`;
  });
  const body = [
    "Safe repair prepared by the gap-audit bot under LEVEL_3_SAFE_REPAIR.",
    "",
    `Objective: ${job.objective}`,
    "",
    "Acceptance criteria:",
    ...job.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    `Files (${files.length}, ${totalLinesChanged} lines changed):`,
    ...files.map((file) => `- ${file.path} (+${file.linesAdded}/-${file.linesRemoved})`),
    "",
    `Evidence: ${evidenceSummary.join("; ")}.`,
    "",
    "Revertible: revert this PR to undo.",
    "This package was prepared, not applied: the bot never pushes, commits, or deploys. Merge only on the owner's tap."
  ].join("\n");
  return {
    jobId: job.id,
    role: job.role,
    branch: `flint/safe-repair/${job.id.slice(0, 8)}`,
    title: `Safe repair: ${job.objective}`,
    body,
    files: files.map((file) => file.path),
    totalLinesChanged,
    acceptanceCriteria: [...job.acceptanceCriteria],
    evidenceSummary,
    state: "AWAITING_APPROVAL",
    revertible: true,
    pushed: false,
    deployed: false
  };
}
