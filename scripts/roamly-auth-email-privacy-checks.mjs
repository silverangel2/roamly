import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint = new URL("../app/api/auth/tester-email/route.ts", import.meta.url);
const authForm = fs.readFileSync(new URL("../components/auth/AuthForm.tsx", import.meta.url), "utf8");

assert.equal(fs.existsSync(endpoint), false, "public tester-list membership endpoint must not exist");
assert.ok(!authForm.includes("/api/auth/tester-email"), "auth UI must not query tester membership by email");
assert.ok(!authForm.includes("isTesterEmail"), "auth UI must not branch on private tester-list membership");
assert.ok(
  authForm.includes("If you were invited to test Roamly, access will be available after you verify this email."),
  "generic verification guidance should still help invited testers without revealing whether an email is listed"
);

console.log("Roamly auth email-privacy checks passed.");
