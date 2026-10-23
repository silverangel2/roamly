/*
 * Destination photo — the itinerary home's one warm element (owner
 * design, 2026-10-23): a REAL photograph of the destination at the
 * top of the trip, fetched once and then kept.
 *
 * Sources: Wikimedia / Wikidata only — free, no key, the same well
 * the pack harvest drinks from. A photo is never AI-generated: a
 * fabricated picture of a real place would lie to the traveler.
 *
 * Cache: the resolved photo rides in `roamly_admin_settings` — the
 * same key/value table that persists the destination registry
 * (`pack_destination:v1:<id>`) — under `destination_photo:v1:<id>`,
 * so the first trip to a destination pays the lookup and every
 * later trip reuses it at zero marginal cost. No migration: the
 * shape is the registry's own { key, value } JSON row.
 *
 * Honesty rules: the photo must belong to THIS destination — a
 * Wikidata candidate with coordinates far from the trip's own
 * destination coordinates is rejected, and any doubt resolves to
 * null, which renders the approved bare header. Every failure is
 * silent and total: no photo, never a broken image.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  BREADTH_DESTINATION_SEEDS,
  PRODUCTION_DESTINATION_SEEDS
} from "@/lib/roamly/engine/packs/destinations";

export type DestinationPhoto = {
  imageUrl: string;
  /** Commons file page — where the credit links. */
  pageUrl: string | null;
  /** e.g. "OlorinakaGandalf · CC BY-SA 4.0" — shown discreetly. */
  credit: string | null;
  source: "wikimedia-commons";
};

type CachedPhoto = DestinationPhoto & { fetchedAt: string };
type CachedMiss = { none: true; fetchedAt: string };

const SETTINGS_TABLE = "roamly_admin_settings";
const CACHE_PREFIX = "destination_photo:v1:";
const PHOTO_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_COORD_DISTANCE_KM = 150;

function normalizedPlaceName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function wikiFetch(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Roamly/1.0 (https://roamlyhq.com; design photo lookup)",
        accept: "application/json"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

type WikiCandidate = {
  file: string;
  coords: { lat: number; lon: number } | null;
  description: string;
  label: string;
};

/** Wikidata: find the place's lead image (P18), with its coordinates
 *  (P625) so a same-named place on another continent can be refused. */
async function findCommonsFile(
  label: string,
  country: string | null,
  coords: { lat: number; lon: number } | null
): Promise<WikiCandidate | null> {
  // Wikidata entity search matches plain place names; appending the
  // country ("Lunenburg Canada") returns nothing at all. Search the
  // bare label first and let the coordinate gate + scoring pick the
  // right same-named place; the country query is only a fallback.
  const searchTerms = country ? [label, `${label} ${country}`] : [label];
  let ids: string[] = [];
  for (const term of searchTerms) {
    const searchData = (await wikiFetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=8&search=${encodeURIComponent(term)}`
    )) as { search?: Array<{ id?: string }> } | null;
    ids = (searchData?.search || []).map((item) => item.id).filter((id): id is string => Boolean(id));
    if (ids.length) break;
  }
  if (!ids.length) return null;

  const entitiesData = (await wikiFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Cdescriptions%7Clabels&languages=en&ids=${ids.join("|")}`
  )) as {
    entities?: Record<
      string,
      {
        labels?: { en?: { value?: string } };
        descriptions?: { en?: { value?: string } };
        claims?: {
          P18?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>;
          P625?: Array<{
            mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } };
          }>;
        };
      }
    >;
  } | null;
  if (!entitiesData?.entities) return null;

  const wantedName = normalizedPlaceName(label);
  let best: (WikiCandidate & { score: number }) | null = null;
  for (const id of ids) {
    const entity = entitiesData.entities[id];
    if (!entity) continue;
    const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof file !== "string" || !file) continue;
    const coordValue = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    const entityCoords =
      typeof coordValue?.latitude === "number" && typeof coordValue?.longitude === "number"
        ? { lat: coordValue.latitude, lon: coordValue.longitude }
        : null;
    // The honesty gate: when both sides carry coordinates, a photo
    // from a same-named place far away is a lie — refuse it.
    if (coords && entityCoords && distanceKm(coords, entityCoords) > MAX_COORD_DISTANCE_KM) continue;
    const entityLabel = entity.labels?.en?.value || "";
    const description = entity.descriptions?.en?.value || "";
    let score = 0;
    if (normalizedPlaceName(entityLabel) === wantedName) score += 3;
    if (coords && entityCoords) score += Math.max(0, 3 - distanceKm(coords, entityCoords) / 50);
    if (country && description.toLowerCase().includes(country.toLowerCase())) score += 1;
    if (!best || score > best.score) {
      best = { file, coords: entityCoords, description, label: entityLabel, score };
    }
  }
  return best;
}

/** Commons: turn a file name into a sized image URL + license credit. */
async function commonsImageInfo(file: string): Promise<DestinationPhoto | null> {
  const data = (await wikiFetch(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=1600&titles=${encodeURIComponent(`File:${file}`)}`
  )) as {
    query?: {
      pages?: Record<
        string,
        {
          imageinfo?: Array<{
            thumburl?: string;
            url?: string;
            descriptionurl?: string;
            extmetadata?: {
              Artist?: { value?: string };
              LicenseShortName?: { value?: string };
            };
          }>;
        }
      >;
    };
  } | null;
  const page = data?.query?.pages ? Object.values(data.query.pages)[0] : null;
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  const artist = info.extmetadata?.Artist?.value ? stripHtml(info.extmetadata.Artist.value) : "";
  const license = info.extmetadata?.LicenseShortName?.value
    ? stripHtml(info.extmetadata.LicenseShortName.value)
    : "";
  const credit = [artist, license].filter(Boolean).join(" · ") || null;
  return {
    imageUrl: info.thumburl || info.url,
    pageUrl: info.descriptionurl || null,
    credit,
    source: "wikimedia-commons"
  };
}

async function fetchDestinationPhoto(
  label: string,
  country: string | null,
  coords: { lat: number; lon: number } | null
): Promise<DestinationPhoto | null> {
  const candidate = await findCommonsFile(label, country, coords);
  if (!candidate) return null;
  return commonsImageInfo(candidate.file);
}

/** Mirror of the engine's registry match (generate.ts
 *  resolveDestinationId): normalized-name containment over the
 *  compiled-in seeds plus the persisted registry rows. */
async function matchDestinationId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  label: string,
  country: string | null
): Promise<string | null> {
  const wanted = normalizedPlaceName(label);
  if (!wanted) return null;
  const matches = (displayName: string) => {
    const name = normalizedPlaceName(displayName);
    return Boolean(name) && (wanted === name || wanted.includes(name) || name.includes(wanted));
  };
  for (const seed of [...BREADTH_DESTINATION_SEEDS, ...PRODUCTION_DESTINATION_SEEDS]) {
    if (matches(seed.displayName)) return seed.destinationId;
  }
  if (country) {
    for (const seed of [...BREADTH_DESTINATION_SEEDS, ...PRODUCTION_DESTINATION_SEEDS]) {
      if (normalizedPlaceName(seed.country) === normalizedPlaceName(country) && matches(seed.displayName)) {
        return seed.destinationId;
      }
    }
  }
  if (admin) {
    const { data } = await admin
      .from(SETTINGS_TABLE)
      .select("key,value")
      .like("key", "pack_destination:v1:%")
      .limit(500);
    for (const row of (data || []) as Array<{ value?: { destinationId?: string; displayName?: string } }>) {
      const dto = row.value;
      if (dto?.destinationId && dto.displayName && matches(dto.displayName)) return dto.destinationId;
    }
  }
  return null;
}

export async function getDestinationPhoto(input: {
  label: string;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<DestinationPhoto | null> {
  const label = (input.label || "").trim();
  if (!label) return null;
  const country = input.country?.trim() || null;
  const coords =
    typeof input.latitude === "number" && Number.isFinite(input.latitude) &&
    typeof input.longitude === "number" && Number.isFinite(input.longitude)
      ? { lat: input.latitude, lon: input.longitude }
      : null;

  const work = (async (): Promise<DestinationPhoto | null> => {
    const admin = createSupabaseAdminClient();
    const destinationId = await matchDestinationId(admin, label, country).catch(() => null);
    const cacheKey = `${CACHE_PREFIX}${destinationId || `label:${normalizedPlaceName(label)}`}`;

    if (admin) {
      const { data } = await admin
        .from(SETTINGS_TABLE)
        .select("value")
        .eq("key", cacheKey)
        .maybeSingle();
      const cached = data?.value as (CachedPhoto | CachedMiss) | undefined;
      if (cached && typeof cached.fetchedAt === "string") {
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if ("none" in cached && cached.none) {
          if (age < MISS_TTL_MS) return null;
        } else if ("imageUrl" in cached && cached.imageUrl) {
          if (age < PHOTO_TTL_MS) {
            return {
              imageUrl: cached.imageUrl,
              pageUrl: cached.pageUrl ?? null,
              credit: cached.credit ?? null,
              source: "wikimedia-commons"
            };
          }
        }
      }
    }

    const photo = await fetchDestinationPhoto(label, country, coords);

    if (admin) {
      const value: CachedPhoto | CachedMiss = photo
        ? { ...photo, fetchedAt: new Date().toISOString() }
        : { none: true, fetchedAt: new Date().toISOString() };
      await admin
        .from(SETTINGS_TABLE)
        .upsert({ key: cacheKey, value }, { onConflict: "key" })
        .then(() => undefined, () => undefined);
    }
    return photo;
  })();

  // The page never waits on the photo well: past the cap, the bare
  // header renders and the lookup's result still lands in the cache
  // for the next visit whenever it completes server-side.
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000))
  ]).catch(() => null);
}
