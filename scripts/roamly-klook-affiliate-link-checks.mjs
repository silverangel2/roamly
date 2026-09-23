import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildKlookProductAffiliateUrl } from "../lib/roamly/klookAffiliateLink.ts";

const product = "https://www.klook.com/en-CA/activity/1234-lisbon-food-tour/";
const referral = "https://affiliate.klook.com/redirect?aid=partner-site&aff_adid=campaign-7&k_site=https%3A%2F%2Fwww.klook.com%2F";
const wrapped = new URL(buildKlookProductAffiliateUrl(product, { referralUrl: referral, partnerId: "partner-site" }));
assert.equal(wrapped.origin, "https://affiliate.klook.com");
assert.equal(wrapped.searchParams.get("aid"), "partner-site");
assert.equal(wrapped.searchParams.get("aff_adid"), "campaign-7");
assert.equal(wrapped.searchParams.get("k_site"), product);

const partnerTagged = new URL(buildKlookProductAffiliateUrl(product, { partnerId: "partner-site" }));
assert.equal(partnerTagged.searchParams.get("aid"), "partner-site");
assert.equal(buildKlookProductAffiliateUrl("http://www.klook.com/activity/123" , { partnerId: "partner-site" }), "", "insecure product links must be rejected");
assert.equal(buildKlookProductAffiliateUrl("https://www.klook.com.attacker.example/activity/123", { partnerId: "partner-site" }), "", "lookalike product hosts must be rejected");
assert.equal(buildKlookProductAffiliateUrl(product, { referralUrl: "https://attacker.example/redirect", partnerId: "" }), "", "unapproved redirect hosts must not receive affiliate destinations");

const marketSearch = await readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8");
assert.match(marketSearch, /booking_url: buildKlookProductAffiliateUrl\(item\.url/);
console.log("Roamly Klook partner-attribution checks passed.");
