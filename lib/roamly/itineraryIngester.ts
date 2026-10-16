import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuccessfulTripExperienceContext } from "@/lib/roamly/successfulTripExperience";
import {
  budgetBandForAmount,
  type SuccessfulTripExperienceContextRecord
} from "@/lib/roamly/successfulTripExperiencePatterns";

/**
 * Roamly Itinerary Ingester — the intake bot for made itineraries.
 *
 * Junel's design (2026-10-16): an ingester that sorts made itineraries into
 * the library the way RI's Sorter sorts reviews — normalize, tag, dedupe,
 * stamp provenance/consent/booking-proof — BEFORE anything can teach the
 * library. Three intakes feed one normalize path:
 *   (a) "generated"      — plans Roamly's own generator makes (at-birth hook)
 *   (b) "shared"         — /trips/share submissions (traveler's own trip)
 *   (c) "owner_submitted"— completed itineraries Junel/the owner submit by hand
 *
 * Deterministic, zero LLM. Fail-soft everywhere: the ingester NEVER throws
 * into the generator or the share flow. When the library storage is absent
 * (front-door migration not yet applied by the owner) it reports
 * `library_storage_unavailable` and the caller continues as if the ingester
 * were not there.
 *
 * Standing rules encoded:
 * - Consent: library-learning is allowed ONLY when consent was actually
 *   collected. The intake default is consent=false → the record is stored
 *   private-only and is NEVER pattern-eligible.
 * - Booking proof: bookingProven is true ONLY on the share flow's
 *   Gmail-segment proof. It is never inferred from anything else.
 * - Prices: snapshots are carried through BYTE-IDENTICAL. The ingester
 *   derives a budget band LABEL from amounts; it never rewrites an amount
 *   or its provenance (CONFIRMED/LIVE_SEARCH/ESTIMATED/UNKNOWN).
 * - No entitlement writes: the one-free-itinerary-per-account rule is not
 *   touched here (no user/account/billing writes exist in this module).
 * - No feedback loop: generated plans are never pattern-eligible. A plan
 *   Roamly suggested is not evidence that it worked — patterns must come
 *   from booking-proven, consenting, traveler-rated trips.
 */

export type ItineraryIntakeSource = "generated" | "shared" | "owner_submitted";

/** Named rejection / routing reasons. Stable strings — callers may branch on them. */
export const INGESTER_REASONS = {
  incompleteItinerary: "incomplete_itinerary",
  missingDestination: "missing_destination",
  noConsentPrivateOnly: "no_consent_private_only",
  duplicateOfExisting: "duplicate_of_existing",
  libraryStorageUnavailable: "library_storage_unavailable",
  storageError: "storage_error"
} as const;

export type IngesterReason = (typeof INGESTER_REASONS)[keyof typeof INGESTER_REASONS];

/** A named day item. Labels are the dedupe identity — keep them verbatim. */
export type IngesterDayItem = {
  dayNumber: number;
  label: string;
  itemType: string | null;
  location: string | null;
};

/**
 * A price snapshot. Carried through byte-identical — the ingester reads
 * amounts for the band label and never alters amount/currency/provenance.
 */
export type IngesterPriceSnapshot = {
  amount: number;
  currency: string | null;
  provenance: string;
  label: string | null;
};

export type IngesterItemVerdict = {
  itemType: string | null;
  rating: number | null;
  itemLabel: string | null;
};

/**
 * Neutral raw input — every adapter produces this shape. Adapters set
 * bookingProven; nothing downstream may infer or upgrade it.
 */
export type RawItineraryInput = {
  title: string | null;
  destination: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  travelersCount: number | null;
  travelStyle: string | null;
  accommodationPreference: string | null;
  transportationPreference: string | null;
  pace: string | null;
  highlights: string | null;
  dayItems: IngesterDayItem[];
  priceSnapshots: IngesterPriceSnapshot[];
  itemVerdicts: IngesterItemVerdict[];
  tripId: string | null;
  userId: string | null;
  /** null = consent was never collected → treated as false. */
  consentAnonymizedReuse: boolean | null;
  /** Set ONLY by adapters. Never inferred downstream. */
  bookingProven: boolean;
};

export type NormalizedItinerary = {
  destinationKey: string;
  destination: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  budgetBand: string | null;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  travelersCount: number | null;
  travelStyle: string | null;
  accommodationPreference: string | null;
  transportationPreference: string | null;
  pace: string | null;
  styleTags: string[];
  seasonQuarter: string | null;
  travelMonth: string | null;
  partyType: string | null;
  dayItems: IngesterDayItem[];
  priceSnapshots: IngesterPriceSnapshot[];
  highlights: string | null;
  consentAnonymizedReuse: boolean;
  bookingProven: boolean;
  /**
   * Intake path this record came from. Carried through normalize so the
   * eligibility gate can enforce it structurally (audit 1A). null when
   * normalize was called without a source (test/pure paths) — the gate
   * treats null as ineligible (fail closed).
   */
  source: ItineraryIntakeSource | null;
  avgItemRating: number | null;
  itemCount: number;
};

export type IngestOutcome =
  | {
      ok: true;
      action: "stored";
      storedId: string;
      normalized: NormalizedItinerary;
      patternEligible: boolean;
    }
  | {
      ok: true;
      action: "duplicate";
      duplicateOf: string;
      normalized: NormalizedItinerary;
      patternEligible: false;
    }
  | {
      ok: true;
      action: "private_only";
      storedId: string | null;
      normalized: NormalizedItinerary;
      patternEligible: false;
      reason: typeof INGESTER_REASONS.noConsentPrivateOnly;
    }
  | {
      ok: false;
      action: "not_stored";
      normalized: NormalizedItinerary | null;
      reason: IngesterReason;
    };

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function cleanText(value: unknown, limit = 200): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, limit) : null;
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function durationDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startDate = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const endDate = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return null;
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  return days >= 0 && days <= 120 ? days + 1 : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

/** Normalized item identity for dedupe: lowercase, punctuation-stripped, collapsed. */
function itemIdentityKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingTableError(message: string): boolean {
  return /schema cache|could not find the table|relation .* does not exist|42P01/i.test(message || "");
}

// ---------------------------------------------------------------------------
// Tagging — conservative, keyword-only. Unknown input tags nothing.
// ---------------------------------------------------------------------------

const STYLE_KEYWORDS: Array<{ tag: string; keywords: string[] }> = [
  { tag: "relaxed", keywords: ["relax", "slow", "leisure", "unwind"] },
  { tag: "packed", keywords: ["packed", "fast-paced", "whirlwind", "intense"] },
  { tag: "family", keywords: ["family", "kids", "children"] },
  { tag: "couples", keywords: ["couple", "honeymoon", "romantic"] },
  { tag: "solo", keywords: ["solo"] },
  { tag: "adventure", keywords: ["adventure", "hiking", "trek", "climb", "rafting"] },
  { tag: "food", keywords: ["food", "culinary", "restaurant", "dining", "cuisine"] },
  { tag: "beach", keywords: ["beach", "island", "coast", "surf"] },
  { tag: "city", keywords: ["city", "urban", "downtown"] },
  { tag: "culture", keywords: ["culture", "museum", "history", "heritage", "temple", "church"] },
  { tag: "nature", keywords: ["nature", "national park", "wildlife", "waterfall", "mountain"] },
  { tag: "luxury", keywords: ["luxury", "five-star", "5-star", "premium"] },
  { tag: "budget", keywords: ["budget", "backpack", "hostel"] },
  { tag: "roadtrip", keywords: ["road trip", "drive", "roadtrip"] },
  { tag: "ski", keywords: ["ski", "snowboard"] },
  { tag: "wellness", keywords: ["wellness", "spa", "retreat", "yoga"] }
];

export function deriveStyleTags(input: {
  travelStyle?: string | null;
  pace?: string | null;
  accommodationPreference?: string | null;
  highlights?: string | null;
}): string[] {
  const haystack = [input.travelStyle, input.pace, input.accommodationPreference, input.highlights]
    .filter((value): value is string => typeof value === "string")
    .join(" | ")
    .toLowerCase();
  if (!haystack.trim()) return [];
  const tags = new Set<string>();
  for (const { tag, keywords } of STYLE_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) tags.add(tag);
  }
  return [...tags].sort();
}

export function deriveSeasonQuarter(startDate: string | null): { quarter: string | null; travelMonth: string | null } {
  if (!startDate || !/^\d{4}-\d{2}/.test(startDate)) return { quarter: null, travelMonth: null };
  const year = startDate.slice(0, 4);
  const month = Number(startDate.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return { quarter: null, travelMonth: null };
  const quarter = `Q${Math.floor((month - 1) / 3) + 1}`;
  return { quarter, travelMonth: `${year}-${String(month).padStart(2, "0")}` };
}

export function derivePartyType(travelersCount: number | null): string | null {
  if (travelersCount == null) return null;
  if (travelersCount <= 1) return "solo";
  if (travelersCount === 2) return "couple";
  return "group";
}

// ---------------------------------------------------------------------------
// Intake adapters — each produces the neutral RawItineraryInput.
// ---------------------------------------------------------------------------

/** Snapshot of a freshly generated itinerary (Dylan's at-birth hook input). */
export type GeneratedItinerarySnapshot = {
  tripId: string;
  userId: string;
  title?: string | null;
  destination?: string | null;
  destinationCity?: string | null;
  destinationCountry?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetAmount?: number | null;
  budgetCurrency?: string | null;
  travelersCount?: number | null;
  travelStyle?: string | null;
  accommodationPreference?: string | null;
  transportationPreference?: string | null;
  pace?: string | null;
  outlineDays: Array<{
    dayNumber: number;
    theme?: string | null;
    geographicArea?: string | null;
    priorityActivities?: string[];
  }>;
  priceSnapshots?: IngesterPriceSnapshot[];
  /** Consent was not collected for generated plans — defaults to false. */
  consentAnonymizedReuse?: boolean | null;
};

/**
 * Adapter (a): generated itineraries at birth. bookingProven is ALWAYS false
 * here — a plan Roamly suggested is not evidence that it worked.
 */
export function adaptGeneratedItinerary(snapshot: GeneratedItinerarySnapshot): RawItineraryInput {
  const dayItems: IngesterDayItem[] = [];
  for (const day of snapshot.outlineDays || []) {
    const dayNumber = positiveInteger(day.dayNumber) || dayItems.length + 1;
    const names: string[] = [];
    const theme = cleanText(day.theme, 120);
    if (theme) names.push(theme);
    for (const activity of day.priorityActivities || []) {
      const label = cleanText(activity, 160);
      if (label) names.push(label);
    }
    const area = cleanText(day.geographicArea, 120);
    for (const label of names) {
      dayItems.push({ dayNumber, label, itemType: null, location: area });
    }
  }
  return {
    title: cleanText(snapshot.title),
    destination: cleanText(snapshot.destination),
    destinationCity: cleanText(snapshot.destinationCity),
    destinationCountry: cleanText(snapshot.destinationCountry),
    startDate: cleanText(snapshot.startDate, 10),
    endDate: cleanText(snapshot.endDate, 10),
    budgetAmount: positiveNumber(snapshot.budgetAmount),
    budgetCurrency: cleanText(snapshot.budgetCurrency, 3),
    travelersCount: positiveInteger(snapshot.travelersCount),
    travelStyle: cleanText(snapshot.travelStyle),
    accommodationPreference: cleanText(snapshot.accommodationPreference),
    transportationPreference: cleanText(snapshot.transportationPreference),
    pace: cleanText(snapshot.pace, 40),
    highlights: null,
    dayItems,
    priceSnapshots: Array.isArray(snapshot.priceSnapshots) ? snapshot.priceSnapshots : [],
    itemVerdicts: [],
    tripId: cleanText(snapshot.tripId, 60),
    userId: cleanText(snapshot.userId, 60),
    consentAnonymizedReuse: snapshot.consentAnonymizedReuse === true,
    bookingProven: false
  };
}

/** Row shapes for the share-flow adapter (mirrors itinerary_submissions / item_verdicts). */
export type SharedSubmissionSnapshot = {
  submission: {
    id: string;
    trip_id: string;
    user_id: string;
    title?: string | null;
    destination?: string | null;
    destination_city?: string | null;
    destination_country?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    highlights?: string | null;
    consent_anonymized_reuse?: boolean | null;
  };
  verdicts: Array<{
    item_type?: string | null;
    rating?: number | null;
    item_label?: string | null;
    location?: string | null;
  }>;
  trip?: {
    travelers_count?: number | null;
    travel_style?: string | null;
    accommodation_preference?: string | null;
    transportation_preference?: string | null;
    budget_amount?: number | null;
  } | null;
};

/**
 * Adapter (b): /trips/share submissions. This is the ONLY adapter that sets
 * bookingProven=true — every verdict here ties to the traveler's own
 * Gmail-sensed booking wallet (booking_proven=true on the share path).
 */
export function adaptSharedSubmission(snapshot: SharedSubmissionSnapshot): RawItineraryInput {
  const submission = snapshot.submission;
  const trip = snapshot.trip || null;
  const dayItems: IngesterDayItem[] = [];
  let dayNumber = 1;
  for (const verdict of snapshot.verdicts || []) {
    const label = cleanText(verdict.item_label, 160);
    if (!label) continue;
    dayItems.push({
      dayNumber: dayNumber++,
      label,
      itemType: cleanText(verdict.item_type, 40),
      location: cleanText(verdict.location)
    });
  }
  return {
    title: cleanText(submission.title),
    destination: cleanText(submission.destination),
    destinationCity: cleanText(submission.destination_city),
    destinationCountry: cleanText(submission.destination_country),
    startDate: cleanText(submission.start_date, 10),
    endDate: cleanText(submission.end_date, 10),
    budgetAmount: positiveNumber(trip?.budget_amount),
    budgetCurrency: null,
    travelersCount: positiveInteger(trip?.travelers_count),
    travelStyle: cleanText(trip?.travel_style),
    accommodationPreference: cleanText(trip?.accommodation_preference),
    transportationPreference: cleanText(trip?.transportation_preference),
    pace: null,
    highlights: cleanText(submission.highlights, 500),
    dayItems,
    priceSnapshots: [],
    itemVerdicts: (snapshot.verdicts || []).map((verdict) => ({
      itemType: cleanText(verdict.item_type, 40),
      rating: typeof verdict.rating === "number" && Number.isFinite(verdict.rating) ? verdict.rating : null,
      itemLabel: cleanText(verdict.item_label, 160)
    })),
    tripId: cleanText(submission.trip_id, 60),
    userId: cleanText(submission.user_id, 60),
    consentAnonymizedReuse: submission.consent_anonymized_reuse === true,
    bookingProven: true
  };
}

export type OwnerSubmittedItineraryInput = {
  submittedByUserId: string;
  title?: string | null;
  destination?: string | null;
  destinationCity?: string | null;
  destinationCountry?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetAmount?: number | null;
  budgetCurrency?: string | null;
  travelersCount?: number | null;
  travelStyle?: string | null;
  pace?: string | null;
  highlights?: string | null;
  dayItems: Array<{ dayNumber?: number | null; label?: string | null; itemType?: string | null; location?: string | null }>;
  priceSnapshots?: IngesterPriceSnapshot[];
  /** Explicit consent collected on the owner-submit form. Defaults to false. */
  consentAnonymizedReuse?: boolean | null;
};

/**
 * Adapter (c): owner-submitted completed itineraries. bookingProven stays
 * false — it is never inferred, not even for the owner.
 */
export function adaptOwnerSubmittedItinerary(input: OwnerSubmittedItineraryInput): RawItineraryInput {
  const dayItems: IngesterDayItem[] = [];
  for (const item of input.dayItems || []) {
    const label = cleanText(item.label, 160);
    if (!label) continue;
    dayItems.push({
      dayNumber: positiveInteger(item.dayNumber) || dayItems.length + 1,
      label,
      itemType: cleanText(item.itemType, 40),
      location: cleanText(item.location)
    });
  }
  return {
    title: cleanText(input.title),
    destination: cleanText(input.destination),
    destinationCity: cleanText(input.destinationCity),
    destinationCountry: cleanText(input.destinationCountry),
    startDate: cleanText(input.startDate, 10),
    endDate: cleanText(input.endDate, 10),
    budgetAmount: positiveNumber(input.budgetAmount),
    budgetCurrency: cleanText(input.budgetCurrency, 3),
    travelersCount: positiveInteger(input.travelersCount),
    travelStyle: cleanText(input.travelStyle),
    accommodationPreference: null,
    transportationPreference: null,
    pace: cleanText(input.pace, 40),
    highlights: cleanText(input.highlights, 500),
    dayItems,
    priceSnapshots: Array.isArray(input.priceSnapshots) ? input.priceSnapshots : [],
    itemVerdicts: [],
    tripId: null,
    userId: cleanText(input.submittedByUserId, 60),
    consentAnonymizedReuse: input.consentAnonymizedReuse === true,
    bookingProven: false
  };
}

// ---------------------------------------------------------------------------
// Normalize — one path for all three intakes.
// ---------------------------------------------------------------------------

const MIN_AVERAGE_RATING_FOR_SUCCESS = 4;
const DEDUPE_OVERLAP_THRESHOLD = 0.85;
const DEDUPE_MIN_ITEMS = 3;

export function destinationKeyFor(input: {
  destination?: string | null;
  destinationCity?: string | null;
  destinationCountry?: string | null;
}): string | null {
  const city = cleanText(input.destinationCity) || cleanText(input.destination);
  const country = cleanText(input.destinationCountry);
  if (!city) return null;
  return [city.toLowerCase(), country ? country.toLowerCase() : null].filter(Boolean).join(",");
}

/**
 * Normalize a raw input into the library record shape. Returns null when the
 * itinerary has no usable destination — the caller routes it to
 * `missing_destination` and never stores it.
 *
 * Prices are deep-copied verbatim: same amounts, same currencies, same
 * provenance strings. Only the budget band LABEL is derived, via the
 * repo's single budgetBandForAmount truth.
 */
export function normalizeItinerary(raw: RawItineraryInput, source?: ItineraryIntakeSource): NormalizedItinerary | null {
  const destinationKey = destinationKeyFor(raw);
  if (!destinationKey) return null;
  if (!raw.dayItems.length) return null;

  const { quarter, travelMonth } = deriveSeasonQuarter(raw.startDate);
  const dayItems: IngesterDayItem[] = raw.dayItems
    .filter((item) => item.label.trim())
    .map((item) => ({
      dayNumber: item.dayNumber,
      label: item.label,
      itemType: item.itemType,
      location: item.location
    }));
  if (!dayItems.length) return null;

  // Verbatim carry-through: deep copy so no caller can mutate the record's
  // prices later, and no step can rewrite amount/currency/provenance.
  const priceSnapshots: IngesterPriceSnapshot[] = raw.priceSnapshots.map((snapshot) => ({
    amount: snapshot.amount,
    currency: snapshot.currency,
    provenance: snapshot.provenance,
    label: snapshot.label
  }));

  const ratings = raw.itemVerdicts
    .map((verdict) => verdict.rating)
    .filter((rating): rating is number => typeof rating === "number");

  return {
    destinationKey,
    destination: raw.destination,
    destinationCity: raw.destinationCity,
    destinationCountry: raw.destinationCountry,
    startDate: raw.startDate,
    endDate: raw.endDate,
    durationDays: durationDays(raw.startDate, raw.endDate),
    budgetBand: budgetBandForAmount(raw.budgetAmount),
    budgetAmount: raw.budgetAmount,
    budgetCurrency: raw.budgetCurrency,
    travelersCount: raw.travelersCount,
    travelStyle: raw.travelStyle,
    accommodationPreference: raw.accommodationPreference,
    transportationPreference: raw.transportationPreference,
    pace: raw.pace,
    styleTags: deriveStyleTags(raw),
    seasonQuarter: quarter,
    travelMonth,
    partyType: derivePartyType(raw.travelersCount),
    dayItems,
    priceSnapshots,
    highlights: raw.highlights,
    consentAnonymizedReuse: raw.consentAnonymizedReuse === true,
    bookingProven: raw.bookingProven === true,
    source: source ?? null,
    avgItemRating: average(ratings) != null ? Math.round((average(ratings) || 0) * 10) / 10 : null,
    itemCount: dayItems.length
  };
}

/**
 * Pattern eligibility is decided at normalize/store time so the aggregation
 * reader never has to re-derive it. The gate is SOURCE-AWARE and fail-closed
 * (audit 1A): the "never pattern-eligible" guarantee lives HERE, not just in
 * the adapters. Rules (all must hold):
 *  - intake source is "shared" — the only path where bookingProven can be
 *    minted. "generated" (a plan Roamly suggested is not evidence it worked)
 *    and "owner_submitted" (proof is never inferred) are never eligible,
 *    regardless of flags; null/unknown sources fail closed.
 *  - consent was actually collected (consentAnonymizedReuse === true)
 *  - the trip is booking-proven (honored only on the share path above)
 *  - the record is not a duplicate pointer
 *  - traveler-rated trips must average >= 4 (mirrors the feedback lane's gate)
 */
export function isPatternEligible(normalized: NormalizedItinerary, duplicateOf: string | null): boolean {
  if (normalized.source !== "shared") return false;
  if (!normalized.consentAnonymizedReuse) return false;
  if (!normalized.bookingProven) return false;
  if (duplicateOf) return false;
  if (normalized.avgItemRating != null && normalized.avgItemRating < MIN_AVERAGE_RATING_FOR_SUCCESS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Dedupe — near-identical itineraries collapse to one library record.
// ---------------------------------------------------------------------------

export type DedupeCandidate = {
  id: string;
  dayItemKeys: string[];
  createdAt: string;
};

export function dedupeCandidateKeys(dayItems: IngesterDayItem[]): string[] {
  const keys = new Set<string>();
  for (const item of dayItems) {
    const key = itemIdentityKey(item.label);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Returns the id of the existing record this itinerary duplicates, or null.
 * A duplicate needs: the same destination key, the same budget band, and
 * >=85% of the smaller item set shared. Plans with fewer than 3 named items
 * on either side are never declared duplicates (too little to judge).
 */
export function resolveDuplicate(
  normalized: NormalizedItinerary,
  candidates: DedupeCandidate[]
): string | null {
  const keys = new Set(dedupeCandidateKeys(normalized.dayItems));
  if (keys.size < DEDUPE_MIN_ITEMS) return null;
  const ordered = [...candidates].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const candidate of ordered) {
    const candidateKeys = new Set(candidate.dayItemKeys);
    if (candidateKeys.size < DEDUPE_MIN_ITEMS) continue;
    let shared = 0;
    for (const key of keys) {
      if (candidateKeys.has(key)) shared += 1;
    }
    const overlap = shared / Math.min(keys.size, candidateKeys.size);
    if (overlap >= DEDUPE_OVERLAP_THRESHOLD) return candidate.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Storage — the itinerary_library_records table (owner-applied migration).
// Absent tables → library_storage_unavailable. Never throws.
// ---------------------------------------------------------------------------

export const ITINERARY_LIBRARY_RECORDS_TABLE = "itinerary_library_records";

type StoredLibraryRow = {
  id: string;
  destination_key: string | null;
  budget_band: string | null;
  day_items: unknown;
  created_at: string;
};

function provenanceFor(source: ItineraryIntakeSource, detail: string | null): Record<string, string | null> {
  return {
    intake: source,
    ingestedAt: new Date().toISOString(),
    sourceDetail: detail
  };
}

function rowFromNormalized(normalized: NormalizedItinerary): Record<string, unknown> {
  return {
    destination_key: normalized.destinationKey,
    destination: normalized.destination,
    destination_city: normalized.destinationCity,
    destination_country: normalized.destinationCountry,
    start_date: normalized.startDate,
    end_date: normalized.endDate,
    duration_days: normalized.durationDays,
    budget_band: normalized.budgetBand,
    budget_amount: normalized.budgetAmount,
    budget_currency: normalized.budgetCurrency,
    travelers_count: normalized.travelersCount,
    travel_style: normalized.travelStyle,
    pace: normalized.pace,
    season_quarter: normalized.seasonQuarter,
    travel_month: normalized.travelMonth,
    party_type: normalized.partyType,
    style_tags: normalized.styleTags,
    day_items: normalized.dayItems,
    price_snapshots: normalized.priceSnapshots,
    highlights: normalized.highlights,
    consent_anonymized_reuse: normalized.consentAnonymizedReuse,
    booking_proven: normalized.bookingProven,
    avg_item_rating: normalized.avgItemRating,
    item_count: normalized.itemCount,
    status: "received"
  };
}

async function tablesReady(admin: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await admin.from(ITINERARY_LIBRARY_RECORDS_TABLE).select("id").limit(1);
    if (!error) return true;
    // A missing table is the expected pre-migration state — not an error.
    return !isMissingTableError(error.message);
  } catch {
    return false;
  }
}

async function loadDedupeCandidates(
  admin: SupabaseClient,
  normalized: NormalizedItinerary
): Promise<DedupeCandidate[]> {
  try {
    let query = admin
      .from(ITINERARY_LIBRARY_RECORDS_TABLE)
      .select("id,destination_key,budget_band,day_items,created_at")
      .eq("destination_key", normalized.destinationKey)
      .order("created_at", { ascending: true })
      .limit(200);
    // Budget-band mismatch means "different trip economics" — never a dupe.
    // Null bands match only null bands.
    query = normalized.budgetBand == null ? query.is("budget_band", null) : query.eq("budget_band", normalized.budgetBand);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    const candidates: DedupeCandidate[] = [];
    for (const row of data as StoredLibraryRow[]) {
      const items = Array.isArray(row.day_items)
        ? (row.day_items as Array<{ label?: unknown }>)
            .map((item) => (typeof item?.label === "string" ? itemIdentityKey(item.label) : ""))
            .filter(Boolean)
        : [];
      candidates.push({ id: row.id, dayItemKeys: [...new Set(items)].sort(), createdAt: row.created_at });
    }
    return candidates;
  } catch {
    return [];
  }
}

/**
 * The full ingest path: validate → normalize → storage check → dedupe →
 * insert. Never throws; every outcome is a named IngestOutcome.
 */
export async function ingestItinerary(
  admin: SupabaseClient | null,
  raw: RawItineraryInput,
  source: ItineraryIntakeSource
): Promise<IngestOutcome> {
  try {
    const normalized = normalizeItinerary(raw, source);
    if (!normalized) {
      return { ok: false, action: "not_stored", normalized: null, reason: INGESTER_REASONS.missingDestination };
    }
    if (!admin) {
      return { ok: false, action: "not_stored", normalized, reason: INGESTER_REASONS.libraryStorageUnavailable };
    }
    if (!(await tablesReady(admin))) {
      return { ok: false, action: "not_stored", normalized, reason: INGESTER_REASONS.libraryStorageUnavailable };
    }

    const candidates = await loadDedupeCandidates(admin, normalized);
    const duplicateOf = resolveDuplicate(normalized, candidates);

    const patternEligible = isPatternEligible(normalized, duplicateOf);
    const row = {
      ...rowFromNormalized(normalized),
      source,
      external_ref: raw.tripId,
      user_id: raw.userId,
      pattern_eligible: patternEligible,
      duplicate_of: duplicateOf,
      provenance: provenanceFor(source, duplicateOf ? `duplicate_of:${duplicateOf}` : raw.tripId)
    };
    const { data, error } = await admin.from(ITINERARY_LIBRARY_RECORDS_TABLE).insert(row).select("id").single();
    if (error || !data) {
      return { ok: false, action: "not_stored", normalized, reason: INGESTER_REASONS.storageError };
    }
    const storedId = typeof (data as { id?: unknown }).id === "string" ? String((data as { id: unknown }).id) : null;
    if (!storedId) {
      return { ok: false, action: "not_stored", normalized, reason: INGESTER_REASONS.storageError };
    }
    // Duplicate collapse: the pointer row is stored for the audit trail, but
    // the library still has exactly one effective record — never pattern-eligible.
    if (duplicateOf) {
      return { ok: true, action: "duplicate", duplicateOf, normalized, patternEligible: false };
    }
    // Consent gate: stored, but private-only — never pattern-eligible.
    if (!normalized.consentAnonymizedReuse) {
      return {
        ok: true,
        action: "private_only",
        storedId,
        normalized,
        patternEligible: false,
        reason: INGESTER_REASONS.noConsentPrivateOnly
      };
    }
    return { ok: true, action: "stored", storedId, normalized, patternEligible };
  } catch {
    return { ok: false, action: "not_stored", normalized: null, reason: INGESTER_REASONS.storageError };
  }
}

/**
 * At-birth hook for the generator: call after the final validated itinerary
 * is persisted (stagedItineraryGeneration completeGeneration, right after the
 * `persistItinerary({ final: true })` success). Wrap in try/catch at the
 * call site too — this function never throws, but the generator must never
 * depend on the library.
 */
export async function recordGeneratedItinerary(
  admin: SupabaseClient | null,
  snapshot: GeneratedItinerarySnapshot
): Promise<IngestOutcome> {
  try {
    const raw = adaptGeneratedItinerary(snapshot);
    return await ingestItinerary(admin, raw, "generated");
  } catch {
    return { ok: false, action: "not_stored", normalized: null, reason: INGESTER_REASONS.storageError };
  }
}

// ---------------------------------------------------------------------------
// Aggregation input — converts eligible stored rows into the shape
// itineraryLibraryAggregation's readers already understand.
// ---------------------------------------------------------------------------

type EligibleRow = {
  id: string;
  destination_key: string | null;
  destination_city: string | null;
  destination_country: string | null;
  duration_days: number | null;
  travelers_count: number | null;
  travel_style: string | null;
  budget_band: string | null;
  avg_item_rating: number | null;
  item_count: number | null;
  booking_proven: boolean | null;
  source: string | null;
  created_at: string;
};

/**
 * Read pattern-eligible ingester rows as SuccessfulTripExperienceContextRecord
 * inputs for the existing aggregation. Missing table (migration not applied)
 * or any read error → []. Generated plans never appear here: they are not
 * booking-proven, so isPatternEligible can never admit them — the patterns
 * engine only learns from trips a traveler actually took and rated.
 */
export async function readIngesterLibraryRecords(
  admin: SupabaseClient
): Promise<SuccessfulTripExperienceContextRecord[]> {
  try {
    const { data, error } = await admin
      .from(ITINERARY_LIBRARY_RECORDS_TABLE)
      .select(
        "id,destination_key,destination_city,destination_country,duration_days,travelers_count,travel_style,budget_band,avg_item_rating,item_count,booking_proven,source,created_at"
      )
      .eq("pattern_eligible", true)
      .eq("status", "received")
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error || !Array.isArray(data)) return [];
    const records: SuccessfulTripExperienceContextRecord[] = [];
    for (const row of data as EligibleRow[]) {
      const destination = row.destination_city || row.destination_key?.split(",")[0] || null;
      const country = row.destination_country || row.destination_key?.split(",")[1] || null;
      const destinationKey = destination
        ? [destination.toLowerCase(), country ? country.toLowerCase() : null].filter(Boolean).join(",")
        : null;
      if (!destinationKey) continue;
      const overallSatisfaction =
        typeof row.avg_item_rating === "number" && Number.isFinite(row.avg_item_rating)
          ? Math.round(row.avg_item_rating)
          : null;
      const context: SuccessfulTripExperienceContext = {
        schemaVersion: 1,
        destinationKey,
        durationDays: typeof row.duration_days === "number" ? row.duration_days : null,
        travelersCount: typeof row.travelers_count === "number" ? row.travelers_count : null,
        travelStyle: row.travel_style,
        accommodationPreference: null,
        transportationPreference: null,
        dayCount: 0,
        plannedItemCount: typeof row.item_count === "number" ? row.item_count : 0,
        flexibleItemCount: 0,
        estimatedBudgetCategoryCount: 0,
        feedbackSignals: {
          overallSatisfaction,
          itineraryPace: null,
          scheduleRealism: null,
          budgetAccuracy: null,
          hotelLocationSatisfaction: null,
          hotelQualitySatisfaction: null,
          transportationSatisfaction: null,
          // A booking-proven, consenting, traveler-rated share is itself the
          // would-use-again signal (same convention as itineraryLibraryAggregation).
          wouldUseRoamlyAgain: true
        }
      };
      records.push({
        experienceContext: context,
        weight: row.booking_proven === true ? 2 : 1,
        budgetBand: row.budget_band
      });
    }
    return records;
  } catch {
    return [];
  }
}
