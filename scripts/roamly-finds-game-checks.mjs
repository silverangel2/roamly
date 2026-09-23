import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [findsPage, tabs, puzzle, appShell, homepage] = await Promise.all([
  readFile(new URL("../app/finds/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsTabs.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/CityPuzzle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/AppShellClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
]);

for (const label of ["Stays", "Flights", "Things to do", "Travel essentials", "Getting around"]) {
  assert.ok(tabs.includes(label), `Finds category tab exists: ${label}`);
}
assert.match(findsPage, /searchAmazonFindProducts/, "Amazon finds use actual Creator API product results");
assert.match(findsPage, /product\.imageUrl/, "Amazon listing cards use the provider's product image");
assert.match(findsPage, /product\.href/, "Amazon listing cards use the provider's item destination");
assert.match(findsPage, /product\.savingPercent/, "sale claims only use provider savings data");
assert.doesNotMatch(findsPage, /images\.unsplash\.com/, "market listings do not use generic stock imagery");
assert.match(findsPage, /amazonAffiliateDisclosure/, "Amazon disclosures are included only when the live catalog is configured");
assert.match(findsPage, /amazonAffiliateDisclosure/, "Amazon disclosures are included only when partner links are configured");
assert.match(tabs, /rel="noopener noreferrer"/, "external partner links are isolated from the opener");
assert.match(findsPage, /Real listings and item photos/i, "the market distinguishes real listings from inspirational content");
assert.match(tabs, /No placeholders, scraped stock photos, or pretend offers/i, "empty shelves do not imply inventory that is not connected");
assert.match(tabs, /key=\{`empty-\$\{active\}`\}/, "empty-state copy is remounted when the selected shelf changes");
assert.match(tabs, /active === "amazon" \? emptyMessage/, "only the Amazon shelf shows the Amazon catalog message");
assert.match(tabs, /No verified travel finds are available yet/, "the all-finds shelf has a category-neutral empty state");
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
