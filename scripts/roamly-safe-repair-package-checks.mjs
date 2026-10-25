import assert from "node:assert/strict";
import { createEvidence } from "../lib/roamly/opsControlPlane.ts";
import {
  LEVEL_3_SAFE_REPAIR_ROLES,
  SAFE_REPAIR_ALLOWED_OPERATIONS,
  SAFE_REPAIR_CONSTRAINTS,
  SAFE_REPAIR_FORBIDDEN_OPERATIONS,
  createSafeRepairJob,
  roleMayReachLevel3
} from "../lib/roamly/specialistOrganization.ts";
import { executiveCanPerform } from "../lib/roamly/executiveSecretary.ts";
import { buildRepairPackage } from "../lib/roamly/safeRepairPackage.ts";

/**
 * Safe-repair package gate (LEVEL_3, 2026-10-24 correction): Level 3 goes
 * to the bots that need frequent coding — the gap auditor only. The
 * secretary coordinates and does not code. A bounded repair job must
 * prepare + validate end-to-end as a PR-ready package (never pushed or
 * deployed by the bot), and every out-of-scope package must be refused
 * with a distinct reason.
 */

console.log("[policy] safe-repair packages: gap auditor only, bounded, PR-rails only");

// 1. Roster: gap auditor only; secretary and every other role excluded.
assert.deepEqual([...LEVEL_3_SAFE_REPAIR_ROLES], ["GAP_AUDIT_QA"], "level-3 roster must be the gap auditor only");
assert.equal(roleMayReachLevel3("GAP_AUDIT_QA"), true, "gap auditor reaches level 3");
assert.equal(roleMayReachLevel3("EXECUTIVE_SECRETARY"), false, "secretary must not reach level 3");
assert.equal(roleMayReachLevel3("SEO"), false, "SEO must not reach level 3");
assert.equal(roleMayReachLevel3("UX"), false, "UX must not reach level 3");
assert.equal(SAFE_REPAIR_CONSTRAINTS.maxFilesChanged, 5, "at most 5 files");
assert.equal(SAFE_REPAIR_CONSTRAINTS.maxLinesChanged, 200, "at most 200 lines");
console.log("  PASS level-3 roster is the gap auditor only");

// 2. The bot's own allowed operations never include push/deploy: the
// package is a proposal for the PR rails, never an application.
for (const operation of ["code_edit", "commit", "push", "deploy", "production_mutation"]) {
  assert.ok(!SAFE_REPAIR_ALLOWED_OPERATIONS.includes(operation), `safe repair must not allow ${operation}`);
  assert.ok(SAFE_REPAIR_FORBIDDEN_OPERATIONS.includes(operation), `safe repair must forbid ${operation}`);
}
console.log("  PASS bot authority never includes code_edit/commit/push/deploy");

// 3. Secretary coordinates, does not code: briefs are fine, patches are not.
assert.equal(executiveCanPerform("prepare bounded safe repair brief"), true, "secretary may prepare a brief");
assert.equal(executiveCanPerform("prepare bounded safe repair"), false, "secretary must not prepare a patch");
assert.equal(executiveCanPerform("validate bounded safe-repair evidence"), true, "secretary may validate evidence for briefings");
assert.equal(executiveCanPerform("deploy bounded safe repair"), false, "secretary must never deploy");
console.log("  PASS secretary coordinates, does not code");

// 4. End-to-end: a real LEVEL_3 job prepares + validates as a PR-ready
// package that waits for the owner's merge tap — never pushed, never deployed.
const job = createSafeRepairJob({
  role: "GAP_AUDIT_QA",
  initiatingSignal: "deterministic_check:example",
  objective: "Safe repair: example finding",
  subsystem: "operations_control_plane",
  allowedFiles: ["lib/roamly/example.ts"],
  estimatedLinesChanged: 40,
  acceptanceCriteria: ["Re-run the failed deterministic check with a passing result."],
  findingId: "GAP-example",
  approvalCategory: null
});
assert.equal(job.authorityLevel, "LEVEL_3_SAFE_REPAIR", "job must be LEVEL_3_SAFE_REPAIR");
assert.equal(job.runnerId, "phase2.gap-audit.safe-repair", "job must use the gap-audit safe-repair runner");
assert.equal(job.ownerApprovalRequired, false, "bounded job must not require owner approval");

const evidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: job.id, category, source: "proof", result: "pass", summary: `${category} passed` })
);
const pkg = buildRepairPackage(
  job,
  [{ path: "lib/roamly/example.ts", linesAdded: 30, linesRemoved: 10 }],
  evidence
);
assert.equal(pkg.state, "AWAITING_APPROVAL", "package must wait for the owner's merge tap");
assert.equal(pkg.pushed, false, "package must never be pushed by the bot");
assert.equal(pkg.deployed, false, "package must never be deployed by the bot");
assert.equal(pkg.revertible, true, "package must be revertible");
assert.deepEqual(pkg.files, ["lib/roamly/example.ts"], "package files must match the patch");
assert.equal(pkg.totalLinesChanged, 40, "package line count must be added + removed");
assert.ok(pkg.branch.startsWith("flint/safe-repair/"), "package must name its PR branch");
assert.ok(pkg.body.includes("never pushes, commits, or deploys"), "package body must state the bot boundary");
console.log("  PASS bounded repair job prepares + validates end-to-end as a PR-ready package");

// 5. Refusals: every out-of-scope shape is refused with a distinct reason.
const baseJob = (overrides = {}) => ({ ...job, ...overrides });
const fullEvidence = evidence;
assert.throws(
  () => createSafeRepairJob({ role: "EXECUTIVE_SECRETARY", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["a.ts"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null }),
  /SAFE_REPAIR_ROLE_NOT_GRANTED/,
  "secretary must not create a level-3 job"
);
assert.throws(
  () => createSafeRepairJob({ role: "SEO", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["a.ts"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null }),
  /SAFE_REPAIR_ROLE_NOT_GRANTED/,
  "SEO must not create a level-3 job"
);
assert.throws(
  () => createSafeRepairJob({ role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["a.ts"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: "spending" }),
  /SAFE_REPAIR_OWNER_APPROVAL_CATEGORY_FORBIDDEN/,
  "an L4 category must be refused at job creation"
);
assert.throws(
  () => buildRepairPackage(baseJob({ authorityLevel: "LEVEL_2_DIAGNOSE" }), [{ path: "lib/roamly/example.ts", linesAdded: 1, linesRemoved: 0 }], fullEvidence),
  /SAFE_REPAIR_JOB_NOT_GRANTED/,
  "a non-level-3 job must not package"
);
assert.throws(
  () => buildRepairPackage(baseJob({ ownerApprovalRequired: true }), [{ path: "lib/roamly/example.ts", linesAdded: 1, linesRemoved: 0 }], fullEvidence),
  /SAFE_REPAIR_OWNER_APPROVAL_REQUIRED/,
  "an owner-approval job must not package as safe repair"
);
assert.throws(
  () => buildRepairPackage(baseJob({ scope: { ...job.scope, approvalCategory: "database_migration" } }), [{ path: "lib/roamly/example.ts", linesAdded: 1, linesRemoved: 0 }], fullEvidence),
  /SAFE_REPAIR_APPROVAL_CATEGORY_FORBIDDEN/,
  "an L4 approval category must be refused in the package"
);
assert.throws(
  () => buildRepairPackage(job, [], fullEvidence),
  /SAFE_REPAIR_SCOPE_EMPTY/,
  "an empty patch must be refused"
);
assert.throws(
  () => buildRepairPackage(job, [1, 2, 3, 4, 5, 6].map((n) => ({ path: `lib/roamly/f${n}.ts`, linesAdded: 1, linesRemoved: 0 })), fullEvidence),
  /SAFE_REPAIR_TOO_MANY_FILES/,
  "a 6th file must be refused"
);
assert.throws(
  () => buildRepairPackage(job, [{ path: "lib/roamly/example.ts", linesAdded: 201, linesRemoved: 0 }], fullEvidence),
  /SAFE_REPAIR_TOO_MANY_LINES/,
  "over 200 lines must be refused"
);
assert.throws(
  () => buildRepairPackage(job, [{ path: "lib/roamly/other.ts", linesAdded: 1, linesRemoved: 0 }], fullEvidence),
  /SAFE_REPAIR_FILE_OUT_OF_SCOPE/,
  "a file outside allowedFiles must be refused"
);
const migrationJob = createSafeRepairJob({ role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["supabase/migrations/20261024_example.sql"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null });
const migrationEvidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: migrationJob.id, category, source: "proof", result: "pass", summary: `${category} passed` })
);
assert.throws(
  () => buildRepairPackage(migrationJob, [{ path: "supabase/migrations/20261024_example.sql", linesAdded: 10, linesRemoved: 0 }], migrationEvidence),
  /SAFE_REPAIR_MIGRATION_FORBIDDEN/,
  "a migration must be refused even when listed in allowedFiles"
);
const secretJob = createSafeRepairJob({ role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: [".env.local"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null });
const secretEvidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: secretJob.id, category, source: "proof", result: "pass", summary: `${category} passed` })
);
assert.throws(
  () => buildRepairPackage(secretJob, [{ path: ".env.local", linesAdded: 10, linesRemoved: 0 }], secretEvidence),
  /SAFE_REPAIR_SECRET_FORBIDDEN/,
  "a secret-bearing path must be refused"
);
const protectedJob = createSafeRepairJob({ role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["lib/roamly/socialReelGenerator.ts"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null });
const protectedEvidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: protectedJob.id, category, source: "proof", result: "pass", summary: `${category} passed` })
);
assert.throws(
  () => buildRepairPackage(protectedJob, [{ path: "lib/roamly/socialReelGenerator.ts", linesAdded: 10, linesRemoved: 0 }], protectedEvidence),
  /SAFE_REPAIR_PROTECTED_FILE/,
  "the protected reel generator must be refused"
);
assert.throws(
  () => buildRepairPackage(job, [{ path: "lib/roamly/example.ts", linesAdded: 1, linesRemoved: 0 }], evidence.slice(0, 2)),
  /SAFE_REPAIR_EVIDENCE_MISSING:build/,
  "missing build evidence must be refused"
);
// Guard against over-broad secret matching: the secretary module's own
// name contains "secret" as a substring and must NOT be flagged.
const secretaryJob = createSafeRepairJob({ role: "GAP_AUDIT_QA", initiatingSignal: "x", objective: "x", subsystem: "s", allowedFiles: ["lib/roamly/executiveSecretary.ts"], estimatedLinesChanged: 10, acceptanceCriteria: ["ok"], approvalCategory: null });
const secretaryEvidence = ["deterministic_check", "typecheck", "build"].map((category) =>
  createEvidence({ jobId: secretaryJob.id, category, source: "proof", result: "pass", summary: `${category} passed` })
);
const secretaryPkg = buildRepairPackage(secretaryJob, [{ path: "lib/roamly/executiveSecretary.ts", linesAdded: 5, linesRemoved: 5 }], secretaryEvidence);
assert.equal(secretaryPkg.state, "AWAITING_APPROVAL", "a legitimate file whose name contains 'secret' must not be flagged");
console.log("  PASS all refusal cases refused with distinct reasons");

console.log("PASS roamly-safe-repair-package-checks");
