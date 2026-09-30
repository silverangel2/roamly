import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (path) => fs.readFile(path, "utf8");
const [page, component, config, resolver, amazon] = await Promise.all([
  read(new URL("../app/finds/page.tsx", import.meta.url)),
  read(new URL("../components/roamly/FindsDirectPartners.tsx", import.meta.url)),
  read(new URL("../lib/roamly/findsCommercialConfig.ts", import.meta.url)),
  read(new URL("../lib/roamly/affiliateResolver.ts", import.meta.url)),
  read(new URL("../lib/roamly/curatedAmazonFinds.ts", import.meta.url))
]);

assert.match(page, /FindsDirectPartners/);
assert.doesNotMatch(page, /FindsTabs|Stay22LetMeAllezScript|searchAmazonFindProducts|FindsEditorialMagazine/);
assert.doesNotMatch(page, /Build your next trip|Search stays|Check flights|Explore experiences/);
assert.match(component, /<a[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/);
for (const title of ["Book your stay", "Find flights", "Book activities", "Shop travel gear", "Get an eSIM"]) {
  assert.match(component, new RegExp(title));
}
assert.doesNotMatch(component, /<form|<input|accordion|finds-live-panel/);
assert.match(component, /findsTravelServices\.stays\.href/);
assert.match(component, /findsWidgets\.flights\.src/);
assert.match(component, /buildKlookSearchUrl/);
assert.match(component, /findsWidgets\.esim\.src/);
assert.match(component, /ROAMLY_AMAZON_CURATED_TAG/);
assert.match(config, /shmarker=750294/);
assert.match(config, /promo_id=8588&campaign_id=541/);
assert.match(amazon, /ROAMLY_AMAZON_CURATED_TAG = "roamly060-20"/);
assert.match(resolver, /export function buildKlookSearchUrl/);

console.log("roamly direct Finds partner checks passed");
