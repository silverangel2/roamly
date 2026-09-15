import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildExploreCandidates } from "../lib/roamly/exploreViewModel.ts";

const base = {
  booking_suggestions: [
    {
      candidateId: "event-1",
      category: "attraction",
      booking_category: "attraction",
      title: "Montreal Public Festival",
      description: "A date-specific public event.",
      booking_status: "suggested",
      booking_label: "View event details",
      normal_search_url: "https://events.example/festival",
      affiliate_url: "",
      estimated_cost_min: null,
      estimated_cost_max: null,
      currency: "CAD",
      price_confidence: "unknown",
      market_source: "public_web",
      factual_status: "verified",
      provider_or_search_source: "Official Festival"
    },
    {
      candidateId: "weak-1",
      category: "attraction",
      booking_category: "attraction",
      title: "Generic attraction",
      description: "Not grounded enough for Explore.",
      booking_status: "suggested",
      booking_label: "Search",
      normal_search_url: "https://search.example/generic",
      affiliate_url: "",
      estimated_cost_min: null,
      estimated_cost_max: null,
      currency: "CAD",
      price_confidence: "unknown"
    }
  ]
};

const candidates = buildExploreCandidates(base);
assert.equal(candidates.length, 1, "only grounded discovery candidates should render");
assert.equal(candidates[0].publicEvent, true, "public events are first-class Explore candidates");
assert.equal(candidates[0].priceKnown, false, "unknown event price remains unknown");
assert.equal(candidates[0].href, "https://events.example/festival", "event details link is preserved without affiliate substitution");
assert.ok(!JSON.stringify(candidates).includes("Fits your plan"), "plan fit is not claimed without feasibility evidence");
assert.deepEqual(buildExploreCandidates({ booking_suggestions: [] }), [], "no evidence produces an empty Explore result");

const root = path.resolve(new URL("..", import.meta.url).pathname);
const route = fs.readFileSync(path.join(root, "app/trip/[id]/explore/page.tsx"), "utf8");
const navigation = fs.readFileSync(path.join(root, "components/roamly/TripContextNav.tsx"), "utf8");
const presentation = fs.readFileSync(path.join(root, "components/roamly/ExploreDiscovery.tsx"), "utf8");
assert.match(route, /getTripBundle\(supabase, current\.user\.id, id\)/, "Explore is scoped to the authenticated trip owner");
assert.match(route, /\/trip\/\$\{id\}\/explore/, "Explore route preserves trip-scoped navigation");
assert.match(navigation, /label: "Explore", suffix: "\/explore"/, "Explore is a proper trip navigation destination");
assert.doesNotMatch(navigation, /admin/i, "trip navigation does not expose admin controls");
assert.doesNotMatch(presentation, /Add to itinerary|Added to itinerary/, "Explore does not fake persistence");

console.log("Roamly Explore checks passed.");
