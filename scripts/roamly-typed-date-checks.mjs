// Typed dates corrupt the year (2026-11-25 QA, bug 2).
//
// The failure: in Step 2 (When), typing 12/13/2026 into the End date
// field repeatedly produced 12/13/0002, and the correctly displayed
// Start date 12/10/2026 was flagged "Enter a real start date." The
// corrupted year was saved: "Resume previous trip" restored 12/13/0202.
// Only keyboard picker selection (arrow keys + Enter) reliably set a
// date. The same typing worked in Deals — whose date inputs are
// uncontrolled (defaultValue, FindsTabs.tsx).
//
// The mechanism (first fix): the plan form's date inputs were plain
// controlled `<input type="date" value onChange>`. Chrome's native
// date input fires onChange per keystroke with INTERMEDIATE values (a
// half-typed year reads as year 0002 / 0262), and committing each one
// to state re-renders the input and resets the browser's segment
// position — the next typed digit lands in the wrong segment and the
// year sticks corrupted. Validation then ran on those intermediate
// states, so a correctly displayed date could still be flagged.
//
// The first fix: for date inputs the browser owns the in-progress
// edit. The input is uncontrolled (defaultValue); the commit happens
// on the native `change` event (blur / Enter / picker selection),
// never per keystroke; external state changes (draft restore, sibling
// auto-shift) sync into the DOM only while the field is not focused;
// blur validates the DOM value. Text/number inputs are untouched.
//
// LIVE FAIL of the first fix (2026-11-25 21:02-21:10 AST, guest,
// desktop, PR #141 deployed): the Start date typed clean (12/10/2026,
// year passing through 0002 transiently and recovering), but the End
// date froze at 12/13/0002 — year "2" → 0002, then "0"/"2"/"6" all
// left it at 0002. Both fields then turned red, including the correct
// Start. Cause: Chrome fires the native `change` event per segment
// edit while the year is typed, so the first fix's change listener
// still committed the intermediate year 0002 — validation ran, and
// the resulting state update froze the End year segment at 0002 (the
// End input is the one whose min moves when the Start commits).
//
// The second fix (this script): the native change commit gates on a
// COMPLETE year — it returns early while the year is below 1000
// (0002/0020/0202 are intermediates, never a real trip year), and
// commits empty (clearing) or any year >= 1000. Picker selections
// and blur-committed final values are complete years, so they still
// commit exactly as before.
//
// Run BEFORE the second fix this script FAILS (no year gate in the
// native change handler). AFTER the fix it PASSES. Live proof (typing
// a date end to end) comes from a browser run after deploy — this
// script proves the wiring, not the keystroke.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const formSource = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");

// The TextInput block: isolate it so the assertions target the date
// input itself, not another field.
const textInputStart = formSource.indexOf("function TextInput({");
assert.ok(textInputStart >= 0, "TextInput exists");
const textInputEnd = formSource.indexOf("function SelectField({", textInputStart);
assert.ok(textInputEnd > textInputStart, "TextInput block found");
const textInput = formSource.slice(textInputStart, textInputEnd);

// 1. Date inputs are uncontrolled: defaultValue, not value.
assert.ok(
  textInput.includes("defaultValue"),
  "date inputs render uncontrolled (defaultValue)"
);
assert.ok(
  /\{\.\.\.\(isDate \? \{ defaultValue: value \} : \{ value \}\)\}/.test(textInput),
  "only date inputs use defaultValue; text/number stay controlled"
);

// 2. The commit happens on the native `change` event, never per keystroke.
assert.ok(
  textInput.includes('addEventListener("change"'),
  "a native change listener commits date values"
);
assert.ok(
  /onChange=\{\(event\) => \{\s*if \(isDate\) return;/.test(textInput),
  "React onChange ignores date keystrokes"
);

// 3. External state (draft restore, sibling auto-shift) syncs into the
// DOM only while the user is not editing the field.
assert.ok(
  textInput.includes("document.activeElement !== el"),
  "DOM sync skips the focused input so typing is never clobbered"
);

// 4. Blur validates what the browser actually holds, not stale state.
assert.ok(
  /inputRef\.current\?\.value \?\? value/.test(textInput),
  "date blur reads the DOM value for validation"
);

// 5. The date updaters still commit whole values only (no partial
// handling was added there — the input, not the updater, is the fix).
assert.ok(
  formSource.includes("function updateStartDate(value: string)"),
  "updateStartDate still exists"
);
assert.ok(
  formSource.includes("function updateEndDate(value: string)"),
  "updateEndDate still exists"
);

// 6. Second fix: the native change commit gates on a complete year.
// Chrome fires `change` per segment edit while the year is typed, so
// without this gate the intermediate years (0002/0020/0202) commit,
// validate, and freeze the End year at 0002. The gate returns early
// while the year is below 1000 and commits empty (clearing) or any
// year >= 1000 — picker selections and blur-committed finals pass.
assert.ok(
  textInput.includes("Number(next.slice(0, 4)) < 1000"),
  "the native change commit returns early while the year is incomplete (< 1000)"
);

console.log("Typed-date corruption checks: PASS");
