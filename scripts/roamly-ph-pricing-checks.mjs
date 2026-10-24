// Roamly Philippines peso pricing checks: PH trips resolve to the PHP Stripe
// price set, CAD trips keep the CAD set, and the two sets never cross.
// Env vars are set BEFORE the billing module loads (it reads config at import).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID = "price_1TpriyGt1u1jZHNUjeUYH3Nu";
process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID = "price_1TprjtGt1u1jZHNUFs2hRoiD";
process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID = "price_1TprkaGt1u1jZHNUO2V3Sjqt";
process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID_PHP = "price_1UU5MgGt1u1jZHNU8uK9m7EZ";
process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID_PHP = "price_1UU5NfGt1u1jZHNUBzO3Yijm";
process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID_PHP = "price_1UU5OOGt1u1jZHNU8ntfIV9Q";

const { isPhilippinesTrip, getPurchaseOption, validateStripePriceForPurchase } = await import(
  "../lib/roamly/billing.ts"
);
const { planEntitlementCopy } = await import("../lib/roamly/planTripUx.ts");

const phTrip = { metadata: { planning: { destinationCountry: "Philippines", destinationCity: "Manila" } } };
const phRootTrip = { metadata: { destinationCountry: "Philippines" } };
const phCityTrip = { metadata: { planning: { destinationCity: "Cebu City" } } };
const phStopTrip = { metadata: { destinationStops: [{ city: "Davao", country: "Philippines" }] } };
const cadTrip = { metadata: { planning: { destinationCountry: "Canada", destinationCity: "Montreal" } } };

// --- PH detection ---
assert.equal(isPhilippinesTrip(phTrip), true, "planning.destinationCountry Philippines");
assert.equal(isPhilippinesTrip(phRootTrip), true, "root destinationCountry Philippines");
assert.equal(isPhilippinesTrip(phCityTrip), true, "Cebu City falls back to Philippines");
assert.equal(isPhilippinesTrip(phStopTrip), true, "Philippines stop falls back to Philippines");
assert.equal(isPhilippinesTrip(cadTrip), false, "Canada/Montreal is not Philippines");
assert.equal(isPhilippinesTrip({ metadata: {} }), false, "empty metadata is not Philippines");
assert.equal(isPhilippinesTrip(null), false, "null trip is not Philippines");
assert.equal(isPhilippinesTrip({ metadata: { planning: { destination: "Manila, Philippines" } } }), true);

// --- Option resolution: display and charge move together ---
const phItinerary = getPurchaseOption("itinerary_unlock", phTrip);
assert.equal(phItinerary.priceId, "price_1UU5MgGt1u1jZHNU8uK9m7EZ");
assert.equal(phItinerary.amount, 9900);
assert.equal(phItinerary.currency, "php");
assert.equal(phItinerary.display, "₱99");
assert.equal(phItinerary.envName, "ROAMLY_STRIPE_ITINERARY_PRICE_ID_PHP");

const phTracking = getPurchaseOption("tracking_addon", phTrip);
assert.equal(phTracking.priceId, "price_1UU5NfGt1u1jZHNUBzO3Yijm");
assert.equal(phTracking.amount, 7900);
assert.equal(phTracking.display, "₱79");

const phBundle = getPurchaseOption("bundle", phTrip);
assert.equal(phBundle.priceId, "price_1UU5OOGt1u1jZHNU8ntfIV9Q");
assert.equal(phBundle.amount, 14900);
assert.equal(phBundle.display, "₱149");

const cadItinerary = getPurchaseOption("itinerary_unlock", cadTrip);
assert.equal(cadItinerary.priceId, "price_1TpriyGt1u1jZHNUjeUYH3Nu");
assert.equal(cadItinerary.amount, 499);
assert.equal(cadItinerary.currency, "cad");
assert.equal(cadItinerary.display, "$4.99 CAD");

const cadDefault = getPurchaseOption("bundle");
assert.equal(cadDefault.priceId, "price_1TprkaGt1u1jZHNUO2V3Sjqt", "no trip context keeps CAD");
assert.equal(cadDefault.amount, 799);

// --- Validation accepts its own set, rejects the other set ---
function stubStripe(price) {
  return { prices: { retrieve: async () => ({ ...price, product: { id: "prod_x", active: true, name: "Test" } }) } };
}
const phpPrice = { id: "price_1UU5MgGt1u1jZHNU8uK9m7EZ", active: true, unit_amount: 9900, currency: "php", type: "one_time" };
const cadPrice = { id: "price_1TpriyGt1u1jZHNUjeUYH3Nu", active: true, unit_amount: 499, currency: "cad", type: "one_time" };

const phOk = await validateStripePriceForPurchase(stubStripe(phpPrice), "itinerary_unlock", phTrip);
assert.equal(phOk.ok, true, "PHP price validates for a Philippines trip");

const phWrongAmount = await validateStripePriceForPurchase(stubStripe(cadPrice), "itinerary_unlock", phTrip);
assert.equal(phWrongAmount.ok, false);
assert.equal(phWrongAmount.error, "STRIPE_PRICE_AMOUNT_MISMATCH", "CAD price must not validate for a PH trip");

const phWrongCurrency = await validateStripePriceForPurchase(
  stubStripe({ ...phpPrice, currency: "cad" }),
  "itinerary_unlock",
  phTrip
);
assert.equal(phWrongCurrency.error, "STRIPE_PRICE_CURRENCY_MISMATCH", "right amount, wrong currency still refuses");

const cadOk = await validateStripePriceForPurchase(stubStripe(cadPrice), "itinerary_unlock", cadTrip);
assert.equal(cadOk.ok, true, "CAD price still validates for a CAD trip");

const cadWrongCurrency = await validateStripePriceForPurchase(
  stubStripe({ ...cadPrice, currency: "php" }),
  "itinerary_unlock",
  cadTrip
);
assert.equal(cadWrongCurrency.error, "STRIPE_PRICE_CURRENCY_MISMATCH", "PHP currency must not validate for a CAD trip");

// --- Plan copy: PH variant only with PH context, CAD otherwise ---
const phCopy = planEntitlementCopy({ signedIn: true, freeItineraryUsed: true, isPhilippinesTrip: true });
assert.match(`${phCopy.stepNote} ${phCopy.nextStep}`, /₱99/, "PH plan copy shows ₱99");
const cadCopy = planEntitlementCopy({ signedIn: true, freeItineraryUsed: true });
assert.match(`${cadCopy.stepNote} ${cadCopy.nextStep}`, /\$4\.99 CAD/, "CAD plan copy unchanged");

// --- Display surfaces carry the ₱ set (static guards) ---
const button = readFileSync(new URL("../components/trip/ActivateTripButton.tsx", import.meta.url), "utf8");
assert.match(button, /isPhilippinesTrip/, "unlock button takes the PH flag");
assert.match(button, /₱99/, "unlock button shows ₱99");
assert.match(button, /₱79/, "unlock button shows ₱79");
assert.match(button, /₱149/, "unlock button shows ₱149");
const phPage = readFileSync(new URL("../app/ph/page.tsx", import.meta.url), "utf8");
assert.match(phPage, /₱99/, "/ph fee block shows ₱99");
assert.match(phPage, /₱79/, "/ph fee block shows ₱79");
assert.match(phPage, /₱149/, "/ph fee block shows ₱149");
assert.match(phPage, /tax included/, "/ph fee block states tax-inclusive");

console.log("Philippines peso pricing checks passed.");
