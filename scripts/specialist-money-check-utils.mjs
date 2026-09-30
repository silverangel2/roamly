import assert from "node:assert/strict";

/**
 * Shared runner for specialist "money mission" deterministic checks.
 *
 * Each finding is scored by revenue impact (high/medium/low) with a short
 * rationale — never an invented metric. Findings run highest-impact first so
 * failures surface the money-moving breakage before anything else.
 */

export const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

export function defineMoneyFinding(id, impact, rationale, run) {
  assert.ok(IMPACT_RANK[impact], `money finding ${id} needs a high/medium/low impact`);
  assert.ok(typeof rationale === "string" && rationale.trim().length > 0, `money finding ${id} needs a rationale`);
  assert.ok(rationale.length <= 140, `money finding ${id} rationale must fit in one line (<=140 chars)`);
  assert.equal(typeof run, "function", `money finding ${id} needs a check function`);
  return { id, impact, rationale, run };
}

export async function runMoneyChecks(specialist, moneyMission, findings) {
  assert.ok(findings.length > 0, `${specialist} must ship at least one money check`);
  console.log(`[${specialist}] money mission: ${moneyMission}`);
  const ordered = [...findings].sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact]);
  for (const finding of ordered) {
    try {
      await finding.run();
      console.log(`  PASS [${finding.impact}] ${finding.id} — ${finding.rationale}`);
    } catch (error) {
      error.message = `[${finding.impact} revenue impact] ${finding.id}: ${finding.rationale}\n  ${error.message}`;
      throw error;
    }
  }
  console.log(`[${specialist}] all ${findings.length} money checks passed.`);
}
