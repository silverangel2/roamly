import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const [findsPage, magazine, curatedSource, creatorsSource] = await Promise.all([
  readFile(new URL("../app/finds/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsEditorialMagazine.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/curatedAmazonFinds.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/amazonCreatorsApi.ts", import.meta.url), "utf8")
]);
const illustrations = await readdir(new URL("../public/images/finds", import.meta.url));

// R-1 RESOLUTION (2026-11-10, owner's own records — ASSESSMENT-B addendum): the unified
// INTERNATIONAL Amazon Associates tag is roamly02e-20 (amazon.com; Junel's 2026-10-14
// switch — US + Philippines clicks earn, Canadians redirect to .ca under the same ID).
// This check previously pinned roamly060-20, the older Canada-only tag, contradicting
// the module below and the owner's records; the pin is corrected, not the module.
assert.match(curatedSource, /ROAMLY_AMAZON_CURATED_TAG\s*=\s*"roamly02e-20"/, "Roamly uses its dedicated Amazon Associates tag");
const searchQueries = [
  "universal travel adapter",
  "packing cubes travel organizer",
  "portable charger travel power bank",
  "travel pillow",
  "digital luggage scale travel",
  "travel toiletry organizer",
  "travel cable organizer pouch",
  "reusable travel toiletry bottles"
];
assert.equal(searchQueries.length, 8, "Worth Packing has a bounded curated travel-essential edit");

for (const searchQuery of searchQueries) {
  // Same R-1 correction as the tag pin above: curated links are built on the
  // international storefront (the module passes marketplace "amazon.com" to
  // buildAmazonSearchUrl, which emits the bare amazon.com host).
  const url = new URL("https://amazon.com/s");
  url.searchParams.set("k", searchQuery);
  url.searchParams.set("tag", "roamly02e-20");
  assert.equal(url.hostname, "amazon.com", "curated links use the international Amazon marketplace");
  assert.equal(url.pathname, "/s", "curated links use relevant Amazon search destinations");
  assert.equal(url.searchParams.get("tag"), "roamly02e-20", "curated links use Roamly attribution");
  assert.ok(url.searchParams.get("k"), "each curated link has a relevant search query");
}

assert.match(curatedSource, /buildAmazonSearchUrl/, "curated links reuse the existing Amazon search-link builder");
assert.match(curatedSource, /recommendationLabel:\s*"curated-category"/, "curated suggestions are not represented as live listings");
assert.match(curatedSource, /image:\s*null/, "curated suggestions do not use unauthorized product imagery");
assert.match(curatedSource, /illustration:\s*"\/images\/finds\//, "curated category cards use project-local generic illustrations");
assert.equal(illustrations.filter((file) => file.endsWith(".webp")).length, 8, "each curated category has a project-local optimized image");
assert.match(curatedSource, /price:\s*null/, "curated suggestions do not invent prices");
assert.match(curatedSource, /saving:\s*null[\s\S]*savingPercent:\s*null/, "curated suggestions do not invent discounts");
assert.doesNotMatch(curatedSource, /live|current|in stock|rating|review|availability/i, "curated source does not claim live commerce facts");
assert.doesNotMatch(curatedSource, /m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-eu\.ssl-images-amazon\.com/i, "curated categories do not hotlink Amazon product images");
assert.doesNotMatch(curatedSource, /AMAZON_ASSOCIATE_TAG|ReviewIntel/i, "ReviewIntel tracking configuration cannot leak into curated Roamly links");
assert.match(findsPage, /curatedAmazonFindCards/, "the Finds page includes curated suggestions alongside grounded API results");
assert.match(magazine, /not live product listings or price claims/i, "the UI states that curated suggestions are not live listings");
assert.match(magazine, /Illustrative image/, "the UI clearly distinguishes generated category art from actual listings");
assert.match(creatorsSource, /not_configured|unavailable/, "Creators API remains an optional dormant path");

console.log("Curated Amazon Finds checks passed");
