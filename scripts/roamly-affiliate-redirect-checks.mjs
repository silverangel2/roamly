import assert from "node:assert/strict";
import { safeAffiliateRedirectUrl } from "../lib/roamly/affiliateRedirect.ts";

const valid = "https://www.stay22.com/allez/roam?address=Halifax%2C%20Canada&aid=test";
assert.equal(safeAffiliateRedirectUrl(valid), valid, "legitimate provider deep link is preserved");
assert.ok(safeAffiliateRedirectUrl("https://subdomain.klook.com/path?aff_sub=test"), "legitimate provider subdomain is allowed");
assert.equal(safeAffiliateRedirectUrl("https://attacker.example/path"), "", "attacker host is rejected");
assert.equal(safeAffiliateRedirectUrl("https://stay22.com.attacker.example/path"), "", "trusted-name suffix attack is rejected");
assert.equal(safeAffiliateRedirectUrl("https://stay22.com@attacker.example/path"), "", "userinfo attack is rejected");
assert.equal(safeAffiliateRedirectUrl("javascript:alert(1)"), "", "javascript scheme is rejected");
assert.equal(safeAffiliateRedirectUrl("data:text/html,hello"), "", "data scheme is rejected");
assert.equal(safeAffiliateRedirectUrl("//attacker.example/path"), "", "protocol-relative URL is rejected");
assert.equal(safeAffiliateRedirectUrl("https://stay22.com./path"), "", "trailing-dot host is rejected");
assert.equal(safeAffiliateRedirectUrl("not a URL"), "", "malformed URL is rejected");
assert.equal(safeAffiliateRedirectUrl("http://www.stay22.com/path"), "", "non-HTTPS URL is rejected");

const route = await (await import("node:fs/promises")).readFile("app/api/roamly/affiliate/click/route.ts", "utf8");
assert.match(route, /safeAffiliateRedirectUrl/, "affiliate route uses the bounded validator");
assert.match(route, /status: 400/, "invalid destinations fail closed without redirecting");
assert.doesNotMatch(route, /safeExternalUrl/, "affiliate route does not use the unbounded external URL validator");

console.log("Affiliate redirect security checks passed.");
