import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { klookTransportFindCard } from "../lib/roamly/findsMarketCore.ts";

const validTransport = {
  id: "klook:transfer-1",
  title: "Lisbon Airport Transfer",
  category: "transport",
  source: "klook",
  price_type: "live_partner",
  price_amount: 22,
  currency: "CAD",
  booking_url: "https://www.klook.com/activity/transfer-1/",
  searched_at: "2026-09-23T12:00:00.000Z",
  metadata: { providerPayload: { image_url: "https://res.klook.com/images/transfer.jpg" } }
};

const card = klookTransportFindCard(validTransport);
assert.equal(card?.category, "transport", "transport listings must stay in the Getting around shelf");
assert.equal(card?.provider, "Klook");
assert.equal(card?.affiliate, true);
assert.match(card?.href || "", /^https:\/\/www\.klook\.com\//);
assert.equal(klookTransportFindCard({ ...validTransport, booking_url: "https://example.com/fake" }), null, "transport links must remain on Klook");
assert.equal(klookTransportFindCard({ ...validTransport, metadata: { providerPayload: {} } }), null, "transport cards require a provider photo");
assert.equal(klookTransportFindCard({ ...validTransport, price_amount: null }), null, "unpriced transport listings must be withheld");

const [page, tabs, market] = await Promise.all([
  readFile(new URL("../app/finds/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsTabs.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8")
]);

assert.match(page, /const origin = clean\(search\.origin/);
assert.match(page, /const startDate = cleanDate\(search\.startDate\)/);
assert.match(page, /const endDate = cleanDate\(search\.endDate\)/);
assert.match(page, /origin=\{origin\} startDate=\{startDate\} endDate=\{endDate\}/);
assert.match(tabs, /name="flightOrigin" defaultValue=\{origin\}/);
assert.match(tabs, /name="flightDeparture" type="date" defaultValue=\{startDate\}/);
assert.match(tabs, /name="flightReturn" type="date" defaultValue=\{endDate\}/);
assert.match(tabs, /name="stayCheckIn" type="date" defaultValue=\{startDate\}/);
assert.match(tabs, /name="stayCheckOut" type="date" defaultValue=\{endDate\}/);
assert.match(tabs, /searchPartner\(event, "transport", "transport"\)/);
assert.match(tabs, /klookTransportFindCard\(item\)/);
assert.match(market, /request\.category === "transport" && isKlookTransportSearch\(request\)/);

console.log("Roamly Finds transport and trip-prefill checks passed");
