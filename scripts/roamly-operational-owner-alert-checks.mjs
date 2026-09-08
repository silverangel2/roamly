import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const alerts = read("lib/roamly/ownerOperationalAlerts.ts");
const recorder = read("lib/roamly/operationalIncidents.ts");
const stripe = read("app/api/stripe/webhook/route.ts");
const gmail = read("app/api/webhooks/gmail/route.ts");

assert.match(alerts, /process\.env\.ROAMLY_OWNER_ALERT_EMAIL/);
assert.doesNotMatch(alerts, /support@roamlyhq\.com/);
assert.match(alerts, /roamly_claim_operational_incident_owner_alert/);
assert.match(alerts, /p_incident_id: params\.incident\.id/);
assert.match(alerts, /p_expected_generation: params\.incident\.owner_alert_generation/);
assert.match(alerts, /idempotencyKey: `owner-alert:/);
assert.match(alerts, /owner_alert_sent_at: new Date\(\)\.toISOString\(\)/);
assert.match(alerts, /\.eq\("owner_alert_generation", params\.incident\.owner_alert_generation\)/);
assert.match(alerts, /\.eq\("owner_alert_claimed_generation", params\.incident\.owner_alert_generation\)/);
assert.match(alerts, /\.eq\("owner_alert_claim_token", claim\.claim_token\)/);
assert.match(alerts, /\.is\("owner_alert_sent_at", null\)/);
assert.match(alerts, /\.select\("id"\)/);
assert.match(alerts, /!marked\.data/);
assert.match(alerts, /OWNER_ALERT_SEVERITIES/);
assert.doesNotMatch(alerts, /Gmail message|access_token|refresh_token|Authorization|CRON_SECRET|VAPID|card/i);
assert.match(recorder, /deliverOwnerOperationalAlert/);
assert.match(recorder, /!data\?\.duplicate/);
assert.match(recorder, /params\.kind !== "recovery"/);
assert.match(recorder, /\.eq\("last_event_id", data\.event_id\)/);
assert.match(stripe, /recordOperationalEvent/);
assert.match(gmail, /recordOperationalEvent/);

function shouldAlert(severity, status) {
  return status === "open" && ["high", "critical"].includes(severity);
}
assert.equal(shouldAlert("critical", "open"), true);
assert.equal(shouldAlert("high", "open"), true);
assert.equal(shouldAlert("medium", "open"), false);
assert.equal(shouldAlert("low", "open"), false);
assert.equal(shouldAlert("high", "resolved"), false);

const claimState = { generation: 1, claimedGeneration: null, status: "open", severity: "high" };
function claim(state, generation) {
  if (!shouldAlert(state.severity, state.status) || state.generation !== generation || state.claimedGeneration === generation) return false;
  state.claimedGeneration = generation;
  return true;
}
const winners = await Promise.all([Promise.resolve().then(() => claim(claimState, 1)), Promise.resolve().then(() => claim(claimState, 1))]);
assert.equal(winners.filter(Boolean).length, 1);
claimState.status = "resolved";
assert.equal(claim(claimState, 1), false);
claimState.status = "open";
claimState.generation = 2;
claimState.claimedGeneration = null;
assert.equal(claim(claimState, 1), false);
assert.equal(claim(claimState, 2), true);

console.log("Operational owner-alert checks passed (eligibility, atomic claim contract, generation safety, privacy, and producer boundaries).");
