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

/**
 * Photo provenance — which tier of the fallback chain produced the
 * photo. Tiers widen WHERE a verified photo of the place comes from;
 * they never substitute a generic picture, and doubt at every tier
 * resolves to null.
 * - "wikimedia-commons" (Tier 0): Wikidata P18 lead image.
 * - "wikimedia-commons-geosearch" (Tier 1): Commons file found by
 *   coordinate geosearch around the place and distance/name gated.
 * - "openstreetmap-image" (Tier 2): the place's own OSM element's
 *   image / wikimedia_commons tag.
 * - "openverse" (Tier 3): Openverse item passing the licence,
 *   name, and destination-context gates.
 */
export type DestinationPhotoSource =
  | "wikimedia-commons"
  | "wikimedia-commons-geosearch"
  | "openstreetmap-image"
  | "openverse";

export type DestinationPhoto = {
  imageUrl: string;
  /** Commons file page — where the credit links. */
  pageUrl: string | null;
  /** e.g. "OlorinakaGandalf · CC BY-SA 4.0" — shown discreetly. */
  credit: string | null;
  source: DestinationPhotoSource;
};

type CachedPhoto = DestinationPhoto & { fetchedAt: string };
type CachedMiss = { none: true; fetchedAt: string };

const SETTINGS_TABLE = "roamly_admin_settings";
// v2 (owner-10 item 3): the lookup learned title variants + French
// labels, so v1 cached misses (e.g. a merged plan title that matched
// nothing) must not shadow the new logic. Bumping the prefix
// re-probes every label once; hits re-cache under v2.
const CACHE_PREFIX = "destination_photo:v2:";
const PHOTO_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_COORD_DISTANCE_KM = 150;

function normalizedPlaceName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** NFD accent fold: "Marché" -> "Marche", so a French place name and
 *  an ASCII-folded file title / catalogue entry compare equal. */
function accentFold(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** normalizedPlaceName over the accent-folded value — the comparison
 *  form the fallback tiers' gates use. */
function normalizedFoldedName(value: string) {
  return normalizedPlaceName(accentFold(value));
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

/**
 * Owner-10 item 3 — title variants, derived mechanically from the
 * stop's own title, never hand-rewritten per venue:
 * 1. the full title verbatim;
 * 2. the title before " et du " / " et de " / " et " (merged plan
 *    titles such as "Musée du marché Sainte-Anne et du parlement…"
 *    name two things; the first is the venue);
 * 3. the title with a generic leading venue word stripped ("Musée
 *    du ", "Musée de ", "Musée ", "Le ", "La ", "Les ");
 * 4. (2) with the same strip.
 * Proven case: (4) turns the Musée stop into "marché Sainte-Anne",
 * whose French Wikidata label matches exactly at 0.1 km. Variants
 * that match nothing (Galerie Blanche, Resto Végo, Le Centre d'art
 * et musée de Montréal) still return null — a miss stays bare.
 */
function labelVariants(label: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const text = value.trim().replace(/\s+/g, " ");
    if (text && !out.includes(text)) out.push(text);
  };
  const stripPrefix = (value: string) =>
    value.replace(/^(musée\s+du\s+|musée\s+de\s+|musée\s+|le\s+|la\s+|les\s+)/i, "");
  push(label);
  const etSplit = label.split(/\s+et\s+du\s+|\s+et\s+de\s+|\s+et\s+/i)[0];
  push(etSplit);
  push(stripPrefix(label));
  push(stripPrefix(etSplit));
  return out.slice(0, 4);
}

/** Distinctive tokens (length > 2) of a normalized name, for overlap. */
function distinctiveTokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((token) => token.length > 2));
}

type WikiEntity = {
  labels?: { en?: { value?: string }; fr?: { value?: string } };
  descriptions?: { en?: { value?: string }; fr?: { value?: string } };
  claims?: {
    P18?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>;
    P625?: Array<{
      mainsnak?: { datavalue?: { value?: { latitude?: number; longitude?: number } } };
    }>;
  };
};

function entityCoordsOf(entity: WikiEntity): { lat: number; lon: number } | null {
  const coordValue = entity.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  return typeof coordValue?.latitude === "number" && typeof coordValue?.longitude === "number"
    ? { lat: coordValue.latitude, lon: coordValue.longitude }
    : null;
}

function entityLabelsOf(entity: WikiEntity): string[] {
  return [entity.labels?.en?.value, entity.labels?.fr?.value].filter(
    (value): value is string => typeof value === "string" && Boolean(value)
  );
}

/** Score one candidate against one variant. The 150 km gate is
 *  applied by the caller before scoring; this only ranks. */
function scoreCandidate(
  entity: WikiEntity,
  variant: string,
  country: string | null,
  coords: { lat: number; lon: number } | null,
  entityCoords: { lat: number; lon: number } | null
): number {
  const wantedName = normalizedPlaceName(variant);
  const labels = entityLabelsOf(entity);
  const description = entity.descriptions?.en?.value || entity.descriptions?.fr?.value || "";
  let score = 0;
  // French labels count: Wikidata's English label for a French venue
  // is often a translation ("St. Anne's Market") while the French
  // label is the venue's own name ("marché Sainte-Anne").
  if (labels.some((label) => normalizedPlaceName(label) === wantedName)) score += 3;
  const wantedTokens = distinctiveTokens(wantedName);
  let shared = 0;
  for (const label of labels) {
    const labelTokens = distinctiveTokens(normalizedPlaceName(label));
    for (const token of wantedTokens) if (labelTokens.has(token)) shared += 1;
    if (shared) break;
  }
  score += Math.min(shared, 2);
  if (coords && entityCoords) score += Math.max(0, 3 - distanceKm(coords, entityCoords) / 50);
  if (country && description.toLowerCase().includes(country.toLowerCase())) score += 1;
  return score;
}

/** Wikidata: find the place's lead image (P18), with its coordinates
 *  (P625) so a same-named place on another continent can be refused. */
async function findCommonsFile(
  label: string,
  country: string | null,
  coords: { lat: number; lon: number } | null
): Promise<WikiCandidate | null> {
  // Wikidata entity search matches plain place names; appending the
  // country ("Lunenburg Canada") returns nothing at all. Search the
  // bare variant first (French, then English — French venues are
  // indexed under French first) and let the coordinate gate +
  // scoring pick the right same-named place; the country query is
  // only a fallback for the full label.
  for (const variant of labelVariants(label)) {
    const searchTerms = [variant, ...(variant === label && country ? [`${label} ${country}`] : [])];
    let ids: string[] = [];
    for (const term of searchTerms) {
      for (const lang of ["fr", "en"]) {
        const searchData = (await wikiFetch(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=${lang}&type=item&limit=8&search=${encodeURIComponent(term)}`
        )) as { search?: Array<{ id?: string }> } | null;
        ids = (searchData?.search || []).map((item) => item.id).filter((id): id is string => Boolean(id));
        if (ids.length) break;
      }
      if (ids.length) break;
    }
    if (!ids.length) continue;

    const entitiesData = (await wikiFetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Cdescriptions%7Clabels&languages=en%7Cfr&ids=${ids.join("|")}`
    )) as { entities?: Record<string, WikiEntity> } | null;
    if (!entitiesData?.entities) continue;

    let best: (WikiCandidate & { score: number }) | null = null;
    for (const id of ids) {
      const entity = entitiesData.entities[id];
      if (!entity) continue;
      const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (typeof file !== "string" || !file) continue;
      const entityCoords = entityCoordsOf(entity);
      // The honesty gate: a coords-bearing query must resolve to a
      // coords-bearing entity within 150 km. An entity with no
      // coordinates cannot be verified to be THIS place — doubt
      // resolves to null, never to a same-named place on another
      // continent (proven 2026-10-26: "WIP" matched a Bangalore office
      // photo because the vacuous gate let a coords-less entity win).
      if (coords && (!entityCoords || distanceKm(coords, entityCoords) > MAX_COORD_DISTANCE_KM)) continue;
      const labels = entityLabelsOf(entity);
      const entityLabel = labels[0] || "";
      const description = entity.descriptions?.en?.value || entity.descriptions?.fr?.value || "";
      const score = scoreCandidate(entity, variant, country, coords, entityCoords);
      if (!best || score > best.score) {
        best = { file, coords: entityCoords, description, label: entityLabel, score };
      }
    }
    // Zero-evidence matches never win: a candidate with no name match,
    // no proximity bonus, and no country mention is a guess, not a photo
    // of this place. The first variant that yields a scored candidate
    // wins — the full title outranks its own shortenings.
    if (best && best.score > 0) return best;
  }
  return null;
}

/**
 * Owner-10 item 3 — coords-based entity search, the last resort when
 * no text variant matches. Strict by construction: the entity must
 * carry P18, sit within the 150 km gate (geosearch itself caps at
 * 2 km), AND share at least two distinctive tokens with some variant
 * of the stop's own title. A junk title ("WIP") shares zero tokens
 * with every nearby entity, so it still returns null; a venue with
 * no Wikidata entity at all (Galerie Blanche) likewise stays null.
 */
async function findCommonsFileByGeosearch(
  label: string,
  coords: { lat: number; lon: number }
): Promise<WikiCandidate | null> {
  const geoData = (await wikiFetch(
    `https://www.wikidata.org/w/api.php?action=query&format=json&list=geosearch&gscoord=${coords.lat}%7C${coords.lon}&gsradius=2000&gslimit=20`
  )) as { query?: { geosearch?: Array<{ title?: string }> } } | null;
  const ids = (geoData?.query?.geosearch || [])
    .map((item) => item.title)
    .filter((id): id is string => typeof id === "string" && id.startsWith("Q"));
  if (!ids.length) return null;
  const entitiesData = (await wikiFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims%7Clabels&languages=en%7Cfr&ids=${ids.join("|")}`
  )) as { entities?: Record<string, WikiEntity> } | null;
  if (!entitiesData?.entities) return null;
  const variantTokenSets = labelVariants(label).map((variant) =>
    distinctiveTokens(normalizedPlaceName(variant))
  );
  let best: (WikiCandidate & { score: number }) | null = null;
  for (const id of ids) {
    const entity = entitiesData.entities[id];
    if (!entity) continue;
    const file = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof file !== "string" || !file) continue;
    const entityCoords = entityCoordsOf(entity);
    if (!entityCoords || distanceKm(coords, entityCoords) > MAX_COORD_DISTANCE_KM) continue;
    const labels = entityLabelsOf(entity);
    let shared = 0;
    for (const labelText of labels) {
      const labelTokens = distinctiveTokens(normalizedPlaceName(labelText));
      for (const variantTokens of variantTokenSets) {
        for (const token of variantTokens) if (labelTokens.has(token)) shared += 1;
      }
      if (shared >= 2) break;
    }
    if (shared < 2) continue;
    const score = shared + Math.max(0, 3 - distanceKm(coords, entityCoords) / 50);
    if (!best || score > best.score) {
      best = { file, coords: entityCoords, description: "", label: labels[0] || "", score };
    }
  }
  return best;
}

type CommonsImageInfo = {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value?: string };
    LicenseShortName?: { value?: string };
  };
};

/** Build the photo from one Commons imageinfo record: the stepped
 *  thumburl the API returns for iiurlwidth (never a hand-built thumb
 *  URL) plus the licence credit from extmetadata. Shared by Tier 0
 *  (commonsImageInfo) and Tier 1 (geosearch pages carry imageinfo
 *  inline), so the credit/thumb behaviour is identical at both. */
function photoFromImageInfo(
  info: CommonsImageInfo | null | undefined,
  source: DestinationPhotoSource
): DestinationPhoto | null {
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
    source
  };
}

/** Commons: turn a file name into a sized image URL + license credit. */
async function commonsImageInfo(
  file: string,
  source: DestinationPhotoSource = "wikimedia-commons"
): Promise<DestinationPhoto | null> {
  const data = (await wikiFetch(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=1600&titles=${encodeURIComponent(`File:${file}`)}`
  )) as {
    query?: {
      pages?: Record<
        string,
        {
          imageinfo?: CommonsImageInfo[];
        }
      >;
    };
  } | null;
  const page = data?.query?.pages ? Object.values(data.query.pages)[0] : null;
  const info = page?.imageinfo?.[0];
  return photoFromImageInfo(info, source);
}

/* ------------------------------------------------------------------ */
/* Tier 1 — Commons geosearch around the place's own coordinates.     */
/* Runs only when Tier 0 found nothing AND the place carries          */
/* coordinates. A file is eligible only when it is verifiably of      */
/* THIS place: its own coordinates within the pass radius, or — for   */
/* a file with no coordinates — an exact folded title match PLUS a    */
/* destination-context token in its title or categories. Anything     */
/* else is a picture of somewhere else and resolves to null.          */
/*                                                                    */
/* Pass 1 (250 m) is unchanged: proximity alone gates it. Pass 2      */
/* (1000 m) additionally demands a DISTINCTIVE name match: the file   */
/* title must share at least one token from the place name's          */
/* distinctive set — its accent-folded, length>2 tokens minus the     */
/* generic type/filler set GENERIC_PLACE_TOKENS below (historic,      */
/* house, museum, park, …). Generic-only overlap does NOT pass. If    */
/* the distinctive set is empty (the name is all generic words, e.g.  */
/* "National Park"), pass 2 instead requires full containment: the    */
/* file title must contain ALL of the place name's tokens.            */
/* Why: live coverage evidence 2026-11-03 (coverage-log §3, place     */
/* X04 Beaconsfield Historic House, Charlottetown) — a Commons        */
/* geosearch at 1000 m contains "Charlottetown historic house 01.jpg" */
/* ~500 m away, a DIFFERENT house, sharing only the generic tokens    */
/* "historic"/"house". The old pass-2 rule (share >=1 token where     */
/* "distinctive" meant only length>2) could have admitted that        */
/* wrong-house photo. The honesty law — a photo must BE the place —   */
/* forbids that, so generic tokens no longer verify a pass-2 file.    */
/* ------------------------------------------------------------------ */

type CommonsGeoPage = {
  title?: string;
  coordinates?: Array<{ lat?: number; lon?: number }>;
  categories?: Array<{ title?: string }>;
  imageinfo?: CommonsImageInfo[];
};

/** "File:Marché Sainte-Anne (Montreal).jpg" -> "Marché Sainte-Anne":
 *  strip the namespace, the extension, and one trailing parenthetical. */
function commonsTitleBase(title: string): string {
  return title
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared;
}

/** Generic place-name tokens for the Tier 1 pass-2 gate: words that
 *  describe a TYPE of place or are pure filler, so sharing one proves
 *  nothing about identity — two different historic houses share
 *  "historic" and "house" without being the same place (X04 evidence,
 *  2026-11-03, see the Tier 1 header above). Matched against the
 *  accent-folded normalized tokens the Tier 1 code already produces
 *  (normalizedFoldedName + distinctiveTokens), so entries are the
 *  folded lowercase forms. */
const GENERIC_PLACE_TOKENS = new Set([
  "historic",
  "historical",
  "house",
  "museum",
  "park",
  "garden",
  "gardens",
  "church",
  "cathedral",
  "chapel",
  "market",
  "centre",
  "center",
  "gallery",
  "library",
  "theatre",
  "theater",
  "hotel",
  "station",
  "street",
  "road",
  "avenue",
  "bridge",
  "tower",
  "castle",
  "palace",
  "beach",
  "lake",
  "mount",
  "mountain",
  "memorial",
  "national",
  "public",
  "royal",
  "old",
  "new",
  "grand",
  "saint",
  "sainte",
  "st",
  "ste",
  "the",
  "of",
  "and",
  "et",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les"
]);

/** True when any distinctive token of the folded context appears as
 *  a token (or folded substring) in one of the folded haystacks. */
function contextAppearsIn(contextFolded: string, haystacksFolded: string[]): boolean {
  const contextTokens = distinctiveTokens(contextFolded);
  const probes = contextTokens.size ? [...contextTokens] : contextFolded ? [contextFolded] : [];
  if (!probes.length) return false;
  for (const haystack of haystacksFolded) {
    if (!haystack) continue;
    const haystackTokens = new Set(haystack.split(" ").filter(Boolean));
    for (const probe of probes) {
      if (haystackTokens.has(probe) || haystack.includes(probe)) return true;
    }
  }
  return false;
}

async function findCommonsPhotoByGeosearch(
  label: string,
  country: string | null,
  coords: { lat: number; lon: number },
  contextLabel: string | null
): Promise<DestinationPhoto | null> {
  const wantedFolded = normalizedFoldedName(label);
  const placeTokens = distinctiveTokens(wantedFolded);
  // Tier 1 pass-2 distinctive set: the place's tokens minus the
  // generic type/filler set. Pass 1 does not use this set.
  const distinctivePlaceTokens = new Set(
    [...placeTokens].filter((token) => !GENERIC_PLACE_TOKENS.has(token))
  );
  // Tokens the full-containment fallback (empty distinctive set)
  // demands in full. Normally placeTokens; if every token was
  // filtered out by the length>2 rule, fall back to the raw folded
  // tokens so the fallback still has something exact to require.
  const rawPlaceTokens = new Set(wantedFolded.split(" ").filter(Boolean));
  const fullContainmentTokens = placeTokens.size ? placeTokens : rawPlaceTokens;
  const context = (contextLabel || "").trim() || country;
  const contextFolded = context ? normalizedFoldedName(context) : "";

  type Ranked = { page: CommonsGeoPage; distanceM: number; overlap: number };
  // Pass 1 at 250 m, then — only if it produced no gated candidate —
  // pass 2 at 1000 m. Pass rank dominates; within a pass, nearer
  // wins and token overlap breaks ties.
  for (const radius of [250, 1000]) {
    const data = (await wikiFetch(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggsprimary=all&ggsnamespace=6&ggsradius=${radius}&ggscoord=${coords.lat}%7C${coords.lon}&ggslimit=50&prop=imageinfo%7Ccoordinates%7Ccategories&iiprop=url%7Cextmetadata&iiurlwidth=1600`
    )) as { query?: { pages?: Record<string, CommonsGeoPage> } } | null;
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    const eligible: Ranked[] = [];
    for (const page of pages) {
      const title = typeof page.title === "string" ? page.title : "";
      if (!title) continue;
      const titleFolded = normalizedFoldedName(commonsTitleBase(title));
      const titleTokens = distinctiveTokens(titleFolded);
      const titleRawTokens = new Set(titleFolded.split(" ").filter(Boolean));
      const overlap = tokenOverlap(placeTokens, titleTokens);
      const fileCoord = page.coordinates?.[0];
      const fileCoords =
        typeof fileCoord?.lat === "number" && typeof fileCoord?.lon === "number"
          ? { lat: fileCoord.lat, lon: fileCoord.lon }
          : null;
      if (fileCoords) {
        const distanceM = distanceKm(coords, fileCoords) * 1000;
        if (distanceM > radius) continue;
        // Pass 2 widens the radius, so it tightens the name gate
        // (see the Tier 1 header): a file up to 1 km away must share
        // at least one DISTINCTIVE token — a generic-only match such
        // as "historic"/"house" (X04 wrong house, 2026-11-03) does
        // not pass. When the place name has no distinctive token at
        // all, the title must instead contain ALL of its tokens.
        if (radius > 250) {
          if (distinctivePlaceTokens.size > 0) {
            if (tokenOverlap(distinctivePlaceTokens, titleTokens) < 1) continue;
          } else {
            if (!fullContainmentTokens.size) continue;
            let containsAll = true;
            for (const token of fullContainmentTokens) {
              if (!titleRawTokens.has(token)) {
                containsAll = false;
                break;
              }
            }
            if (!containsAll) continue;
          }
        }
        eligible.push({ page, distanceM, overlap });
      } else {
        // No coordinates of its own: only an exact folded title match
        // plus destination context in the title or categories can
        // verify this file is the place. No context => reject.
        if (normalizedFoldedName(commonsTitleBase(title)) !== wantedFolded) continue;
        if (!contextFolded) continue;
        const categoryTitles = (page.categories || [])
          .map((category) => (typeof category.title === "string" ? category.title.replace(/^Category:/i, "") : ""))
          .filter(Boolean);
        const haystacks = [normalizedFoldedName(title), ...categoryTitles.map((t) => normalizedFoldedName(t))];
        if (!contextAppearsIn(contextFolded, haystacks)) continue;
        eligible.push({ page, distanceM: Number.POSITIVE_INFINITY, overlap });
      }
    }
    eligible.sort((a, b) => a.distanceM - b.distanceM || b.overlap - a.overlap);
    for (const candidate of eligible) {
      const photo = photoFromImageInfo(candidate.page.imageinfo?.[0], "wikimedia-commons-geosearch");
      if (photo) return photo;
    }
    if (eligible.length) return null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Tier 2 — the place's own OpenStreetMap element tags.               */
/* The gate is that the tag lives on the place's own element,         */
/* fetched by exact id: an image pointer the mapper attached to       */
/* THIS node/way/relation is a claim about this place, not a search   */
/* result. A Commons pointer still resolves through Commons           */
/* imageinfo, so the photo keeps its stepped thumb + licence credit;  */
/* any other URL must answer live as an image before it is used.      */
/* ------------------------------------------------------------------ */

const OSM_ID_PATTERN = /^(node|way|relation)\/\d+$/;

/** Extract a Commons file name from a Commons-ish URL, or null. */
function commonsFileFromUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value).trim() || null;
    } catch {
      return null;
    }
  };
  if (host === "commons.wikimedia.org") {
    const fileMatch = path.match(/\/wiki\/File:(.+)$/);
    if (fileMatch) return decode(fileMatch[1]);
    const specialMatch = path.match(/\/wiki\/Special:FilePath\/(.+)$/);
    if (specialMatch) return decode(specialMatch[1]);
    return null;
  }
  if (host === "upload.wikimedia.org" || host === "thumb.wikimedia.org") {
    if (!path.startsWith("/wikipedia/commons/")) return null;
    const segments = path.split("/").filter(Boolean);
    if (!segments.length) return null;
    // Thumb layout: .../thumb/<a>/<ab>/<file>/<width>-<file> — the
    // real file name is the segment before the sized derivative.
    if (segments.includes("thumb")) {
      return segments.length >= 2 ? decode(segments[segments.length - 2]) : null;
    }
    return decode(segments[segments.length - 1]);
  }
  return null;
}

/** Live validation for a non-Commons image URL: HEAD first, GET with
 *  a small Range when HEAD is refused; only a 2xx image/* passes. */
async function osmImageUrlIsLiveImage(url: string): Promise<boolean> {
  const headers = { "user-agent": "Roamly/1.0 (https://roamlyhq.com; design photo lookup)" };
  const isImage = (response: Response) =>
    response.ok &&
    (response.headers.get("content-type") || "").toLowerCase().startsWith("image/");
  try {
    const head = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(4000) });
    if (isImage(head)) return true;
    if (head.ok) return false; // answered, but not an image
  } catch {
    // HEAD refused at the transport level — fall through to GET.
  }
  try {
    const get = await fetch(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-2047" },
      signal: AbortSignal.timeout(4000)
    });
    return isImage(get);
  } catch {
    return false;
  }
}

async function findOsmElementPhoto(osmId: string): Promise<DestinationPhoto | null> {
  if (!OSM_ID_PATTERN.test(osmId)) return null;
  const data = (await wikiFetch(`https://www.openstreetmap.org/api/0.6/${osmId}.json`)) as {
    elements?: Array<{ tags?: Record<string, unknown> }>;
  } | null;
  const tags = data?.elements?.[0]?.tags;
  if (!tags || typeof tags !== "object") return null;
  const commonsTag = typeof tags.wikimedia_commons === "string" ? tags.wikimedia_commons.trim() : "";
  if (commonsTag.startsWith("File:")) {
    const photo = await commonsImageInfo(commonsTag.slice("File:".length).trim(), "openstreetmap-image");
    if (photo) return photo;
  }
  // "Category:" wikimedia_commons values name a gallery, not this
  // place's photo — skipped; the image tag below is the only other
  // pointer the element carries.
  const imageUrl = typeof tags.image === "string" ? tags.image.trim() : "";
  if (!imageUrl) return null;
  const commonsFile = commonsFileFromUrl(imageUrl);
  if (commonsFile) return commonsImageInfo(commonsFile, "openstreetmap-image");
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  if (!(await osmImageUrlIsLiveImage(imageUrl))) return null;
  return {
    imageUrl,
    pageUrl: `https://www.openstreetmap.org/${osmId}`,
    credit: null,
    source: "openstreetmap-image"
  };
}

/* ------------------------------------------------------------------ */
/* Tier 3 — Openverse, last resort. The query filter is never         */
/* trusted on its own: each item's licence is re-verified from the    */
/* payload, the place name must match the item (title substring, or   */
/* every distinctive token across title + tags), and when a           */
/* destination context is known one of its tokens must also appear.   */
/* Without a context, only the title-substring form passes — a tag-   */
/* only match cannot prove the photo is this place in this city.      */
/* ------------------------------------------------------------------ */

const OPENVERSE_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);

function openverseLicenseLabel(license: string, version: unknown): string {
  const versionText = typeof version === "string" && version.trim() ? ` ${version.trim()}` : "";
  switch (license) {
    case "cc0":
      return "CC0";
    case "pdm":
      return "Public Domain Mark";
    case "by-sa":
      return `CC BY-SA${versionText}`;
    default:
      return `CC BY${versionText}`;
  }
}

async function findOpenversePhoto(
  label: string,
  contextLabel: string | null
): Promise<DestinationPhoto | null> {
  const data = (await wikiFetch(
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(label)}&license=cc0,pdm,by,by-sa&license_type=commercial&page_size=20`
  )) as {
    results?: Array<{
      title?: unknown;
      url?: unknown;
      thumbnail?: unknown;
      foreign_landing_url?: unknown;
      license?: unknown;
      license_version?: unknown;
      creator?: unknown;
      tags?: unknown;
    }>;
  } | null;
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;
  const wantedFolded = normalizedFoldedName(label);
  const placeTokens = distinctiveTokens(wantedFolded);
  const contextFolded = contextLabel ? normalizedFoldedName(contextLabel) : "";
  const contextTokens = contextFolded ? distinctiveTokens(contextFolded) : new Set<string>();

  for (const item of results) {
    const license = typeof item.license === "string" ? item.license.trim().toLowerCase() : "";
    if (!OPENVERSE_LICENSES.has(license)) continue;
    const titleFolded = normalizedFoldedName(typeof item.title === "string" ? item.title : "");
    const tagNames: string[] = [];
    if (Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        if (typeof tag === "string") tagNames.push(tag);
        else if (tag && typeof tag === "object" && typeof (tag as { name?: unknown }).name === "string") {
          tagNames.push((tag as { name: string }).name);
        }
      }
    }
    const titleTokens = new Set(titleFolded.split(" ").filter(Boolean));
    const tagTokenSet = new Set<string>();
    for (const name of tagNames) {
      for (const token of normalizedFoldedName(name).split(" ").filter(Boolean)) tagTokenSet.add(token);
    }
    const substringPass = Boolean(wantedFolded) && titleFolded.includes(wantedFolded);
    const tokenUnion = new Set([...titleTokens, ...tagTokenSet]);
    const tokenPass =
      placeTokens.size > 0 && [...placeTokens].every((token) => tokenUnion.has(token));
    if (contextFolded) {
      if (!substringPass && !tokenPass) continue;
      // Context gate: a distinctive context token must appear in the
      // title, the tags, or the source page URL.
      const landingFolded = normalizedFoldedName(
        typeof item.foreign_landing_url === "string" ? item.foreign_landing_url : ""
      );
      const landingTokens = new Set(landingFolded.split(" ").filter(Boolean));
      const contextHit = [...contextTokens].some(
        (token) => titleTokens.has(token) || tagTokenSet.has(token) || landingTokens.has(token)
      );
      if (!contextHit) continue;
    } else if (!substringPass) {
      continue;
    }
    const imageUrl =
      (typeof item.thumbnail === "string" && item.thumbnail) ||
      (typeof item.url === "string" && item.url) ||
      "";
    if (!imageUrl) continue;
    const pageUrl =
      (typeof item.foreign_landing_url === "string" && item.foreign_landing_url) ||
      (typeof item.url === "string" && item.url) ||
      null;
    const licenseLabel = openverseLicenseLabel(license, item.license_version);
    const creator = typeof item.creator === "string" ? item.creator.trim() : "";
    return {
      imageUrl,
      pageUrl,
      credit: creator ? `${creator} · ${licenseLabel}` : licenseLabel,
      source: "openverse"
    };
  }
  return null;
}

async function fetchDestinationPhoto(
  label: string,
  country: string | null,
  coords: { lat: number; lon: number } | null,
  options?: { osmId?: string | null; contextLabel?: string | null }
): Promise<DestinationPhoto | null> {
  const contextLabel = options?.contextLabel?.trim() || null;
  const osmId = options?.osmId?.trim() || null;
  // Tier 0 — Wikidata lead image (unchanged behaviour).
  const candidate =
    (await findCommonsFile(label, country, coords)) ||
    (coords ? await findCommonsFileByGeosearch(label, coords) : null);
  if (candidate) return commonsImageInfo(candidate.file);
  // Tier 1 — Commons geosearch around the place (coords only).
  if (coords) {
    const tier1 = await findCommonsPhotoByGeosearch(label, country, coords, contextLabel);
    if (tier1) return tier1;
  }
  // Tier 2 — the place's own OSM element tags (osmId only).
  if (osmId) {
    const tier2 = await findOsmElementPhoto(osmId);
    if (tier2) return tier2;
  }
  // Tier 3 — Openverse, licence + name + context gated.
  return findOpenversePhoto(label, contextLabel);
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
  /** The place's own OSM element ("node/123" | "way/123" |
   *  "relation/123" — the pack osmKey format), when the caller has
   *  it. Enables Tier 2; anything else is ignored by the tier's own
   *  format gate. */
  osmId?: string | null;
  /** Destination / city display name, when the caller knows it.
   *  Feeds the Tier 1 coord-less context gate and the Tier 3
   *  context gate; never used as a photo label itself. */
  contextLabel?: string | null;
}): Promise<DestinationPhoto | null> {
  const label = (input.label || "").trim();
  if (!label) return null;
  const country = input.country?.trim() || null;
  const osmId = input.osmId?.trim() || null;
  const contextLabel = input.contextLabel?.trim() || null;
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
              // Provenance is part of the cached fact: a fallback
              // tier's photo must never be re-labelled as Tier 0 on
              // a cache hit. Only a legacy record with no stored
              // source at all falls back to the Tier 0 label.
              source: cached.source || "wikimedia-commons"
            };
          }
        }
      }
    }

    const photo = await fetchDestinationPhoto(label, country, coords, { osmId, contextLabel });

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
