// Home hero destination photo lags the selected tab (2026-11-25 QA, bug 5).
// Paris tab -> Amalfi Coast photo; Kyoto tab -> Paris photo; Santorini
// tab -> Kyoto photo; Barcelona -> generic airport photo. The caption
// switches on time; the photo is one step behind and catches up later.
//
// The mechanism (components/roamly/DynamicDestinationHero.tsx):
// beginTransition sets the incoming image + `transitioning`, and a 700 ms
// timer commits `activeIndex` — and the caption renders `active.name` —
// whether or not the incoming image has decoded. The overlay <Image>
// only starts loading the new file when the transition begins, and the
// campaign PNGs do not decode within 700 ms on first view, so the
// caption switches on schedule while the photo stays one step behind
// until the file decodes.
//
// The fix: gate the caption commit on the incoming image's load. The
// 700 ms fade stays the minimum (the crossfade is not cut short); the
// commit waits for the overlay image's onLoadingComplete beyond that,
// with a 2500 ms hard cap so a slow or failed load can never freeze
// the hero. A failed load counts as settled (onError attempts the
// commit; the cap commits regardless). The reduced-motion path keeps its
// instant commit — no fade, no gate. The auto-rotation uses the same
// beginTransition, so it is fixed too.
//
// This script asserts the wiring in source (a React component cannot
// run in the node VM harness). Run BEFORE the fix it FAILS (no load
// gate); AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const hero = fs.readFileSync(path.join(root, "components/roamly/DynamicDestinationHero.tsx"), "utf8");

// 1. The overlay image reports when it has loaded, and remounts per
// target so the signal fires fresh for each destination.
assert.ok(
  /<Image src={incoming\.image}[\s\S]*?onLoadingComplete/.test(hero),
  "the incoming-image layer reports load completion"
);
assert.ok(
  /<Image src={incoming\.image}[\s\S]*?key=\{incoming\.image\.src\}/.test(hero),
  "the incoming-image layer remounts per destination"
);
assert.ok(
  /<Image src={incoming\.image}[\s\S]*?onError/.test(hero),
  "a failed incoming image is treated as settled, not as a freeze"
);

// 2. The commit waits for the load: the fade timer checks the loaded
// flag (or the commit effect requires it) and the hard cap commits
// regardless.
assert.ok(
  /incomingLoaded/.test(hero),
  "a loaded flag gates the commit"
);
assert.ok(
  /2500/.test(hero),
  "a hard cap (2500 ms) commits even if the image never loads"
);
assert.ok(
  /FADE_MS/.test(hero),
  "the 700 ms fade minimum is preserved"
);

// 3. The reduced-motion path keeps its instant, ungated commit.
assert.ok(
  /if \(reducedMotion\) \{\s*setActiveIndex\(targetIndex\);/.test(hero),
  "reduced motion still commits immediately"
);

// 4. The caption still renders from the committed active destination,
// not from the incoming one (the fix delays the commit, it does not
// move the caption onto the uncommitted image).
assert.ok(
  /<p className="text-xl font-semibold tracking-tight text-white sm:text-2xl">\{active\.name\}<\/p>/.test(hero),
  "the caption renders the committed destination"
);

console.log("Hero photo lag checks: PASS");
