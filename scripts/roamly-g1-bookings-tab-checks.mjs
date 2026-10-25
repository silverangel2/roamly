// G1 — Trip-home Bookings tab checks (structural, no network, no browser).
// Proves, against app/trip/[id]/page.tsx, that the Bookings panel has a
// visible tab: a label in the trip tab nav that targets the bookings radio,
// using the same label pattern/styling as the existing tabs, and that the
// nav stays visible (and the panel shows) while Bookings is checked.
// Usage: node scripts/roamly-g1-bookings-tab-checks.mjs [path-to-page.tsx]
// Default path is the repo-relative app/trip/[id]/page.tsx.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";

const target = process.argv[2] || path.join(process.cwd(), "app/trip/[id]/page.tsx");
const src = readFileSync(target, "utf8");

// The nav block: from the <nav ... roamly-tab-nav ...> opener to its </nav>.
const navOpen = src.indexOf('<nav aria-label="Trip sections"');
const navOpenLegacy = src.indexOf('<nav aria-label="Trip briefing sections"');
const navStart = navOpen !== -1 ? navOpen : navOpenLegacy;
assert.ok(navStart !== -1, "trip tab nav element must exist");
const navEnd = src.indexOf("</nav>", navStart);
assert.ok(navEnd !== -1, "trip tab nav must close");
const nav = src.slice(navStart, navEnd);

// 1. The nav renders its labels from a list that includes the Bookings tab.
//    The discriminating check: the identifier the NAV maps over (not
//    panelTabs, which already held a Bookings entry nobody could tap) must
//    itself define a Bookings label.
assert.ok(nav.includes(".map(([tabId, label])"), "nav must map tab ids to labels");
const navListMatch = nav.match(/(\w+)\.map\(\(\[tabId, label\]\)/);
assert.ok(navListMatch, "nav must map over a named tab list");
const navListName = navListMatch[1];
const navListStart = src.indexOf(`const ${navListName}`);
assert.ok(navListStart !== -1, `nav tab list ${navListName} must be defined`);
const navListDef = src.slice(navListStart, src.indexOf("];", navListStart) + 2);
assert.ok(
  navListDef.includes('["roamly-tab-bookings", "Bookings"]'),
  `the nav's tab list (${navListName}) must include [roamly-tab-bookings, Bookings]`
);

// 2. A visible Bookings label in the nav targets the bookings radio, with
//    the exact same label styling as the existing (briefing) labels. Labels
//    are rendered by the shared map, so all labels in the nav share one
//    className; assert the nav's label template carries htmlFor={tabId} and
//    the established label classes, and that "Bookings" is a rendered label
//    value (not only a radio id or a panel heading).
assert.ok(nav.includes("htmlFor={tabId}"), "nav labels must target their radio via htmlFor");
assert.ok(
  nav.includes("inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-cgray shadow-calm"),
  "nav labels must keep the existing label styling"
);
assert.ok(src.includes('["roamly-tab-bookings", "Bookings"]'), "Bookings must be a nav label value");

// 3. The bookings radio input still exists (the label must check something).
assert.ok(src.includes('"roamly-tab-bookings"'), "roamly-tab-bookings radio id must exist");
assert.ok(
  /panelTabs\.map\(\(\[tabId\]\) => \(\s*<input[^>]*name="roamly-completed-tab"[^>]*id=\{tabId\}/.test(src),
  "panelTabs must still render the hidden radio inputs, including bookings"
);

// 4. CSS gates: bookings-checked shows the bookings panel AND keeps the
//    tab nav visible, so tapping Bookings cannot strand the traveler on a
//    panel with no tab bar to leave it.
assert.ok(
  src.includes('#roamly-tab-bookings:checked ~ .roamly-tab-panels .roamly-panel-bookings'),
  "bookings-checked must show the bookings panel"
);
assert.ok(
  /#roamly-tab-bookings:checked ~ \.roamly-tab-nav[,\{]/.test(src) ||
    src.includes("#roamly-tab-bookings:checked ~ .roamly-tab-nav{display:block}"),
  "bookings-checked must keep the tab nav visible"
);

// 5. The bookings panel content is present (not just the tab).
assert.ok(src.includes('className="roamly-tab-panel roamly-panel-bookings'), "bookings panel section must exist");
assert.ok(src.includes('id="bookings"'), "bookings panel must carry id=bookings");
assert.ok(src.includes("Confirmed bookings and imports"), "bookings panel must still contain the wallet details block");

// 6. Exactly one Bookings label value in the nav list (no duplicate tab).
//    Note: panelTabs legitimately holds its own Bookings entry (the radio
//    input), so this counts inside the nav list's definition only.
const navListLabels = (navListDef.match(/\["roamly-tab-bookings", "Bookings"\]/g) || []).length;
assert.equal(navListLabels, 1, `expected exactly 1 Bookings label in the nav list, found ${navListLabels}`);

console.log("g1-bookings-tab: visible Bookings label in trip tab nav OK; targets bookings radio; same label styling; nav stays visible + panel shows when checked; wallet block present");
