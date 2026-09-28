import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  countUnreadNotifications,
  shouldLoadShellState
} from "../lib/roamly/appShellState.ts";

const [shell, page, timeline, bridge] = await Promise.all([
  readFile(new URL("../components/AppShellClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/notifications/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/NotificationTimelineCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/NotificationShellStateBridge.tsx", import.meta.url), "utf8")
]);

assert.equal(shouldLoadShellState(true, "/notifications"), false);
assert.equal(shouldLoadShellState(true, "/dashboard"), true);
assert.equal(shouldLoadShellState(false, "/notifications"), false);
assert.equal(
  countUnreadNotifications([{ status: "unread" }, { status: "read" }, { status: "failed" }]),
  2
);

assert.match(shell, /shouldLoadShellState\(authenticated, pathname\)/);
assert.match(shell, /roamly:notifications-shell-state/);
assert.match(shell, /roamly:shell-state-refresh/);
assert.match(shell, /fetch\("\/api\/roamly\/trips\/active"\)/);
assert.match(shell, /fetch\("\/api\/roamly\/notifications"\)/);
assert.match(page, /NotificationShellStateBridge/);
assert.match(page, /select\("id", \{ count: "exact", head: true \}\)/);
assert.match(page, /unreadCount=\{unreadNotifications\.count \|\| 0\}/);
assert.match(bridge, /activeTripId, unreadCount/);
assert.match(timeline, /roamly:shell-state-refresh/);

console.log("G-A22-01 shell/navigation checks passed");
