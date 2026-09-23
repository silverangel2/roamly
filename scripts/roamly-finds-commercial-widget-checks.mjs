import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const config = read("lib/roamly/findsCommercialConfig.ts");
const widget = read("components/roamly/FindsCommercialWidgets.tsx");
const magazine = read("components/roamly/FindsEditorialMagazine.tsx");

for (const value of ["trs=549715", "shmarker=750294"]) assert.ok(config.includes(value), `${value} must remain in the approved widget configuration`);
for (const value of ["campaign_id=541", "promo_id=8588", "country=Spain"]) assert.ok(config.includes(value), `${value} must remain in the approved eSIM widget`);
for (const value of ["city_id=107", "city_id=121", "campaign_id=137", "promo_id=4497"]) assert.ok(config.includes(value), `${value} must remain in the approved experience widgets`);
for (const value of ["campaign_id=100", "promo_id=4044", "currency=usd", "target_host=www.aviasales.com%2Fsearch"]) assert.ok(config.includes(value), `${value} must remain in the approved flight widget`);
for (const value of ["campaign_id=111", "promo_id=4563", "currency=cad"]) assert.ok(config.includes(value), `${value} must remain in the approved travel widget`);
for (const value of ["campaign_id=22", "promo_id=3507", "curr=USD"]) assert.ok(config.includes(value), `${value} must remain in the approved rental widget`);

assert.ok(config.includes("6ab4484f066caaef31bc282f"), "Stay22 LetMeAllez ID must remain configured");
assert.ok(config.includes("https://booking.stay22.com/roamly/YhpfMFjm2n"), "Stay22 booking route must remain configured");
assert.ok(config.includes("https://kkday.tpo.lu/DrPvqlSH"), "the current promo must live in centralized configuration");
assert.ok(config.includes("https://intui.tpo.lu/6GQiV5Ai"), "the airport-transfer opportunity must remain configured");

assert.ok(widget.includes("isTrustedTravelpayoutsWidgetUrl(config.src)"), "widget execution must enforce the trusted URL allowlist");
assert.ok(widget.includes("document.createElement(\"script\")"), "widgets must be inserted as client-side scripts");
assert.ok(!widget.includes("dangerouslySetInnerHTML"), "widgets must not use arbitrary HTML execution");
assert.ok(widget.includes("strategy=\"afterInteractive\""), "Stay22 must load through Next Script after interaction");

assert.ok(magazine.includes("activeFindsPromo"), "the magazine must consume the centralized promo configuration");
assert.ok(!magazine.includes("kkday.tpo.lu"), "promo URLs must not be scattered through magazine JSX");
assert.ok(!magazine.includes("intui.tpo.lu"), "transfer URLs must not be scattered through magazine JSX");
assert.ok(magazine.includes("findsTravelServices.stays.href") && magazine.includes("findsTravelServices.airportTransfer.href"), "commercial magazine actions must use their configured external destinations");
assert.ok(magazine.includes("findsWidgets.esim"), "the approved eSIM widget must be part of the magazine");
assert.ok(magazine.includes("findsWidgets.flights"), "the approved flight widget must be part of the magazine");
assert.ok(magazine.includes("findsWidgets.experiences107") && magazine.includes("findsWidgets.experiences121"), "both approved experience widgets must be part of the magazine");

console.log("Roamly Finds commercial widget checks passed.");
