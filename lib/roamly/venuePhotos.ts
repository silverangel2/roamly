/**
 * Venue-row thumbnails (originals pass, 2026-10-26).
 *
 * The mock timeline rows (Home + Live) carry a small photo thumbnail
 * beside the icon for venue rows; travel/arrive rows carry icons only.
 * Rule, enforced here: a row shows a thumbnail ONLY when the real
 * pipeline returns a photo for that stop. No photo = the icon
 * treatment, never a mock photo, never a broken image (the thumbnail
 * component unmounts on error). Thumbnails are keyed by normalized
 * stop title, so the trip page and the live page share one map shape
 * without threading coordinates through the timeline builders.
 */
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";

export type VenuePhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
};

export type VenuePhotoMap = Record<string, VenuePhoto>;

/** Lowercase, accent-stripped, whitespace-collapsed — the map key. */
export function normalizeVenueTitle(title: string | null | undefined): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type TimelineSeed = {
  title?: unknown;
  item_type?: unknown;
  type?: unknown;
  coordinates?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

function seedTitle(seed: TimelineSeed): string {
  const raw = seed.title;
  return typeof raw === "string" ? raw : "";
}

function seedKind(seed: TimelineSeed): string {
  const raw = seed.item_type ?? seed.type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

function seedCoords(seed: TimelineSeed): { latitude: number; longitude: number } | null {
  const directLat = seed.latitude;
  const directLon = seed.longitude;
  if (typeof directLat === "number" && typeof directLon === "number") {
    return { latitude: directLat, longitude: directLon };
  }
  const coords = seed.coordinates;
  if (coords && typeof coords === "object" && !Array.isArray(coords)) {
    const nested = coords as Record<string, unknown>;
    const lat = nested.latitude ?? nested.lat;
    const lon = nested.longitude ?? nested.lon ?? nested.lng;
    if (typeof lat === "number" && typeof lon === "number") {
      return { latitude: lat, longitude: lon };
    }
  }
  return null;
}

/** Venue rows only: activities + meals. Travel, transfers, hotels,
 *  rests, bookings, and reminders never get thumbnails (the mock
 *  gives those rows icons only). */
export function isVenueTimelineSeed(seed: TimelineSeed): boolean {
  const kind = seedKind(seed);
  return kind === "activity" || kind === "meal";
}

/**
 * Fetch pipeline photos for every distinct venue stop across the
 * given days, in parallel (each lookup races at the pipeline's own
 * 6s cap). Misses are simply absent from the map. Cold-cache cost
 * is bounded by one parallel round; warm cache (90-day photo TTL
 * in roamly_admin_settings, when writable) makes later renders cheap.
 */
export async function buildVenuePhotoMap(
  days: ReadonlyArray<{ live_timeline?: ReadonlyArray<TimelineSeed> | null } | null> | null,
  country: string | null
): Promise<VenuePhotoMap> {
  const wanted = new Map<string, { label: string; latitude: number | null; longitude: number | null }>();
  for (const day of days || []) {
    for (const seed of day?.live_timeline || []) {
      if (!seed || !isVenueTimelineSeed(seed)) continue;
      const label = seedTitle(seed);
      const key = normalizeVenueTitle(label);
      if (!key || wanted.has(key)) continue;
      const coords = seedCoords(seed);
      wanted.set(key, { label, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null });
    }
  }
  const entries = await Promise.all(
    [...wanted.entries()].map(async ([key, want]) => {
      const photo = await getDestinationPhoto({
        label: want.label,
        country,
        latitude: want.latitude,
        longitude: want.longitude
      }).catch(() => null);
      if (!photo) return null;
      return [key, { imageUrl: photo.imageUrl, credit: photo.credit ?? null, pageUrl: photo.pageUrl ?? null }] as const;
    })
  );
  const map: VenuePhotoMap = {};
  for (const entry of entries) {
    if (entry) map[entry[0]] = entry[1];
  }
  return map;
}

/** Map lookup for a rendered row title. Miss = icon treatment. */
export function venuePhotoForTitle(
  map: VenuePhotoMap | null | undefined,
  title: string | null | undefined
): VenuePhoto | null {
  if (!map) return null;
  return map[normalizeVenueTitle(title)] || null;
}
