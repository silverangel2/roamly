import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../components/roamly/FindsTabs.tsx", import.meta.url), "utf8");

assert.match(component, /async function searchPartner\(form: HTMLFormElement/);
assert.match(component, /name="flightOrigin"[\s\S]*aria-required="true"/);
assert.match(component, /name="partnerDestination"[\s\S]*aria-required="true"/);
assert.match(component, /name="flightDeparture" type="date"[\s\S]*aria-required="true"/);
assert.match(component, /name="flightReturn" type="date"/);
assert.match(component, /noValidate[\s\S]*onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void searchPartner/);
assert.doesNotMatch(component, /button disabled=\{searchingCategory === "flight"\} onClick=/, "flight validation must not create a second button-level path");
assert.match(component, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void searchPartner\(event\.currentTarget, "flight", "flight"\); \}\}/, "flight validation and search stay on the shared form handler");
assert.match(component, /key=\{partnerSearchMessage\.flight \|\| "flight-idle"\}/, "feedback remounts when its visible message changes");
assert.match(component, /!destinationValue \|\| \(category === "flight" && \(!originValue \|\| !departure\)\)/);
assert.match(component, /Add the required trip details to search current offers/);
assert.match(component, /Return date must be the same as or later than departure/);
assert.match(component, /Checking current flight fares…/);
assert.match(component, /data-find-state=\{searchingCategory === "flight" \? "loading"/);
assert.match(component, /data-find-state=\{searchingCategory === "flight" \? "loading" : partnerSearchMessage\.flight \? "terminal"/);
assert.match(component, /const PARTNER_SEARCH_TIMEOUT_MS = 15_000/);
assert.match(component, /new AbortController\(\)/);
assert.match(component, /controller\.abort\(\)/);
assert.match(component, /Flight search timed out\. Current fares are unavailable right now/);
assert.match(component, /if \(!response\.ok\)/);
assert.match(component, /Current flight search is temporarily unavailable\. No stale fares are being shown/);
assert.match(component, /Current flight search returned an unreadable response\. No fares are being shown/);
assert.match(component, /Search is temporarily unavailable\. No stale offers are being shown/);
assert.match(component, /No current \$\{cardCategory === "flight" \? "fare"/);
assert.match(component, /flightFindCard\(item\)/);
assert.match(component, /buildAviasalesDeepLink/);
assert.match(component, /findsFlightHandoff\.marker/);
assert.match(component, /Opening your \$\{originValue\} to \$\{destinationValue\} search on \$\{findsFlightHandoff\.provider\}/);
assert.match(component, /window\.location\.assign\(handoffUrl\)/);
assert.match(component, /Add a return date so we can open the provider search/);
assert.doesNotMatch(component, /flightFindCard\(\{/, "flight feedback must not construct fallback inventory");
assert.doesNotMatch(component, /\/plan/, "flight feedback must not introduce a fabricated internal booking fallback");

console.log("Roamly deterministic flight feedback checks passed");
