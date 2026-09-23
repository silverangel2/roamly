import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingPhotoUrls, safeBookingPhotoUrls } from "../lib/roamly/bookingPhotoCore.ts";

const fixtures = [
  { main_photo: false, url: { large: "https://q-xx.bstatic.com/xdata/second.jpg" } },
  { main_photo: true, url: { large: "https://q-xx.bstatic.com/xdata/main.jpg", standard: "https://q-xx.bstatic.com/xdata/main-standard.jpg" } },
  { main_photo: false, url: { large: "http://q-xx.bstatic.com/insecure.jpg" } },
  { main_photo: false, url: { large: "https://bstatic.com.attacker.example/fake.jpg" } },
  { main_photo: false, url: { large: "https://example.com/not-provider-content.jpg" } }
];
assert.deepEqual(bookingPhotoUrls(fixtures), [
  "https://q-xx.bstatic.com/xdata/main.jpg",
  "https://q-xx.bstatic.com/xdata/second.jpg"
]);
assert.deepEqual(safeBookingPhotoUrls(["https://q-xx.bstatic.com/a.jpg", "javascript:alert(1)"]), ["https://q-xx.bstatic.com/a.jpg"]);
assert.equal(bookingPhotoUrls("not an array").length, 0);

const [inventory, market, itinerary, tripPage] = await Promise.all([
  readFile(new URL("../lib/roamly/hotelInventory.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/itineraryIntelligence.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8")
]);
assert.match(inventory, /extras: \["description", "facilities", "photos", "policies", "rooms"\]/);
assert.match(inventory, /photoUrls: property\.photoUrls \|\| \[\]/);
assert.match(inventory, /photos: Array\.isArray\(row\.photos\).*detail\.photos/s);
assert.match(market, /photo_urls: candidate\.photoUrls/);
assert.match(itinerary, /photo_urls: photoUrls/);
assert.match(tripPage, /suggestion\.photo_urls\?\.\[0\]/);
assert.match(tripPage, /Property photo · Booking\.com/);
console.log("Roamly Booking.com photo provenance checks passed");
