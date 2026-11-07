import type { DestinationDTO, ProvenanceDTO } from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import type { StoredCandidate } from "@/lib/roamly/engine/packs/types";
import {
  OVERTURE_EXTRACT_CLASSIFIER_VERSION,
  OVERTURE_EXTRACT_FORMAT,
  OVERTURE_EXTRACT_SLICE_VERSION
} from "@/lib/roamly/engine/packs/types";
import {
  DEFAULT_FETCH_POLICY,
  systemFetcher,
  type FetchPolicy,
  type Fetcher
} from "@/lib/roamly/engine/packs/collectors";
import { insideDestinationCoverage } from "@/lib/roamly/engine/packs/destinations";
import {
  OPEN_PLACES_KINDS,
  classifyOvertureRecord,
  toOpenPlacesCandidate,
  type OpenPlacesRecord
} from "@/lib/roamly/engine/packs/openPlaces";

/*
 * Overture Places EXTRACT collector — the PRIMARY pack supply
 * (SPEED FIX F1, 2026-11-07; owner consolidation strategy: proven
 * free components become primary, Roamly hand-rolled machinery is
 * the honest fallback).
 *
 * Why this lane exists: a fresh destination's pack used to be
 * collected LIVE from the public Overpass mirrors inside an
 * hourly cron drain — up to the 210 s collection deadline, behind
 * a 0–60 min timer wait, on shared mirrors that 502 under a single
 * build (CRAWL-INVESTIGATION-REPORT 2026-11-07: two production
 * trips waited 41 and 78 minutes for 5–6 s of actual generation).
 * Overture Maps publishes the whole Places dataset (72M+ POIs,
 * CDLA Permissive 2.0) as public S3 parquet, spatially clustered
 * with per-row-group bbox statistics, so a per-city extract is a
 * few range reads (scripts/roamly-overture-extract-slice.mjs).
 * Building a pack from the extract is a local classification of
 * static data: seconds, no live mirror, no queue.
 *
 * Why Overture and not Foursquare OS Places (the other candidate
 * the investigation scanned): the codebase already carries a
 * complete, proven Overture classifier (openPlaces.ts —
 * classifyOvertureRecord over the Overture taxonomy), and the
 * parquet's taxonomy columns are that same taxonomy, so the
 * extract lane reuses it verbatim. FSQ's taxonomy is a different
 * vocabulary (a brand-new classifier to prove) and its parquet is
 * not spatially partitioned, so a one-city slice cannot prune by
 * row-group statistics the way Overture's can. FSQ stays a future
 * enrichment candidate, not the primary.
 *
 * Lane discipline (the codebase's whole-pack rule, unchanged):
 * one source per pack version, never a merge. builder.ts's
 * primaryCollector tries this lane first; it serves ONLY when the
 * extract exists for the destination AND classifies to a viable
 * pack (sight stock at the codebase's own thin bar). No extract,
 * a thin extract, or any lane error → the live lane (Overpass
 * ladder → Open Places API fallback) builds the pack exactly as
 * before, and ITS provenance says so. An extract pack's
 * provenance names the dataset release it was sliced from.
 */

export interface OvertureExtractFile {
  format: string;
  /** Overture data release the slice was cut from ("2026-10-21.0"). */
  release: string;
  slicedAt: string;
  destination: {
    destinationId: string;
    displayName?: string;
    country?: string;
  };
  records: OpenPlacesRecord[];
}

export interface ExtractEvidence {
  release: string;
  slicedAt: string | null;
  recordsReceived: number;
  droppedOutOfCoverage: number;
  unclassified: number;
  dedupedNameKind: number;
  /** Per-kind candidate counts — ALL 14 kinds, zeros explicit. */
  byKind: Record<string, number>;
}

export interface ExtractCollection {
  candidates: StoredCandidate[];
  evidence: ExtractEvidence;
}

/** One extract record -> the stored row shape: the API lane's own
 *  conversion, plus the dataset tag that keeps the row's
 *  provenance label truthful (see candidateRowToDTO in builder.ts:
 *  an extract row must not claim it arrived "via Open Places
 *  API"). The candidateKey stays "overture:<id>" — the place's
 *  identity is the same GERS id whichever lane served it. */
export function toExtractCandidate(rec: OpenPlacesRecord, kind: string): StoredCandidate {
  const base = toOpenPlacesCandidate(rec, kind);
  return { ...base, tags: { ...base.tags, source_dataset: "overture-places-extract" } };
}

/** Classify a sliced extract into pack candidates. This is the
 *  Open Places adapter's post-filter discipline, step for step
 *  (coverage filter -> classify -> dedupe by name+kind): the
 *  records were bbox-filtered at slice time, but coverage here is
 *  the destination's full coverage (seed box + any deliberate
 *  subregions), and the slicer slices the seed box only — so this
 *  filter is the authority, not a formality. */
export function classifyExtractRecords(
  destination: DestinationDTO,
  extract: OvertureExtractFile
): ExtractCollection {
  let droppedOutOfCoverage = 0;
  let unclassified = 0;
  const classified: StoredCandidate[] = [];
  for (const rec of extract.records) {
    if (
      typeof rec.lat !== "number" ||
      typeof rec.lon !== "number" ||
      !insideDestinationCoverage(destination, rec.lat, rec.lon)
    ) {
      droppedOutOfCoverage += 1;
      continue;
    }
    const kind = classifyOvertureRecord(rec);
    if (!kind) {
      unclassified += 1;
      continue;
    }
    classified.push(toExtractCandidate(rec, kind));
  }
  // Same dedupe grain as the API lane (name+kind, first wins).
  const seen = new Set<string>();
  const kept: StoredCandidate[] = [];
  let dedupedNameKind = 0;
  for (const c of classified) {
    const k = `${c.name.toLowerCase()}|${c.kind}`;
    if (seen.has(k)) {
      dedupedNameKind += 1;
      continue;
    }
    seen.add(k);
    kept.push(c);
  }
  const byKind: Record<string, number> = {};
  for (const kind of OPEN_PLACES_KINDS) byKind[kind] = 0;
  for (const c of kept) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return {
    candidates: kept,
    evidence: {
      release: extract.release,
      slicedAt: extract.slicedAt ?? null,
      recordsReceived: extract.records.length,
      droppedOutOfCoverage,
      unclassified,
      dedupedNameKind,
      byKind
    }
  };
}

/** Provenance for a pack version built by the extract lane.
 *  Source "overture-places-extract"; the label carries the slice
 *  plan + classifier versions, the dataset release, and the
 *  per-kind counts (zeros explicit) — the same honesty pattern
 *  the other lanes established. */
export function extractBuildProvenance(collection: ExtractCollection, builtAt: UtcInstant): ProvenanceDTO {
  const ev = collection.evidence;
  const counts = OPEN_PLACES_KINDS.map((k) => `${k} ${ev.byKind[k] ?? 0}`).join(", ");
  return {
    source: "overture-places-extract",
    sourceRef: `overture-extract:${ev.release}`,
    recordedAt: builtAt,
    label:
      `Overture Maps Places — prebuilt extract (${OVERTURE_EXTRACT_SLICE_VERSION}) sliced from the public ` +
      `S3 parquet release ${ev.release} (CDLA Permissive 2.0), classifier ${OVERTURE_EXTRACT_CLASSIFIER_VERSION}; ` +
      `${ev.recordsReceived} records in the destination box, ${collection.candidates.length} candidates (${counts}); ` +
      `live Overpass collection remains the fallback for destinations without an extract`
  };
}

/* ------------------------------------------------------------------ */
/* Extract loading                                                     */
/*                                                                     */
/* Resolution order for a destination's extract file:                  */
/*   1. an injected loader (proofs, tests, future store-backed reads); */
/*   2. ROAMLY_PACK_EXTRACT_DIR/<destinationId>.json (local disk —     */
/*      proofs and self-hosted runs);                                  */
/*   3. ROAMLY_PACK_EXTRACT_URL_TEMPLATE with {destinationId}          */
/*      substituted (production: the extracts published to object      */
/*      storage by the slicer).                                        */
/* Every miss or failure resolves to null — a lane miss, never an      */
/* error: the live lane behind this one owns the failure surface.      */
/* ------------------------------------------------------------------ */

export interface OvertureExtractLoadOptions {
  loader?: (destination: DestinationDTO) => Promise<OvertureExtractFile | null>;
  fetcher?: Fetcher;
  policy?: FetchPolicy;
  /** Directory override (defaults to ROAMLY_PACK_EXTRACT_DIR). */
  dir?: string | null;
  /** URL template override (defaults to ROAMLY_PACK_EXTRACT_URL_TEMPLATE). */
  urlTemplate?: string | null;
}

function asExtractFile(parsed: unknown, destination: DestinationDTO): OvertureExtractFile | null {
  if (!parsed || typeof parsed !== "object") return null;
  const file = parsed as Partial<OvertureExtractFile>;
  if (file.format !== OVERTURE_EXTRACT_FORMAT) return null;
  if (file.destination?.destinationId !== destination.destinationId) return null;
  if (typeof file.release !== "string" || !file.release) return null;
  if (!Array.isArray(file.records)) return null;
  return file as OvertureExtractFile;
}

export async function loadOvertureExtract(
  destination: DestinationDTO,
  options: OvertureExtractLoadOptions = {}
): Promise<OvertureExtractFile | null> {
  if (options.loader) {
    try {
      const loaded = await options.loader(destination);
      return loaded ? asExtractFile(loaded, destination) : null;
    } catch {
      return null;
    }
  }
  const dir = options.dir !== undefined ? options.dir : process.env.ROAMLY_PACK_EXTRACT_DIR || null;
  if (dir) {
    try {
      const { readFile } = await import("node:fs/promises");
      const text = await readFile(`${dir.replace(/\/$/, "")}/${destination.destinationId}.json`, "utf8");
      return asExtractFile(JSON.parse(text), destination);
    } catch {
      return null;
    }
  }
  const template =
    options.urlTemplate !== undefined ? options.urlTemplate : process.env.ROAMLY_PACK_EXTRACT_URL_TEMPLATE || null;
  if (template) {
    const fetcher = options.fetcher ?? systemFetcher;
    const policy = options.policy ?? DEFAULT_FETCH_POLICY;
    try {
      const url = template.replace("{destinationId}", encodeURIComponent(destination.destinationId));
      const res = await fetcher(url, {
        method: "GET",
        headers: { "User-Agent": "roamly-pack-extract/1" },
        signal: AbortSignal.timeout(policy.attemptTimeoutMs)
      });
      if (!res.ok) return null;
      return asExtractFile(JSON.parse(await res.text()), destination);
    } catch {
      return null;
    }
  }
  return null;
}

/** The extract lane as a collection step: load + classify.
 *  Returns null on any miss (no extract, wrong format, another
 *  destination's file) — the caller decides viability (sight
 *  stock) and owns the fallback. */
export async function collectPoiCandidatesFromExtract(
  destination: DestinationDTO,
  options: OvertureExtractLoadOptions = {}
): Promise<ExtractCollection | null> {
  const extract = await loadOvertureExtract(destination, options);
  if (!extract) return null;
  return classifyExtractRecords(destination, extract);
}
