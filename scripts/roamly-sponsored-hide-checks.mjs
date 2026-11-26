// "Hide this sponsored card" persists across a reload in the same tab
// but NOT in a new tab (2026-11-25 QA, bug 8). Language persists
// across tabs by contrast.
//
// The mechanism (components/roamly/HouseAdCard.tsx): the hide flag
// (HIDE_KEY = "house-ad-hidden:") is read and written through
// sessionGet/sessionSet, which use window.sessionStorage — storage
// scoped to one tab. A new tab gets a fresh session store, so the
// card reappears. Language persists because it uses localStorage.
//
// The fix: the hide flag moves to localStorage (new localGet/localSet
// helpers, same key name, same try/catch for private mode). The
// impression dedupe (IMP_KEY) deliberately stays on sessionStorage:
// it is a once-per-session rule by design (the file header: "same
// once-per-session-per-placement rule as Phase 1; the server dedupes
// per visitor for 30 minutes"), and changing it would alter counting.
//
// One-time transition note: a hide made before this fix lives only in
// that tab's session store, so the card shows once more in a new tab
// after the fix; hiding it again persists everywhere from then on.
//
// Run BEFORE the fix this script FAILS (the hide flag uses
// sessionStorage). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const card = fs.readFileSync(path.join(root, "components/roamly/HouseAdCard.tsx"), "utf8");

// The hide flag is stored in localStorage, not sessionStorage.
assert.ok(
  /function localGet\(key: string\) \{[\s\S]*?window\.localStorage\.getItem\(key\)/.test(card),
  "a localGet helper reads from localStorage"
);
assert.ok(
  /function localSet\(key: string, value: string\) \{[\s\S]*?window\.localStorage\.setItem\(key, value\)/.test(card),
  "a localSet helper writes to localStorage"
);
assert.ok(
  /if \(localGet\(HIDE_KEY \+ place\)\) setDismissed\(true\);/.test(card),
  "the hide flag is READ from localStorage on mount"
);
assert.ok(
  /localSet\(HIDE_KEY \+ place, "1"\);/.test(card),
  "the hide flag is WRITTEN to localStorage on hide"
);
assert.ok(
  !/session(Get|Set)\(HIDE_KEY/.test(card),
  "no sessionStorage access remains for the hide flag"
);

// The impression dedupe stays once-per-session by design.
assert.ok(
  /if \(sessionGet\(impKey\)\) return;/.test(card),
  "impression dedupe still reads sessionStorage"
);
assert.ok(
  /sessionSet\(impKey, "1"\);/.test(card),
  "impression dedupe still writes sessionStorage"
);

console.log("Sponsored hide persistence checks: PASS");
