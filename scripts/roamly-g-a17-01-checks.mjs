import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widget = fs.readFileSync(path.join(root, "components/roamly/FindsCommercialWidgets.tsx"), "utf8");

for (const state of ["loading", "ready", "unavailable"]) {
  assert.ok(widget.includes(`WidgetState = \"loading\" | \"ready\" | \"unavailable\"` ) || widget.includes(`type WidgetState = \"loading\" | \"ready\" | \"unavailable\"`), `${state} state model must remain explicit`);
}
assert.match(widget, /WIDGET_RENDER_TIMEOUT_MS\s*=\s*8_000/);
assert.match(widget, /new MutationObserver/);
assert.match(widget, /hasUsableTravelpayoutsContent/);
assert.match(widget, /element\.tagName === "SCRIPT"/);
assert.match(widget, /element\.textContent\?\.trim\(\)/);
assert.match(widget, /script\.addEventListener\("load", settleReadyIfUsable/);
assert.match(widget, /script\.addEventListener\("error", settleUnavailable/);
assert.match(widget, /window\.setTimeout\(settleUnavailable, WIDGET_RENDER_TIMEOUT_MS\)/);
assert.match(widget, /window\.clearTimeout\(timeout\)/);
assert.match(widget, /observer\?\.disconnect\(\)/);
assert.match(widget, /setRetryNonce\(\(value\) => value \+ 1\)/);
assert.match(widget, /Live offers aren’t available right now\./);
assert.match(widget, /Nothing has been substituted or guessed\./);
assert.match(widget, /aria-hidden=\{state === "unavailable"\}/);
assert.match(widget, /minHeight: state === "unavailable" \? 0/);
assert.ok(!widget.includes("setState(\"waiting\")"), "script load must not leave an unexplained waiting state");
assert.ok(!widget.includes("no travel inventory"), "fallback must not claim inventory is absent");

console.log("G-A17-01 Finds widget terminal-state checks passed.");
