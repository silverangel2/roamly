import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const locales = ["en", "fr", "es", "ja", "ko", "zh"];
const bundles = Object.fromEntries(locales.map((locale) => [locale, JSON.parse(fs.readFileSync(path.join(root, "messages", `${locale}.json`), "utf8"))]));
const required = ["Back home", "Welcome back", "Log in", "Bookings", "Add booking", "Save booking", "Live Trip Companion", "Building your itinerary", "Open Maps", "Enable notifications"];

for (const locale of locales) {
  for (const key of required) assert.equal(typeof bundles[locale].text[key], "string", `${locale} missing customer key: ${key}`);
}
for (const locale of locales.slice(1)) {
  for (const key of required) assert.notEqual(bundles[locale].text[key], bundles.en.text[key], `${locale} retained customer prose: ${key}`);
}

const boundary = fs.readFileSync(path.join(root, "components/i18n/TranslatedTextBoundary.tsx"), "utf8");
assert.match(boundary, /placeholder/);
assert.match(boundary, /aria-label/);
assert.match(boundary, /translateText/);

const bookingManager = fs.readFileSync(path.join(root, "components/roamly/TripBookingsManager.tsx"), "utf8");
assert.match(bookingManager, /formatRoamlyCurrency/);
assert.match(bookingManager, /formatRoamlyDate/);
assert.match(bookingManager, /useI18n/);

const dashboard = fs.readFileSync(path.join(root, "app/dashboard/page.tsx"), "utf8");
assert.match(dashboard, /formatRoamlyDate/);
assert.match(dashboard, /getServerLocale/);

console.log("Customer i18n checks passed");
