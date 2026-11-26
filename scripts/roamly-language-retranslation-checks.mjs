// Language switch does not re-translate the header until a full
// reload, and the puzzle status line stays English in French mode
// (2026-11-25 QA, bug 6).
//
// ROOT CAUSE (part A — the live defect, proven in code):
// components/i18n/TranslatedTextBoundary.tsx stores the FIRST-SEEN
// value of each text node as its "original". A node first seen in
// French stores the French string; on switching to English,
// translateExactText is the identity function, so the stored French
// "translates" to itself — and the effect overwrites React's correct
// English render with the stale French. The same staleness hits the
// puzzle status line in the other direction: React renders it in
// French via t("ui.home.puzzle.choose"), but the boundary looks up the
// stored English original ("Choose a piece · 0 swaps") in the text
// map, finds no entry (it is dynamic, built by t()), and writes the
// English back over React's French. The fix: when the stored base has
// no translation, return early — never overwrite React's current
// render with an untranslated stale original. Same guard for
// attributes.
//
// REBASE NOTE (2026-11-25): the first version of this fix also
// rewrote CityPuzzle to new ui.puzzle.* dictionary keys and added
// three static strings to the text map. That was built against a
// STALE tree: main already translates the puzzle line via
// t("ui.home.puzzle.choose"/"solved") with keys present in all six
// bundles, and main's text maps (1,565 entries each) already contain
// all four static strings. So on main, part A is the whole fix —
// CityPuzzle and the bundles need NO change. This script asserts that
// reality: the boundary guard, plus the dictionary keys and text-map
// entries main already carries, so a future regression is caught.
//
// Run BEFORE the fix this script FAILS (no guard in the boundary).
// AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

// Part A: the boundary never overwrites React's render with an
// untranslated stale original.
const boundary = fs.readFileSync(path.join(root, "components/i18n/TranslatedTextBoundary.tsx"), "utf8");
assert.ok(
  /if \(translated === core\) return;/.test(boundary),
  "translateNode returns early when the stored base has no translation"
);
assert.ok(
  /if \(translateText\(base\.trim\(\)\) === base\.trim\(\)\) continue;/.test(boundary),
  "attributes get the same no-translation guard"
);

// The puzzle line is translated by the dictionary, not the boundary:
// CityPuzzle uses t("ui.home.puzzle.choose"/"solved"), and those keys
// exist in every bundle.
const puzzle = fs.readFileSync(path.join(root, "components/roamly/CityPuzzle.tsx"), "utf8");
assert.ok(puzzle.includes('t("ui.home.puzzle.choose"'), "CityPuzzle translates the status line via ui.home.puzzle.choose");
assert.ok(puzzle.includes('t("ui.home.puzzle.solved"'), "CityPuzzle translates the solved line via ui.home.puzzle.solved");
for (const locale of ["en", "fr", "es", "ja", "ko", "zh"]) {
  const bundle = JSON.parse(fs.readFileSync(path.join(root, `messages/${locale}.json`), "utf8"));
  const keys = bundle.ui?.home?.puzzle;
  assert.ok(keys, `${locale} bundle has ui.home.puzzle`);
  for (const key of ["choose", "solved", "swapOne", "swapMany", "progress", "found"]) {
    assert.ok(typeof keys[key] === "string" && keys[key].length > 0, `${locale} ui.home.puzzle.${key} exists`);
  }
  // The static puzzle strings live in the text map in every locale.
  for (const text of [
    "Where will the pieces take you?",
    "Swap two pieces at a time to discover somewhere new. Solve the picture when you feel like playing, then decide whether it belongs on your trip.",
    "Explore 100 destinations through travel photos and destination illustrations. Planning remains one tap away above.",
    "Now choose another piece to swap."
  ]) {
    assert.ok(typeof bundle.text?.[text] === "string", `${locale} text map has ${JSON.stringify(text.slice(0, 30))}`);
  }
}

console.log("Language switch re-translation checks: PASS");
