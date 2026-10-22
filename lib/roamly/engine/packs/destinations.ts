import { contentId } from "@/lib/roamly/engine/ids";
import type { DestinationDTO } from "@/lib/roamly/engine/types";

/*
 * Destination registry seeds — the 8 breadth destinations. Later
 * registry entries live in PRODUCTION_DESTINATION_SEEDS below the
 * breadth export, so the breadth corpus this file was frozen with
 * (and the Phase 2/3 fixtures prove against) never silently grows.
 *
 * Registry IDs are minted ONCE, deterministically, from the
 * destination's geocode identity (country + display name + centre),
 * so re-registering the same destination yields the same ID and
 * registration is idempotent. The ID is an identity, not a slug:
 * nothing downstream parses it or derives meaning from it.
 *
 * Coordinates are the recorded pool entries' (the Phase 2 fixtures'
 * scenarios.json, themselves from the shadow's mock pool); the
 * geocode provenance says exactly that. The bbox follows the
 * shadow collectors' sizing rule verbatim: "big" destinations
 * (kind matches /city/ and not /small/) get ±0.055 lat / ±0.075 lon,
 * small ones ±0.04 / ±0.055 — the same boxes the shadow packs were
 * collected with, so seeded and live builds query identical ground.
 */

export function destinationRegistryId(country: string, displayName: string, centre: { lat: number; lon: number }): string {
  return contentId("dst", [country, displayName, centre.lat.toFixed(4), centre.lon.toFixed(4)]);
}

export function shadowBBox(
  centre: { lat: number; lon: number },
  kind: string
): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const big = /city/.test(kind) && !/small/.test(kind);
  const dLat = big ? 0.055 : 0.04;
  const dLon = big ? 0.075 : 0.055;
  return {
    minLat: centre.lat - dLat,
    minLon: centre.lon - dLon,
    maxLat: centre.lat + dLat,
    maxLon: centre.lon + dLon
  };
}

interface SeedSpec {
  poolId: string;
  displayName: string;
  country: string;
  kind: string;
  centre: { lat: number; lon: number };
  timeZone: string;
  /** Overrides the shared provenance label for entries that did NOT
   *  come from the shadow mock pool (the label must never claim a
   *  provenance the entry does not have). */
  provenanceLabel?: string;
}

const SEED_SPECS: readonly SeedSpec[] = [
  { poolId: "fredericton-family", displayName: "Fredericton", country: "Canada", kind: "small city", centre: { lat: 45.9636, lon: -66.6431 }, timeZone: "America/Moncton" },
  { poolId: "halifax-coastal", displayName: "Halifax", country: "Canada", kind: "coastal city", centre: { lat: 44.6488, lon: -63.5752 }, timeZone: "America/Halifax" },
  { poolId: "charlottetown-smalltown", displayName: "Charlottetown", country: "Canada", kind: "small coastal town", centre: { lat: 46.2382, lon: -63.1311 }, timeZone: "America/Halifax" },
  { poolId: "quebec-city-family", displayName: "Quebec City", country: "Canada", kind: "old city", centre: { lat: 46.8139, lon: -71.208 }, timeZone: "America/Toronto" },
  { poolId: "banff-mountain", displayName: "Banff", country: "Canada", kind: "mountain town", centre: { lat: 51.1784, lon: -115.5708 }, timeZone: "America/Edmonton" },
  { poolId: "lunenburg-coastal", displayName: "Lunenburg", country: "Canada", kind: "small coastal town", centre: { lat: 44.377, lon: -64.3184 }, timeZone: "America/Halifax" },
  { poolId: "montreal-city", displayName: "Montreal", country: "Canada", kind: "big city", centre: { lat: 45.5017, lon: -73.5673 }, timeZone: "America/Toronto" },
  { poolId: "rocky-harbour-gros-morne", displayName: "Rocky Harbour", country: "Canada", kind: "coastal mountain small town", centre: { lat: 49.5917, lon: -57.9184 }, timeZone: "America/St_Johns" }
];

export const BREADTH_DESTINATION_SEEDS: readonly DestinationDTO[] = SEED_SPECS.map((spec) => ({
  destinationId: destinationRegistryId(spec.country, spec.displayName, spec.centre),
  displayName: spec.displayName,
  country: spec.country,
  centre: spec.centre,
  bbox: shadowBBox(spec.centre, spec.kind),
  timeZone: spec.timeZone,
  geocodeProvenance: {
    source: "recorded-destination-registry",
    sourceRef: spec.poolId,
    recordedAt: null,
    label:
      spec.provenanceLabel ??
      `Recorded pool entry coordinates (shadow mock pool, frozen in the Phase 2 fixtures); kind "${spec.kind}" sizes the collection bbox by the shadow rule`
  }
}));

export function breadthDestination(displayName: string): DestinationDTO {
  const found = BREADTH_DESTINATION_SEEDS.find((d) => d.displayName === displayName);
  if (!found) throw new RangeError(`no breadth destination seed named ${displayName}`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Production registry additions (post-breadth)                        */
/*                                                                     */
/* Destinations registered for production beyond the frozen breadth  */
/* corpus. They are full registry citizens (the Supabase PackStore   */
/* seeds its registry from PRODUCTION_DESTINATION_SEEDS) but they    */
/* are NOT breadth fixtures: no golden pack exists for them, and no  */
/* suite may treat them as proven corpus.                            */
/* ------------------------------------------------------------------ */

/** Paris, France — added with the 2026-10-22 production ship for
 *  the tester-lane world-destination proof (Paris, 4 days). Centre
 *  = the recorded city-centre point (Île de la Cité area); the bbox
 *  follows the shadow "big city" sizing rule, like every seed. */
export const PARIS_DESTINATION: DestinationDTO = {
  destinationId: destinationRegistryId("France", "Paris", { lat: 48.8566, lon: 2.3522 }),
  displayName: "Paris",
  country: "France",
  centre: { lat: 48.8566, lon: 2.3522 },
  bbox: shadowBBox({ lat: 48.8566, lon: 2.3522 }, "big city"),
  timeZone: "Europe/Paris",
  geocodeProvenance: {
    source: "recorded-destination-registry",
    sourceRef: "paris-city",
    recordedAt: null,
    label:
      "Recorded city-centre coordinates entered with the 2026-10-22 production ship for the tester-lane world-destination proof (not a shadow pool entry); kind \"big city\" sizes the collection bbox by the shadow rule"
  }
};

/** The registry a production store serves: the breadth corpus plus
 *  every production addition. */
export const PRODUCTION_DESTINATION_SEEDS: readonly DestinationDTO[] = [
  ...BREADTH_DESTINATION_SEEDS,
  PARIS_DESTINATION
];
