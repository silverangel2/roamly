import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8");
const provider = source.match(/async function searchTravelpayouts\([\s\S]*?\n}\n\nasync function /)?.[0];
assert.ok(provider, "Travelpayouts search adapter exists");
assert.match(provider, /headers:\s*\{\s*"X-Access-Token":\s*clean\(process\.env\.TRAVELPAYOUTS_API_TOKEN\)\s*\}/);
assert.doesNotMatch(provider, /searchParams\.set\(["']token["']/i, "API credentials must not be exposed in request URLs");
assert.match(provider, /fetchJson\(url\.toString\(\),\s*\{/);
console.log("Travelpayouts credential transport checks passed.");
