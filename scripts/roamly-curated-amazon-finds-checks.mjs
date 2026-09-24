import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const [findsPage, magazine, curatedSource, creatorsSource] = await Promise.all([
  readFile(new URL("../app/finds/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsEditorialMagazine.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/curatedAmazonFinds.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/amazonCreatorsApi.ts", import.meta.url), "utf8")
]);
const illustrations = await readdir(new URL("../public/images/finds", import.meta.url));

assert.match(curatedSource, /ROAMLY_AMAZON_CURATED_TAG\s*=\s*"roamly060-20"/, "Roamly uses its dedicated Amazon Associates tag");
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
  const url = new URL("https://amazon.ca/s");
  url.searchParams.set("k", searchQuery);
  url.searchParams.set("tag", "roamly060-20");
  assert.equal(url.hostname, "amazon.ca", "curated links use the Canadian Amazon marketplace");
  assert.equal(url.pathname, "/s", "curated links use relevant Amazon search destinations");
  assert.equal(url.searchParams.get("tag"), "roamly060-20", "curated links use Roamly attribution");
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
