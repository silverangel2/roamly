import assert from "node:assert/strict";
import { isValidPushKey, normalizePushEndpoint } from "../lib/roamly/pushEndpoint.ts";

for (const endpoint of [
  "https://fcm.googleapis.com/fcm/send/example-token",
  "https://updates.push.services.mozilla.com/wpush/v2/example-token",
  "https://web.push.apple.com/Qabc123",
  "https://wns2-notify.notify.windows.com/w/?token=example"
]) assert.ok(normalizePushEndpoint(endpoint), `expected supported endpoint: ${endpoint}`);

for (const endpoint of [
  "http://fcm.googleapis.com/send/token",
  "https://127.0.0.1/push",
  "https://localhost/push",
  "https://fcm.googleapis.com.attacker.example/push",
  "https://user:pass@fcm.googleapis.com/push",
  "https://fcm.googleapis.com:8443/push",
  "https://fcm.googleapis.com/push#fragment",
  "https://attacker.example/push",
  42,
  null
]) assert.equal(normalizePushEndpoint(endpoint), null, `expected rejection: ${String(endpoint)}`);

assert.equal(isValidPushKey("A".repeat(87), "p256dh"), true);
assert.equal(isValidPushKey("A".repeat(22), "auth"), true);
assert.equal(isValidPushKey("short", "p256dh"), false);
assert.equal(isValidPushKey("not a key with spaces", "auth"), false);

console.log("Push endpoint validation checks passed.");
