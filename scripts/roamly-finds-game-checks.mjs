import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [findsPage, tabs, magazine, puzzle, appShell, homepage] = await Promise.all([
  readFile(new URL("../app/finds/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsTabs.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsEditorialMagazine.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/CityPuzzle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/AppShellClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
]);

for (const label of ["Stays", "Flights", "Things to do", "Travel essentials", "Getting around"]) {
  assert.ok(tabs.includes(label), `Finds category tab exists: ${label}`);
}
assert.match(findsPage, /searchAmazonFindProducts/, "Amazon finds use actual Creator API product results");
assert.match(findsPage, /amazonFindCard\(product, productResults\.checkedAt\)/, "Amazon listing cards use the centralized provider-backed card mapping");
assert.doesNotMatch(findsPage, /images\.unsplash\.com/, "market listings do not use generic stock imagery");
assert.match(findsPage, /amazonAffiliateDisclosure/, "Amazon disclosures are included only when the live catalog is configured");
assert.match(findsPage, /amazonAffiliateDisclosure/, "Amazon disclosures are included only when partner links are configured");
assert.match(magazine, /rel="noopener noreferrer"/, "external partner links are isolated from the opener");
assert.match(magazine, /Real products only, when verified/i, "the magazine distinguishes real listings from inspirational content");
assert.match(tabs, /No unverified offers are shown/i, "empty shelves do not imply inventory that is not connected");
assert.match(magazine, /emptyMessage/, "unavailable commercial feeds use honest editorial empty-state copy");
assert.match(magazine, /Stories for wherever you’re going/, "the primary Finds surface is editorial rather than a search-results heading");
assert.match(magazine, /aria-labelledby="stay-heading"[\s\S]*?Where to stay/, "the stay editorial slot remains visible when live inventory is empty");
assert.match(magazine, /onOpenSearch\("stays"\)/, "the empty stay slot opens the stay search, not trip planning");
assert.match(magazine, /aria-labelledby="activities-heading"[\s\S]*?Things worth doing/, "the activity editorial slot remains visible when live inventory is empty");
assert.match(magazine, /onOpenSearch\("activities"\)/, "the empty activity slot opens activity discovery");
assert.match(magazine, /Flights worth checking[\s\S]*?onOpenSearch\("flights"\)/, "the empty flight slot opens flight search");
assert.equal((magazine.match(/href=\{card\.href\}/g) || []).length, 2, "product, hotel, activity, and flight cards use the item-specific card destination");
assert.equal((magazine.match(/href=\{`\/plan/g) || []).length, 1, "the only planner link in the magazine is the intentional general destination-story action");
assert.match(magazine, /Plan around \{story\.city\}/, "general destination editorial may retain its secondary planning action");
assert.match(puzzle, /Swap two pieces at a time/, "destination puzzle describes the playable swap mechanic");
assert.match(puzzle, /setOrder\(\(current\)/, "puzzle swaps pieces interactively");
assert.match(puzzle, /aria-pressed=\{selected === position\}/, "puzzle selection state is accessible");
assert.match(puzzle, /aria-live="polite"/, "puzzle result is announced accessibly");
assert.match(puzzle, /You found \{destination\.city\}, \{destination\.country\}/, "solving reveals the correct destination name");
assert.match(puzzle, /href=\{`\/plan\?destination=/, "solved puzzle routes into trip planning");
assert.match(puzzle, /#finds-tab-flights/, "solved puzzle routes into Flights shelf");
assert.match(puzzle, /#finds-tab-stays/, "solved puzzle routes into Hotels shelf");
assert.equal((puzzle.match(/\{ city: "/g) || []).length, 25, "only destination-matched image puzzles are listed");
assert.match(homepage, /<DynamicDestinationHero \/>\s*<CityPuzzle \/>/, "jigsaw panel sits immediately below homepage hero");
assert.match(appShell, /href: "\/finds"/, "Finds is reachable from app navigation");
assert.match(findsPage, /href="\/play"/, "city puzzle is reachable from Finds");

console.log("Roamly Finds and city puzzle checks passed");
