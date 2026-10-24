/**
 * House Ads Engine (Phase 1) — Roamly's own sponsored photo cards.
 *
 * Creatives live in code (no DB, no admin UI in v1). Every card is labeled
 * "Sponsored", every impression is counted when the card actually renders
 * into view (POST /api/ads/event), and every click goes through
 * /api/ads/click/<id>, which records the click server-side and then
 * 302-redirects to the landing. Landings are resolved HERE, on the server.
 */

export const HOUSE_AD_SITE = "roamly";

export type HouseAdCategory = "hotel" | "gadget" | "trip" | "house";
export type HouseAdContext = "home" | "trip";
export type HouseAdMonetization = "affiliate" | "house" | "unwired";

export type HouseAdCreative = {
  id: string;
  category: HouseAdCategory;
  headline: string;
  body: string;
  /** Who the card is "by" — printed on the card next to the Sponsored label. */
  sponsorLabel: string;
  image: string;
  imageAlt: string;
  ctaLabel: string;
  monetization: HouseAdMonetization;
};

/** Booking.com search landing. Roamly's Travelpayouts marker powers its
 * flight (Aviasales) deep links, but there is no Booking.com affiliate
 * configuration for a plain hotel search in this codebase, so these clicks
 * earn $0 until Junel wires a Booking/Travelpayouts hotel ID — the URL is
 * a plain search URL, never a fabricated affiliate link. */
export function bookingSearchUrl(city: string) {
  const url = new URL("https://www.booking.com/searchresults.html");
  url.searchParams.set("ss", city);
  return url.toString();
}

export const REVIEWINTEL_ANALYZE_URL = "https://getreviewintel.com/analyze";

export const HOUSE_AD_CREATIVES: HouseAdCreative[] = [
  {
    id: "hotel-kyoto",
    category: "hotel",
    headline: "Kyoto stays, from ryokan calm to city buzz",
    body: "Compare Kyoto hotels and ryokan, then book the dates that fit your trip.",
    sponsorLabel: "Booking.com",
    image: "/ads/hotel-kyoto.jpg",
    imageAlt: "A quiet Japanese hotel room with a wooden headboard and lantern light",
    ctaLabel: "See Kyoto stays",
    monetization: "unwired",
  },
  {
    id: "hotel-lisbon",
    category: "hotel",
    headline: "Lisbon stays with the old town at your door",
    body: "Compare Lisbon hotels near the trams, the viewpoints, and the pastéis.",
    sponsorLabel: "Booking.com",
    image: "/ads/hotel-lisbon.jpg",
    imageAlt: "A Lisbon viewpoint terrace over tiled rooftops",
    ctaLabel: "See Lisbon stays",
    monetization: "unwired",
  },
  {
    id: "gadget-earbuds",
    category: "gadget",
    headline: "Travel earbuds? Check the real reviews first",
    body: "ReviewIntel reads what actual buyers said and gives you a straight Buy, Wait, or Skip.",
    sponsorLabel: "ReviewIntel",
    image: "/ads/gadget-earbuds.jpg",
    imageAlt: "Wireless earbuds and their charging case on a desk beside a laptop",
    ctaLabel: "Check it first",
    monetization: "house",
  },
  {
    id: "ri-check",
    category: "house",
    headline: "Buying something for the trip? Check it first",
    body: "Paste a product link or a screenshot — ReviewIntel reads the real reviews before your money moves.",
    sponsorLabel: "ReviewIntel",
    image: "/ads/ri-check.jpg",
    imageAlt: "A shopper holding a payment card while browsing a store on a laptop",
    ctaLabel: "Check a product",
    monetization: "house",
  },
];

const CREATIVE_BY_ID = new Map(HOUSE_AD_CREATIVES.map((c) => [c.id, c]));

export function getHouseAdCreative(id: string) {
  return CREATIVE_BY_ID.get(id) || null;
}

/** Default landing URL for a creative. The click route resolves through
 * lib/houseAdServer.ts, which applies Roamly's own Amazon affiliate gate
 * to the gadget card when that gate is enabled in the environment;
 * everywhere else this default is the final landing. This module stays
 * client-safe (no server-only imports) so the card component can share
 * the catalog and selection logic. */
export function resolveHouseAdLanding(id: string): string | null {
  switch (id) {
    case "hotel-kyoto":
      return bookingSearchUrl("Kyoto");
    case "hotel-lisbon":
      return bookingSearchUrl("Lisbon");
    case "gadget-earbuds":
      return REVIEWINTEL_ANALYZE_URL;
    case "ri-check":
      return REVIEWINTEL_ANALYZE_URL;
    default:
      return null;
  }
}

/** Which creative families a placement may show, in rotation order. */
export const HOUSE_AD_CONTEXT_FAMILIES: Record<HouseAdContext, HouseAdCategory[]> = {
  home: ["hotel", "gadget", "house"],
  trip: ["hotel", "house", "gadget"],
};

export function houseAdCandidates(context: HouseAdContext): HouseAdCreative[] {
  const families = HOUSE_AD_CONTEXT_FAMILIES[context] || HOUSE_AD_CONTEXT_FAMILIES.home;
  const seen = new Set<string>();
  const ordered: HouseAdCreative[] = [];
  for (const family of families) {
    for (const creative of HOUSE_AD_CREATIVES) {
      if (creative.category === family && !seen.has(creative.id)) {
        seen.add(creative.id);
        ordered.push(creative);
      }
    }
  }
  return ordered;
}

/** Even rotation: a numeric seed (the slot passes an hourly bucket) walks
 * the candidate list in order, so every creative in the family gets its
 * share of impressions. */
export function pickHouseAd(context: HouseAdContext, seed: number): HouseAdCreative | null {
  const candidates = houseAdCandidates(context);
  if (!candidates.length) return null;
  const index = ((Math.floor(seed) % candidates.length) + candidates.length) % candidates.length;
  return candidates[index];
}

/** Index of the next creative in a rotation of `length` creatives.
 * Advancing from the hourly-seed start index with this helper walks the
 * same even order pickHouseAd(context, seed + step) would pick. */
export function nextHouseAdIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return (((Math.floor(index) + 1) % length) + length) % length;
}

export type HouseAdRotationState = {
  documentHidden: boolean;
  inView: boolean;
  hovered: boolean;
  dismissed: boolean;
  candidateCount: number;
};

/** The slot's rotation may only advance while the card is actually on
 * screen, the tab is visible, the pointer is not hovering the card, and
 * the visitor has not dismissed it. */
export function houseAdRotationAllowed(state: HouseAdRotationState): boolean {
  return (
    state.candidateCount > 1 &&
    state.inView &&
    !state.documentHidden &&
    !state.hovered &&
    !state.dismissed
  );
}

export function houseAdClickPath(id: string) {
  return `/api/ads/click/${encodeURIComponent(id)}`;
}

export type HouseAdEvent = {
  creativeId: string;
  eventType: "impression" | "click";
  pagePath: string | null;
};

/** Validate an event payload from the wire. Impressions arrive at
 * /api/ads/event; clicks are only ever recorded by the click route itself,
 * so a "click" posted to the event route is rejected here. */
export function parseHouseAdEvent(body: unknown, allowedTypes: HouseAdEvent["eventType"][] = ["impression"]): HouseAdEvent | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const creativeId = typeof record.creativeId === "string" ? record.creativeId : "";
  const eventType = typeof record.eventType === "string" ? record.eventType : "";
  if (!getHouseAdCreative(creativeId)) return null;
  if (!allowedTypes.includes(eventType as HouseAdEvent["eventType"])) return null;
  const pagePath =
    typeof record.pagePath === "string" && record.pagePath.startsWith("/")
      ? record.pagePath.slice(0, 300)
      : null;
  return { creativeId, eventType: eventType as HouseAdEvent["eventType"], pagePath };
}
