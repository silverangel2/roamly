import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFindCard, bookingFindCard, flightFindCard, klookFindCard, publicEventFindCard } from "../lib/roamly/findsMarketCore.ts";
import { travelpayoutsBookingUrl } from "../lib/roamly/travelpayoutsLink.ts";

const hotel = {
  id: "booking:42", title: "Verified Lisbon Stay", source: "booking_demand", price_type: "live_partner",
  price_amount: 412.5, currency: "EUR", booking_url: "https://www.booking.com/hotel/pt/fixture.html",
  searched_at: "2026-09-22T12:00:00.000Z",
  metadata: { providerPayload: { availability_status: "available", photo_urls: ["https://q-xx.bstatic.com/property.jpg"] } }
};
assert.equal(bookingFindCard(hotel)?.price, "€412.50");
assert.equal(bookingFindCard({ ...hotel, affiliate_url: "https://www.stay22.com/allez/booking?aid=fixture" })?.provider, "Booking.com via Stay22", "verified live Booking.com hotel data can hand off through Stay22 to Booking.com");
assert.match(bookingFindCard({ ...hotel, affiliate_url: "https://www.stay22.com/allez/booking?aid=fixture" })?.href || "", /^https:\/\/www\.stay22\.com\/allez\/booking/);
assert.equal(bookingFindCard({ ...hotel, affiliate_url: "https://app.stay22.com/login" })?.provider, "Booking.com", "unsafe Stay22 operational URLs are never used as customer links");
assert.equal(bookingFindCard(hotel)?.affiliate, true, "Booking Demand fallback remains disclosed as an affiliate route");
assert.equal(bookingFindCard({ ...hotel, price_type: "search_ready" }), null, "unpriced/search-only hotels never appear as bookable offers");
assert.equal(bookingFindCard({ ...hotel, booking_url: "https://booklng.com/fake" }), null, "hotel CTA must be a verified Booking host");
assert.equal(bookingFindCard({ ...hotel, metadata: { providerPayload: { availability_status: "available", photo_urls: ["https://example.com/fake.jpg"] } } }), null, "hotel cards require a provider-hosted property photo");

const activity = {
  id: "klook:88", title: "Lisbon Food Walk", source: "klook", price_type: "live_partner", price_amount: 39, currency: "CAD",
  booking_url: "https://www.klook.com/activity/88-food-walk/", searched_at: "2026-09-22T12:00:00.000Z",
  metadata: { providerPayload: { image_url: "https://res.klook.com/image/upload/food-walk.jpg" } }
};
assert.equal(klookFindCard(activity)?.category, "activity");
assert.equal(klookFindCard({ ...activity, metadata: { providerPayload: {} } }), null, "Klook experiences without provider photos are withheld");
assert.equal(klookFindCard({ ...activity, booking_url: "https://example.com/activity" }), null, "Klook CTA must remain on Klook");

const publicEvent = {
  id: "event:88", category: "attraction", source: "public_web", title: "Lisbon Night Market",
  normal_search_url: "https://events.example.org/lisbon-night-market", start_date: "2026-10-14", searched_at: "2026-09-23T12:00:00.000Z",
  metadata: { public_event: { venue: "Ribeira Square" } }
};
assert.equal(publicEventFindCard(publicEvent)?.affiliate, false, "public events never receive affiliate claims");
assert.equal(publicEventFindCard(publicEvent)?.image, null, "public events without source imagery do not receive substitute photos");

const flight = {
  id: "flight:1", title: "YHZ to LIS flight", origin: "YHZ", destination: "LIS", source: "travelpayouts", price_type: "live_partner",
  price_amount: 780, currency: "CAD", booking_url: "https://www.aviasales.com/search/YHZ2209LIS1", searched_at: "2026-09-22T12:00:00.000Z",
  metadata: { providerPayload: { duration_to: 505, duration_back: 480, transfers: 1 } }
};
const product = amazonFindCard({
  id: "B012345678",
  title: "Travel packing cubes",
  imageUrl: "https://m.media-amazon.com/images/I/test.jpg",
  href: "https://www.amazon.ca/dp/B012345678?tag=roamly-20",
  price: "CDN$19.99",
  currency: "CAD",
  saving: null,
  savingPercent: null,
  deal: false,
  merchant: "Amazon.ca",
  availability: "in_stock"
});
assert.match(product.href, /^https:\/\/www\.amazon\.ca\/dp\/B012345678\?/);
assert.notEqual(product.href, "/plan", "Amazon product CTA remains item-specific");
assert.match(flightFindCard(flight)?.image || "", /roamly-flight-route\.svg$/);
assert.match(flightFindCard(flight)?.description || "", /Outbound 8h 25m · return 8h · 1 stop outbound/);
assert.match(flightFindCard(flight)?.description || "", /not a live quote/i);
assert.equal(flightFindCard(flight)?.checkedAt, null, "a current query timestamp must not be presented as the fare's verification time");
assert.equal(flightFindCard({ ...flight, booking_url: "https://example.com/ticket" }), null, "flight CTA must remain on the expected ticket seller");
assert.notEqual(flightFindCard(flight)?.href, "/plan", "flight CTA remains Travelpayouts-specific");
assert.notEqual(bookingFindCard(hotel)?.href, "/plan", "hotel CTA remains property/search-specific");
assert.notEqual(klookFindCard(activity)?.href, "/plan", "commercial activity CTA remains Klook-specific");
assert.equal(travelpayoutsBookingUrl("/search/YHZ2209LIS1", "marker 123"), "https://www.aviasales.com/search/YHZ2209LIS1?marker=marker+123");
assert.equal(travelpayoutsBookingUrl("search/YHZ2209LIS1?adults=1", "marker123"), "https://www.aviasales.com/search/YHZ2209LIS1?adults=1&marker=marker123", "affiliate marker is appended correctly when provider link has a query");
assert.equal(travelpayoutsBookingUrl("https://example.com/fake", "marker123"), undefined, "provider links cannot redirect off Aviasales");
assert.equal(travelpayoutsBookingUrl("/search/YHZ2209LIS1", ""), undefined, "flight offers without a configured marker are withheld");

const [component, magazine, route, market, nextConfig] = await Promise.all([
  readFile(new URL("../components/roamly/FindsTabs.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/roamly/FindsEditorialMagazine.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/roamly/market-search/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/roamly/travelMarketSearch.ts", import.meta.url), "utf8"),
  readFile(new URL("../next.config.ts", import.meta.url), "utf8")
]);
assert.match(component, /category: "hotel"/);
assert.match(component, /category: "flight"/);
assert.match(component, /searchPartner\(event, "attraction", "activity"\)/);
assert.match(component, /store: false/);
assert.match(magazine, /Some links may earn Roamly a commission/, "all live affiliate shelves must disclose commission relationships");
assert.match(component, /ArrowRight/);
assert.match(component, /ArrowLeft/);
assert.match(component, /event\.key === "Home"/);
assert.match(component, /event\.key === "End"/);
assert.match(component, /tabIndex=\{active === item\.id \? 0 : -1\}/, "tab focus must follow the roving tab-stop pattern");
assert.match(route, /const auth = await requireUser\(\)/, "live market searches must remain authenticated");
assert.match(route, /store: body\.store !== false/, "Finds can search live without writing market cache rows");
assert.match(route, /resolveAffiliateLink\(\{[\s\S]*?category: "hotel"[\s\S]*?affiliate_url: affiliate\.finalUrl/, "hotel results use the configured Stay22 route only when affiliate configuration resolves successfully");
assert.match(market, /resolveTravelIataCode\(request\.origin\)/, "flight queries are normalized to real airport codes");
assert.match(nextConfig, /hostname: "\*\*\.bstatic\.com"/, "provider hotel photos are permitted by the optimized image configuration");
assert.match(nextConfig, /hostname: "res\.klook\.com"/, "provider activity photos are permitted by the optimized image configuration");
console.log("Roamly live Finds provider checks passed");
