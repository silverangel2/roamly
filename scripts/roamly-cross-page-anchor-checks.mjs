// Cross-page anchor "How it works" (https://roamlyhq.com/#the-journey)
// does not land on its section from another page (2026-11-25 QA,
// bug 11). From Deals, the nav link lands at the top of home; it
// only scrolls once home is already loaded.
//
// The mechanism: the section exists (app/page.tsx, id="the-journey")
// and the nav links to "/#the-journey" (AppShellClient), but the home
// page — a server component — has NO hash-scroll handling on mount.
// The only scrollToHash in the codebase lives in
// components/roamly/TripContextNav.tsx, for trip pages only. A
// client-side navigation to a hash URL does not reliably land on the
// anchor: the page mounts fresh and the target is not scrolled to.
//
// The fix: a tiny client component, HomeHashScroll, rendered on the
// home page. On mount (via requestAnimationFrame, so layout has
// settled) and on every hashchange, it scrolls to the element named
// by location.hash, if it exists. Instant scroll — the same as the
// browser's own anchor jump. Scoped to home: other pages keep their
// own handling.
//
// Run BEFORE the fix this script FAILS (no hash-scroll component on
// home). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

// The component exists, is a client component, and scrolls to the
// hash target on mount and on hashchange.
const scroller = fs.readFileSync(path.join(root, "components/roamly/HomeHashScroll.tsx"), "utf8");
assert.ok(scroller.includes('"use client"'), "HomeHashScroll is a client component");
assert.ok(scroller.includes("useEffect"), "HomeHashScroll runs an effect");
assert.ok(scroller.includes("hashchange"), "HomeHashScroll listens for hash changes");
assert.ok(scroller.includes("getElementById"), "HomeHashScroll looks up the hash target by id");
assert.ok(scroller.includes("scrollIntoView"), "HomeHashScroll scrolls to the target");
assert.ok(scroller.includes("location.hash"), "HomeHashScroll reads the current hash");

// The home page renders it, and the section still exists.
const home = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
assert.ok(home.includes("HomeHashScroll"), "the home page renders HomeHashScroll");
assert.ok(home.includes('id="the-journey"'), "the #the-journey section still exists");

console.log("Cross-page anchor checks: PASS");
