import type { CurrencyCode, MoneyRange, PerBasis } from "@/lib/roamly/engine/money";
import { isCurrencyCode, isMoneyRange, isPerBasis } from "@/lib/roamly/engine/money";
import { isContentId, isSourceKey } from "@/lib/roamly/engine/ids";
import type { LocalDate, PlanMinutes, UtcInstant } from "@/lib/roamly/engine/time";
import { isLocalDate, isUtcInstant, isValidTimeZone } from "@/lib/roamly/engine/time";

/*
 * Canonical DTOs — the one typed contract set for the production
 * wiring (DESIGN-PRODUCTION.md §1.4, Phase 1).
 *
 * The TS domain core (Phase 2+) is synchronous and persistence-free:
 * it consumes and produces ONLY these shapes. Application services
 * and jobs translate between these DTOs and database rows, API
 * payloads, and provider responses — the DTO is the boundary, and
 * every translation is validated by the guards in this file.
 *
 * Every DTO carries:
 *   - stable identity (content IDs / source keys from ids.ts — never
 *     a name or slug), and
 *   - provenance (where the fact came from, and when it was recorded).
 *
 * Field shapes deliberately mirror the proven shadow records (the
 * zero-engine price ladder, part2 reconciliation/companion/lifecycle,
 * the entry gates, the Budget-vs-Real bot) so the golden fixtures in
 * scripts/fixtures/wiring-phase1/ are conversions, not inventions.
 * Where a shadow shape and a production ruling differ (e.g. lifecycle
 * archiving vs the shadow's delete-the-itinerary), the DTO follows
 * the RULING and the difference is documented on the type.
 */

/* ------------------------------------------------------------------ */
/* Versions (policy + schema constants — bump deliberately)            */
/* ------------------------------------------------------------------ */

export const DTO_SCHEMA_VERSION = 1;
export const PACK_SCHEMA_VERSION = 1;
export const EXTRACTOR_VERSION = "recon-canonical-1";
/* prices-2 (2026-10-22): the ALL-IN scope policy change (owner decision) —
 * the lodging band table joined the policy and the budget verdict's scope
 * widened to plan items + lodging + getting-there (budgetScope.ts). */
export const PRICE_POLICY_VERSION = "prices-2";
export const ENGINE_GENERATION_VERSION = "zero-engine-v1";
export const HANDOVER_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Guard plumbing                                                      */
/* ------------------------------------------------------------------ */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPlanMinutes(value: unknown): value is PlanMinutes {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function check(
  errors: string[],
  condition: boolean,
  message: string
): void {
  if (!condition) errors.push(message);
}

function finish<T>(errors: string[], value: T): ParseResult<T> {
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

/* ------------------------------------------------------------------ */
/* Provenance — attached to every fact                                 */
/* ------------------------------------------------------------------ */

export interface ProvenanceDTO {
  /** Who/what produced this fact: "osm", "google", "gmail", "library",
   *  "traveler", "zero-engine", "staged-ai", a provider name, ... */
  source: string;
  /** Durable pointer to the source record (source key, message id,
   *  file ref) — null when the source has no addressable record. */
  sourceRef: string | null;
  /** When the fact was recorded (instant), null in pure fixtures. */
  recordedAt: UtcInstant | null;
  /** Human label for surfaces/logs, e.g. "booking-email", "owner library". */
  label: string | null;
}

export function isProvenanceDTO(value: unknown): value is ProvenanceDTO {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.source) &&
    (value.sourceRef === null || typeof value.sourceRef === "string") &&
    (value.recordedAt === null || isUtcInstant(value.recordedAt)) &&
    (value.label === null || typeof value.label === "string")
  );
}

function checkProvenance(errors: string[], value: unknown, path: string): void {
  check(errors, isProvenanceDTO(value), `${path}: invalid provenance`);
}

/* ------------------------------------------------------------------ */
/* Geography                                                           */
/* ------------------------------------------------------------------ */

export interface GeoPointDTO {
  lat: number;
  lon: number;
}

export function isGeoPointDTO(value: unknown): value is GeoPointDTO {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    isFiniteNumber(value.lon) &&
    value.lon >= -180 &&
    value.lon <= 180
  );
}

/* ------------------------------------------------------------------ */
/* Destination + pack + candidate (SHORTLIST)                          */
/* ------------------------------------------------------------------ */

export interface DestinationDTO {
  destinationId: string; // registry ID (content ID or UUID)
  displayName: string;
  country: string;
  centre: GeoPointDTO;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  timeZone: string; // IANA — the trip's plan-time zone
  geocodeProvenance: ProvenanceDTO;
}

export type PackStatus = "building" | "ready" | "failed" | "superseded";
export const PACK_STATUSES: readonly PackStatus[] = [
  "building",
  "ready",
  "failed",
  "superseded"
];

export interface DestinationPackDTO {
  packVersionId: string;
  destinationId: string;
  schemaVersion: number; // PACK_SCHEMA_VERSION at build time
  classifierVersion: string;
  status: PackStatus;
  builtAt: UtcInstant | null;
  counts: {
    candidates: number;
    byKind: Record<string, number>;
  };
  provenance: ProvenanceDTO;
}

export interface GoogleEnrichmentDTO {
  placeId: string; // Google Place ID (external identifier only)
  priceLevel: string | null; // e.g. "PRICE_LEVEL_MODERATE"
  rating: number | null;
  ratingCount: number | null;
  hoursStatus: "known" | "unknown" | "closed-temporarily" | null;
  wheelchairEntrance: boolean | null;
  fetchedAt: UtcInstant;
  refreshDueAt: UtcInstant; // Google-derived fields: +30 days discipline
  provenance: ProvenanceDTO;
}

export interface CandidateDTO {
  candidateKey: string; // source key, e.g. "osm:node/283264348"
  kind: string; // museum | food | park | ferry | ... (pack vocabulary)
  name: string;
  pos: GeoPointDTO | null;
  hours: { status: "known" | "unknown"; raw: string | null } | null;
  enrichment: GoogleEnrichmentDTO | null;
  provenance: ProvenanceDTO;
}

export function parseCandidateDTO(value: unknown): ParseResult<CandidateDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["candidate: not an object"] };
  check(errors, isSourceKey(value.candidateKey), "candidate.candidateKey: not a source key");
  check(errors, isNonEmptyString(value.kind), "candidate.kind: required");
  check(errors, isNonEmptyString(value.name), "candidate.name: required");
  check(errors, value.pos === null || isGeoPointDTO(value.pos), "candidate.pos: invalid");
  if (value.hours !== null && value.hours !== undefined) {
    check(
      errors,
      isRecord(value.hours) &&
        (value.hours.status === "known" || value.hours.status === "unknown"),
      "candidate.hours: invalid status"
    );
  }
  checkProvenance(errors, value.provenance, "candidate.provenance");
  return finish(errors, value as unknown as CandidateDTO);
}

/* ------------------------------------------------------------------ */
/* Price evidence — the ladder (zero-engine prices.mjs, verbatim tiers) */
/* ------------------------------------------------------------------ */

export type PriceTier = "VERIFIED" | "BAND" | "COSTED" | "UNKNOWN";
export const PRICE_TIERS: readonly PriceTier[] = [
  "VERIFIED",
  "BAND",
  "COSTED",
  "UNKNOWN"
];

export type PricedCategory = "meal" | "admission" | "crossing";

export interface PriceEvidenceDTO {
  tier: PriceTier;
  category: PricedCategory;
  /** Null iff tier is UNKNOWN — unknown is never zero, never guessed. */
  range: MoneyRange | null;
  per: PerBasis;
  /** The labeled basis, carried verbatim ("ESTIMATED — ..."). */
  basis: string;
}

export function isPriceEvidenceDTO(value: unknown): value is PriceEvidenceDTO {
  if (!isRecord(value)) return false;
  if (!oneOf(PRICE_TIERS, value.tier)) return false;
  if (!oneOf(["meal", "admission", "crossing"] as const, value.category)) return false;
  if (!isPerBasis(value.per)) return false;
  if (!isNonEmptyString(value.basis)) return false;
  if (value.tier === "UNKNOWN") return value.range === null;
  return isMoneyRange(value.range);
}

/** A library VERIFIED price record — the exact shape judgeBudget consumes. */
export interface LibraryPriceRecordDTO {
  candidateKey: string; // the ladder's library key (candidate key / item key)
  amount: number;
  currency: CurrencyCode;
  per: PerBasis;
  source: string;
  recordedAt: string; // date or instant, as recorded
  evidenceCount: number; // confirmed observations behind this record
}

export function isLibraryPriceRecordDTO(value: unknown): value is LibraryPriceRecordDTO {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.candidateKey) &&
    isFiniteNumber(value.amount) &&
    isCurrencyCode(value.currency) &&
    isPerBasis(value.per) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.recordedAt) &&
    isNonNegativeInt(value.evidenceCount)
  );
}

/* ------------------------------------------------------------------ */
/* The plan document (trip / itinerary)                                */
/* ------------------------------------------------------------------ */

export interface TravelersDTO {
  adults: number;
  children: number;
  infants: number;
}

/** Paying party = adults + children (shadow judge assumption, labeled). */
export function payingPartyOf(travelers: TravelersDTO): number {
  return (travelers.adults || 0) + (travelers.children || 0);
}

export type BudgetVerdict = "WITHIN" | "AT RISK" | "OVER" | "UNVERIFIABLE";
export const BUDGET_VERDICTS: readonly BudgetVerdict[] = [
  "WITHIN",
  "AT RISK",
  "OVER",
  "UNVERIFIABLE"
];

export interface BudgetCapDTO {
  amount: number;
  currency: CurrencyCode;
  verdict: BudgetVerdict | null;
  verdictNote: string | null;
}

export interface ItineraryItemDTO {
  itemId: string; // content ID (ids.itineraryItemId) — never the place name
  candidateKey: string | null; // source key of the underlying candidate
  type: string; // stop | food | rest | transfer | flight | ...
  kind: string | null; // museum | gallery | ferry | ... (pack vocabulary)
  name: string;
  startMin: PlanMinutes; // minutes after trip-local midnight
  endMin: PlanMinutes; // may exceed 1439 for after-midnight ends
  pos: GeoPointDTO | null;
  bookingReference: string | null;
  priceEvidence: PriceEvidenceDTO | null; // null = not a priced item
  provenance: ProvenanceDTO | null;
}

export interface ItineraryDayDTO {
  dayId: string;
  dayNumber: number; // 1-based
  date: LocalDate; // trip-local civil date
  role: string; // pacing vocabulary: FULL | LIGHT | REST | OPEN | MOVE | standard
  items: ItineraryItemDTO[];
  endMin: PlanMinutes | null;
}

export type GenerationSource = "zero-engine" | "staged-ai";

export interface TripPlanDocumentDTO {
  schemaVersion: number; // DTO_SCHEMA_VERSION
  tripId: string;
  destinationId: string;
  destinationName: string;
  country: string;
  timeZone: string; // IANA — every date/minutes field reads in this zone
  startDate: LocalDate;
  endDate: LocalDate;
  travelers: TravelersDTO;
  days: ItineraryDayDTO[];
  budgetCap: BudgetCapDTO | null;
  anchorStay: { name: string; candidateKey: string | null } | null;
  source: GenerationSource; // honest label (M10) — never faked
  packVersionId: string | null; // the pinned pack this plan was solved from
  policyVersions: { pricePolicy: string; extractor: string };
  provenance: ProvenanceDTO;
}

function checkPriceEvidence(
  errors: string[],
  value: unknown,
  path: string
): void {
  if (value === null || value === undefined) return;
  check(errors, isPriceEvidenceDTO(value), `${path}: invalid price evidence`);
}

function checkItem(errors: string[], value: unknown, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${path}: not an object`);
    return;
  }
  check(errors, isContentId(value.itemId), `${path}.itemId: not a content ID`);
  check(
    errors,
    value.candidateKey === null || isSourceKey(value.candidateKey),
    `${path}.candidateKey: not a source key`
  );
  check(errors, isNonEmptyString(value.type), `${path}.type: required`);
  check(errors, isNonEmptyString(value.name), `${path}.name: required`);
  check(errors, isPlanMinutes(value.startMin), `${path}.startMin: invalid plan minutes`);
  check(errors, isPlanMinutes(value.endMin), `${path}.endMin: invalid plan minutes`);
  if (isPlanMinutes(value.startMin) && isPlanMinutes(value.endMin)) {
    check(errors, value.endMin >= value.startMin, `${path}: endMin before startMin`);
  }
  check(errors, value.pos === null || isGeoPointDTO(value.pos), `${path}.pos: invalid`);
  checkPriceEvidence(errors, value.priceEvidence, `${path}.priceEvidence`);
}

export function parseTripPlanDocumentDTO(
  value: unknown
): ParseResult<TripPlanDocumentDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["plan: not an object"] };
  check(errors, value.schemaVersion === DTO_SCHEMA_VERSION, "plan.schemaVersion: must be 1");
  check(errors, isNonEmptyString(value.tripId), "plan.tripId: required");
  check(errors, isNonEmptyString(value.destinationId), "plan.destinationId: required");
  check(errors, isValidTimeZone(value.timeZone), "plan.timeZone: not an IANA zone");
  check(errors, isLocalDate(value.startDate), "plan.startDate: invalid local date");
  check(errors, isLocalDate(value.endDate), "plan.endDate: invalid local date");
  if (!isRecord(value.travelers)) {
    errors.push("plan.travelers: required");
  } else {
    check(errors, isNonNegativeInt(value.travelers.adults), "plan.travelers.adults: invalid");
    check(errors, isNonNegativeInt(value.travelers.children), "plan.travelers.children: invalid");
    check(errors, isNonNegativeInt(value.travelers.infants), "plan.travelers.infants: invalid");
  }
  if (!Array.isArray(value.days) || value.days.length === 0) {
    errors.push("plan.days: must be a non-empty array");
  } else {
    value.days.forEach((day, i) => {
      const path = `plan.days[${i}]`;
      if (!isRecord(day)) {
        errors.push(`${path}: not an object`);
        return;
      }
      check(errors, day.dayNumber === i + 1, `${path}.dayNumber: expected ${i + 1}`);
      check(errors, isLocalDate(day.date), `${path}.date: invalid local date`);
      check(errors, Array.isArray(day.items), `${path}.items: must be an array`);
      if (Array.isArray(day.items)) {
        day.items.forEach((item, j) => checkItem(errors, item, `${path}.items[${j}]`));
      }
    });
  }
  if (value.budgetCap !== null && value.budgetCap !== undefined) {
    check(errors, isRecord(value.budgetCap), "plan.budgetCap: invalid");
    if (isRecord(value.budgetCap)) {
      check(errors, isFiniteNumber(value.budgetCap.amount), "plan.budgetCap.amount: invalid");
      check(errors, isCurrencyCode(value.budgetCap.currency), "plan.budgetCap.currency: invalid");
      check(
        errors,
        value.budgetCap.verdict === null || oneOf(BUDGET_VERDICTS, value.budgetCap.verdict),
        "plan.budgetCap.verdict: invalid"
      );
    }
  }
  check(errors, oneOf(["zero-engine", "staged-ai"] as const, value.source), "plan.source: invalid");
  checkProvenance(errors, value.provenance, "plan.provenance");
  return finish(errors, value as unknown as TripPlanDocumentDTO);
}

/* ------------------------------------------------------------------ */
/* Prediction record (PREDICT — M8 shape)                              */
/* ------------------------------------------------------------------ */

export interface BudgetPostureDTO {
  verdict: BudgetVerdict;
  note: string;
  cap: { amount: number; currency: CurrencyCode } | null;
  coverage: number; // evidenced / priced, 0..1
  coverageThreshold: number;
  pricedItems: number;
  evidencedItems: number;
  evidenceByTier: Record<string, number>;
  estimatedTotals: MoneyRange | null; // party basis
  scopeNote: string;
}

export interface PredictionRecordDTO {
  predictionId: string; // content ID (ids.predictionId)
  tripId: string;
  recordedAt: UtcInstant;
  highlights: {
    itemRef: string;
    name: string;
    day: number;
    score: number;
    reasons: string[];
  }[];
  risks: {
    riskRef: string;
    itemRef: string | null;
    kind: string;
    note: string;
  }[];
  budgetPosture: BudgetPostureDTO;
  paceLoad: Record<string, unknown> | null;
  /** LEARN grades, written later against recorded outcomes; null until graded. */
  grades: {
    itemOutcomes: { itemRef: string; outcome: string; travelerRating: number | null }[];
    gradedAt: UtcInstant;
  } | null;
}

export function parsePredictionRecordDTO(
  value: unknown
): ParseResult<PredictionRecordDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["prediction: not an object"] };
  check(errors, isContentId(value.predictionId), "prediction.predictionId: not a content ID");
  check(errors, isNonEmptyString(value.tripId), "prediction.tripId: required");
  check(errors, isUtcInstant(value.recordedAt), "prediction.recordedAt: invalid instant");
  check(errors, Array.isArray(value.highlights), "prediction.highlights: must be an array");
  check(errors, Array.isArray(value.risks), "prediction.risks: must be an array");
  if (!isRecord(value.budgetPosture)) {
    errors.push("prediction.budgetPosture: required");
  } else {
    const bp = value.budgetPosture;
    check(errors, oneOf(BUDGET_VERDICTS, bp.verdict), "prediction.budgetPosture.verdict: invalid");
    check(
      errors,
      isFiniteNumber(bp.coverage) && bp.coverage >= 0 && bp.coverage <= 1,
      "prediction.budgetPosture.coverage: out of range"
    );
    check(errors, isNonNegativeInt(bp.pricedItems), "prediction.budgetPosture.pricedItems: invalid");
    check(errors, isNonNegativeInt(bp.evidencedItems), "prediction.budgetPosture.evidencedItems: invalid");
    check(
      errors,
      bp.estimatedTotals === null || isMoneyRange(bp.estimatedTotals),
      "prediction.budgetPosture.estimatedTotals: invalid"
    );
  }
  return finish(errors, value as unknown as PredictionRecordDTO);
}

/* ------------------------------------------------------------------ */
/* Booking facts + signals (Gmail reconciliation canonical shape)      */
/* ------------------------------------------------------------------ */

/** A stated local date/time, verbatim from the source (provenance time). */
export interface StatedDateTimeDTO {
  date: LocalDate;
  time: string; // "HH:MM" as stated
  minutes: PlanMinutes; // hour*60 + minute of the stated clock
  timeZone: string; // as stated (may be an abbreviation — provenance, not IANA)
  stated: string; // the exact source text
}

export interface BookingPriceDTO {
  amount: number | null;
  currency: CurrencyCode | null;
  status: "booked" | "paid-actual" | "UNKNOWN";
}

export interface BookingFactDTO {
  kind: string; // flight | hotel | restaurant | cruise | transfer | ...
  provider: string | null;
  reference: string | null;
  leadTraveler: string | null;
  status: string | null; // confirmed | delayed | changed | cancelled | ...
  price: BookingPriceDTO;
  name: string | null;
  place: string | null;
  address: string | null;
  flight: string | null;
  from: string | null;
  to: string | null;
  start: StatedDateTimeDTO | null;
  end: StatedDateTimeDTO | null;
}

export interface BookingSignalDTO {
  signalId: string; // ids.bookingSignalId — the shadow recon- scheme
  classification: "signal" | "unresolved";
  booking: BookingFactDTO;
  missingFields: string[]; // non-empty iff classification is "unresolved"
  provenance: ProvenanceDTO & { messageId: string };
}

export function parseBookingSignalDTO(value: unknown): ParseResult<BookingSignalDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["signal: not an object"] };
  check(errors, isContentId(value.signalId), "signal.signalId: not a content ID");
  check(
    errors,
    value.signalId === undefined || String(value.signalId).startsWith("recon-"),
    "signal.signalId: must use the recon- scheme"
  );
  check(errors, oneOf(["signal", "unresolved"] as const, value.classification), "signal.classification: invalid");
  if (!isRecord(value.booking)) {
    errors.push("signal.booking: required");
  } else {
    const b = value.booking;
    check(errors, isNonEmptyString(b.kind), "signal.booking.kind: required");
    if (isRecord(b.price)) {
      check(
        errors,
        b.price.amount === null || isFiniteNumber(b.price.amount),
        "signal.booking.price.amount: invalid"
      );
      check(
        errors,
        oneOf(["booked", "paid-actual", "UNKNOWN"] as const, b.price.status),
        "signal.booking.price.status: invalid"
      );
    } else {
      errors.push("signal.booking.price: required");
    }
    for (const key of ["start", "end"] as const) {
      const sdt = b[key];
      if (sdt !== null && sdt !== undefined) {
        check(
          errors,
          isRecord(sdt) && isLocalDate(sdt.date) && isPlanMinutes(sdt.minutes),
          `signal.booking.${key}: invalid stated date/time`
        );
      }
    }
  }
  check(errors, Array.isArray(value.missingFields), "signal.missingFields: must be an array");
  if (value.classification === "unresolved") {
    check(
      errors,
      Array.isArray(value.missingFields) && value.missingFields.length > 0,
      "signal: unresolved requires named missing fields (never guessed)"
    );
  }
  check(
    errors,
    isRecord(value.provenance) && isNonEmptyString(value.provenance.messageId),
    "signal.provenance.messageId: required"
  );
  return finish(errors, value as unknown as BookingSignalDTO);
}

/* ------------------------------------------------------------------ */
/* Companion item + ledger entry (Build 2, M2/M3 shapes)               */
/* ------------------------------------------------------------------ */

export type CompanionItemState =
  | "upcoming"
  | "leave-by"
  | "current"
  | "checked-in"
  | "skipped"
  | "missed"
  | "stale"
  | "expired";

export const COMPANION_ITEM_STATES: readonly CompanionItemState[] = [
  "upcoming",
  "leave-by",
  "current",
  "checked-in",
  "skipped",
  "missed",
  "stale",
  "expired"
];

export interface MapChoiceDTO {
  provider: "apple" | "google" | "citymapper";
  available: boolean;
  recommended: boolean;
  label: string;
}

export interface CompanionItemDTO {
  itemId: string; // the plan item's content ID
  kind: string; // activity | flight | hotel | leave-by | loud-alert | ...
  title: string;
  state: CompanionItemState;
  date: LocalDate;
  startMin: PlanMinutes;
  endMin: PlanMinutes;
  leaveByMin: PlanMinutes | null;
  mapChoices: MapChoiceDTO[];
  provenance: ProvenanceDTO | null;
}

export function parseCompanionItemDTO(value: unknown): ParseResult<CompanionItemDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["companion item: not an object"] };
  check(errors, isContentId(value.itemId), "companion.itemId: not a content ID");
  check(errors, isNonEmptyString(value.kind), "companion.kind: required");
  check(errors, isNonEmptyString(value.title), "companion.title: required");
  check(errors, oneOf(COMPANION_ITEM_STATES, value.state), "companion.state: invalid");
  check(errors, isLocalDate(value.date), "companion.date: invalid local date");
  check(errors, isPlanMinutes(value.startMin), "companion.startMin: invalid");
  check(errors, isPlanMinutes(value.endMin), "companion.endMin: invalid");
  check(
    errors,
    value.leaveByMin === null || isPlanMinutes(value.leaveByMin),
    "companion.leaveByMin: invalid"
  );
  check(errors, Array.isArray(value.mapChoices), "companion.mapChoices: must be an array");
  if (Array.isArray(value.mapChoices)) {
    value.mapChoices.forEach((choice, i) => {
      check(
        errors,
        isRecord(choice) &&
          oneOf(["apple", "google", "citymapper"] as const, choice.provider) &&
          typeof choice.available === "boolean" &&
          typeof choice.recommended === "boolean",
        `companion.mapChoices[${i}]: invalid`
      );
    });
  }
  return finish(errors, value as unknown as CompanionItemDTO);
}

/** M2 append-only ledger classifications (owner interaction rules). */
export type LedgerClassification =
  | "DIRECTIONS_VIEWED"
  | "CHECKED_IN"
  | "SKIPPED"
  | "MISSED"
  | "STALE"
  | "EXPIRED";

export const LEDGER_CLASSIFICATIONS: readonly LedgerClassification[] = [
  "DIRECTIONS_VIEWED",
  "CHECKED_IN",
  "SKIPPED",
  "MISSED",
  "STALE",
  "EXPIRED"
];

export interface CompanionLedgerEntryDTO {
  entryId: string; // content ID (ids.companionLedgerEntryId)
  tripId: string;
  activityRef: string; // the plan item's content ID
  classification: LedgerClassification;
  at: UtcInstant;
  atMinuteOfTrip: PlanMinutes; // trip-local minute the action belongs to
  dwellMinutes: number | null; // measured on check-in close-out, else null
  undoOfEntryId: string | null; // Undo links, never edits (append-only)
  provenance: ProvenanceDTO;
}

export function parseCompanionLedgerEntryDTO(
  value: unknown
): ParseResult<CompanionLedgerEntryDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["ledger entry: not an object"] };
  check(errors, isContentId(value.entryId), "ledger.entryId: not a content ID");
  check(errors, isNonEmptyString(value.tripId), "ledger.tripId: required");
  check(errors, isNonEmptyString(value.activityRef), "ledger.activityRef: required");
  check(
    errors,
    oneOf(LEDGER_CLASSIFICATIONS, value.classification),
    "ledger.classification: invalid"
  );
  check(errors, isUtcInstant(value.at), "ledger.at: invalid instant");
  check(errors, isPlanMinutes(value.atMinuteOfTrip), "ledger.atMinuteOfTrip: invalid");
  check(
    errors,
    value.dwellMinutes === null || isNonNegativeInt(value.dwellMinutes),
    "ledger.dwellMinutes: invalid"
  );
  checkProvenance(errors, value.provenance, "ledger.provenance");
  return finish(errors, value as unknown as CompanionLedgerEntryDTO);
}

/* ------------------------------------------------------------------ */
/* Gates (M1) + handoff tokens (M6)                                    */
/* ------------------------------------------------------------------ */

export type InstallGateState =
  | "NOT_INSTALLED"
  | "PROMPT"
  | "GUIDED"
  | "MINIMIZED"
  | "INSTALLED_DETECTED"
  | "NOTIFY_ASK"
  | "NOTIFY_DENIED"
  | "GUIDED_ENABLE"
  | "READY";

export const INSTALL_GATE_STATES: readonly InstallGateState[] = [
  "NOT_INSTALLED",
  "PROMPT",
  "GUIDED",
  "MINIMIZED",
  "INSTALLED_DETECTED",
  "NOTIFY_ASK",
  "NOTIFY_DENIED",
  "GUIDED_ENABLE",
  "READY"
];

/** Design §2.4 Gmail gate states (shadow ASK is the OAUTH_PENDING entry). */
export type GmailGateState =
  | "NOT_CONNECTED"
  | "ASK"
  | "OAUTH_PENDING"
  | "CONNECTED"
  | "RECONCILIATION_ARMED"
  | "REAUTH_REQUIRED"
  | "DISCONNECTED"
  | "REVOKED";

export const GMAIL_GATE_STATES: readonly GmailGateState[] = [
  "NOT_CONNECTED",
  "ASK",
  "OAUTH_PENDING",
  "CONNECTED",
  "RECONCILIATION_ARMED",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "REVOKED"
];

export interface GateStateDTO {
  userId: string;
  deviceId: string;
  platform: "ios" | "android" | "other";
  installState: InstallGateState;
  alertsPermission: "granted" | "denied" | "default" | null;
  alertsCheckedAt: UtcInstant | null;
  installDetectedAt: UtcInstant | null;
  gmailState: GmailGateState;
  gmailConnectionRef: string | null;
  /** Recorded BEFORE the first Gmail read; the actual granted scope. */
  gmailConsentScope: string | null;
  flowAllowed: boolean; // server-computed; self-report never sets this
  updatedAt: UtcInstant;
}

export function parseGateStateDTO(value: unknown): ParseResult<GateStateDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["gate state: not an object"] };
  check(errors, isNonEmptyString(value.userId), "gate.userId: required");
  check(errors, isNonEmptyString(value.deviceId), "gate.deviceId: required");
  check(errors, oneOf(["ios", "android", "other"] as const, value.platform), "gate.platform: invalid");
  check(errors, oneOf(INSTALL_GATE_STATES, value.installState), "gate.installState: invalid");
  check(errors, oneOf(GMAIL_GATE_STATES, value.gmailState), "gate.gmailState: invalid");
  check(
    errors,
    value.alertsPermission === null ||
      oneOf(["granted", "denied", "default"] as const, value.alertsPermission),
    "gate.alertsPermission: invalid"
  );
  check(errors, typeof value.flowAllowed === "boolean", "gate.flowAllowed: must be boolean");
  if (value.installState === "READY") {
    // Owner ruling 2026-10-21 19:14 ADT: READY requires detected
    // install AND granted alerts — a record claiming READY without
    // both is invalid on its face.
    check(errors, value.installDetectedAt !== null, "gate: READY without installDetectedAt");
    check(errors, value.alertsPermission === "granted", "gate: READY without granted alerts");
  }
  if (value.gmailState === "RECONCILIATION_ARMED") {
    check(
      errors,
      isNonEmptyString(value.gmailConsentScope),
      "gate: RECONCILIATION_ARMED without a recorded consent scope"
    );
  }
  check(errors, isUtcInstant(value.updatedAt), "gate.updatedAt: invalid instant");
  return finish(errors, value as unknown as GateStateDTO);
}

/** M6 handoff token record — the hash only, never the token. */
export interface HandoffTokenDTO {
  tokenId: string;
  userId: string;
  tripId: string;
  tokenHash: string; // SHA-256 hex of the opaque token
  createdAt: UtcInstant;
  expiresAt: UtcInstant; // createdAt + 10 minutes (owner ruling 19:15 ADT)
  usedAt: UtcInstant | null; // set atomically on first redemption (burn)
}

export function isHandoffTokenDTO(value: unknown): value is HandoffTokenDTO {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.tokenId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.tripId) &&
    typeof value.tokenHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.tokenHash) &&
    isUtcInstant(value.createdAt) &&
    isUtcInstant(value.expiresAt) &&
    (value.usedAt === null || isUtcInstant(value.usedAt))
  );
}

/* ------------------------------------------------------------------ */
/* Lifecycle (M4) + purge receipt (M5)                                 */
/* ------------------------------------------------------------------ */

export type LifecycleStateName =
  | "ACTIVE"
  | "TRIP_ENDED"
  | "POST_TRIP_PENDING"
  | "CLOSED"
  | "PURGED";

export const LIFECYCLE_STATES: readonly LifecycleStateName[] = [
  "ACTIVE",
  "TRIP_ENDED",
  "POST_TRIP_PENDING",
  "CLOSED",
  "PURGED"
];

/** Legal transitions — the machine in one table (shadow trip-lifecycle). */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<LifecycleStateName, readonly LifecycleStateName[]>
> = {
  ACTIVE: ["TRIP_ENDED"],
  TRIP_ENDED: ["POST_TRIP_PENDING"],
  POST_TRIP_PENDING: ["CLOSED"],
  CLOSED: ["PURGED"],
  PURGED: []
};

export type CloseReason = "review-submitted" | "review-window-expired";

/**
 * M5 purge receipt — content-free by construction. It proves a purge
 * happened (trip ref, dates, counts) and contains NOTHING about the
 * trip's content: no place names, no traveler names, no item data.
 * The guard rejects any record carrying content-ish fields.
 */
export interface PurgeReceiptDTO {
  tripRef: string;
  dates: { start: LocalDate; end: LocalDate };
  purgedAt: UtcInstant;
  closedReason: CloseReason;
  reviewWindowDays: number;
  deletedCounts: {
    notifications: number;
    cachedDays: number;
    ledgerEntries: number;
    itineraryItems: number;
    liveCopies: number;
  };
  libraryRetained: boolean;
}

const PURGE_RECEIPT_KEYS: ReadonlySet<string> = new Set([
  "tripRef",
  "dates",
  "purgedAt",
  "closedReason",
  "reviewWindowDays",
  "deletedCounts",
  "libraryRetained"
]);

export function parsePurgeReceiptDTO(value: unknown): ParseResult<PurgeReceiptDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["purge receipt: not an object"] };
  for (const key of Object.keys(value)) {
    check(
      errors,
      PURGE_RECEIPT_KEYS.has(key),
      `purge receipt: unexpected field "${key}" — receipts are content-free`
    );
  }
  check(errors, isNonEmptyString(value.tripRef), "receipt.tripRef: required");
  check(
    errors,
    isRecord(value.dates) && isLocalDate(value.dates.start) && isLocalDate(value.dates.end),
    "receipt.dates: invalid"
  );
  check(errors, isUtcInstant(value.purgedAt), "receipt.purgedAt: invalid instant");
  check(
    errors,
    oneOf(["review-submitted", "review-window-expired"] as const, value.closedReason),
    "receipt.closedReason: invalid"
  );
  check(errors, typeof value.libraryRetained === "boolean", "receipt.libraryRetained: invalid");
  if (isRecord(value.deletedCounts)) {
    for (const key of ["notifications", "cachedDays", "ledgerEntries", "itineraryItems", "liveCopies"]) {
      check(
        errors,
        isNonNegativeInt(value.deletedCounts[key]),
        `receipt.deletedCounts.${key}: invalid`
      );
    }
  } else {
    errors.push("receipt.deletedCounts: required");
  }
  return finish(errors, value as unknown as PurgeReceiptDTO);
}

export interface LifecycleStateDTO {
  tripId: string;
  state: LifecycleStateName;
  dates: { start: LocalDate; end: LocalDate };
  reviewWindowDays: number;
  reviewWindowEndsAt: UtcInstant | null;
  endedAt: UtcInstant | null;
  closedAt: UtcInstant | null;
  closedReason: CloseReason | null;
  history: { state: LifecycleStateName; at: UtcInstant | null }[];
  /** Owner ruling 2026-10-21 19:39 ADT: the purchased itinerary is
   *  ARCHIVED in the account, never deleted — the purge deletes the
   *  panel and live copies only. The shadow store deleted the live
   *  itinerary copy outright; production keeps this archive record. */
  archive: { archivedAt: UtcInstant; itineraryRef: string } | null;
  purgeReceipt: PurgeReceiptDTO | null; // M5 — no FK; survives the purge
}

export function parseLifecycleStateDTO(value: unknown): ParseResult<LifecycleStateDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["lifecycle: not an object"] };
  check(errors, isNonEmptyString(value.tripId), "lifecycle.tripId: required");
  check(errors, oneOf(LIFECYCLE_STATES, value.state), "lifecycle.state: invalid");
  check(
    errors,
    isRecord(value.dates) && isLocalDate(value.dates.start) && isLocalDate(value.dates.end),
    "lifecycle.dates: invalid"
  );
  check(errors, isNonNegativeInt(value.reviewWindowDays), "lifecycle.reviewWindowDays: invalid");
  check(errors, Array.isArray(value.history) && value.history.length > 0, "lifecycle.history: required");
  if (Array.isArray(value.history)) {
    // History must be a legal walk through the transition table.
    let prev: LifecycleStateName | null = null;
    value.history.forEach((entry, i) => {
      if (!isRecord(entry) || !oneOf(LIFECYCLE_STATES, entry.state)) {
        errors.push(`lifecycle.history[${i}]: invalid state`);
        return;
      }
      if (prev !== null) {
        check(
          errors,
          LIFECYCLE_TRANSITIONS[prev].includes(entry.state),
          `lifecycle.history[${i}]: illegal transition ${prev} -> ${entry.state}`
        );
      }
      prev = entry.state;
    });
    const last = value.history[value.history.length - 1];
    if (isRecord(last)) {
      check(errors, last.state === value.state, "lifecycle: history does not end at current state");
    }
  }
  if (value.state === "PURGED") {
    check(errors, value.purgeReceipt !== null, "lifecycle: PURGED without a purge receipt");
    check(errors, value.archive !== null, "lifecycle: PURGED without an archive record (19:39 ruling)");
  }
  if (value.purgeReceipt !== null && value.purgeReceipt !== undefined) {
    const receipt = parsePurgeReceiptDTO(value.purgeReceipt);
    if (!receipt.ok) errors.push(...receipt.errors);
  }
  return finish(errors, value as unknown as LifecycleStateDTO);
}

/* ------------------------------------------------------------------ */
/* Budget vs Real (the bot's comparison record)                        */
/* ------------------------------------------------------------------ */

export type RealPriceSource = "PAID" | "LIBRARY" | "LIVE-CHECK";
export type BudgetVsRealVerdict = "INSIDE-RANGE" | "ABOVE" | "BELOW" | "UNVERIFIABLE";
export type BudgetCheckpoint = "BEFORE" | "DURING" | "AFTER";

export interface RealPriceDTO {
  source: RealPriceSource;
  amount: number; // party total (bot normalizes to party; see BOT-REPORT)
  currency: CurrencyCode;
  per: PerBasis;
  observedAt: UtcInstant | null;
  /** LIVE-CHECK older than 24h is STALE: shown, excluded from totals. */
  stale: boolean;
  excludedFromTotals: boolean;
  basis: string;
}

export interface BudgetVsRealItemDTO {
  itemRef: string;
  dayNumber: number;
  name: string;
  estimate: PriceEvidenceDTO;
  real: RealPriceDTO | null; // null iff verdict is UNVERIFIABLE
  verdict: BudgetVsRealVerdict;
  loud: boolean; // real price crossed the cap on this item
}

export interface BudgetVsRealComparisonDTO {
  checkpoint: BudgetCheckpoint;
  at: UtcInstant | null;
  tripRef: string;
  items: BudgetVsRealItemDTO[];
  rollups: {
    realTotal: number | null; // evidenced real spend only — never zero-filled
    unverifiableItems: number;
    byCategory: Record<string, { realTotal: number; items: number }>;
  };
  regrade: {
    verdict: BudgetVerdict;
    totals: MoneyRange | null;
    cap: { amount: number; currency: CurrencyCode } | null;
  };
  loud: boolean; // BUDGET_BUSTED_BY_REAL_PRICES raised at this checkpoint
  calibrationWrites: LibraryPriceRecordDTO[]; // PAID only, VERIFIED shape
}

export function parseBudgetVsRealComparisonDTO(
  value: unknown
): ParseResult<BudgetVsRealComparisonDTO> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["budget-vs-real: not an object"] };
  check(errors, oneOf(["BEFORE", "DURING", "AFTER"] as const, value.checkpoint), "bvr.checkpoint: invalid");
  check(errors, isNonEmptyString(value.tripRef), "bvr.tripRef: required");
  check(errors, Array.isArray(value.items), "bvr.items: must be an array");
  if (Array.isArray(value.items)) {
    value.items.forEach((item, i) => {
      const path = `bvr.items[${i}]`;
      if (!isRecord(item)) {
        errors.push(`${path}: not an object`);
        return;
      }
      check(errors, isNonEmptyString(item.itemRef), `${path}.itemRef: required`);
      check(errors, isPriceEvidenceDTO(item.estimate), `${path}.estimate: invalid`);
      check(
        errors,
        oneOf(["INSIDE-RANGE", "ABOVE", "BELOW", "UNVERIFIABLE"] as const, item.verdict),
        `${path}.verdict: invalid`
      );
      if (item.verdict === "UNVERIFIABLE") {
        check(errors, item.real === null, `${path}: UNVERIFIABLE must carry no real price`);
      } else {
        check(errors, isRecord(item.real), `${path}.real: required for a graded verdict`);
        if (isRecord(item.real)) {
          check(
            errors,
            oneOf(["PAID", "LIBRARY", "LIVE-CHECK"] as const, item.real.source),
            `${path}.real.source: invalid`
          );
          if (item.real.stale === true) {
            check(
              errors,
              item.real.excludedFromTotals === true,
              `${path}.real: a STALE price must be excluded from totals`
            );
          }
        }
      }
    });
  }
  check(errors, Array.isArray(value.calibrationWrites), "bvr.calibrationWrites: must be an array");
  if (Array.isArray(value.calibrationWrites)) {
    value.calibrationWrites.forEach((write, i) => {
      check(errors, isLibraryPriceRecordDTO(write), `bvr.calibrationWrites[${i}]: invalid VERIFIED record`);
    });
  }
  check(errors, typeof value.loud === "boolean", "bvr.loud: must be boolean");
  return finish(errors, value as unknown as BudgetVsRealComparisonDTO);
}
