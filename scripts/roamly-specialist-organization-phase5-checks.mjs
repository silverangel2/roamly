import assert from "node:assert/strict";
import {
  SPECIALIST_PROFILES,
  SPECIALIST_MAX_AUTHORITY,
  routeSpecialistSignal,
  specialistSupportsRunner,
  specialistSupportsSignal,
  specialistSupportsSubsystem
} from "../lib/roamly/specialistOrganization.ts";
import { adrianTriage, lucaDispatchAllowed, lucaPlan } from "../lib/roamly/adrianLucaOrchestration.ts";
import { createEvidence, evidenceSatisfiesCompletion, OperationsScheduler } from "../lib/roamly/opsControlPlane.ts";
import { createWorkerAssignment, SimulatedWorkerAdapter } from "../lib/roamly/workerExecution.ts";

const fixtures = [
  ["SEO", "seo.crawlability.failed", "seo"],
  ["UX_PRODUCT_EXPERIENCE", "ux.accessibility.failed", "accessibility"],
  ["SECURITY_PRIVACY", "security.authorization.failed", "authorization"],
  ["PROVIDER_TRAVEL_INTELLIGENCE", "provider.contract.failed", "provider"],
  ["MARKETING_GROWTH", "marketing.campaign.failed", "marketing"],
  ["CUSTOMER_EXPERIENCE", "customer_experience.notification.failed", "customer_experience"],
  ["GAP_AUDIT_QA_RELIABILITY", "gap.audit.failed", "operations_control_plane"]
];

assert.equal(Object.keys(SPECIALIST_PROFILES).length, 7, "all Phase 2 and Phase 5 specialists are registered");
for (const [specialist, code, subsystem] of fixtures) {
  assert.equal(SPECIALIST_PROFILES[specialist].maxAuthority, SPECIALIST_MAX_AUTHORITY);
  assert.equal(SPECIALIST_PROFILES[specialist].financialBudgetUsd, 0);
  assert.equal(SPECIALIST_PROFILES[specialist].tokenBudget, 0);
  assert.equal(SPECIALIST_PROFILES[specialist].network, "NONE");
  assert.equal(routeSpecialistSignal({ code, subsystem }), specialist, `${specialist} routes deterministically`);
  assert.equal(specialistSupportsSignal(specialist, { code, subsystem }), true);
  assert.equal(specialistSupportsSubsystem(specialist, subsystem), true);
  assert.equal(specialistSupportsRunner(specialist, "LEVEL_1_OBSERVE", SPECIALIST_PROFILES[specialist].runners.LEVEL_1_OBSERVE), true);
}

assert.equal(routeSpecialistSignal({ code: "public_route.failed", subsystem: "public_routes" }), null, "ambiguous signal does not create a swarm");
assert.equal(routeSpecialistSignal({ code: "unknown.signal", subsystem: "unknown" }), null, "unknown signal is not broadcast");

const seoSignal = { signalId: "phase5-seo-1", source: "deterministic_check", code: "seo.crawlability.failed", objective: "Diagnose SEO crawlability evidence", subsystem: "seo", specialist: "SEO", requestedAuthority: "LEVEL_2_DIAGNOSE", tokenBudget: 0, financialBudgetUsd: 0, attemptCeiling: 1 };
const seoScheduler = new OperationsScheduler();
const seoDecision = adrianTriage(seoSignal, seoScheduler, Date.parse("2026-09-28T12:00:00Z"));
assert.equal(seoDecision.accepted, true, "SEO signal routes through Adrian");
assert.equal(seoDecision.job?.runnerId, "phase5.seo.diagnose");
assert.equal(seoDecision.job?.authorityLevel, "LEVEL_2_DIAGNOSE");
assert.equal(adrianTriage(seoSignal, seoScheduler).accepted, false, "duplicate signal is suppressed");
assert.equal(adrianTriage({ ...seoSignal, specialist: "UNREGISTERED" }, new OperationsScheduler()).reason, "UNKNOWN_SPECIALIST");
assert.equal(adrianTriage({ ...seoSignal, requestedAuthority: "LEVEL_3_SAFE_REPAIR" }, new OperationsScheduler()).reason, "AUTHORITY_EXCEEDS_PHASE3_POLICY");
assert.equal(adrianTriage({ ...seoSignal, tokenBudget: 1 }, new OperationsScheduler()).reason, "BUDGET_EXCEEDS_SPECIALIST_POLICY");
assert.equal(adrianTriage({ ...seoSignal, subsystem: "billing" }, new OperationsScheduler()).reason, "SUBSYSTEM_UNSUPPORTED_BY_SPECIALIST");
assert.equal(adrianTriage({ ...seoSignal, code: "security.authorization.failed", subsystem: "authorization" }, new OperationsScheduler()).reason, "SIGNAL_UNSUPPORTED_BY_SPECIALIST");

const securityDecision = adrianTriage({ ...seoSignal, signalId: "phase5-security-1", code: "security.authorization.failed", subsystem: "authorization", specialist: "SECURITY_PRIVACY", approvalCategory: "security_sensitive" }, new OperationsScheduler());
assert.equal(securityDecision.accepted, true);
assert.equal(securityDecision.ownerApprovalRequired, true, "security-sensitive work is owner-gated");
const securityPlan = lucaPlan(securityDecision.job, {}, []);
assert.equal(securityPlan.ready, false);
assert.equal(lucaDispatchAllowed(securityPlan, securityDecision.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), false);

const seoPlan = lucaPlan(seoDecision.job, {}, []);
assert.equal(seoPlan.ready, true);
assert.equal(lucaDispatchAllowed(seoPlan, seoDecision.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), true);
assert.equal(lucaDispatchAllowed({ ...seoPlan, authorityCeiling: "LEVEL_3_SAFE_REPAIR" }, seoDecision.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), false, "Luca cannot expand authority");
assert.equal(lucaDispatchAllowed({ ...seoPlan, tokenBudget: 1 }, seoDecision.job, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), false, "Luca cannot expand token budget");
assert.equal(lucaDispatchAllowed(seoPlan, { ...seoDecision.job, runnerId: "phase2.gap-audit.observe" }, { activeGlobalJobs: 0, globalLimit: 1, lockedSubsystems: [], dependencyStates: {}, usage: { tokens: 0, financialCostUsd: 0 } }), false, "unsupported runner cannot dispatch");
assert.equal(lucaPlan({ ...seoDecision.job, status: "QUEUED" }, {}, ["seo"]).ready, false, "conflicting subsystem lock blocks execution");
const workerAssignment = createWorkerAssignment({ job: seoDecision.job, plan: seoPlan, repository: "roamly", repositoryRevision: "785ebdb66c3b3eb821fbf574db4bf3c0e1121673" });
const workerResult = await new SimulatedWorkerAdapter().execute(workerAssignment, { actualRevision: workerAssignment.repositoryRevision });
assert.equal(workerResult.state, "completed", "Phase 5 runner uses the simulated-local adapter");
assert.equal(workerResult.evidence.cleanupState, "DESTROYED");

const completionEvidence = createEvidence({ jobId: seoDecision.job.id, category: "deterministic_check", source: "phase5", result: "pass", summary: "Bounded deterministic evidence", metadata: { specialist: "SEO" } });
assert.equal(evidenceSatisfiesCompletion(seoDecision.job, [completionEvidence]), true, "evidence gates completion");
assert.equal(evidenceSatisfiesCompletion(seoDecision.job, []), false, "prose alone cannot complete a job");
assert.throws(() => createEvidence({ jobId: seoDecision.job.id, category: "deterministic_check", source: "phase5", result: "pass", summary: "unsafe", metadata: { body: "raw customer content" } }), /SENSITIVE_EVIDENCE_KEY_REJECTED/);

const source = await import("node:fs/promises").then(({ readFile }) => Promise.all([
  readFile(new URL("../lib/roamly/specialistOrganization.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/adrianLucaOrchestration.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/workerExecution.ts", import.meta.url), "utf8")
]));
assert.doesNotMatch(source[0], /child_process|exec\(|spawn\(|eval\(|fetch\(/);
assert.doesNotMatch(source[1], /child_process|exec\(|spawn\(|eval\(|shell/);
assert.doesNotMatch(source[2], /child_process|exec\(|spawn\(|eval\(|fetch\(/);
assert.match(source[0], /customer_pii|no_raw_gmail|no_precise_location|no_payment_data/);
console.log("Roamly Phase 5 specialist organization checks passed");
