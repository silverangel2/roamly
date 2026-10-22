/*
 * Build 2 post-trip loop + library ingest (DESIGN-PRODUCTION.md
 * Phase 10; flag ROAMLY_BUILD2_POSTTRIP_ENABLED, default OFF).
 *
 * The loop, end to end:
 *   1. A trip completes (the canonical predicate lives in
 *      tripCompletion.ts; Phase 11 owns the lifecycle flip to
 *      POST_TRIP_PENDING). The review ask is composed from the
 *      AS-LIVED record — what actually happened, reconstructed from
 *      the final plan + the Phase 7 companion ledger (M2) + activity
 *      states + the traveler's own bookings — never from the
 *      as-planned itinerary, and it is addressed to the traveler's
 *      CONNECTED GMAIL only (Build 2 law: email is only Gmail; an
 *      Outlook connection never satisfies the recipient rule).
 *   2. Feedback intake stays production's (trip_feedback +
 *      TripFeedbackForm, unchanged route). The ingest seam in
 *      tripFeedback.ts calls maybeIngestCompletedTrip() after a
 *      post-trip feedback save, behind the flag.
 *   3. INGEST GATE (Dylan addition E, owner-endorsed): a trip enters
 *      the library only when it is OUTSTANDING (overall rating at
 *      the threshold) AND verified as-lived (>= 3 verified check-ins
 *      from the ledger). Rating alone never ingests. A refusal is a
 *      recorded decision with its reasons — never a silent drop.
 *   4. INGEST SHAPE (contradiction C5 + PORTABILITY §6): M9's
 *      roamly_library_trips stores the owner INDEX (place, hotel +
 *      stars, flights, weather, honest known-subtotal price, rating)
 *      and pattern links POINTING AT the archived trip record. It
 *      never embeds or duplicates the as-lived itinerary document —
 *      the ephemeral as-lived evidence stays purge-governed
 *      (Phase 11), the purchased itinerary stays archived in place.
 *   5. BUDGET-VS-REAL AFTER leg: the post-trip reckoning runs the
 *      Phase 2 budgetVsReal module against the as-lived actuals —
 *      final variance, calibration writes into the library price
 *      store in the ladder's VERIFIED shape, and band/model bias
 *      proposals at >= 5 observations (recorded, never applied).
 *
 * Prices are honest or absent: the known subtotal sums KNOWN booked
 * prices only; unknown prices are named in price_unknown_items and
 * never converted to zero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { annulledEntryIds } from "./companionPanel";
import {
  SupabaseCompanionLedgerStore,
  type CompanionLedgerStore
} from "./companionLedger";
import {
  calibrate,
  proposeBias,
  runCheckpoint,
  type BiasObservation,
  type BiasProposal,
  type BvrItinerary,
  type CheckpointReport,
  type LibraryRecord,
  type LibraryStore,
  type PaidFact
} from "./engine/budgetVsReal";
import { instantStringToLocal } from "./engine/time";
import type { CompanionLedgerEntryDTO } from "./engine/types";
import type { SuccessfulTripExperienceContext } from "./successfulTripExperience";
import {
  budgetBandForAmount,
  type SuccessfulTripExperienceContextRecord
} from "./successfulTripExperiencePatterns";

export const LIBRARY_TRIPS_TABLE = "roamly_library_trips";
/** The email_connections provider value for Gmail — must equal
 *  GMAIL_PROVIDER in emailConnections.ts (kept as a literal here so
 *  this module never drags the OAuth/extraction chain into the
 *  post-trip lane). */
const GMAIL_PROVIDER_NAME = "gmail";
/** Booking-proven library records carry the aggregation's highest
 *  source weight — the same weight the frontdoor lane carries. */
export const LIBRARY_TRIP_RECORD_WEIGHT = 2;
const MIN_AVERAGE_RATING_FOR_SUCCESS = 4;

/* ------------------------------------------------------------------ */
/* The AS-LIVED record (production shape)                              */
/* ------------------------------------------------------------------ */

export interface AsLivedPrice {
  amount: number;
  currency: string;
  status: string;
}

export type AsLivedItemType = "hotel" | "flight" | "activity" | "other";
export type AsLivedOutcome = "kept" | "skipped" | "changed" | "unknown";

export interface AsLivedItem {
  itemKey: string;
  name: string;
  day: number;
  itemType: AsLivedItemType;
  outcome: AsLivedOutcome;
  planned: { start: string; end: string } | null;
  actual: {
    start?: string;
    end?: string;
    checkedIn?: string;
    left?: string;
    dwellMin?: number | null;
    state?: string;
  } | null;
  evidence: { type: string; verified: boolean; reference?: string } | null;
  signal: { classification: "SKIP" | "MISSED"; rehomeCandidate: boolean } | null;
  travelerRating: number | null;
  liked: string | null;
  bookingRef: string | null;
  price: AsLivedPrice | null;
}

export interface AsLivedFlight {
  provider: string | null;
  flight: string | null;
  from: string | null;
  to: string | null;
  departure: string | null;
  arrival: string | null;
  price: AsLivedPrice | null;
}

export interface AsLivedHotel {
  name: string;
  stars: number | null;
  price: AsLivedPrice | null;
  checkInActual: string | null;
  checkOutActual: string | null;
}

export interface AsLivedWeatherDay {
  date: string;
  conditions: string | null;
  highC: number | null;
  lowC: number | null;
  source: string | null;
}

export interface AsLivedRecord {
  tripId: string;
  userId: string;
  destination: string;
  destinationCity: string | null;
  destinationCountry: string | null;
  dates: string[];
  timezone: string;
  hotel: AsLivedHotel | null;
  flights: AsLivedFlight[];
  weather: AsLivedWeatherDay[];
  items: AsLivedItem[];
  overallTravelerRating: number | null;
  ratingScale: number;
  evidenceStatus: string | null;
}

/* ------------------------------------------------------------------ */
/* Outstanding gate (shadow evaluateOutstanding, ported)               */
/* ------------------------------------------------------------------ */

export interface OutstandingThresholds {
  overallRating: number;
  minVerifiedCheckIns: number;
  maxUnresolvedCollisions: number;
}

export interface OutstandingEvaluation {
  eligible: boolean;
  threshold: OutstandingThresholds;
  verifiedCheckInCount: number;
  overallTravelerRating: number | null;
  ratingScale: number;
  unresolvedCollisions: number;
  reasons: string[];
  basis: string;
}

export function verifiedCheckIns(asLived: AsLivedRecord): AsLivedItem[] {
  return asLived.items.filter(
    (item) => item.evidence?.type === "check-in" && item.evidence?.verified === true
  );
}

export function evaluateOutstanding(
  asLived: AsLivedRecord,
  options: Partial<OutstandingThresholds> & { unresolvedCollisions?: number } = {}
): OutstandingEvaluation {
  const threshold: OutstandingThresholds = {
    overallRating: options.overallRating ?? 5,
    minVerifiedCheckIns: options.minVerifiedCheckIns ?? 3,
    maxUnresolvedCollisions: options.maxUnresolvedCollisions ?? 0
  };
  const checkIns = verifiedCheckIns(asLived);
  const unresolvedCollisions = options.unresolvedCollisions ?? 0;
  const reasons: string[] = [];
  if ((asLived.overallTravelerRating ?? 0) < threshold.overallRating) {
    reasons.push(
      `overall rating ${asLived.overallTravelerRating ?? "missing"} is below the outstanding threshold ${threshold.overallRating}/${asLived.ratingScale || 5}`
    );
  }
  if (checkIns.length < threshold.minVerifiedCheckIns) {
    reasons.push(
      `only ${checkIns.length} verified check-ins; ${threshold.minVerifiedCheckIns} required`
    );
  }
  if (unresolvedCollisions > threshold.maxUnresolvedCollisions) {
    reasons.push(`${unresolvedCollisions} unresolved collision(s) remain`);
  }
  return {
    eligible: reasons.length === 0,
    threshold,
    verifiedCheckInCount: checkIns.length,
    overallTravelerRating: asLived.overallTravelerRating,
    ratingScale: asLived.ratingScale || 5,
    unresolvedCollisions,
    reasons,
    basis: "Dylan addition E: outstanding rating AND verified as-lived evidence"
  };
}

/* ------------------------------------------------------------------ */
/* Honest known-price index (shadow knownPriceIndex, production form)  */
/* ------------------------------------------------------------------ */

export interface KnownPriceEntry {
  label: string;
  amount: number;
  currency: string;
  status: string;
  bookingRef?: string;
}

export interface KnownPriceIndex {
  knownItems: KnownPriceEntry[];
  totalKnown: number;
  currency: string;
  unknownItems: string[];
  estimatedPrice: {
    amount: number | null;
    currency: string;
    status: "ESTIMATED_KNOWN_SUBTOTAL";
    basis: string;
    unknownItems: string[];
    isCompleteTripTotal: boolean;
  };
}

export function buildKnownPriceIndex(asLived: AsLivedRecord): KnownPriceIndex {
  const entries: KnownPriceEntry[] = [];
  const seenRefs = new Set<string>();
  for (const flight of asLived.flights) {
    if (flight.price) {
      entries.push({
        label: `${flight.provider || "Flight"} ${flight.flight || ""}`.trim(),
        amount: flight.price.amount,
        currency: flight.price.currency || "CAD",
        status: flight.price.status || "booked"
      });
    }
  }
  if (asLived.hotel?.price) {
    entries.push({
      label: asLived.hotel.name,
      amount: asLived.hotel.price.amount,
      currency: asLived.hotel.price.currency || "CAD",
      status: asLived.hotel.price.status || "booked"
    });
  }
  for (const item of asLived.items) {
    // Flights are counted once, via the flights list above — a
    // flight plan item carrying the same booking never double-counts.
    if (item.itemType === "flight") continue;
    if (!item.bookingRef || seenRefs.has(item.bookingRef)) continue;
    seenRefs.add(item.bookingRef);
    if (item.price && item.price.status !== "UNKNOWN") {
      entries.push({
        label: item.name,
        amount: item.price.amount,
        currency: item.price.currency || "CAD",
        status: item.price.status || "booked",
        bookingRef: item.bookingRef
      });
    }
  }
  const unknownItems = asLived.items
    .filter(
      (item) =>
        item.bookingRef && (!item.price || item.price.status === "UNKNOWN")
    )
    .map((item) => item.name);
  const totalKnown = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const currency = entries[0]?.currency || "CAD";
  return {
    knownItems: entries,
    totalKnown,
    currency,
    unknownItems,
    estimatedPrice: {
      // No known prices at all => the subtotal is UNKNOWN (null),
      // never a fabricated zero.
      amount: entries.length ? totalKnown : null,
      currency,
      status: "ESTIMATED_KNOWN_SUBTOTAL",
      basis:
        "Sum of known booked prices only. Unknown prices remain unknown and are never converted to zero.",
      unknownItems,
      isCompleteTripTotal: entries.length > 0 && unknownItems.length === 0
    }
  };
}

/* ------------------------------------------------------------------ */
/* The M9 library row — index + links, NEVER an itinerary document     */
/* ------------------------------------------------------------------ */

export interface LibraryTripItemVerdict {
  itemKey: string;
  name: string;
  day: number;
  itemType: AsLivedItemType;
  outcome: AsLivedOutcome;
  travelerRating?: number;
}

export interface LibraryTripRow {
  trip_id: string;
  user_id: string;
  destination: string;
  destination_city: string | null;
  destination_country: string | null;
  destination_key: string;
  start_date: string | null;
  end_date: string | null;
  hotel_name: string | null;
  hotel_stars: number | null;
  hotel_check_in_actual: string | null;
  hotel_check_out_actual: string | null;
  flights: Array<{
    provider: string | null;
    flight: string | null;
    from: string | null;
    to: string | null;
    price: AsLivedPrice | null;
  }>;
  weather: AsLivedWeatherDay[];
  price_known_subtotal: number | null;
  price_currency: string;
  price_unknown_items: string[];
  price_is_complete: boolean;
  overall_rating: number | null;
  rating_scale: number;
  verified_checkin_count: number;
  budget_band: string | null;
  item_verdicts: LibraryTripItemVerdict[];
  provenance: Record<string, unknown>;
}

export function destinationKeyFor(
  city: string | null,
  destination: string,
  country: string | null
): string {
  const place = (city || destination || "").trim().toLowerCase();
  const nation = (country || "").trim().toLowerCase();
  return [place, nation].filter(Boolean).join(",");
}

export function buildLibraryTripRow(
  asLived: AsLivedRecord,
  evaluation: OutstandingEvaluation,
  options: { budgetAmount?: number | null } = {}
): LibraryTripRow {
  const prices = buildKnownPriceIndex(asLived);
  const budgetBand =
    budgetBandForAmount(options.budgetAmount) ??
    budgetBandForAmount(prices.estimatedPrice.amount);
  return {
    trip_id: asLived.tripId,
    user_id: asLived.userId,
    destination: asLived.destination,
    destination_city: asLived.destinationCity,
    destination_country: asLived.destinationCountry,
    destination_key: destinationKeyFor(
      asLived.destinationCity,
      asLived.destination,
      asLived.destinationCountry
    ),
    start_date: asLived.dates[0] ?? null,
    end_date: asLived.dates[asLived.dates.length - 1] ?? null,
    hotel_name: asLived.hotel?.name ?? null,
    hotel_stars: asLived.hotel?.stars ?? null,
    hotel_check_in_actual: asLived.hotel?.checkInActual ?? null,
    hotel_check_out_actual: asLived.hotel?.checkOutActual ?? null,
    flights: asLived.flights.map((flight) => ({
      provider: flight.provider,
      flight: flight.flight,
      from: flight.from,
      to: flight.to,
      price: flight.price
    })),
    weather: asLived.weather,
    price_known_subtotal: prices.estimatedPrice.amount,
    price_currency: prices.currency,
    price_unknown_items: prices.unknownItems,
    price_is_complete: prices.estimatedPrice.isCompleteTripTotal,
    overall_rating: asLived.overallTravelerRating,
    rating_scale: asLived.ratingScale || 5,
    verified_checkin_count: evaluation.verifiedCheckInCount,
    budget_band: budgetBand,
    item_verdicts: asLived.items.map((item) => {
      const verdict: LibraryTripItemVerdict = {
        itemKey: item.itemKey,
        name: item.name,
        day: item.day,
        itemType: item.itemType,
        outcome: item.outcome
      };
      if (item.travelerRating !== null && item.travelerRating !== undefined) {
        verdict.travelerRating = item.travelerRating;
      }
      return verdict;
    }),
    provenance: {
      source: "build2-post-trip-ingest",
      basis: "AS-LIVED itinerary (Dylan addition E), not the as-planned itinerary",
      evidenceStatus: asLived.evidenceStatus,
      archivedTripId: asLived.tripId,
      note: "Index + pattern links to the archived trip record; no itinerary document is stored in the library."
    }
  };
}

/* ------------------------------------------------------------------ */
/* Store seam (append/upsert + decisions), Supabase + in-memory        */
/* ------------------------------------------------------------------ */

export interface IngestDecision {
  tripId: string;
  at: string;
  eligible: boolean;
  reasons: string[];
  verifiedCheckInCount: number;
  overallTravelerRating: number | null;
}

export interface LibraryTripStore {
  upsertRow(row: LibraryTripRow): Promise<{ inserted: boolean }>;
  getByTripId(tripId: string): Promise<LibraryTripRow | null>;
  recordDecision(decision: IngestDecision): Promise<void>;
  listDecisions(tripId: string): Promise<IngestDecision[]>;
}

export function isMissingLibraryTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      /relation .* does not exist|schema cache|could not find the table/i.test(
        candidate.message
      ))
  );
}

const LIBRARY_TRIP_COLUMNS =
  "trip_id, user_id, destination, destination_city, destination_country, destination_key, start_date, end_date, hotel_name, hotel_stars, hotel_check_in_actual, hotel_check_out_actual, flights, weather, price_known_subtotal, price_currency, price_unknown_items, price_is_complete, overall_rating, rating_scale, verified_checkin_count, budget_band, item_verdicts, provenance";

export class SupabaseLibraryTripStore implements LibraryTripStore {
  private readonly supabase: SupabaseClient;
  private readonly decisions: IngestDecision[] = [];

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async upsertRow(row: LibraryTripRow): Promise<{ inserted: boolean }> {
    const { data, error } = await this.supabase
      .from(LIBRARY_TRIPS_TABLE)
      .upsert(row, { onConflict: "trip_id", ignoreDuplicates: true })
      .select("trip_id");
    if (error) throw error;
    return { inserted: Array.isArray(data) && data.length > 0 };
  }

  async getByTripId(tripId: string): Promise<LibraryTripRow | null> {
    const { data, error } = await this.supabase
      .from(LIBRARY_TRIPS_TABLE)
      .select(LIBRARY_TRIP_COLUMNS)
      .eq("trip_id", tripId)
      .maybeSingle();
    if (error) {
      if (isMissingLibraryTableError(error)) return null;
      throw error;
    }
    return (data as LibraryTripRow | null) ?? null;
  }

  /** Decisions are returned to the caller as the ingest record; the
   *  Phase 11 lifecycle history (M4) is their durable home. This
   *  store keeps them for the life of the process so a refusal is
   *  never a silent drop inside a run. */
  async recordDecision(decision: IngestDecision): Promise<void> {
    this.decisions.push(decision);
  }

  async listDecisions(tripId: string): Promise<IngestDecision[]> {
    return this.decisions.filter((decision) => decision.tripId === tripId);
  }
}

export class InMemoryLibraryTripStore implements LibraryTripStore {
  private readonly rows = new Map<string, LibraryTripRow>();
  private readonly decisions: IngestDecision[] = [];

  async upsertRow(row: LibraryTripRow): Promise<{ inserted: boolean }> {
    if (this.rows.has(row.trip_id)) return { inserted: false };
    this.rows.set(row.trip_id, row);
    return { inserted: true };
  }

  async getByTripId(tripId: string): Promise<LibraryTripRow | null> {
    return this.rows.get(tripId) ?? null;
  }

  async recordDecision(decision: IngestDecision): Promise<void> {
    this.decisions.push(decision);
  }

  async listDecisions(tripId: string): Promise<IngestDecision[]> {
    return this.decisions.filter((decision) => decision.tripId === tripId);
  }
}

/* ------------------------------------------------------------------ */
/* The ingest: gate first, write second, refusal always recorded       */
/* ------------------------------------------------------------------ */

export interface IngestResult {
  ingested: boolean;
  /** True when M9 is not applied yet — the gate ran, nothing wrote. */
  unavailable: boolean;
  evaluation: OutstandingEvaluation;
  decision: IngestDecision;
  row: LibraryTripRow | null;
  reason: string | null;
  error: string | null;
}

export async function ingestAsLivedTrip(
  store: LibraryTripStore,
  asLived: AsLivedRecord,
  options: Partial<OutstandingThresholds> & {
    unresolvedCollisions?: number;
    now: string;
    budgetAmount?: number | null;
  }
): Promise<IngestResult> {
  const evaluation = evaluateOutstanding(asLived, options);
  const decision: IngestDecision = {
    tripId: asLived.tripId,
    at: options.now,
    eligible: evaluation.eligible,
    reasons: evaluation.reasons,
    verifiedCheckInCount: evaluation.verifiedCheckInCount,
    overallTravelerRating: asLived.overallTravelerRating
  };
  await store.recordDecision(decision);
  if (!evaluation.eligible) {
    return {
      ingested: false,
      unavailable: false,
      evaluation,
      decision,
      row: null,
      reason: evaluation.reasons.join("; "),
      error: null
    };
  }
  const row = buildLibraryTripRow(asLived, evaluation, {
    budgetAmount: options.budgetAmount
  });
  try {
    await store.upsertRow(row);
  } catch (error) {
    return {
      ingested: false,
      unavailable: isMissingLibraryTableError(error),
      evaluation,
      decision,
      row: null,
      reason: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    ingested: true,
    unavailable: false,
    evaluation,
    decision,
    row,
    reason: null,
    error: null
  };
}

/* ------------------------------------------------------------------ */
/* Review email composition (shadow buildPostTripEmail, ported)       */
/* ------------------------------------------------------------------ */

export interface PostTripReviewPrompt {
  itemKey: string;
  name: string;
  prompt: string;
  ratingPrompt: string;
  knownLiked: string | null;
  dwellMin: number | null;
}

export interface PostTripReviewEmail {
  subject: string;
  toLabel: string;
  body: string;
  reviewPrompts: PostTripReviewPrompt[];
  liked: Array<{ name: string; liked: string; travelerRating: number | null }>;
  generatedFrom: string;
}

export function buildPostTripReviewEmail(
  asLived: AsLivedRecord,
  options: { travelerName?: string } = {}
): PostTripReviewEmail {
  const travelerName = options.travelerName || "there";
  // A rest block is not a place to review — no prompt is generated for it.
  const reviewable = asLived.items.filter(
    (item) => !/rest and change/i.test(item.name)
  );
  const prompts: PostTripReviewPrompt[] = reviewable.map((item) => {
    if (item.outcome === "kept") {
      return {
        itemKey: item.itemKey,
        name: item.name,
        prompt: /^flight/i.test(item.name)
          ? `How was ${item.name}?`
          : `What did you like about ${item.name}?`,
        ratingPrompt: "Rate it from 1 to 5.",
        knownLiked: item.liked,
        dwellMin: item.actual?.dwellMin ?? null
      };
    }
    if (item.signal?.classification === "SKIP") {
      return {
        itemKey: item.itemKey,
        name: item.name,
        prompt: `You skipped ${item.name}. Was that about taste, timing, or something else?`,
        ratingPrompt: "No rating needed for a skipped place.",
        knownLiked: null,
        dwellMin: null
      };
    }
    if (item.signal?.classification === "MISSED") {
      return {
        itemKey: item.itemKey,
        name: item.name,
        prompt: `${item.name} was missed because of circumstances. Should Roamly try to fit it in next time?`,
        ratingPrompt: "No rating needed for a missed place.",
        knownLiked: null,
        dwellMin: null
      };
    }
    return {
      itemKey: item.itemKey,
      name: item.name,
      prompt: `How was ${item.name}?`,
      ratingPrompt: "Rate it from 1 to 5.",
      knownLiked: item.liked,
      dwellMin: item.actual?.dwellMin ?? null
    };
  });
  const liked = asLived.items
    .filter((item) => item.liked)
    .map((item) => ({
      name: item.name,
      liked: item.liked as string,
      travelerRating: item.travelerRating
    }));
  const body = [
    `Hi ${travelerName},`,
    "",
    `Welcome home. Before your ${asLived.destination} trip becomes just photos, tell us what it was really like.`,
    "",
    ...liked.map((entry) => `You told us ${entry.name}: "${entry.liked}"`),
    "",
    "A few quick questions are below. Your answers teach Roamly what to keep, what to skip, and what to fit in next time.",
    "",
    ...prompts.map((prompt, index) => `${index + 1}. ${prompt.prompt} ${prompt.ratingPrompt}`),
    "",
    "Thank you for travelling with Roamly."
  ].join("\n");
  return {
    subject: `How was ${asLived.destination}? Tell us what you loved`,
    toLabel: travelerName,
    body,
    reviewPrompts: prompts,
    liked,
    generatedFrom: "as-lived itinerary record, not the as-planned itinerary"
  };
}

/* ------------------------------------------------------------------ */
/* Recipient rule: the connected Gmail, and only the connected Gmail   */
/* ------------------------------------------------------------------ */

export async function resolveConnectedGmailAddress(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("email_connections")
      .select("email_address")
      .eq("user_id", userId)
      .eq("provider", GMAIL_PROVIDER_NAME)
      .eq("connection_status", "connected")
      .not("email_address", "is", null)
      .limit(1);
    if (error) return null;
    const row = (data || [])[0] as { email_address?: string | null } | undefined;
    const address = (row?.email_address || "").trim();
    return address ? address : null;
  } catch {
    return null;
  }
}

export async function composePostTripReviewAsk(
  admin: SupabaseClient,
  asLived: AsLivedRecord,
  options: { travelerName?: string } = {}
): Promise<
  | { ok: true; to: string; email: PostTripReviewEmail }
  | { ok: false; reason: "NO_CONNECTED_GMAIL" }
> {
  const to = await resolveConnectedGmailAddress(admin, asLived.userId);
  if (!to) return { ok: false, reason: "NO_CONNECTED_GMAIL" };
  return { ok: true, to, email: buildPostTripReviewEmail(asLived, options) };
}

/* ------------------------------------------------------------------ */
/* As-lived reconstruction: final plan + M2 ledger + states + bookings */
/* ------------------------------------------------------------------ */

export interface LivedPlanItem {
  itemKey: string;
  name: string;
  day: number;
  itemType: AsLivedItemType;
  plannedStart: string | null;
  plannedEnd: string | null;
  /** live_timeline state: completed / checked_in / skipped / missed / ... */
  state: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  bookingRef: string | null;
}

export interface LivedBookingFact {
  kind: "flight" | "hotel" | "activity" | "other";
  reference: string | null;
  itemKey: string | null;
  title: string;
  provider: string | null;
  flightNumber: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  departureLabel: string | null;
  arrivalLabel: string | null;
  stars: number | null;
  amount: number | null;
  currency: string | null;
  priceStatus: string | null;
  checkInActual: string | null;
  checkOutActual: string | null;
}

export interface AsLivedFeedbackFacts {
  overallRating: number | null;
  itemRatings: Record<string, number>;
  likedByItem: Record<string, string>;
  wouldUseRoamlyAgain: boolean | null;
}

export interface ReconstructionInput {
  trip: {
    id: string;
    userId: string;
    destination: string;
    destinationCity: string | null;
    destinationCountry: string | null;
    startDate: string | null;
    endDate: string | null;
    timezone: string;
  };
  planItems: LivedPlanItem[];
  ledgerEntries: CompanionLedgerEntryDTO[];
  bookings: LivedBookingFact[];
  weather: AsLivedWeatherDay[];
  feedback: AsLivedFeedbackFacts | null;
  evidenceStatus?: string | null;
}

function dateRange(startDate: string | null, endDate: string | null): string[] {
  if (!startDate || !endDate) return [];
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const dates: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function bookingPrice(fact: LivedBookingFact): AsLivedPrice | null {
  if (fact.amount === null || !Number.isFinite(fact.amount)) return null;
  return {
    amount: fact.amount,
    currency: (fact.currency || "CAD").toUpperCase(),
    status: fact.priceStatus || "booked"
  };
}

export function reconstructAsLivedRecord(input: ReconstructionInput): AsLivedRecord {
  const annulled = annulledEntryIds(input.ledgerEntries);
  const effective = input.ledgerEntries.filter(
    (entry) => !entry.undoOfEntryId && !annulled.has(entry.entryId)
  );
  const checkInByRef = new Map<string, CompanionLedgerEntryDTO>();
  const skipRefs = new Set<string>();
  const missedRefs = new Set<string>();
  for (const entry of effective) {
    if (entry.classification === "CHECKED_IN") {
      const current = checkInByRef.get(entry.activityRef);
      if (!current || entry.atMinuteOfTrip >= current.atMinuteOfTrip) {
        checkInByRef.set(entry.activityRef, entry);
      }
    } else if (entry.classification === "SKIPPED") {
      skipRefs.add(entry.activityRef);
    } else if (entry.classification === "MISSED") {
      missedRefs.add(entry.activityRef);
    }
  }

  const priceByItemKey = new Map<string, AsLivedPrice>();
  const priceByRef = new Map<string, AsLivedPrice>();
  for (const fact of input.bookings) {
    const price = bookingPrice(fact);
    if (!price) continue;
    if (fact.itemKey) priceByItemKey.set(fact.itemKey, price);
    if (fact.reference) priceByRef.set(fact.reference, price);
  }

  const items: AsLivedItem[] = input.planItems.map((planItem) => {
    const checkIn = checkInByRef.get(planItem.itemKey) ?? null;
    const state = (planItem.state || "").trim().toLowerCase();
    let outcome: AsLivedOutcome = "unknown";
    let signal: AsLivedItem["signal"] = null;
    let evidence: AsLivedItem["evidence"] = null;
    if (skipRefs.has(planItem.itemKey) || state === "skipped") {
      outcome = "skipped";
      signal = { classification: "SKIP", rehomeCandidate: false };
      evidence = skipRefs.has(planItem.itemKey)
        ? { type: "traveler-action", verified: true }
        : null;
    } else if (missedRefs.has(planItem.itemKey) || state === "missed") {
      outcome = "changed";
      signal = { classification: "MISSED", rehomeCandidate: true };
      evidence = missedRefs.has(planItem.itemKey)
        ? { type: "circumstance-record", verified: true }
        : null;
    } else if (
      checkIn ||
      state === "completed" ||
      state === "checked_in" ||
      state === "done" ||
      state === "finished"
    ) {
      outcome = "kept";
    }
    if (checkIn) evidence = { type: "check-in", verified: true };

    let actual: AsLivedItem["actual"] = null;
    if (checkIn) {
      actual = {
        checkedIn: instantStringToLocal(checkIn.at, input.trip.timezone).clock,
        dwellMin: checkIn.dwellMinutes
      };
      if (planItem.actualStart) actual.start = planItem.actualStart;
      if (planItem.actualEnd) {
        actual.end = planItem.actualEnd;
        actual.left = planItem.actualEnd;
      }
    } else if (planItem.actualStart || planItem.actualEnd) {
      actual = {};
      if (planItem.actualStart) actual.start = planItem.actualStart;
      if (planItem.actualEnd) actual.end = planItem.actualEnd;
    }

    return {
      itemKey: planItem.itemKey,
      name: planItem.name,
      day: planItem.day,
      itemType: planItem.itemType,
      outcome,
      planned:
        planItem.plannedStart && planItem.plannedEnd
          ? { start: planItem.plannedStart, end: planItem.plannedEnd }
          : null,
      actual,
      evidence,
      signal,
      travelerRating: input.feedback?.itemRatings[planItem.itemKey] ?? null,
      liked: input.feedback?.likedByItem[planItem.itemKey] ?? null,
      bookingRef: planItem.bookingRef,
      price:
        priceByItemKey.get(planItem.itemKey) ??
        (planItem.bookingRef ? priceByRef.get(planItem.bookingRef) : undefined) ??
        null
    };
  });

  const flights: AsLivedFlight[] = input.bookings
    .filter((fact) => fact.kind === "flight")
    .map((fact) => ({
      provider: fact.provider,
      flight: fact.flightNumber,
      from: fact.fromLabel,
      to: fact.toLabel,
      departure: fact.departureLabel,
      arrival: fact.arrivalLabel,
      price: bookingPrice(fact)
    }));
  const hotelFact = input.bookings.find((fact) => fact.kind === "hotel") ?? null;
  const hotel: AsLivedHotel | null = hotelFact
    ? {
        name: hotelFact.title,
        stars: hotelFact.stars,
        price: bookingPrice(hotelFact),
        checkInActual: hotelFact.checkInActual,
        checkOutActual: hotelFact.checkOutActual
      }
    : null;

  return {
    tripId: input.trip.id,
    userId: input.trip.userId,
    destination: input.trip.destination,
    destinationCity: input.trip.destinationCity,
    destinationCountry: input.trip.destinationCountry,
    dates: dateRange(input.trip.startDate, input.trip.endDate),
    timezone: input.trip.timezone,
    hotel,
    flights,
    weather: input.weather,
    items,
    overallTravelerRating: input.feedback?.overallRating ?? null,
    ratingScale: 5,
    evidenceStatus: input.evidenceStatus ?? null
  };
}

/* ------------------------------------------------------------------ */
/* Budget-vs-real AFTER leg: the post-trip reckoning                   */
/* ------------------------------------------------------------------ */

export interface PostTripReckoning {
  report: CheckpointReport;
  calibrationWrites: Array<LibraryRecord & { key: string }>;
  biasProposals: BiasProposal[];
  observations: BiasObservation[];
}

export function runPostTripReckoning(params: {
  itinerary: BvrItinerary;
  bookingFacts?: PaidFact[];
  actuals?: PaidFact[];
  library: LibraryStore;
  now: string;
  priorObservations?: BiasObservation[];
}): PostTripReckoning {
  const report = runCheckpoint(params.itinerary, "AFTER", {
    now: params.now,
    bookingFacts: params.bookingFacts || [],
    actuals: params.actuals || [],
    library: params.library
  });
  const calibrationWrites = calibrate(report.items, params.library, {
    now: params.now
  });
  const observations = [
    ...(params.priorObservations || []),
    ...report.observations
  ];
  return {
    report,
    calibrationWrites,
    biasProposals: proposeBias(observations),
    observations
  };
}

/* ------------------------------------------------------------------ */
/* Pattern bridge: library trips -> aggregation records (fail-soft)    */
/* ------------------------------------------------------------------ */

interface TripContextFields {
  travelers_count: number | null;
  travel_style: string | null;
  accommodation_preference: string | null;
  transportation_preference: string | null;
  budget_amount: number | null;
}

function averageOf(values: Array<number | null | undefined>): number | null {
  const usable = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function durationDaysBetween(
  start: string | null,
  end: string | null
): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const days = Math.round((endMs - startMs) / 86_400_000);
  return days >= 0 && days <= 90 ? days + 1 : null;
}

export function libraryTripRowToContextRecord(
  row: LibraryTripRow,
  trip: TripContextFields | null,
  feedback: { wouldUseRoamlyAgain: boolean | null } | null
): SuccessfulTripExperienceContextRecord | null {
  const overallSatisfaction =
    row.overall_rating !== null && Number.isFinite(row.overall_rating)
      ? Math.round(row.overall_rating)
      : null;
  // Successful-trip gate, mirroring the frontdoor lane: only trips the
  // traveler rates highly feed the *successful-trip* patterns.
  if (overallSatisfaction === null || overallSatisfaction < MIN_AVERAGE_RATING_FOR_SUCCESS) {
    return null;
  }
  const verdicts = Array.isArray(row.item_verdicts) ? row.item_verdicts : [];
  const hotelRatings = verdicts
    .filter((verdict) => verdict.itemType === "hotel")
    .map((verdict) => verdict.travelerRating ?? null);
  const flightRatings = verdicts
    .filter((verdict) => verdict.itemType === "flight")
    .map((verdict) => verdict.travelerRating ?? null);
  const hotelAverage = averageOf(hotelRatings);
  const flightAverage = averageOf(flightRatings);
  const context: SuccessfulTripExperienceContext = {
    schemaVersion: 1,
    destinationKey: row.destination_key || null,
    durationDays: durationDaysBetween(row.start_date, row.end_date),
    travelersCount:
      typeof trip?.travelers_count === "number" && trip.travelers_count > 0
        ? Math.floor(trip.travelers_count)
        : null,
    travelStyle: trip?.travel_style ?? null,
    accommodationPreference: trip?.accommodation_preference ?? null,
    transportationPreference: trip?.transportation_preference ?? null,
    dayCount: durationDaysBetween(row.start_date, row.end_date) ?? 0,
    plannedItemCount: verdicts.length,
    flexibleItemCount: 0,
    estimatedBudgetCategoryCount: 0,
    feedbackSignals: {
      overallSatisfaction,
      itineraryPace: null,
      scheduleRealism: null,
      budgetAccuracy: null,
      hotelLocationSatisfaction:
        hotelAverage !== null ? Math.round(hotelAverage) : null,
      hotelQualitySatisfaction:
        hotelAverage !== null ? Math.round(hotelAverage) : null,
      transportationSatisfaction:
        flightAverage !== null ? Math.round(flightAverage) : null,
      // The traveler's own answer when it exists; unknown stays null
      // and the aggregation's qualifier fails closed on it.
      wouldUseRoamlyAgain: feedback?.wouldUseRoamlyAgain ?? null
    }
  };
  return {
    experienceContext: context,
    weight: LIBRARY_TRIP_RECORD_WEIGHT,
    budgetBand: row.budget_band ?? budgetBandForAmount(trip?.budget_amount)
  };
}

/**
 * Read ingested library trips as weighted experience records.
 * Returns [] when M9 is not applied yet or on any read error —
 * the aggregation's fail-soft posture, exactly like the frontdoor
 * and ingester lanes.
 */
export async function readLibraryTripExperienceRecords(
  admin: SupabaseClient
): Promise<SuccessfulTripExperienceContextRecord[]> {
  try {
    const { data, error } = await admin
      .from(LIBRARY_TRIPS_TABLE)
      .select(LIBRARY_TRIP_COLUMNS)
      .order("ingested_at", { ascending: true })
      .limit(2000);
    if (error) return [];
    const rows = (data || []) as unknown as LibraryTripRow[];
    if (!rows.length) return [];
    const tripIds = [...new Set(rows.map((row) => row.trip_id).filter(Boolean))];
    const [tripsResult, feedbackResult] = await Promise.all([
      tripIds.length
        ? admin
            .from("roamly_trips")
            .select(
              "id,travelers_count,travel_style,accommodation_preference,transportation_preference,budget_amount"
            )
            .in("id", tripIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      tripIds.length
        ? admin
            .from("trip_feedback")
            .select("trip_id,created_at,would_use_roamly_again")
            .eq("feedback_type", "post_trip")
            .in("trip_id", tripIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null })
    ]);
    if (tripsResult.error || feedbackResult.error) return [];
    const tripsById = new Map<string, TripContextFields>();
    for (const trip of (tripsResult.data || []) as Array<Record<string, unknown>>) {
      tripsById.set(String(trip.id), {
        travelers_count:
          typeof trip.travelers_count === "number" ? trip.travelers_count : null,
        travel_style:
          typeof trip.travel_style === "string" ? trip.travel_style : null,
        accommodation_preference:
          typeof trip.accommodation_preference === "string"
            ? trip.accommodation_preference
            : null,
        transportation_preference:
          typeof trip.transportation_preference === "string"
            ? trip.transportation_preference
            : null,
        budget_amount:
          typeof trip.budget_amount === "number" ? trip.budget_amount : null
      });
    }
    const wouldUseByTrip = new Map<string, boolean | null>();
    for (const row of (feedbackResult.data || []) as Array<Record<string, unknown>>) {
      // Rows arrive oldest-first; the latest answer wins.
      wouldUseByTrip.set(
        String(row.trip_id),
        typeof row.would_use_roamly_again === "boolean"
          ? row.would_use_roamly_again
          : null
      );
    }
    const records: SuccessfulTripExperienceContextRecord[] = [];
    for (const row of rows) {
      const record = libraryTripRowToContextRecord(
        row,
        tripsById.get(row.trip_id) ?? null,
        { wouldUseRoamlyAgain: wouldUseByTrip.get(row.trip_id) ?? null }
      );
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* The feedback seam: assemble + ingest for one completed trip         */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
}

/** "HH:MM" from an ISO datetime, an "HH:MM" string, or minutes after
 *  local midnight (the live_timeline shapes all appear in the wild). */
function clockOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const minutes = Math.max(0, Math.floor(value));
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const iso = /T(\d{2}:\d{2})/.exec(trimmed);
    if (iso) return iso[1];
    if (/^\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 5);
    if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 5);
  }
  return null;
}

function planItemsFromFullJson(fullJson: unknown): LivedPlanItem[] {
  const full = asRecord(fullJson);
  const days = Array.isArray(full.daily_itinerary) ? full.daily_itinerary : [];
  const items: LivedPlanItem[] = [];
  days.forEach((rawDay, dayIndex) => {
    const day = asRecord(rawDay);
    const rawItems = [day.live_timeline, day.timeline, day.activities].find(
      Array.isArray
    ) as unknown[] | undefined;
    const dayNumber =
      asNumber(day.day_number) ?? asNumber(day.dayNumber) ?? dayIndex + 1;
    for (const rawItem of rawItems || []) {
      const item = asRecord(rawItem);
      const name = asString(item.name) || asString(item.title) || "";
      const itemKey =
        asString(item.item_id) ||
        asString(item.key) ||
        asString(item.id) ||
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!itemKey || !name) continue;
      const rawType = (
        asString(item.item_type) ||
        asString(item.type) ||
        asString(item.kind) ||
        ""
      ).toLowerCase();
      const itemType: AsLivedItemType =
        rawType === "flight"
          ? "flight"
          : rawType === "hotel"
            ? "hotel"
            : "activity";
      items.push({
        itemKey,
        name,
        day: Math.floor(dayNumber),
        itemType,
        plannedStart: clockOf(item.startTime ?? item.start_time ?? item.start),
        plannedEnd: clockOf(item.endTime ?? item.end_time ?? item.end),
        state: asString(item.state) || asString(item.status),
        actualStart: clockOf(
          item.actualStartTime ?? item.actual_start_time ?? item.actualStart
        ),
        actualEnd: clockOf(
          item.actualEndTime ?? item.actual_end_time ?? item.actualEnd
        ),
        bookingRef:
          asString(item.booking_ref) ||
          asString(asRecord(item.booking).booking_id) ||
          asString(item.bookingRef)
      });
    }
  });
  return items;
}

function bookingFactsFromRows(rows: Array<Record<string, unknown>>): LivedBookingFact[] {
  return rows.map((row) => {
    const metadata = asRecord(row.metadata);
    const rawType = (asString(row.booking_type) || "other").toLowerCase();
    const kind: LivedBookingFact["kind"] =
      rawType === "flight"
        ? "flight"
        : rawType === "hotel"
          ? "hotel"
          : rawType === "other"
            ? "other"
            : "activity";
    const amountCents = asNumber(row.amount_cents);
    return {
      kind,
      reference: asString(row.confirmation_number),
      itemKey:
        asString(metadata.item_key) || asString(metadata.itemKey),
      title: asString(row.title) || asString(row.provider_name) || "Booking",
      provider: asString(row.provider_name),
      flightNumber:
        asString(metadata.flight_number) || asString(metadata.flightNumber),
      fromLabel: asString(metadata.from) || asString(row.city),
      toLabel: asString(metadata.to),
      departureLabel:
        asString(metadata.departure) ||
        [asString(row.start_date), clockOf(row.start_time)]
          .filter(Boolean)
          .join(" ") ||
        null,
      arrivalLabel:
        asString(metadata.arrival) ||
        [asString(row.end_date), clockOf(row.end_time)]
          .filter(Boolean)
          .join(" ") ||
        null,
      stars: asNumber(metadata.stars),
      amount: amountCents !== null ? amountCents / 100 : null,
      currency: (asString(row.currency) || "CAD").toUpperCase(),
      priceStatus: asString(row.booking_status),
      checkInActual: asString(metadata.check_in_actual),
      checkOutActual: asString(metadata.check_out_actual)
    };
  });
}

export interface PostTripSeamPorts {
  ledgerStore?: CompanionLedgerStore;
  libraryStore?: LibraryTripStore;
  /** Weather belongs to the Phase 3 pack layer (snapshots are keyed
   *  by destination registry ID); the caller injects the historical
   *  snapshot read. Default: no weather rows — stated, never faked. */
  loadWeather?: () => Promise<AsLivedWeatherDay[]>;
}

export type PostTripSeamResult =
  | (IngestResult & { status: "evaluated" })
  | {
      status: "trip-not-found" | "assembly-failed";
      ingested: false;
      error: string;
    };

/**
 * Assemble the as-lived record for one completed trip from production
 * stores and run the ingest gate. Called by the tripFeedback seam
 * behind ROAMLY_BUILD2_POSTTRIP_ENABLED. Never throws: a failure is a
 * returned status, and the feedback save that triggered it has
 * already succeeded on its own.
 */
export async function maybeIngestCompletedTrip(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  overallRating: number | null;
  wouldUseRoamlyAgain: boolean | null;
  now?: string;
  ports?: PostTripSeamPorts;
}): Promise<PostTripSeamResult> {
  try {
    const admin = params.supabase;
    const tripResult = await admin
      .from("roamly_trips")
      .select(
        "id,destination,destination_city,destination_country,start_date,end_date,timezone,metadata,budget_amount"
      )
      .eq("id", params.tripId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (tripResult.error || !tripResult.data) {
      return {
        status: "trip-not-found",
        ingested: false,
        error: tripResult.error?.message || "TRIP_NOT_FOUND"
      };
    }
    const trip = tripResult.data as Record<string, unknown>;
    const metadata = asRecord(trip.metadata);
    const timezone =
      asString(trip.timezone) || asString(metadata.timezone) || "UTC";

    const [itineraryResult, bookingsResult] = await Promise.all([
      admin
        .from("roamly_itineraries")
        .select("full_json")
        .eq("trip_id", params.tripId)
        .maybeSingle(),
      admin
        .from("roamly_bookings")
        .select(
          "booking_type,provider_name,title,confirmation_number,booking_status,amount_cents,currency,start_date,end_date,start_time,end_time,city,metadata"
        )
        .eq("trip_id", params.tripId)
        .eq("user_id", params.userId)
    ]);
    const ledgerStore =
      params.ports?.ledgerStore || new SupabaseCompanionLedgerStore(admin);
    const ledgerEntries = await ledgerStore
      .listForTrip(params.tripId)
      .catch(() => [] as CompanionLedgerEntryDTO[]);
    const weather = params.ports?.loadWeather
      ? await params.ports.loadWeather().catch(() => [] as AsLivedWeatherDay[])
      : [];

    const asLived = reconstructAsLivedRecord({
      trip: {
        id: params.tripId,
        userId: params.userId,
        destination:
          asString(trip.destination_city) || asString(trip.destination) || "Trip",
        destinationCity: asString(trip.destination_city),
        destinationCountry: asString(trip.destination_country),
        startDate: asString(trip.start_date),
        endDate: asString(trip.end_date),
        timezone
      },
      planItems: planItemsFromFullJson(
        (itineraryResult.data as Record<string, unknown> | null)?.full_json
      ),
      ledgerEntries,
      bookings: bookingFactsFromRows(
        (bookingsResult.data || []) as Array<Record<string, unknown>>
      ),
      weather,
      feedback: {
        overallRating: params.overallRating,
        itemRatings: {},
        likedByItem: {},
        wouldUseRoamlyAgain: params.wouldUseRoamlyAgain
      }
    });
    const result = await ingestAsLivedTrip(
      params.ports?.libraryStore || new SupabaseLibraryTripStore(admin),
      asLived,
      {
        now: params.now || new Date().toISOString(),
        budgetAmount: asNumber(trip.budget_amount)
      }
    );
    return { ...result, status: "evaluated" };
  } catch (error) {
    return {
      status: "assembly-failed",
      ingested: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
