/*
 * Zero-engine generation driver (DESIGN-PRODUCTION.md Phase 5, §2.3).
 *
 * The deterministic engine enters production BEHIND the existing
 * staged-generation contract: this module produces and consumes the
 * exact `StagedGenerationState` document the incumbent driver uses —
 * same version, same stage vocabulary (outline -> day_batch ->
 * finalization), same one-day batches, same lease/claim discipline
 * (a state.worker lease + an updated_at CAS on the trip row), same
 * failure shapes. The shipped watchdog (`resetStrandedGeneratingBatches`),
 * the waiting page (`publicStagedGenerationProgress`), the cron wakes
 * and the after() chain therefore work against engine jobs UNCHANGED;
 * they are imported from the incumbent module, never re-implemented.
 *
 * The differences are exactly the point of the engine:
 *   - stages are computed by the Phase 2 domain core over a PINNED
 *     pack version (Phase 3), with Places enrichment (Phase 4) as a
 *     two-pass job step when finalists lack it — never a model call;
 *   - the job records provider "roamly-zero-engine", zero tokens and
 *     zero model cost in every stage run, honestly;
 *   - the finished document carries an honest generation note naming
 *     the deterministic engine, and finalization accepts it through
 *     the itinerary row's `source = 'zero-engine'` column (M10) —
 *     the staged-AI literal is never written by this path;
 *   - final validation (`validateItineraryForProduction`) gates this
 *     path exactly as it gates the incumbent (KF-1 discipline: the
 *     gate is never weakened, for either path);
 *   - predictions (PREDICT) are written immutably at plan lock (M8).
 *
 * Reachability (the flag law): a job is an engine job only when the
 * queue row carries generation_version 'zero-engine-v1', and the
 * version is only ever written when ROAMLY_ZERO_ENGINE_ENABLED is on
 * AND the runtime deps (pack store backend) are configured. With the
 * flag off, no engine job can be created and the worker's dispatch
 * branch is unreachable — the incumbent path serves everything,
 * byte-for-byte the pre-phase behavior.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStarterItinerary,
  validateItineraryForProduction,
  type RoamlyActivitySeed,
  type RoamlyDayPlan,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { normalizeLocale } from "@/lib/i18n";
import { enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { lockGeneratedItinerary, markFreeItineraryUsed } from "@/lib/roamly/billing";
import { calculateTripDateRange } from "@/lib/roamly/dateUtils";
import { enforceSelectedHotelIdentity } from "@/lib/roamly/selectedHotelIdentity";
import {
  getStagedGenerationState,
  nextStagedGenerationWork,
  canResumeStagedGeneration,
  resetStrandedGeneratingBatches,
  StagedGenerationError,
  type StagedGenerationBatchState,
  type StagedGenerationDayState,
  type StagedGenerationStageRun,
  type StagedGenerationState,
  type StagedGenerationStatus,
  type StagedTripOutline
} from "@/lib/roamly/stagedItineraryGeneration";
import { getGenerationEmailStatus, finalizeStagedGenerationNotification } from "@/lib/roamly/itineraryGenerationEmail";
import { localizeGeneratedExactText } from "@/lib/roamly/generationLanguage";
import { getConfirmedBookingsForItinerary } from "@/lib/roamly/bookings";
import { getTravelerMemory } from "@/lib/roamly/travelerMemory";
import { buildTravelerPersonalizationContext, type TravelerPersonalizationContext } from "@/lib/roamly/travelerPersonalization";
import { syncGeneratedItinerary } from "@/lib/trips";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { scoreStays, type ScoredStay } from "@/lib/roamly/engine/anchors";
import { composeDay, newComposerState, type ComposerState, type ComposeContext } from "@/lib/roamly/engine/frames";
import { judgeTrip } from "@/lib/roamly/engine/judges";
import { partyProfile } from "@/lib/roamly/engine/journey";
import { auditTrip } from "@/lib/roamly/engine/emotion";
import { buildPredictions, type PredictionRecord } from "@/lib/roamly/engine/predict";
import { stampBudgetVerdictDisplay } from "@/lib/roamly/engine/budgetVerdictDisplay";
import { priceEvidence } from "@/lib/roamly/engine/prices";
import { solveTrip, type MustSeeSpec, type SolveResult } from "@/lib/roamly/engine/solver";
import { extractConstraints, namedMustSeeMiss, type ExtractedConstraints } from "@/lib/roamly/engine/understand";
import { fmt, isoPlus, parseHhmm, type EngineDay, type EngineItem, type EnginePack } from "@/lib/roamly/engine/util";
import { predictionId } from "@/lib/roamly/engine/ids";
import { assemblePinnedEnginePack, readServingPack } from "@/lib/roamly/engine/packs/builder";
import type { PackStore } from "@/lib/roamly/engine/packs/store";
import type { WeatherSnapshotRecord } from "@/lib/roamly/engine/packs/types";
import { finalistKeysFromPlan, PlacesEnrichmentService } from "@/lib/roamly/engine/places/enrich";
import { capsFromEnv } from "@/lib/roamly/engine/places/ledger";
import { placesClientFromEnv } from "@/lib/roamly/engine/places/client";
import { SupabasePackStore } from "@/lib/roamly/engine/packs/supabaseStore";
import { SupabasePlacesLedgerStore } from "@/lib/roamly/engine/places/supabaseLedgerStore";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* ------------------------------------------------------------------ */
/* Identity + flag                                                     */
/* ------------------------------------------------------------------ */

export const ZERO_ENGINE_GENERATION_VERSION = "zero-engine-v1";
export const ZERO_ENGINE_PROVIDER = "roamly-zero-engine";
export const ZERO_ENGINE_SOURCE = "zero-engine";

/** The honest provenance note on every engine-produced final plan.
 *  It names the deterministic engine; it never claims a model wrote
 *  the plan, and (paired with the row's source column, M10) it is
 *  what finalization accepts for this path. */
export const ZERO_ENGINE_GENERATION_NOTE =
  "Generated by Roamly's deterministic zero-engine from recorded place data — no AI model calls were used.";

/** Same stage-lease + attempt-limit discipline as the incumbent
 *  driver (the env knobs are shared, so ops tunes one system). */
const STAGE_LEASE_MS = Number(process.env.ROAMLY_STAGED_GENERATION_LEASE_MS || 4 * 60_000);
const BATCH_ATTEMPT_LIMIT = Number(process.env.ROAMLY_STAGED_BATCH_ATTEMPT_LIMIT || 4);

const FLAG_ON_VALUES: ReadonlySet<string> = new Set(["1", "true", "on", "yes"]);

/** The Phase 5 feature flag (DESIGN §2.6). Default OFF everywhere:
 *  unset, empty, or any unrecognized value reads as OFF. */
export function zeroEngineFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.ROAMLY_ZERO_ENGINE_ENABLED || "").trim().toLowerCase();
  return FLAG_ON_VALUES.has(raw);
}

/** A job is driven by the engine only when the flag is on AND the
 *  job itself was created as an engine job (its queue row carries
 *  the engine generation version). Either condition alone is never
 *  enough — this is what keeps the flag-off posture byte-identical
 *  for every incumbent job. */
export function zeroEngineEnabledForJob(params: {
  env?: NodeJS.ProcessEnv;
  generationVersion?: string | null;
}): boolean {
  return (
    zeroEngineFlagEnabled(params.env ?? process.env) &&
    params.generationVersion === ZERO_ENGINE_GENERATION_VERSION
  );
}

/* ------------------------------------------------------------------ */
/* The engine record (rides roamly_trips.metadata.zeroEngine, beside  */
/* the generation state doc — DATA-INFRA §1)                           */
/* ------------------------------------------------------------------ */

export interface ZeroEngineRunRecord {
  generationVersion: typeof ZERO_ENGINE_GENERATION_VERSION;
  provider: typeof ZERO_ENGINE_PROVIDER;
  destinationId: string | null;
  destinationName: string | null;
  packVersionId: string | null;
  anchor: {
    name: string;
    key: string | null;
    source: "booked" | "selected" | "scored-fallback" | "destination-centre";
    pos: { lat: number; lon: number };
  } | null;
  packWaitCount: number;
  enrichment: { mode: "live" | "off" | "not-run"; enriched: number; calls: number } | null;
  startedAt: string;
  completedAt: string | null;
}

function initialRunRecord(startedAt: string): ZeroEngineRunRecord {
  return {
    generationVersion: ZERO_ENGINE_GENERATION_VERSION,
    provider: ZERO_ENGINE_PROVIDER,
    destinationId: null,
    destinationName: null,
    packVersionId: null,
    anchor: null,
    packWaitCount: 0,
    enrichment: null,
    startedAt,
    completedAt: null
  };
}

function getRunRecord(metadata: unknown): ZeroEngineRunRecord | null {
  const record = getRecord(getRecord(metadata)?.zeroEngine);
  if (!record || record.generationVersion !== ZERO_ENGINE_GENERATION_VERSION) return null;
  return record as unknown as ZeroEngineRunRecord;
}

/* ------------------------------------------------------------------ */
/* Small helpers (the incumbent's private ones, mirrored — the state  */
/* doc must round-trip through the incumbent's own reader)            */
/* ------------------------------------------------------------------ */

function nowIso() {
  return new Date().toISOString();
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dateForDay(payload: TripPlannerPayload, dayNumber: number) {
  if (!payload.startDate) return "";
  const date = new Date(`${payload.startDate}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + dayNumber - 1);
  return date.toISOString().slice(0, 10);
}

function buildInitialDayStates(payload: TripPlannerPayload, totalDayCount: number): Record<string, StagedGenerationDayState> {
  return Object.fromEntries(
    Array.from({ length: totalDayCount }, (_, index) => {
      const dayNumber = index + 1;
      return [
        String(dayNumber),
        {
          dayNumber,
          date: dateForDay(payload, dayNumber),
          status: "queued" as const,
          attemptCount: 0,
          lastError: null,
          updatedAt: nowIso()
        }
      ];
    })
  );
}

function buildInitialBatchStates(totalDayCount: number): Record<string, StagedGenerationBatchState> {
  return Object.fromEntries(
    Array.from({ length: totalDayCount }, (_, index) => {
      const id = `batch-${index + 1}`;
      return [
        id,
        {
          id,
          dayNumbers: [index + 1],
          status: "queued" as const,
          attemptCount: 0,
          lastError: null,
          updatedAt: nowIso(),
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null
        }
      ];
    })
  );
}

function safePayloadForState(payload: TripPlannerPayload): TripPlannerPayload {
  return {
    ...payload,
    language: normalizeLocale(payload.language),
    interests: (payload.interests || []).slice(0, 16),
    priceDiscovery: undefined,
    confirmedBookings: undefined
  };
}

function persistedTripStatusForGeneration(status: StagedGenerationStatus) {
  if (status === "complete") return "generated";
  if (status === "failed" || status === "partially_failed") return "draft";
  return "generating";
}

function appendStageRun(state: StagedGenerationState, run: Omit<StagedGenerationStageRun, "id" | "createdAt">) {
  const stageRuns = [
    ...(state.stageRuns || []),
    {
      ...run,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: nowIso()
    }
  ].slice(-40);
  return { ...state, stageRuns };
}

function releaseLease(state: StagedGenerationState): StagedGenerationState {
  return { ...state, worker: null, updatedAt: nowIso() };
}

function engineStageRun(run: Omit<StagedGenerationStageRun, "id" | "createdAt" | "provider" | "model" | "inputTokens" | "outputTokens" | "estimatedCostUsd">): Omit<StagedGenerationStageRun, "id" | "createdAt"> {
  return {
    ...run,
    provider: ZERO_ENGINE_PROVIDER,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0
  };
}

/* ------------------------------------------------------------------ */
/* Persistence seam                                                    */
/*                                                                     */
/* The driver never touches the database directly: every write goes  */
/* through this contract, whose Supabase implementation below is the */
/* production one and whose in-memory implementation (exercised by   */
/* the Phase 5 harness) defines the same CAS/lease semantics.        */
/* ------------------------------------------------------------------ */

export interface EngineTripRow {
  id: string;
  user_id: string;
  metadata: unknown;
  updated_at: string;
}

export interface EnginePredictionWrite {
  predictionId: string;
  tripId: string;
  userId: string;
  packVersionId: string;
  generationVersion: string;
  recordedAt: string;
  record: PredictionRecord;
}

export interface EngineGenerationStore {
  loadTrip(tripId: string, userId?: string): Promise<EngineTripRow>;
  /** Persist state + run record into the trip's metadata (the same
   *  generation/generationEmail upkeep the incumbent performs). */
  persistState(trip: EngineTripRow, state: StagedGenerationState, run: ZeroEngineRunRecord): Promise<EngineTripRow>;
  /** Claim the trip for this request: writes the lease into the
   *  state doc under an updated_at CAS. Null = a live lease is held
   *  by another driver (or the row moved under us). */
  claim(trip: EngineTripRow, state: StagedGenerationState, run: ZeroEngineRunRecord): Promise<EngineTripRow | null>;
  /** Persist the assembled itinerary (partial or final). A FINAL
   *  persist also stamps the row's honest source (M10); a failure to
   *  stamp is a hard error — an unstamped engine final would be
   *  unrecognizable to finalization, and silence is not an option. */
  persistItinerary(trip: EngineTripRow, itinerary: RoamlyItinerary, final: boolean): Promise<void>;
  /** Immutable PREDICT write (M8): false when a prediction already
   *  exists for the trip — the first record stands, forever. */
  writePrediction(write: EnginePredictionWrite): Promise<{ written: boolean }>;
  markFreeItineraryUsed(userId: string, tripId: string): Promise<{ ok: boolean; error?: string }>;
  lockItinerary(userId: string, tripId: string, unlockSource: string): Promise<{ error: string | null }>;
}

function generationMetadata(metadata: unknown, state: StagedGenerationState, run: ZeroEngineRunRecord) {
  const current = (getRecord(metadata) || {}) as Record<string, unknown>;
  const currentEmail = getGenerationEmailStatus(current, state.tripId);
  return {
    ...current,
    generationEmail: {
      ...currentEmail,
      tripId: state.tripId,
      email_me_when_ready: currentEmail.email_me_when_ready !== false
    },
    generation: state,
    zeroEngine: run
  };
}

/** Production store: the trip-row CAS mirrors claimTrip/persistState
 *  in the incumbent module (which are not exported) — same lease
 *  shape, same compare-and-swap on roamly_trips.updated_at. */
export function createSupabaseEngineGenerationStore(supabase: SupabaseClient): EngineGenerationStore {
  async function loadTrip(tripId: string, userId?: string): Promise<EngineTripRow> {
    let query = supabase.from("roamly_trips").select("id,user_id,metadata,updated_at").eq("id", tripId);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new StagedGenerationError(error.message, "TRIP_LOAD_FAILED", 500);
    if (!data) throw new StagedGenerationError("Trip not found.", "TRIP_NOT_FOUND", 404, true);
    return data as EngineTripRow;
  }

  async function writeState(trip: EngineTripRow, state: StagedGenerationState, run: ZeroEngineRunRecord, cas: boolean) {
    const nextState = { ...state, tripId: trip.id, updatedAt: nowIso() };
    const current = await supabase
      .from("roamly_trips")
      .select("metadata")
      .eq("id", trip.id)
      .eq("user_id", trip.user_id)
      .maybeSingle();
    if (current.error) throw new StagedGenerationError(current.error.message, "GENERATION_STATE_LOAD_FAILED", 500);
    const metadataBase = getRecord(current.data?.metadata) || getRecord(trip.metadata) || {};
    let update = supabase
      .from("roamly_trips")
      .update({
        metadata: generationMetadata(metadataBase, nextState, run),
        status: persistedTripStatusForGeneration(nextState.status),
        itinerary_status: persistedTripStatusForGeneration(nextState.status)
      })
      .eq("id", trip.id)
      .eq("user_id", trip.user_id);
    if (cas) update = update.eq("updated_at", trip.updated_at);
    const { data, error } = await update.select("id,user_id,metadata,updated_at").maybeSingle();
    if (error) throw new StagedGenerationError(error.message, "GENERATION_STATE_SAVE_FAILED", 500);
    return (data as EngineTripRow | null) || null;
  }

  return {
    loadTrip,
    async persistState(trip, state, run) {
      const row = await writeState(trip, state, run, false);
      if (!row) throw new StagedGenerationError("Generation state save returned no row.", "GENERATION_STATE_SAVE_FAILED", 500);
      return row;
    },
    async claim(trip, state, run) {
      return writeState(trip, state, run, true);
    },
    async persistItinerary(trip, itinerary, final) {
      const sync = await syncGeneratedItinerary(supabase, {
        tripId: trip.id,
        userId: trip.user_id,
        itinerary,
        status: final ? "generated" : "preview"
      });
      if (sync.error) throw new StagedGenerationError(sync.error, "ITINERARY_STORAGE_FAILED", 500);
      if (final) {
        const stamped = await supabase
          .from("roamly_itineraries")
          .update({ source: ZERO_ENGINE_SOURCE })
          .eq("trip_id", trip.id)
          .eq("user_id", trip.user_id);
        if (stamped.error) {
          throw new StagedGenerationError(
            `Engine final could not be stamped with its honest source: ${stamped.error.message}`,
            "ITINERARY_SOURCE_WRITE_FAILED",
            500
          );
        }
      }
    },
    async writePrediction(write) {
      const { error } = await supabase.from("roamly_trip_predictions").insert({
        prediction_id: write.predictionId,
        trip_id: write.tripId,
        user_id: write.userId,
        pack_version_id: write.packVersionId,
        generation_version: write.generationVersion,
        recorded_at: write.recordedAt,
        highlights: write.record.highlights,
        risks: write.record.risks,
        budget_posture: write.record.budgetPosture,
        pace_load: write.record.paceLoad,
        learn_contract: write.record.learnContract
      });
      if (!error) return { written: true };
      if (/duplicate key|unique/i.test(error.message)) return { written: false };
      throw new StagedGenerationError(error.message, "PREDICTION_WRITE_FAILED", 500);
    },
    async markFreeItineraryUsed(userId, tripId) {
      const marked = await markFreeItineraryUsed(supabase, userId, tripId);
      return marked.ok ? { ok: true } : { ok: false, error: marked.error };
    },
    async lockItinerary(userId, tripId, unlockSource) {
      const lock = await lockGeneratedItinerary(
        supabase,
        userId,
        tripId,
        (unlockSource as "free" | "paid" | "bundle" | "admin") || "paid"
      );
      return { error: lock.error ? lock.error.message : null };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Runtime deps factory — the reachability gate                        */
/*                                                                     */
/* The Supabase stores landed with the 2026-10-22 production ship      */
/* (SHIP-MANIFEST §4 step 4), after M7/M8/M10 were applied and        */
/* verified. The gate is unchanged: until the backend is configured   */
/* (ROAMLY_PACK_STORE=supabase), this factory returns null and NO      */
/* engine job can be created or advanced — the flag alone changes     */
/* nothing.                                                           */
/*                                                                     */
/* The pack + ledger stores are system data (M7's tables are          */
/* service-role only under RLS), so they are built over the service-  */
/* role admin client regardless of which client the caller passed:    */
/* the generation route calls this with the traveler's client (where  */
/* only the non-null decision is consumed), the worker with the       */
/* admin client. No admin client configured ⇒ null ⇒ engine           */
/* unreachable, never a half-live engine.                             */
/* ------------------------------------------------------------------ */

/** The Google project/billing identity the Places ledger is keyed
 *  by — the scope the places-ledger migration seeds its counter
 *  rows for. Every spend path for the production key shares it. */
export const PLACES_LEDGER_PRODUCTION_SCOPE = "roamly-production";

export interface EngineRuntimeDeps {
  store: EngineGenerationStore;
  packStore: PackStore;
  placesService: PlacesEnrichmentService | null;
}

export function buildEngineRuntimeDeps(supabase: SupabaseClient): EngineRuntimeDeps | null {
  if ((process.env.ROAMLY_PACK_STORE || "").trim().toLowerCase() !== "supabase") return null;
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const packStore = new SupabasePackStore(admin);
  const placesService = new PlacesEnrichmentService({
    store: packStore,
    ledger: new SupabasePlacesLedgerStore(admin),
    // Null until the owner pastes GOOGLE_PLACES_API_KEY: provider
    // mode "off", enrichment a no-op, the engine runs OSM-only.
    client: placesClientFromEnv(process.env),
    scope: PLACES_LEDGER_PRODUCTION_SCOPE,
    caps: capsFromEnv(process.env)
  });
  return { store: createSupabaseEngineGenerationStore(supabase), packStore, placesService };
}

/* ------------------------------------------------------------------ */
/* Request derivation — payload -> solver spec                          */
/*                                                                     */
/* The same derivation the golden pipeline performs by hand: the      */
/* traveler's written request is extracted deterministically, their   */
/* explicit requirements become must-sees, and the day anchor follows */
/* the production anchor law — (1) the traveler's confirmed BOOKED    */
/* stay, (2) a traveler-selected stay, (3) the top scored stay as a   */
/* labeled fallback. The engine never silently "chooses a hotel"      */
/* beyond that labeled fallback.                                      */
/* ------------------------------------------------------------------ */

export interface EngineSolveContext {
  extracted: ExtractedConstraints;
  earliestMin: number;
  restSpec: { type: string; text?: string } | null;
  mustSees: MustSeeSpec[];
  anchorName: string;
  anchorPos: { lat: number; lon: number };
  anchorKey: string | null;
  anchorSource: NonNullable<ZeroEngineRunRecord["anchor"]>["source"];
  pinnedStay: { name: string; pos: { lat: number; lon: number } } | null;
}

const MUST_SEE_STOPWORDS: ReadonlySet<string> = new Set([
  "one", "a", "an", "the", "to", "of", "for", "with", "and", "or", "visit", "visiting",
  "morning", "afternoon", "evening", "please", "want", "wants", "need", "needs", "some",
  "our", "their", "this", "that", "day", "trip", "time", "see", "go", "going"
]);

/** The solver's kind vocabulary (KIND_BY_PATTERN in solver.ts): the
 *  words the engine itself treats as naming a KIND of place. */
const MUST_SEE_KIND_WORDS: ReadonlySet<string> = new Set(["falls", "waterfall", "lighthouse", "ferry", "market", "museum"]);

function mustSeeTokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9'’-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !MUST_SEE_STOPWORDS.has(w));
}

/**
 * Pattern derivation for a traveler's stated must-do. The solver
 * matches a must-see to the FIRST pool candidate whose name contains
 * ANY pattern, so an over-broad pattern set actively steals matches:
 * "one harbour ferry ride" tokenized naively yields "harbour", which
 * matches a lighthouse excursion before the ferry is ever reached
 * (measured, Phase 5 harness — Halifax). The derivation therefore
 * builds a specificity ladder and, per must-see, keeps the most
 * specific tier that matches at least one real candidate in the pack:
 *   tier 1 — the label itself, its adjacent-token bigrams, and its
 *            capitalized (proper-noun) tokens: "maritime museum",
 *            "Levis", "Montmorency";
 *   tier 2 — the engine's kind words present in the label: "ferry",
 *            "lighthouse", "market", "museum", "falls";
 *   tier 3 — every content token (last resort, only when nothing
 *            more specific names anything in the pack).
 * If no tier matches, all tiers combine — the solver then reports
 * the must-see unmet or falls back to kind matching, honestly.
 */
function mustSeePatterns(label: string, pack: EnginePack): string[] {
  const tokens = mustSeeTokens(label);
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  const capitalized = label
    .split(/[^A-Za-z0-9'’-]+/)
    .filter((w) => /^[A-Z]/.test(w) && w.length >= 3 && !MUST_SEE_STOPWORDS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());
  const tier1 = [...new Set([label, ...bigrams, ...capitalized])];
  const tier2 = tokens.filter((t) => MUST_SEE_KIND_WORDS.has(t));
  const tier3 = tokens;
  const poolNames = [...pack.excursions, ...pack.transport.filter((c) => c.kind === "ferry"), ...pack.sights].map((c) =>
    c.name.toLowerCase().replace(/[^a-z0-9]+/g, " ")
  );
  const matchesAny = (patterns: string[]) =>
    patterns.some((p) => {
      const needle = p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return needle.length >= 3 && poolNames.some((name) => name.includes(needle));
    });
  // Tier 1 matched: the specific patterns name the place. The kind
  // words ride along — they are the solver's own vocabulary, they
  // are how the traveler's phrasing names the KIND when the specific
  // name is a category ("maritime museum" -> a museum), and the
  // solver's first-match semantics decide between them in pool
  // order, exactly as with the hand-written golden specs. What never
  // rides along is a bare CONTEXT token ("harbour", "ride", "local"):
  // those live in tier 3, reached only when nothing specific and no
  // kind word names anything in the pack.
  if (matchesAny(tier1)) return [...new Set([...tier1, ...tier2])];
  if (matchesAny(tier2)) return [...new Set([label, ...tier2])];
  return [...new Set([label, ...tier1, ...tier2, ...tier3])];
}

export function deriveMustSees(payload: TripPlannerPayload, extracted: ExtractedConstraints, pack: EnginePack): MustSeeSpec[] {
  const out: MustSeeSpec[] = [];
  const seenLabels = new Set<string>();
  const seenTokenSets: string[][] = [];
  const push = (label: string) => {
    const clean = label.trim();
    const key = clean.toLowerCase();
    if (!clean || seenLabels.has(key)) return;
    // The same must-do stated twice in different words (a structured
    // requirement AND the free-text place item the extractor found)
    // is ONE must-see: dedupe when either token set contains the
    // other ("maritime museum visit" vs "a visit to the maritime
    // museum" — scheduling it twice distorts the whole plan).
    const tokens = mustSeeTokens(clean);
    const tokenKey = [...tokens].sort().join(" ");
    if (
      seenTokenSets.some(
        (prior) => prior.join(" ") === tokenKey || tokens.every((t) => prior.includes(t)) || prior.every((t) => tokens.includes(t))
      )
    ) {
      return;
    }
    seenLabels.add(key);
    seenTokenSets.push(tokens);
    out.push({ id: `ms-${out.length + 1}`, label: clean, patterns: mustSeePatterns(clean, pack) });
  };
  for (const req of payload.explicitRequirements || []) {
    if (req.type === "activity") push(req.request);
  }
  for (const req of payload.constraints?.activity?.mustDoActivities || []) {
    if (req.type === "activity") push(req.request);
  }
  for (const req of payload.constraints?.activity?.explicitRequestedActivities || []) {
    if (req.type === "activity") push(req.request);
  }
  for (const item of extracted.placeItems || []) push(item);
  // Desire-phrased must-sees (ship defect #3): "we would love a
  // morning at a local food market" is an ask with the same force
  // as an "include … please" item — it derives through the same
  // push (same dedupe, same pattern ladder, same solver).
  for (const desire of extracted.mustSeeDesires || []) push(desire);
  return out.slice(0, 12);
}

type ConfirmedBooking = NonNullable<TripPlannerPayload["confirmedBookings"]>[number];

function bookedStay(payload: TripPlannerPayload): ConfirmedBooking | null {
  const bookings = payload.confirmedBookings || [];
  return (
    bookings.find((b) => /hotel|stay|accommodation|lodging|apartment|bnb/i.test(`${b.booking_type || ""} ${b.title || ""}`)) ||
    null
  );
}

export function deriveSolveContext(params: {
  payload: TripPlannerPayload;
  pack: EnginePack;
  scoredStays: ScoredStay[];
}): EngineSolveContext {
  const { payload, pack, scoredStays } = params;
  const requestText = [payload.specialNotes || "", ...(payload.interests || [])].join("\n").trim();
  const extracted = extractConstraints(requestText);
  const earliestMin = parseHhmm(extracted.earliestStart || "09:00") ?? 9 * 60;
  const restSpec = extracted.rest ? { type: extracted.rest.type, text: extracted.rest.text } : null;
  const mustSees = deriveMustSees(payload, extracted, pack);

  const booked = bookedStay(payload);
  if (booked) {
    const title = getString(booked.title, "Your booked stay");
    const match = scoredStays.find(
      (s) => s.name.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(s.name.toLowerCase())
    );
    const pos = match?.pos || pack.center;
    return {
      extracted,
      earliestMin,
      restSpec,
      mustSees,
      anchorName: title,
      anchorPos: pos,
      anchorKey: match?.key || null,
      anchorSource: "booked",
      pinnedStay: { name: title, pos }
    };
  }

  const top = scoredStays[0] || null;
  if (top) {
    return {
      extracted,
      earliestMin,
      restSpec,
      mustSees,
      anchorName: top.name,
      anchorPos: top.pos,
      anchorKey: top.key,
      anchorSource: "scored-fallback",
      pinnedStay: null
    };
  }

  return {
    extracted,
    earliestMin,
    restSpec,
    mustSees,
    anchorName: `${pack.destination} centre (base anchor)`,
    anchorPos: pack.center,
    anchorKey: null,
    anchorSource: "destination-centre",
    pinnedStay: null
  };
}

/* ------------------------------------------------------------------ */
/* The pipeline — one deterministic pass over a pinned pack.          */
/* Mirrors the golden pipeline's order exactly (extract -> stays ->   */
/* solve -> compose), with the Phase 2 judges attached for grading.   */
/* ------------------------------------------------------------------ */

export interface EnginePlanRun {
  plan: SolveResult;
  ctx: EngineSolveContext;
  daysOut: EngineDay[];
  judge: ReturnType<typeof judgeTrip>;
  emotionHard: number;
}

export function runEnginePlan(params: {
  pack: EnginePack;
  payload: TripPlannerPayload;
  totalDayCount: number;
  anchorOverride?: { name: string; pos: { lat: number; lon: number }; key: string | null; source: EngineSolveContext["anchorSource"] } | null;
}): EnginePlanRun {
  const { pack, payload, totalDayCount } = params;
  const scoredStays = scoreStays(pack);
  const derived = deriveSolveContext({ payload, pack, scoredStays });
  const ctx: EngineSolveContext = params.anchorOverride
    ? {
        ...derived,
        anchorName: params.anchorOverride.name,
        anchorPos: params.anchorOverride.pos,
        anchorKey: params.anchorOverride.key,
        anchorSource: params.anchorOverride.source,
        pinnedStay:
          params.anchorOverride.source === "booked"
            ? { name: params.anchorOverride.name, pos: params.anchorOverride.pos }
            : derived.pinnedStay
      }
    : derived;

  const startIso = payload.startDate || "";
  const dates = Array.from({ length: totalDayCount }, (_, i) => isoPlus(startIso, i));
  const plan = solveTrip(pack, {
    days: totalDayCount,
    startIso,
    dates,
    earliestMin: ctx.earliestMin,
    restSpec: ctx.restSpec,
    mustSees: ctx.mustSees,
    basePos: ctx.anchorPos,
    baseName: ctx.anchorName,
    pinnedStay: ctx.pinnedStay
  });

  const anchorStay = scoredStays.find((s) => s.key === ctx.anchorKey) || null;
  const weatherByDate = Object.fromEntries(pack.weather.map((w) => [w.date, w]));
  const composeCtx: ComposeContext = {
    earliestLabel: earliestLabelFor(ctx.extracted),
    stay: anchorStay ? { name: anchorStay.name, walkableSights: anchorStay.walkableSights } : null,
    weatherByDate,
    baseName: ctx.anchorName,
    hasDietary: (ctx.extracted.dietary || []).length > 0
  };
  const composerState: ComposerState = newComposerState();
  const candByKey = new Map(
    [...pack.sights, ...pack.foods, ...pack.stays, ...pack.excursions, ...pack.transport].map((c) => [c.key, c])
  );
  const daysOut: EngineDay[] = plan.days.map((day) => {
    const items = day.items.map((item) => {
      const out: EngineItem = { ...item };
      const g = item.key ? candByKey.get(item.key)?.google : null;
      if (g) {
        out.google = g;
        if (g.priceLevel) out.priceBand = { level: g.priceLevel, source: g.source };
      }
      if (!out.priceEvidence) {
        const ev = priceEvidence(out);
        if (ev) out.priceEvidence = ev;
      }
      return out;
    });
    const withItems: EngineDay = { ...day, items };
    return { ...withItems, narrative: composeDay(withItems, composeCtx, composerState) };
  });

  // Ship defect #3, second half: a must-see the solver could not
  // match is NAMED in the day words — appended to the first day's
  // narrative verbatim — never silently dropped. (A matched
  // must-see needs no note: the place itself is in the plan.)
  const unmetMustSees = plan.mustSeeResults.filter((r) => r.status === "unmet");
  if (unmetMustSees.length && daysOut.length) {
    const first = daysOut[0];
    const base = Array.isArray(first.narrative) ? first.narrative : first.narrative ? [first.narrative] : [];
    daysOut[0] = {
      ...first,
      narrative: [...base, ...unmetMustSees.map((r) => namedMustSeeMiss(r.label, pack.destination))]
    };
  }

  const judge = judgeTrip(daysOut, { earliestMin: ctx.earliestMin });
  const emotion = auditTrip(daysOut, { profile: partyProfile(null, payload.specialNotes || "") });
  return { plan, ctx, daysOut, judge, emotionHard: emotion.hard };
}

function earliestLabelFor(extracted: ExtractedConstraints): string {
  return extracted.earliestStart || "09:00";
}

/* ------------------------------------------------------------------ */
/* Conversion — EngineDay -> the canonical RoamlyDayPlan document.    */
/*                                                                     */
/* The conversion is where the engine plan becomes the document the   */
/* rest of production already renders and validates. Timed items keep */
/* the solver's exact minutes; legs become transfer items (the        */
/* production gate requires transfer time between major items at      */
/* different places); the anchor stay is materialized as a grounded   */
/* hotel item (check-in on day 1, return each evening, check-out on   */
/* the final day) because the stay IS part of the engine plan — it    */
/* is the day's base — and the readiness gate rightly demands a       */
/* named, grounded hotel on multi-day trips.                          */
/* ------------------------------------------------------------------ */

const KIND_CATEGORY: Record<string, string> = {
  museum: "Museum",
  gallery: "Gallery",
  park: "Park",
  viewpoint: "Viewpoint",
  market: "Market",
  falls: "Attraction",
  lighthouse: "Attraction",
  attraction: "Attraction",
  venue: "Attraction",
  historic: "Attraction",
  ferry: "Ferry",
  station: "Transport"
};

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function evidenceCost(ev: ReturnType<typeof priceEvidence>): number | null {
  if (!ev || !ev.range) return null;
  return Math.round(((ev.range.low + ev.range.high) / 2) * 100) / 100;
}

function evidenceCostStatus(ev: ReturnType<typeof priceEvidence>): RoamlyActivitySeed["cost_status"] {
  if (!ev) return "UNKNOWN";
  if (ev.tier === "VERIFIED") return "CONFIRMED";
  if (ev.tier === "UNKNOWN") return "UNKNOWN";
  return "ESTIMATED";
}

export interface DayConversionContext {
  destination: string;
  anchorName: string;
  anchorKey: string | null;
  anchorBooked: boolean;
  totalDayCount: number;
  /** Candidate keys the solver scheduled as must-sees (from
   *  SolveResult.mustSeeResults itemKeys) — they convert as must-do. */
  mustSeeKeys: ReadonlySet<string>;
  /** The traveler's origin label when it differs from the destination
   *  (e.g. "Saint John"): the converter then emits the arrival travel
   *  on day 1 and the departure travel on the final day that the
   *  production validator requires of any itinerary — the engine's
   *  in-destination legs do not cover getting there and back. */
  originLabel: string | null;
}

export function engineDayToRoamlyDayPlan(day: EngineDay, ctx: DayConversionContext): RoamlyDayPlan {
  const timeline: RoamlyActivitySeed[] = [];
  const isFirst = day.dayNumber === 1;
  const isLast = day.dayNumber === ctx.totalDayCount;
  const isMustDo = (i: EngineItem) => Boolean(i.protected) || i.role === "mustsee" || (i.key ? ctx.mustSeeKeys.has(i.key) : false);

  const staySeed = (label: string, timed: { start: number; end: number } | null): RoamlyActivitySeed => ({
    time_label: label,
    ...(timed ? { startTime: hhmm(timed.start), endTime: hhmm(timed.end) } : {}),
    title: ctx.anchorName,
    description:
      label === "Check-in"
        ? `Check in at ${ctx.anchorName} — your base for this trip.`
        : label === "Check-out"
          ? `Check out of ${ctx.anchorName} and keep luggage handled before departure.`
          : `Return to ${ctx.anchorName} for the night.`,
    location_name: ctx.anchorName,
    estimated_cost: null,
    category: "Hotel",
    map_query: ctx.anchorName,
    item_type: "hotel",
    ...(ctx.anchorKey ? { candidateId: ctx.anchorKey } : {}),
    factualStatus: ctx.anchorBooked ? "verified" : "search_ready",
    cost_status: "UNKNOWN",
    timing_status: "PLANNED"
  });

  if (isFirst && ctx.originLabel) {
    timeline.push({
      time_label: "Arrival",
      title: `Travel from ${ctx.originLabel} to ${ctx.destination}`,
      description: `Arrival travel from ${ctx.originLabel} to ${ctx.destination} — make your way in, then settle at your stay.`,
      location_name: ctx.destination,
      estimated_cost: null,
      category: "Travel",
      map_query: ctx.destination,
      item_type: "travel",
      origin: ctx.originLabel,
      destination: ctx.destination,
      cost_status: "UNKNOWN",
      timing_status: "PLANNED"
    });
  }
  if (isFirst) timeline.push(staySeed("Check-in", null));
  if (isLast && ctx.totalDayCount > 1) timeline.push(staySeed("Check-out", null));

  const legSeeds = new Map<number, RoamlyActivitySeed>();
  day.legs.forEach((leg, index) => {
    legSeeds.set(index, {
      time_label: `${fmt(leg.depart)} – ${fmt(leg.arrive)}`,
      startTime: hhmm(leg.depart),
      endTime: hhmm(leg.arrive),
      title: leg.mode === "walk" ? `Walk to ${leg.toName}` : `Transfer to ${leg.toName}`,
      description: `${leg.mode === "walk" ? "Walk" : "Travel"} from ${leg.fromName} to ${leg.toName} — about ${leg.minutes} min.`,
      location_name: leg.toName,
      estimated_cost: null,
      category: "Transfer",
      map_query: leg.toName,
      item_type: "transfer",
      travelTimeMinutes: leg.minutes,
      origin: leg.fromName,
      destination: leg.toName,
      cost_status: "UNKNOWN",
      timing_status: "PLANNED"
    });
  });

  // Interleave legs and items chronologically: a leg departs when the
  // previous item ends, so sorting by start keeps the day's geometry.
  const entries: { start: number; seed: RoamlyActivitySeed }[] = [];
  day.legs.forEach((leg, index) => {
    const seed = legSeeds.get(index);
    if (seed) entries.push({ start: leg.depart, seed });
  });
  for (const item of day.items) {
    entries.push({ start: item.start, seed: engineItemToSeed(item, day, isMustDo(item)) });
  }
  entries.sort((a, b) => a.start - b.start);
  for (const entry of entries) timeline.push(entry.seed);

  if (!isLast) {
    // Starts when the traveler is actually back: the later of the
    // last item's end and the return leg's arrival (the leg departs
    // as the last item ends, so item-end alone would overlap it).
    const lastItemEnd = day.items.length ? Math.max(...day.items.map((i) => i.end)) : day.endMin;
    const lastLegArrive = day.legs.length ? Math.max(...day.legs.map((l) => l.arrive)) : 0;
    const backAt = Math.max(lastItemEnd, lastLegArrive);
    timeline.push(staySeed("Return to your stay", { start: backAt, end: backAt + 15 }));
  }

  if (isLast && ctx.totalDayCount > 1 && ctx.originLabel) {
    timeline.push({
      time_label: "Departure",
      title: `Travel from ${ctx.destination} to ${ctx.originLabel}`,
      description: `Departure travel from ${ctx.destination} back to ${ctx.originLabel} — collect your luggage from your stay and head out.`,
      location_name: ctx.originLabel,
      estimated_cost: null,
      category: "Travel",
      map_query: ctx.originLabel,
      item_type: "travel",
      origin: ctx.destination,
      destination: ctx.originLabel,
      cost_status: "UNKNOWN",
      timing_status: "PLANNED"
    });
  }

  const food = day.items.filter((i) => i.type === "food").map((i) => i.name || i.title || "").filter(Boolean);
  const mustDo = day.items.filter(isMustDo).map((i) => i.name || i.title || "").filter(Boolean);
  const restWindows = day.items
    .filter((i) => i.type === "rest")
    .map((i) => `${i.name || i.title || "Rest"} (${fmt(i.start)} – ${fmt(i.end)})`);
  const blockText = (from: number, to: number, emptyText: string) => {
    const names = day.items.filter((i) => i.start >= from && i.start < to).map((i) => i.name || i.title || "").filter(Boolean);
    return names.length ? names.join(" · ") : emptyText;
  };
  const dayCost = day.items.reduce<number | null>((sum, item) => {
    const cost = evidenceCost(item.priceEvidence ? priceEvidence(item) : null);
    return cost == null ? sum : (sum ?? 0) + cost;
  }, null);
  const firstStop = day.items.find((i) => i.type === "stop" || i.type === "food");

  return {
    day_number: day.dayNumber,
    date: day.date,
    city: ctx.destination,
    title: firstStop ? `Day ${day.dayNumber}: ${firstStop.name || firstStop.title || ctx.destination}` : `Day ${day.dayNumber} in ${ctx.destination}`,
    morning: blockText(0, 12 * 60, "A gentle start around your stay."),
    afternoon: blockText(12 * 60, 17 * 60, "Open time — rest, wander, or revisit a favorite spot."),
    evening: blockText(17 * 60, 24 * 60, "A quiet evening near your stay."),
    food,
    estimated_cost: dayCost,
    map_queries: [...new Set(day.items.map((i) => i.name || i.title || "").filter(Boolean))],
    live_timeline: timeline,
    primary_plan: (day.narrative || []).join(" "),
    protected_anchors: [ctx.anchorName, ...mustDo],
    must_do_items: mustDo,
    flexible_items: day.items.filter((i) => !isMustDo(i) && i.type === "stop").map((i) => i.name || i.title || "").filter(Boolean),
    rest_windows: restWindows,
    plan_status: "coherent"
  };
}

function engineItemToSeed(item: EngineItem, day: EngineDay, mustDo: boolean): RoamlyActivitySeed {
  const ev = item.priceEvidence ? priceEvidence(item) : null;
  const isMeal = item.type === "food";
  const isRest = item.type === "rest";
  const category = isMeal ? "Restaurant" : isRest ? "Rest" : KIND_CATEGORY[item.kind || ""] || "Attraction";
  return {
    time_label: `${fmt(item.start)} – ${fmt(item.end)}`,
    startTime: hhmm(item.start),
    endTime: hhmm(item.end),
    title: item.name || item.title || "",
    description: item.sub || `${item.name || item.title || "Stop"} — planned for day ${day.dayNumber} of this trip.`,
    location_name: item.name || item.title || "",
    estimated_cost: evidenceCost(ev),
    category,
    map_query: item.name || item.title || "",
    item_type: isMeal ? "meal" : isRest ? "rest" : "activity",
    ...(item.key ? { candidateId: item.key } : {}),
    source: item.key ? "openstreetmap" : undefined,
    factualStatus: item.key ? "search_ready" : "estimated",
    plan_role: mustDo ? "must_do" : isMeal ? "meal" : isRest ? "rest" : "primary",
    ...(mustDo ? { must_do: true } : {}),
    cost_status: evidenceCostStatus(ev),
    timing_status: "PLANNED"
  };
}

/* ------------------------------------------------------------------ */
/* The finalization bridge — engine days -> the canonical document    */
/* that the existing finalization accepts, with honest provenance.    */
/* Mirrors the incumbent's assemble order: baseline scaffolding,      */
/* repair, production affiliate attach, hotel identity, localize.     */
/* The ONE deliberate difference: the generation note is the honest   */
/* engine note, never the staged-AI literal.                          */
/* ------------------------------------------------------------------ */

export function assembleEngineItinerary(params: {
  state: StagedGenerationState;
  generatedDays: RoamlyDayPlan[];
  final: boolean;
}): RoamlyItinerary {
  const { state } = params;
  const payload: TripPlannerPayload = {
    ...state.payload,
    priceDiscoveryId: state.priceDiscoveryId || state.payload.priceDiscoveryId || null,
    priceDiscovery: state.priceDiscovery || undefined,
    budgetConstraint: state.budgetConstraint || state.payload.budgetConstraint,
    confirmedBookings: state.confirmedBookings || undefined
  };
  const baseline = buildStarterItinerary(payload);
  const outline = state.outline;
  const raw: RoamlyItinerary = {
    ...baseline,
    destination_summary: outline?.tripSummary || baseline.destination_summary,
    route_reasoning: outline?.importantConstraints?.length
      ? `${baseline.route_reasoning} ${outline.importantConstraints.slice(0, 3).join(" ")}`
      : baseline.route_reasoning,
    hotel_area_suggestions: outline?.hotelAreaRecommendation
      ? [outline.hotelAreaRecommendation, ...baseline.hotel_area_suggestions].slice(0, 6)
      : baseline.hotel_area_suggestions,
    daily_itinerary: params.generatedDays,
    generation_note: params.final
      ? ZERO_ENGINE_GENERATION_NOTE
      : "Generation is in progress (Roamly zero-engine). Completed days are shown as they pass validation."
  };
  // NO travel-requirements repair on this bridge — deliberately. The
  // shipped repair pass is calibrated to AI-day shape: measured on
  // engine output (Phase 5 harness bisect, PHASE5-REPORT) it strips
  // the solver's transfer legs, discards a scheduled must-see on the
  // final day, and injects ungrounded template items ("Hotel checkout
  // and luggage check", "Search verified places near …") that the
  // production validator then rightly rejects. Engine days are
  // travel-complete by construction — a timed leg between every pair
  // of stops, arrival/departure travel and the grounded stay emitted
  // by the converter — so the bridge keeps only the steps that are
  // shape-preserving for grounded days: affiliate attach, the
  // selected-hotel identity guard, and localization. Final validation
  // itself is NOT skipped or softened: it gates this output in the
  // finalization stage exactly as it gates the incumbent's.
  const enriched = enrichItineraryBookingSuggestions(raw, payload);
  return localizeGeneratedExactText(
    enforceSelectedHotelIdentity(stripFallbackRouteBookings(enriched), state),
    payload.language
  ) as RoamlyItinerary;
}

/**
 * Navigation legs are evidence, not bookable inventory. When no
 * affiliate provider is configured for transport, the production
 * affiliate attach falls back to a plain maps route link
 * (provider "google_maps", CTA "Open route") on transfer items —
 * a link the production validator itself rejects as a booking
 * provider for the transport category. The bridge drops exactly
 * that fallback from leg items (item_type transfer/travel); a real
 * affiliate booking (klook / travelpayouts / stay22, attached when
 * production config provides one) is kept wherever it landed, and
 * bookings on stays, meals and activities are untouched.
 */
function stripFallbackRouteBookings(itinerary: RoamlyItinerary): RoamlyItinerary {
  let changed = false;
  const days = itinerary.daily_itinerary.map((day) => ({
    ...day,
    live_timeline: day.live_timeline.map((item) => {
      if (
        item.booking &&
        (item.booking.provider || "").toLowerCase() === "google_maps" &&
        (item.item_type === "transfer" || item.item_type === "travel" || item.affiliate_category === "transport")
      ) {
        changed = true;
        return { ...item, booking: undefined, booking_label: undefined, affiliate_category: undefined };
      }
      return item;
    })
  }));
  return changed ? { ...itinerary, daily_itinerary: days } : itinerary;
}

export function enginePayloadFromState(state: StagedGenerationState): TripPlannerPayload {
  return {
    ...state.payload,
    priceDiscoveryId: state.priceDiscoveryId || state.payload.priceDiscoveryId || null,
    priceDiscovery: state.priceDiscovery || undefined,
    budgetConstraint: state.budgetConstraint || state.payload.budgetConstraint,
    confirmedBookings: state.confirmedBookings || undefined
  };
}

/* ------------------------------------------------------------------ */
/* Context prep — the engine's light equivalent of the incumbent's   */
/* prepare step: confirmed bookings + traveler personalization ONLY. */
/* No market search, no price discovery: the engine grounds in the   */
/* pack, and the cost law prefers not buying data it will not use.   */
/* ------------------------------------------------------------------ */

export async function prepareEngineGenerationContext(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  payload: TripPlannerPayload;
}): Promise<{
  personalization: TravelerPersonalizationContext;
  confirmedBookings: TripPlannerPayload["confirmedBookings"];
}> {
  const [confirmedBookings, travelerMemory] = await Promise.all([
    getConfirmedBookingsForItinerary(params.supabase, params.userId, params.tripId),
    getTravelerMemory(params.supabase, params.userId)
  ]);
  const personalization = buildTravelerPersonalizationContext(travelerMemory.profile);
  personalization.aggregateGuidance = [];
  return { personalization, confirmedBookings: confirmedBookings.bookings };
}

/* ------------------------------------------------------------------ */
/* Start — the same initial state document the incumbent writes,     */
/* plus the engine run record beside it.                              */
/* ------------------------------------------------------------------ */

export interface EngineGenerationContext {
  personalization: TravelerPersonalizationContext;
  confirmedBookings?: TripPlannerPayload["confirmedBookings"];
}

export function buildEngineInitialState(params: {
  tripId: string;
  payload: TripPlannerPayload;
  unlockSource: "free" | "paid" | "bundle" | "admin";
  qaTester?: boolean;
  requestId: string;
  context: EngineGenerationContext;
}): StagedGenerationState {
  const dateRange = calculateTripDateRange(params.payload.startDate, params.payload.endDate);
  if (!dateRange.ok) throw new StagedGenerationError("Trip dates are invalid.", "INVALID_TRIP_DATES", 400, true);
  const totalDayCount = dateRange.days || params.payload.daysCount || 1;
  const payload = safePayloadForState({ ...params.payload, daysCount: totalDayCount });
  return {
    version: 2,
    tripId: params.tripId,
    status: "queued",
    currentStage: "generating_outline",
    totalDayCount,
    completedDayCount: 0,
    outline: null,
    days: buildInitialDayStates(payload, totalDayCount),
    batches: buildInitialBatchStates(totalDayCount),
    generatedDays: {},
    payload,
    personalization: params.context.personalization,
    priceDiscovery: null,
    priceDiscoveryId: null,
    budgetConstraint: params.payload.budgetConstraint || null,
    confirmedBookings: params.context.confirmedBookings || [],
    unlockSource: params.unlockSource,
    qaTester: params.qaTester === true,
    model: null,
    provider: ZERO_ENGINE_PROVIDER,
    outlineAttemptCount: 0,
    aiCallCount: 0,
    estimatedAiCostUsd: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    stageRuns: [],
    finalValidationErrors: [],
    lastError: null,
    lastErrorCode: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    worker: null,
    trace: { requestId: params.requestId }
  };
}

export async function startEngineGeneration(params: {
  store: EngineGenerationStore;
  tripId: string;
  userId: string;
  payload: TripPlannerPayload;
  requestId: string;
  unlockSource: "free" | "paid" | "bundle" | "admin";
  qaTester?: boolean;
  context: EngineGenerationContext;
}): Promise<StagedGenerationState> {
  const state = buildEngineInitialState(params);
  const run = initialRunRecord(state.startedAt);
  const trip = await params.store.loadTrip(params.tripId, params.userId);
  await params.store.persistState(trip, state, run);
  return state;
}

/* ------------------------------------------------------------------ */
/* Advance — mirrors the incumbent driver's discipline step for step: */
/* load -> terminal checks -> claim (lease + CAS) -> watchdog -> one  */
/* stage of work -> persist. The watchdog and the work selector are   */
/* the incumbent's own exported functions.                            */
/* ------------------------------------------------------------------ */

export interface EngineAdvanceDeps {
  store: EngineGenerationStore;
  packStore: PackStore;
  placesService?: PlacesEnrichmentService | null;
}

export type EngineAdvanceResult = {
  ok: boolean;
  status: StagedGenerationStatus;
  state: StagedGenerationState;
  advanced: boolean;
  busy?: boolean;
  stage?: string;
  batchId?: string | null;
  dayNumbers?: number[] | null;
  error?: string;
  validationFailed?: boolean;
  waitingForPack?: boolean;
};

function completedDayCountOf(state: StagedGenerationState) {
  return Object.values(state.days).filter((d) => d.status === "complete").length;
}

async function assemblePinnedPackForTrip(
  deps: EngineAdvanceDeps,
  tripId: string,
  payload: TripPlannerPayload,
  run: ZeroEngineRunRecord
): Promise<{ pack: EnginePack; versionId: string } | null> {
  let weather: WeatherSnapshotRecord | null = null;
  if (run.destinationId && payload.startDate && payload.endDate) {
    weather = await deps.packStore.getWeatherSnapshot(run.destinationId, "forecast", payload.startDate, payload.endDate);
  }
  const assembled = await assemblePinnedEnginePack(deps.packStore, tripId, weather);
  if (!assembled) return null;
  return { pack: assembled.pack, versionId: assembled.version.dto.packVersionId };
}

function normalizedPlaceName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function resolveDestinationId(deps: EngineAdvanceDeps, payload: TripPlannerPayload): Promise<string | null> {
  const destinations = await deps.packStore.listDestinations();
  const wanted = [payload.destinationCity, payload.destination]
    .map((v) => normalizedPlaceName(getString(v)))
    .filter(Boolean);
  for (const dest of destinations) {
    const name = normalizedPlaceName(dest.displayName);
    if (wanted.some((w) => w === name || w.includes(name) || name.includes(w))) return dest.destinationId;
  }
  return null;
}

/* ------------------------- outline stage ------------------------- */

async function runOutlineStage(params: {
  deps: EngineAdvanceDeps;
  trip: EngineTripRow;
  state: StagedGenerationState;
  run: ZeroEngineRunRecord;
  requestId: string;
}): Promise<EngineAdvanceResult> {
  const { deps } = params;
  let { state, run } = params;
  const started = Date.now();
  state = { ...state, status: "generating_outline", currentStage: "generating_outline", updatedAt: nowIso() };
  let trip = await deps.store.persistState(params.trip, state, run);

  const destinationId = run.destinationId || (await resolveDestinationId(deps, state.payload));
  if (!destinationId) {
    throw new StagedGenerationError(
      "No registered destination matches this trip yet, so the zero-engine cannot ground a plan.",
      "ZERO_ENGINE_DESTINATION_UNREGISTERED",
      502,
      true,
      { failureCategory: "engine_data" }
    );
  }
  const serving = await readServingPack(deps.packStore, destinationId);
  if (serving.state !== "ready" || !serving.pack) {
    // Cold destination: a build is enqueued by the read itself; the
    // job waits (the worker releases it) and a later wake retries —
    // a customer request never blocks on a pack build (DESIGN §2.2).
    run = { ...run, destinationId, packWaitCount: run.packWaitCount + 1 };
    const waiting = releaseLease({ ...state, status: "queued", currentStage: "generating_outline", updatedAt: nowIso() });
    await deps.store.persistState(trip, waiting, run);
    return { ok: true, status: waiting.status, state: waiting, advanced: false, busy: true, waitingForPack: true, stage: "outline" };
  }

  await deps.packStore.pinVersion(state.tripId, serving.pack.dto.packVersionId);
  run = { ...run, destinationId, packVersionId: serving.pack.dto.packVersionId };

  const assembled = await assemblePinnedPackForTrip(deps, state.tripId, state.payload, run);
  if (!assembled) {
    throw new StagedGenerationError("The pinned pack could not be assembled.", "ZERO_ENGINE_PACK_ASSEMBLY_FAILED", 502, false, {
      failureCategory: "engine_data"
    });
  }
  const pack = assembled.pack;
  run = { ...run, destinationName: pack.destination };
  const scoredStays = scoreStays(pack);
  const ctx = deriveSolveContext({ payload: enginePayloadFromState(state), pack, scoredStays });
  run = {
    ...run,
    anchor: { name: ctx.anchorName, key: ctx.anchorKey, source: ctx.anchorSource, pos: ctx.anchorPos }
  };

  const outlineAttemptCount = (state.outlineAttemptCount || 0) + 1;
  const outlineDays = Array.from({ length: state.totalDayCount }, (_, index) => {
    const dayNumber = index + 1;
    return {
      id: `day-${dayNumber}`,
      dayNumber,
      date: dateForDay(state.payload, dayNumber),
      theme: dayNumber === 1 ? "Arrival and first steps" : dayNumber === state.totalDayCount ? "Final day and departure" : `Exploring ${pack.destination}`,
      geographicArea: pack.destination,
      priorityActivities: ctx.mustSees.map((m) => m.label).slice(0, 8)
    };
  });
  const outline: StagedTripOutline = {
    tripSummary: `${pack.destination}, ${pack.country} — a ${state.totalDayCount}-day trip planned from recorded place data by Roamly's deterministic zero-engine.`,
    hotelAreaRecommendation: `${ctx.anchorName} — the trip's base${ctx.anchorSource === "booked" ? " (your confirmed booking)" : ""}.`,
    importantConstraints: [
      ...(ctx.extracted.earliestStart ? [`No starts before ${ctx.extracted.earliestStart}.`] : []),
      ...(ctx.restSpec?.text ? [`Rest protected: ${ctx.restSpec.text}.`] : []),
      ...(ctx.extracted.dietary.length ? [`Dietary: ${ctx.extracted.dietary.join(", ")}.`] : [])
    ],
    days: outlineDays
  };

  const durationMs = Date.now() - started;
  state = releaseLease(
    appendStageRun(
      {
        ...state,
        status: "generating_day",
        currentStage: "generating_day",
        outline,
        outlineAttemptCount,
        provider: ZERO_ENGINE_PROVIDER,
        model: null,
        lastError: null,
        lastErrorCode: null
      },
      engineStageRun({
        stage: "outline",
        batchId: null,
        dayNumbers: null,
        attemptNumber: outlineAttemptCount,
        status: "success",
        durationMs,
        failureCategory: null,
        errorCode: null
      })
    )
  );
  trip = await deps.store.persistState(trip, state, run);
  return { ok: true, status: state.status, state, advanced: true, stage: "outline" };
}

/* ------------------------ day batch stage ------------------------ */

async function runDayBatchStage(params: {
  deps: EngineAdvanceDeps;
  trip: EngineTripRow;
  state: StagedGenerationState;
  run: ZeroEngineRunRecord;
  batchId: string;
  requestId: string;
}): Promise<EngineAdvanceResult> {
  const { deps } = params;
  let { state, run } = params;
  const batch = state.batches[params.batchId];
  if (!batch) throw new StagedGenerationError("Batch not found.", "BATCH_NOT_FOUND", 404, true);
  const started = Date.now();
  const attemptCount = batch.attemptCount + 1;

  state = {
    ...state,
    status: "generating_day",
    currentStage: "generating_day",
    batches: {
      ...state.batches,
      [batch.id]: { ...batch, status: "generating", attemptCount, startedAt: batch.startedAt || nowIso(), updatedAt: nowIso(), lastError: null }
    },
    days: {
      ...state.days,
      ...Object.fromEntries(
        batch.dayNumbers.map((dayNumber) => [
          String(dayNumber),
          {
            ...state.days[String(dayNumber)],
            dayNumber,
            status: "generating" as const,
            attemptCount,
            startedAt: state.days[String(dayNumber)]?.startedAt || nowIso(),
            updatedAt: nowIso(),
            lastError: null
          }
        ])
      )
    }
  };
  let trip = await deps.store.persistState(params.trip, state, run);

  const assembled = await assemblePinnedPackForTrip(deps, state.tripId, state.payload, run);
  if (!assembled) {
    throw new StagedGenerationError("The pinned pack could not be assembled.", "ZERO_ENGINE_PACK_ASSEMBLY_FAILED", 502, false, {
      failureCategory: "engine_data"
    });
  }
  let pack = assembled.pack;
  const payload = enginePayloadFromState(state);

  // Two-pass enrichment (DESIGN Phase 5): only on the first batch,
  // only when a Places service is injected, and only when the pinned
  // version's finalists lack enrichment. It runs as a job step inside
  // the generation job — never synchronously inside the HTTP request
  // that created the trip, and never as a model call.
  const isFirstBatch = Object.values(state.batches).every((b) => b.id === batch.id || b.status === "queued");
  if (isFirstBatch && deps.placesService && run.enrichment === null) {
    const firstPass = runEnginePlan({ pack, payload, totalDayCount: state.totalDayCount, anchorOverride: run.anchor });
    const finalists = finalistKeysFromPlan(firstPass.plan, run.anchor?.key || null);
    const report = await deps.placesService.enrichPackFinalists(assembled.versionId, [...finalists]);
    run = {
      ...run,
      enrichment: {
        mode: report.mode,
        enriched: report.enriched,
        calls: report.callsThisRun.textSearch + report.callsThisRun.placeDetails
      }
    };
    const refreshed = await assemblePinnedPackForTrip(deps, state.tripId, state.payload, run);
    if (refreshed) pack = refreshed.pack;
  }

  const planRun = runEnginePlan({ pack, payload, totalDayCount: state.totalDayCount, anchorOverride: run.anchor });
  const mustSeeKeys = new Set(
    planRun.plan.mustSeeResults.map((m) => m.itemKey).filter((k): k is string => typeof k === "string" && k.length > 0)
  );
  const originRaw = getString(payload.origin) || getString(payload.originCity);
  const conversionCtx: DayConversionContext = {
    destination: pack.destination,
    anchorName: planRun.ctx.anchorName,
    anchorKey: planRun.ctx.anchorKey,
    anchorBooked: planRun.ctx.anchorSource === "booked",
    totalDayCount: state.totalDayCount,
    mustSeeKeys,
    originLabel:
      originRaw && originRaw.trim().toLowerCase() !== pack.destination.trim().toLowerCase() ? originRaw : null
  };
  const batchDays = batch.dayNumbers
    .map((dayNumber) => planRun.daysOut.find((d) => d.dayNumber === dayNumber))
    .filter((d): d is EngineDay => Boolean(d))
    .map((d) => engineDayToRoamlyDayPlan(d, conversionCtx));

  const batchErrors: string[] = [];
  for (const dayNumber of batch.dayNumbers) {
    const day = batchDays.find((d) => d.day_number === dayNumber);
    if (!day) batchErrors.push(`Batch missing Day ${dayNumber}.`);
    else if (!day.live_timeline.length) batchErrors.push(`Day ${dayNumber} has no timeline items.`);
  }
  if (batchErrors.length) {
    throw new StagedGenerationError(batchErrors.slice(0, 4).join(" | "), "DAY_BATCH_VALIDATION_FAILED", 502, false, {
      failureCategory: "malformed_output"
    });
  }

  const completedAt = nowIso();
  const durationMs = Date.now() - started;
  state = releaseLease(
    appendStageRun(
      {
        ...state,
        status: "generating_day",
        currentStage: "generating_day",
        completedDayCount: Math.min(state.totalDayCount, completedDayCountOf(state) + batchDays.length),
        provider: ZERO_ENGINE_PROVIDER,
        model: null,
        generatedDays: { ...state.generatedDays, ...Object.fromEntries(batchDays.map((d) => [String(d.day_number), d])) },
        batches: {
          ...state.batches,
          [batch.id]: {
            ...state.batches[batch.id],
            status: "complete",
            attemptCount,
            provider: ZERO_ENGINE_PROVIDER,
            model: null,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            completedAt,
            updatedAt: completedAt,
            lastError: null
          }
        },
        days: {
          ...state.days,
          ...Object.fromEntries(
            batch.dayNumbers.map((dayNumber) => [
              String(dayNumber),
              {
                ...state.days[String(dayNumber)],
                dayNumber,
                status: "complete" as const,
                attemptCount,
                updatedAt: completedAt,
                completedAt,
                lastError: null
              }
            ])
          )
        },
        lastError: null,
        lastErrorCode: null
      },
      engineStageRun({
        stage: "day_batch",
        batchId: batch.id,
        dayNumbers: batch.dayNumbers,
        attemptNumber: attemptCount,
        status: "success",
        durationMs,
        failureCategory: null,
        errorCode: null
      })
    )
  );

  const sortedDays = Object.values(state.generatedDays).sort((a, b) => a.day_number - b.day_number);
  const partial = assembleEngineItinerary({ state, generatedDays: sortedDays, final: false });
  await deps.store.persistItinerary(trip, partial, false);
  trip = await deps.store.persistState(trip, state, run);
  return { ok: true, status: state.status, state, advanced: true, stage: "day_batch", batchId: batch.id, dayNumbers: batch.dayNumbers };
}

/* ----------------------- finalization stage ----------------------- */

function finalValidationFailureState(state: StagedGenerationState, validationErrors: string[], attemptCount: number): StagedGenerationState {
  return releaseLease({
    ...state,
    status: "failed",
    currentStage: "failed",
    finalValidationErrors: validationErrors,
    finalValidationAttemptCount: attemptCount,
    finalValidationRepairedAt: attemptCount > 1 ? nowIso() : state.finalValidationRepairedAt || null,
    lastError: validationErrors.join(" | "),
    lastErrorCode: "FINAL_VALIDATION_FAILED"
  });
}

async function runFinalizationStage(params: {
  deps: EngineAdvanceDeps;
  trip: EngineTripRow;
  state: StagedGenerationState;
  run: ZeroEngineRunRecord;
  requestId: string;
}): Promise<EngineAdvanceResult> {
  const { deps } = params;
  let { state, run } = params;
  let trip = params.trip;
  const payload = enginePayloadFromState(state);

  state = { ...state, status: "enriching_transport", currentStage: "enriching_transport", updatedAt: nowIso() };
  trip = await deps.store.persistState(trip, state, run);
  state = { ...state, status: "enriching_affiliates", currentStage: "enriching_affiliates", updatedAt: nowIso() };
  trip = await deps.store.persistState(trip, state, run);

  const sortedDays = Object.values(state.generatedDays).sort((a, b) => a.day_number - b.day_number);
  let itinerary = assembleEngineItinerary({ state, generatedDays: sortedDays, final: true });
  // Single validation pass. The incumbent retries through the repair
  // pass because model output is stochastic and repair fixes common
  // model omissions; engine output is deterministic, a re-run would
  // produce the identical document, and the repair pass corrupts
  // grounded engine days (see assembleEngineItinerary). A failure
  // here is therefore the honest FINAL_VALIDATION_FAILED — the gate
  // refuses, exactly the KF-1 posture, never a weakened pass.
  const validation = validateItineraryForProduction(itinerary, payload);
  const validationAttemptCount = 1;
  if (!validation.ok) {
    const failed = finalValidationFailureState(state, validation.errors, validationAttemptCount);
    const partial = assembleEngineItinerary({ state: failed, generatedDays: sortedDays, final: false });
    await deps.store.persistItinerary(trip, partial, false);
    await deps.store.persistState(trip, failed, run);
    return {
      ok: false,
      status: failed.status,
      state: failed,
      advanced: false,
      stage: "complete",
      error: "FINAL_VALIDATION_FAILED",
      validationFailed: true
    };
  }

  // PREDICT at lock (M8): the predictions are computed from the final
  // engine plan over the pinned pack and written immutably BEFORE the
  // completion is persisted — a completed engine trip always carries
  // the record LEARN will grade against.
  const assembled = await assemblePinnedPackForTrip(deps, state.tripId, state.payload, run);
  if (assembled && run.packVersionId) {
    const planRun = runEnginePlan({ pack: assembled.pack, payload, totalDayCount: state.totalDayCount, anchorOverride: run.anchor });
    /* ALL-IN budget scope (owner decision, 2026-10-22): PREDICT's
     * budget posture prices lodging from the resolved anchor stay's
     * own record — its Google price level when the pinned pack carries
     * one (BAND evidence), its booked price when a booking record ever
     * supplies one. No transport estimate is computed at generation
     * time today, so getting-there enters as no-evidence: named in the
     * scope note and excluded from the totals, never zero. */
    const anchorStayRecord = run.anchor?.key
      ? (assembled.pack.stays ?? []).find((s) => s.key === run.anchor?.key) ?? null
      : null;
    const predictions = buildPredictions(
      {
        days: planRun.daysOut,
        travelers: {
          adults: payload.travelers?.adults ?? 1,
          children: payload.travelers?.children ?? 0,
          infants: payload.travelers?.infants ?? 0
        },
        budgetCap: payload.budgetAmount ? { amount: payload.budgetAmount, currency: payload.budgetCurrency || "CAD" } : null
      },
      assembled.pack,
      {
        now: nowIso(),
        scope: {
          lodging: run.anchor
            ? {
                name: run.anchor.name,
                candidateKey: run.anchor.key,
                nights: Math.max(0, state.totalDayCount - 1),
                priceBandLevel: anchorStayRecord?.google?.priceLevel ?? null,
                priceBandSource: anchorStayRecord?.google ? "google" : null
              }
            : null,
          transport: null
        }
      }
    );
    await deps.store.writePrediction({
      predictionId: predictionId({ tripId: state.tripId, packVersionId: run.packVersionId }),
      tripId: state.tripId,
      userId: trip.user_id,
      packVersionId: run.packVersionId,
      generationVersion: ZERO_ENGINE_GENERATION_VERSION,
      recordedAt: predictions.recordedAt,
      record: predictions
    });
    // Ship defect #2: the prediction row is service-role-only — the
    // traveler can never see the all-in verdict there. Stamp the
    // traveler-facing display payload onto the saved itinerary
    // document itself, so the trip page renders the verdict for
    // engine trips (its absence remains the incumbent signature:
    // no stamp, legacy budget display, untouched).
    itinerary = stampBudgetVerdictDisplay(itinerary, predictions.budgetPosture);
  }

  const completed: StagedGenerationState = releaseLease({
    ...state,
    status: "complete",
    currentStage: "complete",
    completedDayCount: state.totalDayCount,
    completedAt: nowIso(),
    finalValidationErrors: [],
    finalValidationAttemptCount: validationAttemptCount,
    finalValidationRepairedAt: validationAttemptCount > 1 ? nowIso() : state.finalValidationRepairedAt || null,
    lastError: null,
    lastErrorCode: null
  });
  run = { ...run, completedAt: completed.completedAt || nowIso() };
  await deps.store.persistItinerary(trip, itinerary, true);

  if (completed.unlockSource === "free") {
    const marked = await deps.store.markFreeItineraryUsed(trip.user_id, trip.id);
    if (!marked.ok) {
      const failed: StagedGenerationState = {
        ...completed,
        status: "failed",
        currentStage: "failed",
        lastError: "Free itinerary was already used.",
        lastErrorCode: "PAYMENT_REQUIRED"
      };
      await deps.store.persistState(trip, failed, run);
      throw new StagedGenerationError(
        "Your account's free itinerary has already been used. Payment is required to generate another itinerary.",
        "PAYMENT_REQUIRED",
        402,
        true
      );
    }
  }
  const lock = await deps.store.lockItinerary(trip.user_id, trip.id, completed.unlockSource || "paid");
  if (lock.error) throw new StagedGenerationError(lock.error, "ITINERARY_LOCK_FAILED", 500);
  await deps.store.persistState(trip, completed, run);
  return { ok: true, status: completed.status, state: completed, advanced: true, stage: "complete" };
}

/* --------------------------- advance --------------------------- */

export async function advanceEngineGeneration(params: {
  deps: EngineAdvanceDeps;
  tripId: string;
  userId?: string;
  requestId: string;
}): Promise<EngineAdvanceResult> {
  const { deps } = params;
  const initialTrip = await deps.store.loadTrip(params.tripId, params.userId);
  const initialState = getStagedGenerationState(initialTrip.metadata, params.tripId);
  if (!initialState) {
    throw new StagedGenerationError("No staged generation job exists for this trip.", "GENERATION_JOB_NOT_FOUND", 404, true);
  }
  const initialRun = getRunRecord(initialTrip.metadata);
  if (!initialRun) {
    throw new StagedGenerationError("This trip is not a zero-engine generation job.", "NOT_AN_ENGINE_JOB", 409, true);
  }
  if (
    initialState.status === "complete" ||
    ((initialState.status === "failed" || initialState.status === "partially_failed") && !canResumeStagedGeneration(initialState))
  ) {
    return { ok: initialState.status === "complete", status: initialState.status, state: initialState, advanced: false };
  }

  // Claim: same lease discipline as the incumbent — a live lease held
  // by another request refuses entry; the write itself is a CAS on
  // the trip row's updated_at.
  const existingLeaseUntil = initialState.worker?.leaseExpiresAt ? new Date(initialState.worker.leaseExpiresAt).getTime() : 0;
  if (existingLeaseUntil > Date.now() && initialState.worker?.leaseId !== params.requestId) {
    return { ok: true, status: initialState.status, state: initialState, advanced: false, busy: true };
  }
  let run = initialRun;
  const claimedState: StagedGenerationState = {
    ...initialState,
    worker: { leaseId: params.requestId, leaseExpiresAt: new Date(Date.now() + STAGE_LEASE_MS).toISOString() },
    updatedAt: nowIso()
  };
  const claimedTrip = await deps.store.claim(initialTrip, claimedState, run);
  if (!claimedTrip) {
    return { ok: true, status: initialState.status, state: initialState, advanced: false, busy: true };
  }
  let trip = claimedTrip;
  let state = getStagedGenerationState(trip.metadata, params.tripId) || claimedState;
  run = getRunRecord(trip.metadata) || run;

  // Watchdog: the shipped function, unmodified, over the engine's
  // state document. Holding the claim proves no live driver owns
  // this trip, exactly as in the incumbent advance.
  const watchdog = resetStrandedGeneratingBatches(state, Date.now());
  if (watchdog.changed) {
    state = watchdog.state;
    trip = await deps.store.persistState(trip, state, run);
  }

  try {
    const work = nextStagedGenerationWork(state);
    if (!work) {
      const released = releaseLease(state);
      await deps.store.persistState(trip, released, run);
      return { ok: true, status: released.status, state: released, advanced: false };
    }
    if (work.stage === "outline") {
      return await runOutlineStage({ deps, trip, state, run, requestId: params.requestId });
    }
    if (work.stage === "day_batch" && work.batchId) {
      return await runDayBatchStage({ deps, trip, state, run, batchId: work.batchId, requestId: params.requestId });
    }
    // All batches resolved: either a partial failure or finalization.
    if (Object.values(state.batches).some((b) => b.status === "failed")) {
      const partial = releaseLease({
        ...state,
        status: "partially_failed",
        currentStage: "partially_failed",
        lastError: "One or more days failed after bounded retries.",
        lastErrorCode: "DAY_PARTIAL_FAILURE"
      });
      await deps.store.persistState(trip, partial, run);
      return { ok: true, status: partial.status, state: partial, advanced: false };
    }
    return await runFinalizationStage({ deps, trip, state, run, requestId: params.requestId });
  } catch (error) {
    const generationError =
      error instanceof StagedGenerationError
        ? error
        : new StagedGenerationError(
            error instanceof Error && error.message ? `Generation stage failed: ${error.message}` : "Generation stage failed.",
            "GENERATION_STAGE_FAILED",
            502
          );

    // A stage may already have persisted progress (the day-batch
    // flip persists before its work runs), which makes the claim-time
    // trip handle stale for the failure write. Reload the row so the
    // failure state lands on the freshest revision — and, equally,
    // re-read the state so the failure bookkeeping starts from what
    // the stage actually persisted.
    const freshTrip = await deps.store.loadTrip(params.tripId, params.userId).catch(() => trip);
    trip = freshTrip;
    state = getStagedGenerationState(freshTrip.metadata, params.tripId) || state;
    run = getRunRecord(freshTrip.metadata) || run;

    if (!state.outline) {
      const exhausted = generationError.permanent || (state.outlineAttemptCount || 0) >= BATCH_ATTEMPT_LIMIT;
      const updatedState = releaseLease(
        appendStageRun(
          {
            ...state,
            status: exhausted ? "failed" : "generating_outline",
            currentStage: exhausted ? "failed" : "generating_outline",
            lastError: generationError.message,
            lastErrorCode: generationError.code
          },
          engineStageRun({
            stage: "outline",
            batchId: null,
            dayNumbers: null,
            attemptNumber: state.outlineAttemptCount || 1,
            status: "failed",
            durationMs: null,
            failureCategory: generationError.failureCategory,
            errorCode: generationError.code
          })
        )
      );
      await deps.store.persistState(trip, updatedState, run);
      if (generationError.permanent || exhausted) throw generationError;
      return { ok: false, status: updatedState.status, state: updatedState, advanced: false, error: generationError.code };
    }

    const failedBatch =
      Object.values(state.batches).find((batch) => batch.status === "generating") ||
      Object.values(state.batches).find((batch) => batch.status !== "complete");
    const exhausted = generationError.permanent || Boolean(failedBatch && failedBatch.attemptCount >= BATCH_ATTEMPT_LIMIT);
    const failedBatchState = failedBatch
      ? { ...failedBatch, status: exhausted ? ("failed" as const) : ("queued" as const), lastError: generationError.code, updatedAt: nowIso() }
      : null;
    const failedDayStates = failedBatchState
      ? Object.fromEntries(
          failedBatchState.dayNumbers.map((dayNumber) => [
            String(dayNumber),
            {
              ...state.days[String(dayNumber)],
              dayNumber,
              status: failedBatchState.status,
              lastError: generationError.code,
              updatedAt: nowIso()
            }
          ])
        )
      : {};
    const updatedState = releaseLease(
      appendStageRun(
        {
          ...state,
          status: exhausted ? "failed" : state.status,
          currentStage: exhausted ? "failed" : "generating_day",
          batches: failedBatchState ? { ...state.batches, [failedBatchState.id]: failedBatchState } : state.batches,
          days: { ...state.days, ...failedDayStates },
          lastError: generationError.message,
          lastErrorCode: generationError.code
        },
        engineStageRun({
          stage: "day_batch",
          batchId: failedBatch?.id || null,
          dayNumbers: failedBatch?.dayNumbers || null,
          attemptNumber: failedBatch?.attemptCount || 1,
          status: "failed",
          durationMs: null,
          failureCategory: generationError.failureCategory,
          errorCode: generationError.code
        })
      )
    );
    await deps.store.persistState(trip, updatedState, run);
    if (generationError.permanent || !failedBatch) throw generationError;
    return { ok: false, status: updatedState.status, state: updatedState, advanced: false, error: generationError.code };
  }
}

/** Completion notification parity: when an engine job reaches a
 *  terminal state through a path that bypasses the queue worker's
 *  own finish step, the same staged-generation email machinery is
 *  used (it reads the same state document). Exported for the worker
 *  branch; the worker's normal terminal handling already covers the
 *  queue-driven flow. */
export async function notifyEngineTerminal(tripId: string, kind: "completion" | "failure") {
  return finalizeStagedGenerationNotification({ tripId, kind });
}
