import assert from "node:assert/strict";
import { rankHotelMarketResults } from "../lib/roamly/hotelMarketRelevance.ts";

const stays = [
  { id: "hotel-a", category: "hotel", title: "Downtown House", price_amount: 900, metadata: { providerPayload: { price_per_night: 300, amenities: ["pool", "parking"], neighborhood: "Downtown" } } },
  { id: "hotel-b", category: "hotel", title: "Quiet Garden Inn", price_amount: 600, metadata: { providerPayload: { price_per_night: 200, amenities: ["garden", "quiet rooms"], neighborhood: "Old Town" } } },
  { id: "hotel-c", category: "hotel", title: "Quiet Walkable Stay", price_amount: 750, metadata: { providerPayload: { price_per_night: 250, amenities: ["quiet rooms"], neighborhood: "Old Town" } } }
];

const ranked = rankHotelMarketResults(stays, { maximum_nightly_price: 250, hotel_preferences: "quiet, walkable" });
assert.deepEqual(ranked.map((stay) => stay.id), ["hotel-c", "hotel-b"], "preference matches rank first, then nightly price, while exceeding-budget stays are excluded");
assert.match(ranked[0].recommendation_label || "", /Matches your preferences/);
assert.equal(rankHotelMarketResults(stays, { maximum_nightly_price: 150 }).length, 0, "a hard nightly limit never returns out-of-budget or unpriced stays");
assert.equal(rankHotelMarketResults(stays, {}).length, 3, "without a budget limit, no live property is discarded");
console.log("Roamly hotel preference and budget ranking checks passed");
