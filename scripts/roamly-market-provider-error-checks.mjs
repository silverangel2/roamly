import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { travelMarketProviderFailureMessage } from "../lib/roamly/travelMarketProviderError.ts";

assert.match(travelMarketProviderFailureMessage({ name: "TimeoutError" }), /timed out/i);
assert.match(travelMarketProviderFailureMessage({ status: 429 }), /rate-limiting/i);
assert.match(travelMarketProviderFailureMessage({ status: 403 }), /could not authorize/i);
assert.match(travelMarketProviderFailureMessage({ status: 503 }), /temporarily unavailable/i);
assert.match(travelMarketProviderFailureMessage(new Error("secret-bearing internal error")), /could not be completed/i);
assert.doesNotMatch(travelMarketProviderFailureMessage(new Error("secret-bearing internal error")), /secret-bearing/);

const source = await readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /Promise\.allSettled\(\[searchKlook\(request\)\]\)/, "single-provider search failures must propagate to the user-safe warning path");
assert.match(source, /providerFailure = travelMarketProviderFailureMessage\(error\)/);
assert.match(source, /providerFailure \|\|/);
console.log("Roamly market provider failure checks passed.");
