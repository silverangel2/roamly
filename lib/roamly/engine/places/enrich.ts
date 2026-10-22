import { sourceKey } from "@/lib/roamly/engine/ids";
import type { PackStore } from "@/lib/roamly/engine/packs/store";
import {
  PackStoreError,
  systemPackClock,
  toInstant,
  type PackClock,
  type StoredCandidate
} from "@/lib/roamly/engine/packs/types";
import type { PlacesClient } from "@/lib/roamly/engine/places/client";
import {
  monthlyCostReport,
  monthKeyOf,
  type PlacesLedgerCounters,
  type PlacesLedgerStore,
  type PlacesMonthlyCostReport
} from "@/lib/roamly/engine/places/ledger";
import { evaluateMatch, normalizeDetails, rejectionRecord } from "@/lib/roamly/engine/places/normalize";
import {
  MATCH_GATE_KM,
  PLACES_SEARCH_MAX_RESULTS,
  type MatchRejection,
  type PlacesCaps,
  type PlacesSkuCounts,
  type PlacesTextSearchRequest
} from "@/lib/roamly/engine/places/types";

/*
 * The Places enrichment service (DESIGN §2.5, Phase 4): enriches a
 * pack version's FINALISTS with Google data — as a job, never
 * synchronously inside generation — under three disciplines, all
 * ported from the live-proven shadow collector:
 *
 *   CACHE-FIRST (mandatory): a candidate whose stored record —
 *   enrichment OR recorded rejection — is inside the 30-day
 *   refresh discipline triggers NO ledger operation and NO call;
 *   the guard is not even consulted.
 *
 *   COST GUARD: every call is reserved against the monthly ledger
 *   BEFORE it is made; a cap-crossing reservation is refused, the
 *   candidate completes OSM-only, and the refusal is recorded in
 *   the run's provenance. A call whose outcome is unknown moves
 *   its reservation to RECONCILIATION — never blindly retried.
 *
 *   DISTANCE GATE: the search's first hit is accepted only within
 *   2 km of the candidate's OSM position; a rejection is written
 *   back as the candidate's record (provenance), with no details
 *   fetched and nothing attached.
 *
 * Write-back goes through PackStore.putCandidateEnrichment — the
 * separate enrichment record on the candidate row; the base POI
 * layer never moves.
 *
 * Finalist selection (shadow engine.mjs): the scheduled items of a
 * solved plan plus the anchor stay — finalistKeysFromPlan. The
 * service itself takes the finalist key set as its seam: Phase 5's
 * generation job computes it from the first-pass solve.
 */

export interface EnrichmentOutcome {
  candidateKey: string;
  osmKey: string;
  name: string;
  outcome:
    | "enriched"
    | "from-cache"
    | "rejected"
    | "rejected-from-cache"
    | "refused"
    | "reconciliation"
    | "not-in-pack"
    | "no-position";
  matchedName: string | null;
  /** The Google display name differs from the OSM name (the live
   *  proof's "Don Vegan" -> "Le Don Restaurant"). Surfaced, never
   *  silently adopted: the plan keeps the traveler's name. */
  renamed: boolean;
  distanceKm: number | null;
  businessStatus: string | null;
  hoursKnown: boolean;
  stage: "text-search" | "place-details" | null;
  detail: string | null;
  /** This outcome was produced by an in-flight twin run of the
   *  same service (single-flight coalescing) — this run made no
   *  calls of its own for the candidate. */
  coalesced?: boolean;
}

export interface EnrichmentRefusal {
  candidateKey: string;
  osmKey: string;
  name: string;
  stage: "text-search" | "place-details";
  reason: string;
}

export interface EnrichmentReconciliation {
  operationKey: string;
  candidateKey: string;
  sku: "textSearch" | "placeDetails";
  error: string;
}

export interface EnrichmentRunReport {
  packVersionId: string;
  destinationId: string;
  /** "off" when no client is injected (no key): OSM-only, the
   *  engine identical — the design's rollback posture. */
  mode: "live" | "off";
  finalists: number;
  enriched: number;
  fromCache: number;
  outcomes: EnrichmentOutcome[];
  rejectedMatches: { candidateKey: string; osmKey: string; name: string; rejection: MatchRejection }[];
  refused: EnrichmentRefusal[];
  reconciliations: EnrichmentReconciliation[];
  callsThisRun: PlacesSkuCounts;
  ledgerScope: string;
  month: string;
  caps: PlacesCaps;
  countersBefore: PlacesLedgerCounters;
  countersAfter: PlacesLedgerCounters;
  cost: PlacesMonthlyCostReport;
  note: string;
}

/** The finalist selection rule, ported from the shadow engine
 *  (engine.mjs): the scheduled items' keys plus the anchor stay. */
export function finalistKeysFromPlan(
  plan: { days: readonly { items: readonly { key?: string }[] }[] },
  anchorStayKey: string | null
): Set<string> {
  const keys = new Set<string>();
  for (const day of plan.days) {
    for (const item of day.items) {
      if (item.key) keys.add(item.key);
    }
  }
  if (anchorStayKey) keys.add(anchorStayKey);
  return keys;
}

/** The Text Search request for one candidate — name + locality,
 *  biased to the candidate's known OSM position (shadow verbatim). */
export function buildTextSearchRequest(
  candidateName: string,
  destinationName: string,
  country: string,
  pos: { lat: number; lon: number }
): PlacesTextSearchRequest {
  return {
    textQuery: `${candidateName}, ${destinationName}, ${country}`,
    maxResultCount: PLACES_SEARCH_MAX_RESULTS,
    locationBias: {
      circle: { center: { latitude: pos.lat, longitude: pos.lon }, radius: MATCH_GATE_KM * 1000 }
    }
  };
}

export interface PlacesEnrichmentDeps {
  store: PackStore;
  ledger: PlacesLedgerStore;
  /** Null = provider OFF (no key configured): runs report mode
   *  "off" and make no calls. */
  client: PlacesClient | null;
  /** The Google project/billing identity the ledger is keyed by —
   *  every spend path for that project shares these counters. */
  scope: string;
  caps: PlacesCaps;
  clock?: PackClock;
}

interface RunContext {
  packVersionId: string;
  destinationName: string;
  country: string;
  month: string;
  calls: PlacesSkuCounts;
  refused: EnrichmentRefusal[];
  rejectedMatches: EnrichmentRunReport["rejectedMatches"];
  reconciliations: EnrichmentReconciliation[];
}

export class PlacesEnrichmentService {
  private readonly deps: PlacesEnrichmentDeps;
  private readonly clock: PackClock;
  /** Single-flight registry: concurrent runs of THIS service over
   *  the same (version, candidate) coalesce onto one provider
   *  spend per refresh cycle (the DB translation is the unique
   *  operation key + the conditional reserve — see the ledger's
   *  migration header). */
  private readonly inflight = new Map<string, Promise<EnrichmentOutcome>>();

  constructor(deps: PlacesEnrichmentDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemPackClock;
  }

  private nowIso(): string {
    return toInstant(this.clock());
  }

  async enrichPackFinalists(packVersionId: string, finalistKeys: readonly string[]): Promise<EnrichmentRunReport> {
    const { store, ledger, client, scope, caps } = this.deps;
    const month = monthKeyOf(this.clock());
    const countersBefore = await ledger.getCounters(scope, month);
    const version = await store.getVersion(packVersionId);
    if (!version) throw new PackStoreError("VERSION_NOT_FOUND", `no pack version ${packVersionId}`);
    const destination = await store.getDestination(version.dto.destinationId);
    if (!destination) throw new PackStoreError("UNKNOWN_DESTINATION", `pack version ${packVersionId} has no registered destination`);

    const ctx: RunContext = {
      packVersionId,
      destinationName: destination.displayName,
      country: destination.country,
      month,
      calls: { textSearch: 0, placeDetails: 0 },
      refused: [],
      rejectedMatches: [],
      reconciliations: []
    };

    const outcomes: EnrichmentOutcome[] = [];
    if (client) {
      const rows = await store.getVersionCandidates(packVersionId);
      const byOsmKey = new Map(rows.map((r) => [r.osmKey, r]));
      const byCandidateKey = new Map(rows.map((r) => [r.candidateKey, r]));
      for (const key of finalistKeys) {
        const row = byCandidateKey.get(key) ?? byOsmKey.get(key) ?? null;
        if (!row) {
          outcomes.push({
            candidateKey: key.startsWith("osm:") ? key : sourceKey("osm", key),
            osmKey: key,
            name: key,
            outcome: "not-in-pack",
            matchedName: null,
            renamed: false,
            distanceKm: null,
            businessStatus: null,
            hoursKnown: false,
            stage: null,
            detail: "finalist key is not a candidate of this pack version — no call made"
          });
          continue;
        }
        outcomes.push(await this.enrichCandidateShared(ctx, row));
      }
    }

    const countersAfter = await ledger.getCounters(scope, month);
    return {
      packVersionId,
      destinationId: version.dto.destinationId,
      mode: client ? "live" : "off",
      finalists: finalistKeys.length,
      enriched: outcomes.filter((o) => o.outcome === "enriched").length,
      fromCache: outcomes.filter((o) => o.outcome === "from-cache" || o.outcome === "rejected-from-cache").length,
      outcomes,
      rejectedMatches: ctx.rejectedMatches,
      refused: ctx.refused,
      reconciliations: ctx.reconciliations,
      callsThisRun: ctx.calls,
      ledgerScope: scope,
      month,
      caps,
      countersBefore,
      countersAfter,
      cost: monthlyCostReport(countersAfter, caps),
      note:
        "Caps sit inside the monthly free allotments by design (owner condition: minimal expenses); " +
        "refusals complete OSM-only and are reported, never silent."
    };
  }

  /** Single-flight wrapper: a concurrent run for the same
   *  (version, candidate) awaits the in-flight twin and reports
   *  its outcome as coalesced, instead of spending twice. */
  private async enrichCandidateShared(ctx: RunContext, row: StoredCandidate): Promise<EnrichmentOutcome> {
    const flightKey = `${ctx.packVersionId}|${row.candidateKey}`;
    const existing = this.inflight.get(flightKey);
    if (existing) {
      const twin = await existing.catch(() => null);
      if (twin) return { ...twin, coalesced: true };
    }
    const run = this.enrichCandidate(ctx, row);
    this.inflight.set(flightKey, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(flightKey);
    }
  }

  private baseOutcome(row: StoredCandidate): EnrichmentOutcome {
    return {
      candidateKey: row.candidateKey,
      osmKey: row.osmKey,
      name: row.name,
      outcome: "enriched",
      matchedName: null,
      renamed: false,
      distanceKm: null,
      businessStatus: null,
      hoursKnown: false,
      stage: null,
      detail: null
    };
  }

  private async capRefusalReason(sku: "textSearch" | "placeDetails", cap: number): Promise<string> {
    const counters = await this.deps.ledger.getCounters(this.deps.scope, monthKeyOf(this.clock()));
    const used = counters[sku].committed + counters[sku].reserved;
    const label = sku === "textSearch" ? "Text Search" : "Place Details";
    return `monthly ${label} cap reached (${used}/${cap}) — OSM-only for this candidate, by the cost guard`;
  }

  private async enrichCandidate(ctx: RunContext, row: StoredCandidate): Promise<EnrichmentOutcome> {
    const { store, ledger, client, scope, caps } = this.deps;
    const clientLive = client as PlacesClient; // callers guarantee non-null on this path
    const out = this.baseOutcome(row);
    const nowIso = this.nowIso();
    const today = nowIso.slice(0, 10);

    // CACHE-FIRST (mandatory): a fresh stored record — enrichment
    // or recorded rejection — never triggers a call, and the
    // ledger is not even consulted.
    const existing = row.enrichment;
    if (existing && existing.refreshDue && existing.refreshDue >= today) {
      if (existing.matchRejected) {
        out.outcome = "rejected-from-cache";
        out.matchedName = existing.matchRejected.matchedName;
        out.distanceKm = existing.matchRejected.distanceKm;
        out.detail = `recorded rejection (${existing.matchRejected.reason}) is inside its refresh window — no call made`;
        ctx.rejectedMatches.push({
          candidateKey: row.candidateKey,
          osmKey: row.osmKey,
          name: row.name,
          rejection: existing.matchRejected
        });
        return out;
      }
      out.outcome = "from-cache";
      out.businessStatus = existing.businessStatus ?? null;
      out.hoursKnown = Boolean(existing.hoursByDay);
      out.distanceKm = existing.matchDistanceKm ?? null;
      out.detail = "stored enrichment is inside its 30-day refresh window — no call made";
      return out;
    }

    if (!row.pos) {
      out.outcome = "no-position";
      out.detail = "candidate has no OSM position — a match cannot be distance-verified, so no call is made";
      return out;
    }

    // Reserve BEFORE the call (cost guard). A null reservation is
    // a cap refusal: no call follows it, ever.
    const searchOp = await ledger.tryReserve({
      scope,
      sku: "textSearch",
      cap: caps.textSearch,
      packVersionId: ctx.packVersionId,
      candidateKey: row.candidateKey
    });
    if (!searchOp) {
      const reason = await this.capRefusalReason("textSearch", caps.textSearch);
      out.outcome = "refused";
      out.stage = "text-search";
      out.detail = reason;
      ctx.refused.push({ candidateKey: row.candidateKey, osmKey: row.osmKey, name: row.name, stage: "text-search", reason });
      return out;
    }

    let searchRes;
    try {
      searchRes = await clientLive.textSearch(buildTextSearchRequest(row.name, ctx.destinationName, ctx.country, row.pos));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ledger.markReconciliation(searchOp.operationKey, `text search outcome unknown: ${message}`);
      out.outcome = "reconciliation";
      out.stage = "text-search";
      out.detail = `text search outcome unknown — reservation held in reconciliation, never blindly retried: ${message}`;
      ctx.reconciliations.push({ operationKey: searchOp.operationKey, candidateKey: row.candidateKey, sku: "textSearch", error: message });
      return out;
    }
    // The search ran and is billable, whatever the gate decides.
    await ledger.commit(searchOp.operationKey);
    ctx.calls.textSearch += 1;

    const verdict = evaluateMatch(row.pos, searchRes.places?.[0]);
    if (!verdict.matched) {
      const record = rejectionRecord(verdict.rejection, clientLive.sourceLabel, nowIso, searchOp.operationKey);
      await store.putCandidateEnrichment(ctx.packVersionId, row.candidateKey, record);
      out.outcome = "rejected";
      out.matchedName = verdict.rejection.matchedName;
      out.distanceKm = verdict.rejection.distanceKm;
      out.detail = `distance gate: ${verdict.rejection.reason}${verdict.rejection.distanceKm !== null ? ` (${verdict.rejection.distanceKm} km)` : ""} — nothing attached`;
      ctx.rejectedMatches.push({ candidateKey: row.candidateKey, osmKey: row.osmKey, name: row.name, rejection: verdict.rejection });
      return out;
    }
    out.matchedName = verdict.matchedName;
    out.renamed = verdict.matchedName !== null && verdict.matchedName !== row.name;
    out.distanceKm = verdict.distanceKm;

    const detailsOp = await ledger.tryReserve({
      scope,
      sku: "placeDetails",
      cap: caps.placeDetails,
      packVersionId: ctx.packVersionId,
      candidateKey: row.candidateKey
    });
    if (!detailsOp) {
      const reason = await this.capRefusalReason("placeDetails", caps.placeDetails);
      out.outcome = "refused";
      out.stage = "place-details";
      out.detail = `${reason} — match verified but details NOT fetched`;
      ctx.refused.push({ candidateKey: row.candidateKey, osmKey: row.osmKey, name: row.name, stage: "place-details", reason });
      return out;
    }

    let details;
    try {
      details = await clientLive.placeDetails(verdict.placeId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ledger.markReconciliation(detailsOp.operationKey, `place details outcome unknown: ${message}`);
      out.outcome = "reconciliation";
      out.stage = "place-details";
      out.detail = `place details outcome unknown — reservation held in reconciliation, never blindly retried: ${message}`;
      ctx.reconciliations.push({ operationKey: detailsOp.operationKey, candidateKey: row.candidateKey, sku: "placeDetails", error: message });
      return out;
    }
    await ledger.commit(detailsOp.operationKey);
    ctx.calls.placeDetails += 1;

    const record = normalizeDetails(details, clientLive.sourceLabel, nowIso, verdict.distanceKm);
    record.operationKey = detailsOp.operationKey;
    await store.putCandidateEnrichment(ctx.packVersionId, row.candidateKey, record);
    out.outcome = "enriched";
    out.businessStatus = record.businessStatus ?? null;
    out.hoursKnown = Boolean(record.hoursByDay);
    out.detail = `enriched from Place Details (place ${verdict.placeId}, match ${verdict.distanceKm} km)`;
    return out;
  }
}
