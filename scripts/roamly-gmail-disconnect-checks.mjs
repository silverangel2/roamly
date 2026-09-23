import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { revokeGoogleOAuthToken, stopGmailPushDelivery } from "../lib/roamly/gmailDisconnect.ts";

let captured;
const successFetch = async (url, init) => {
  captured = { url: String(url), init };
  return new Response(null, { status: 200 });
};

assert.equal(await stopGmailPushDelivery("access-secret", successFetch), true);
assert.equal(captured.url, "https://gmail.googleapis.com/gmail/v1/users/me/stop");
assert.equal(captured.init.method, "POST");
assert.equal(captured.init.headers.authorization, "Bearer access-secret");
assert.doesNotMatch(captured.url, /access-secret/);

assert.equal(await revokeGoogleOAuthToken("refresh-secret", successFetch), true);
assert.equal(captured.url, "https://oauth2.googleapis.com/revoke", "credentials must never appear in the revoke URL");
assert.equal(captured.init.method, "POST");
assert.equal(captured.init.headers["content-type"], "application/x-www-form-urlencoded");
assert.equal(new URLSearchParams(captured.init.body).get("token"), "refresh-secret");
assert.equal(await revokeGoogleOAuthToken("expired", async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 })), true);
assert.equal(await revokeGoogleOAuthToken("refresh-secret", async () => new Response("{}", { status: 503 })), false);
assert.equal(await stopGmailPushDelivery("access-secret", async () => { throw new Error("offline"); }), false);
assert.equal(await revokeGoogleOAuthToken("", successFetch), false);

const source = await readFile(new URL("../lib/roamly/emailConnections.ts", import.meta.url), "utf8");
const disconnect = source.match(/export async function disconnectEmailConnection\([\s\S]*?\n}\n\nexport async function renewOutlookSubscription/)?.[0];
assert.ok(disconnect);
assert.match(disconnect, /stopGmailPushDelivery\(accessToken\)/);
assert.match(disconnect, /revokeGoogleOAuthToken\(refreshToken \|\| accessToken\)/);
assert.match(disconnect, /encrypted_access_token: null[\s\S]*encrypted_refresh_token: null[\s\S]*connection_status: "disconnected"/);
assert.match(disconnect, /email_watch_subscriptions[\s\S]*status: "stopped"/);
assert.match(disconnect, /revocationConfirmed/);

const component = await readFile(new URL("../components/account/EmailConnectionSettings.tsx", import.meta.url), "utf8");
assert.match(component, /Google could not confirm access revocation/);
assert.match(component, /ui\.email\.importGmailOnly/);
assert.match(component, /role="status"/);
console.log("Roamly Gmail disconnect privacy checks passed.");
