"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  accommodationOptions,
  bedPreferenceOptions,
  currencyOptions,
  transportationOptions,
  walkingToleranceOptions,
  type TripPlannerPayload,
  type TripType
} from "@/lib/trip-planner";
import {
  isValidPlaceValue,
  matchRecommendedPlace,
  normalizePlaceText,
  popularOriginPlaces,
  recommendedPlaces,
  type NormalizedPlace
} from "@/lib/roamly/places";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
import { useSpringNumber } from "@/components/boardui/spring";
import {
  EntryGate,
  gateFlowSurface,
  getOrCreateGateDeviceId,
  type EntryGateReadiness
} from "@/components/roamly/EntryGate";
import { ALERTS_BLOCK_MESSAGE, INSTALL_BLOCK_MESSAGE } from "@/lib/roamly/gateMachine";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatRoamlyNumber } from "@/lib/i18n";
import {
  fetchWithSupabaseAuth,
  resolveBrowserAuthState,
  subscribeBrowserAuthState,
  syncSupabaseServerSession,
  type BrowserAuthStatus
} from "@/lib/roamly/authenticatedFetch";
import { calculateTripDateRange, shiftIsoDate } from "@/lib/roamly/dateUtils";
import {
  invalidTypedDayCount,
  planDateFieldErrors,
  planEntitlementCopy,
  PLAN_PREFERENCE_DEFAULTS,
  positiveDayCount,
  preferenceStyleSummary,
  syncPlanDates,
  travelerCountPhrase,
  tripLengthCopy
} from "@/lib/roamly/planTripUx";
import { describeBudgetBalanceCents, formatBudgetMoneyCents } from "@/lib/roamly/budget";
import { GUEST_ITINERARY_PATH } from "@/lib/roamly/guestItineraryView";
import { type TransportOption } from "@/lib/roamly/transportOptions";
import { Bus, Car, Check, Plane, Route, TrainFront, type LucideIcon } from "lucide-react";
import {
  applyTransportOptionSelection,
  buildBudgetConstraintForItinerary,
  type BudgetCategoryConfidence,
  type TripPriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import {
  PLAN_DRAFT_KEY,
  browserPlanDraftStorages,
  clearOwnedPlanDraft,
  readRestorablePlanDraft,
  writeOwnedPlanDraft
} from "@/lib/roamly/planDraftStorage";
import { PLANNER_BACKEND_CAPABILITY_GAPS } from "@/lib/roamly/plannerCapabilityGaps";
import { travelerNoteDisplay } from "@/lib/roamly/travelerNotes";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";
import { BuiChip } from "@/components/boardui/Badge";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiClickSpark } from "@/components/boardui/ClickSpark";
import { BuiEnterContent } from "@/components/boardui/EnterContent";
import { BuiFieldError, useBuiField, type BuiField } from "@/components/boardui/Field";
import { BuiMorphButton } from "@/components/boardui/MorphButton";

/**
 * Plan-flow redesign (owner directive 2026-11-03, Airbnb search-flow
 * pattern — Jakob's Law): full-screen sheet, one task at a time.
 * Where -> When -> Who, one at a time; Budget, Preferences and Review
 * follow the same folding pattern after Who. Each completed step folds
 * into ONE summary line the traveller can tap to reopen/edit. The data
 * model, validation rules, payload and API calls are unchanged — only
 * the step PRESENTATION is restructured (Dates & travelers is split
 * into When and Who; the duplicate typed day-count input is gone, the
 * When step is one date-range experience and daysCount stays synced
 * from the range).
 */
const steps = [
  { title: "Where", detail: "Where are you going?" },
  { title: "When", detail: "Pick your dates" },
  { title: "Who", detail: "Who is travelling?" },
  { title: "Budget", detail: "What the total includes" },
  { title: "Preferences", detail: "Pace, access, interests" },
  { title: "Review & generate", detail: "Check costs first" }
];

/** Recent searches (element 5): this browser only, no server calls. */
const PLAN_RECENTS_KEY = "roamly:plan-recents:v1";
const PLAN_RECENTS_MAX = 5;

type PlanRecentSearch = {
  destinationLabel: string;
  originLabel: string;
  startDate: string;
  endDate: string;
  adults: string;
  children: string;
  rooms: string;
  savedAt: number;
};

function readPlanRecents(): PlanRecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PLAN_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is PlanRecentSearch => {
        const record = item as Record<string, unknown> | null;
        return Boolean(record && typeof record.destinationLabel === "string" && record.destinationLabel.trim());
      })
      .slice(0, PLAN_RECENTS_MAX);
  } catch {
    return [];
  }
}

function writePlanRecent(recent: PlanRecentSearch) {
  if (typeof window === "undefined") return;
  try {
    const key = `${recent.destinationLabel.toLowerCase()}|${recent.startDate}|${recent.endDate}`;
    const rest = readPlanRecents().filter(
      (item) => `${item.destinationLabel.toLowerCase()}|${item.startDate}|${item.endDate}` !== key
    );
    window.localStorage.setItem(PLAN_RECENTS_KEY, JSON.stringify([recent, ...rest].slice(0, PLAN_RECENTS_MAX)));
  } catch {
    // Recents are a convenience only; storage failure never blocks planning.
  }
}

const planningTravelStyles = ["Budget", "Balanced", "Premium"] as const;
const planningPaces = ["Relaxed", "Balanced", "Packed"] as const;
const planningInterests = [
  "Culture",
  "Food",
  "Nightlife",
  "Nature",
  "Shopping",
  "Museums",
  "Beaches",
  "Family",
  "Adventure",
  "Romance",
  "Business"
] as const;

type StopItem = {
  id: string;
  place: NormalizedPlace | null;
};

type PriceDiscoveryResult = {
  flightEstimateCents: number;
  hotelEstimateCents: number;
  activitiesEstimateCents: number;
  foodEstimateCents: number;
  localTransportEstimateCents: number;
  selectedTransportEstimateCents?: number;
  bufferEstimateCents: number;
  totalEstimateCents: number;
  committedBudgetCents: number;
  remainingBudgetCents: number | null;
  budgetStatus: "within_budget" | "tight" | "over_budget" | "unknown";
  budgetCurrency: string;
  coverageNote: string;
  recommendedTransportOption?: TransportOption | null;
  transportSelection?: { mode: TransportOption["mode"]; title: string; selectedBy: "traveler" } | null;
  transportOptions?: TransportOption[];
  transportAssumptions?: string[];
  hotelEstimateNote?: string;
  budgetCategoryConfidence?: BudgetCategoryConfidence[];
  unknownMarketPriceCount?: number;
  priceCoverage?: "market" | "partial" | "fallback";
  cross_border?: boolean;
  crossBorderWarnings?: string[];
  originCurrency?: string;
  destinationCurrency?: string;
  currencyChange?: boolean;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toNumberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function readIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : "";
}

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

const primaryActionClass =
  "bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)] transition hover:bg-[#0A6FE0] disabled:opacity-60";
const selectedPrimaryOptionClass =
  "border-cblue bg-cblue text-white shadow-[0_8px_20px_rgba(8,123,255,0.22)]";
const selectedWarmOptionClass =
  "border-corange bg-[#FFF1E6] text-[#8F4512] shadow-[0_8px_20px_rgba(255,121,61,0.14)]";
const unselectedOptionClass =
  "border-chair bg-white text-cink hover:border-cblue/50 hover:text-cblue";
const GENERATION_ERROR_MESSAGE = "Roamly could not finish itinerary generation. Please try again in a moment.";
const AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
const PLAN_RESUME_PATH = "/plan?resumePlan=1&continueGenerate=1";

function selectedOptionClass(label: string) {
  return ["Food", "Nightlife", "Romance", "Premium"].includes(label)
    ? selectedWarmOptionClass
    : selectedPrimaryOptionClass;
}

function planAuthUrl(pathname: "/login" | "/signup") {
  return `${pathname}?next=${encodeURIComponent(PLAN_RESUME_PATH)}`;
}

function planLoginUrl() {
  return planAuthUrl("/login");
}

function cleanTripId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameOriginTripPath(previewUrl: unknown, tripIdValue: unknown) {
  const tripId = cleanTripId(tripIdValue);
  const fallbackPath = tripId ? `/trip/${encodeURIComponent(tripId)}` : "/dashboard";
  const rawPath = typeof previewUrl === "string" && previewUrl.trim() ? previewUrl.trim() : fallbackPath;

  try {
    const url = new URL(rawPath, window.location.origin);
    const path = `${url.pathname}${url.search}${url.hash}`;

    if (!tripId) return path.startsWith("/trip/") ? path : fallbackPath;

    const expectedPath = `/trip/${encodeURIComponent(tripId)}`;
    if (
      path === expectedPath ||
      path.startsWith(`${expectedPath}?`) ||
      path.startsWith(`${expectedPath}#`) ||
      path.startsWith(`${expectedPath}/`)
    ) {
      return path;
    }

    return fallbackPath;
  } catch {
    return fallbackPath;
  }
}

async function openTripAfterSessionSync(
  router: ReturnType<typeof useRouter>,
  previewUrl: unknown,
  tripId: unknown
) {
  const tripPath = sameOriginTripPath(previewUrl, tripId);

  await syncSupabaseServerSession({ refresh: true });

  router.replace(tripPath);
  router.refresh();
}

function defaultStops(): StopItem[] {
  return [
    { id: "stop-1", place: null },
    { id: "stop-2", place: null }
  ];
}

function clampStep(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(steps.length - 1, Math.max(0, Math.round(parsed)));
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readDraftString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readDraftBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readDraftStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : fallback;
}

function readDraftOption<T extends readonly string[]>(value: unknown, options: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value : fallback;
}

function readDraftTripType(value: unknown): TripType {
  return value === "multi_city" ? "multi_city" : "single_destination";
}

function readDraftNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDraftPlace(value: unknown): NormalizedPlace | null {
  if (typeof value === "string") {
    const text = normalizePlaceText(value);
    return text.length >= 2 ? { label: text, value: text, source: "custom" } : null;
  }

  const record = getRecord(value);
  if (!record) return null;

  const label = readDraftString(record.label || record.value || record.formatted_address);
  const placeValue = readDraftString(record.value || record.label || record.formatted_address);
  const normalized = normalizePlaceText(placeValue || label);
  if (normalized.length < 2) return null;
  const source = record.source === "google" || record.source === "local" ? record.source : "custom";

  return {
    label: label || normalized,
    value: normalized,
    city: readDraftString(record.city) || undefined,
    region: readDraftString(record.region) || undefined,
    country: readDraftString(record.country) || undefined,
    place_id: readDraftString(record.place_id || record.placeId) || undefined,
    latitude: readDraftNumber(record.latitude),
    longitude: readDraftNumber(record.longitude),
    formatted_address: readDraftString(record.formatted_address || record.formattedAddress) || undefined,
    currency: readDraftString(record.currency) || undefined,
    timezone: readDraftString(record.timezone) || undefined,
    source
  };
}

const CARRIED_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCarriedIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${CARRIED_MONTH_LABELS[month - 1]} ${day}`;
}

// Fix round D4: the quiet Step 1 line naming what a hero deep link carried
// in, so the traveller can see their homepage answers survived. Built only
// from values the hero branches actually applied; "" when nothing beyond
// the destination was carried (the destination shows in its own field).
// The hero sends dates and travellers only — origin is asked once, on
// Step 1 itself, and is optional there (Fix 2 correction).
function heroCarriedSummary(startDate: string, endDate: string, travelers: number | null) {
  const parts: string[] = [];
  if (startDate && endDate) {
    const start = formatCarriedIsoDate(startDate);
    const end = formatCarriedIsoDate(endDate);
    if (start && end) parts.push(`${start} – ${end}`);
  }
  if (travelers) parts.push(`${travelers} ${travelers === 1 ? "traveller" : "travellers"}`);
  return parts.length ? `From your search: ${parts.join(" · ")}` : "";
}

function readDraftStops(record: Record<string, unknown>) {
  const rawStopItems = Array.isArray(record.stopItems)
    ? record.stopItems
    : Array.isArray(record.stops)
      ? record.stops
      : null;

  if (rawStopItems) {
    const restored = rawStopItems
      .map((item, index) => {
        const stop = getRecord(item);
        const id = readDraftString(stop?.id, `stop-${index + 1}`);
        return { id, place: readDraftPlace(stop?.place) };
      })
      .slice(0, 12);
    while (restored.length < 2) restored.push({ id: `stop-${restored.length + 1}`, place: null });
    return restored;
  }

  const rawStops = Array.isArray(record.destinationStops)
    ? record.destinationStops
    : Array.isArray(record.destination_stops)
      ? record.destination_stops
      : [];
  const restored = rawStops
    .map((item, index) => ({ id: `stop-${index + 1}`, place: readDraftPlace(item) }))
    .filter((stop) => stop.place)
    .slice(0, 12);
  while (restored.length < 2) restored.push({ id: `stop-${restored.length + 1}`, place: null });
  return restored;
}

function readDraftPriceDiscovery(value: unknown) {
  const record = getRecord(value);
  return record ? (record as unknown as PriceDiscoveryResult) : null;
}

function getVisitorKey() {
  if (typeof window === "undefined") return "";
  const key = "roamly_visitor_key";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function trackPlanEvent(eventType: string, metadata: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  void fetch("/api/roamly/events/app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      visitorKey: getVisitorKey(),
      eventType,
      path: window.location.pathname,
      url: window.location.href,
      title: document.title,
      referrer: document.referrer,
      platform: navigator.platform,
      language: navigator.language,
      metadata
    })
  }).catch(() => undefined);
}

function isCurrencyOption(value: string | undefined): value is (typeof currencyOptions)[number] {
  return Boolean(value && (currencyOptions as readonly string[]).includes(value));
}

function placeValue(place: NormalizedPlace | null) {
  return normalizePlaceText(place?.value || place?.label || "");
}

function tripDateValidationMessage(startDate: string, endDate: string, daysRaw: string) {
  const synced = syncPlanDates(startDate, endDate, daysRaw);
  const fieldErrors = planDateFieldErrors(synced.startDate, synced.endDate, daysRaw);
  return fieldErrors.start || fieldErrors.end || fieldErrors.days;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-black text-chead">{children}</span>;
}

function formatMoney(cents: number | null, currency: string) {
  return formatBudgetMoneyCents(cents, currency);
}

function formatTransportMoney(amount: number | null | undefined, currency: string, locale: Parameters<typeof formatRoamlyNumber>[1]) {
  if (amount == null || !Number.isFinite(amount)) return "Search-ready";
  return `${currency} ${formatRoamlyNumber(Math.round(amount), locale)}`;
}

function formatTransportOption(option: TransportOption | null | undefined, fallbackCurrency: string, locale: Parameters<typeof formatRoamlyNumber>[1]) {
  if (!option) return "Compare transport before booking.";
  const currency = option.currency || fallbackCurrency;
  const min = formatTransportMoney(option.estimated_cost_min, currency, locale);
  const max = formatTransportMoney(option.estimated_cost_max, currency, locale);
  const range = option.estimated_cost_min != null && option.estimated_cost_max != null ? `${min}-${max}` : min !== "Search-ready" ? min : max;
  return `${option.title}: ${range}. ${option.why_recommended}`;
}

/**
 * Transport prompt face (owner prompt law, 2026-11-08): the selector is
 * ONE question + radio-card option boxes. Per box the ceiling is the
 * mode name, the duration, the price — plus at most ONE short line on
 * the suggested option. Every internal state (availability, rule ids,
 * price-confidence tiers) stays in the data model and off the face.
 * The card recipe is BoardUI's radio-card family (see
 * components/boardui/Card.tsx): squircle radius, hairline border,
 * layered soft shadow, press/lift primitives.
 */
const TRANSPORT_MODE_FACE: Record<TransportOption["mode"], { label: string; noun: string; Icon: LucideIcon }> = {
  flight: { label: "Fly", noun: "Flight", Icon: Plane },
  drive: { label: "Drive", noun: "Drive", Icon: Car },
  train: { label: "Train", noun: "Train", Icon: TrainFront },
  bus: { label: "Bus", noun: "Bus", Icon: Bus },
  mixed: { label: "Drive + fly", noun: "Mixed route", Icon: Route }
};

function formatTransportDurationFace(option: TransportOption) {
  if (option.estimated_duration_hours == null || !Number.isFinite(option.estimated_duration_hours)) return "";
  const totalMinutes = Math.round((option.estimated_duration_hours * 60) / 5) * 5;
  if (totalMinutes <= 0) return "";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function formatTransportPriceFace(
  option: TransportOption,
  fallbackCurrency: string,
  locale: Parameters<typeof formatRoamlyNumber>[1]
) {
  const currency = option.currency || fallbackCurrency;
  const min = option.estimated_cost_min;
  const max = option.estimated_cost_max;
  if (min != null && max != null && min !== max) {
    return `${currency} ${formatRoamlyNumber(Math.round(min), locale)}–${formatRoamlyNumber(Math.round(max), locale)}`;
  }
  const single = max ?? min;
  return single != null ? `${currency} ${formatRoamlyNumber(Math.round(single), locale)}` : "";
}

/** One quiet provenance attribution for the line under the options —
 *  short form only; the full provenance string stays in the data. */
function transportProvenanceShort(option: TransportOption) {
  if (option.mode === "drive" || (option.mode === "mixed" && option.cost_breakdown?.gas != null)) {
    return "Gas uses Canada's official fuel ratings";
  }
  const face = TRANSPORT_MODE_FACE[option.mode];
  if (option.price_confidence === "live_partner" || option.price_confidence === "cached_recent") {
    return `${face.noun} price from ${option.source}`;
  }
  return `${face.noun} price is a Roamly estimate`;
}

function confidenceFor(discovery: PriceDiscoveryResult, category: BudgetCategoryConfidence["category"]) {
  return discovery.budgetCategoryConfidence?.find((item) => item.category === category);
}

function budgetValueWithConfidence(discovery: PriceDiscoveryResult, category: BudgetCategoryConfidence["category"], cents: number | null | undefined) {
  const confidence = confidenceFor(discovery, category);
  const value = formatMoney(cents ?? null, discovery.budgetCurrency);
  return confidence ? `${value} · ${confidence.label}` : value;
}

function budgetStatusCopy(status: PriceDiscoveryResult["budgetStatus"]) {
  if (status === "unknown") {
    return "Add a total budget to compare this estimate against your comfort zone.";
  }
  if (status === "tight") {
    return "Your budget is tight. Roamly will prioritize affordable stays, free attractions, public transit, and low-cost food.";
  }
  if (status === "over_budget") {
    return "This trip may exceed your budget. Roamly will compare driving, train, bus, mixed airport routes, lower-cost stays, fewer paid activities, or a higher budget.";
  }
  return "Your trip looks possible within budget.";
}

function TextInput({
  value,
  onChange,
  ariaLabel,
  type = "text",
  min,
  disabled,
  id,
  field,
  inputMode,
  onBlurExtra
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  type?: "text" | "date" | "number";
  min?: string | number;
  disabled?: boolean;
  id?: string;
  field?: BuiField;
  inputMode?: "decimal" | "numeric" | "text";
  onBlurExtra?: () => void;
}) {

return (
    <input
      id={id}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        field?.onChange(event.target.value);
      }}
      onBlur={() => {
        field?.onBlur(value);
        onBlurExtra?.();
      }}
      type={type}
      min={min ?? (type === "date" ? todayIsoDate() : undefined)}
      inputMode={inputMode}
      aria-label={ariaLabel}
      aria-invalid={field?.error ? true : undefined}
      aria-describedby={field?.error && id ? `${id}-error` : undefined}
      disabled={disabled}
      className={`bui-input mt-2 min-h-12 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${field?.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"}${disabled ? " cursor-not-allowed opacity-60" : ""}`}
    />
  );
}

function SelectField({
  value,
  onChange,
  options,
  defaultValue
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  defaultValue?: string;
}) {
  const { translateText } = useI18n();

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="bui-input mt-2 min-h-12 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {translateText(option)}
          {option === defaultValue ? ` (${translateText("default")})` : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * Batch 6 (BoardUI hard-apply — plan flow): one labelled field on
 * the BoardUI form pattern, wired exactly like batch 3's
 * BookingField and batch 4's PackageField. A real visible label
 * that never leaves (never placeholder-as-label), the foundation
 * `bui-input` recipe (16px text, styled autofill), and — for
 * fields with a validator — the reserved BuiFieldError slot under
 * the input, so an error appearing never pushes the layout or the
 * footer buttons down. Validation runs on blur via useBuiField;
 * once a field has errored, every keystroke re-checks so the
 * error clears the moment it is fixed. Callers key the field by
 * `field.shakeKey` so a new error shakes (form rule: wrong input
 * shakes). The plan form's slots reserve TWO lines
 * (reserveLines={2}): its messages are full sentences ("Please
 * enter a realistic trip budget (at least 100 CAD).") that wrap
 * to two lines at phone width — measured 2026-11-03, when a
 * one-line slot still let the block below shift by one line
 * (20px). That reservation used to live in a local FieldError;
 * it now lives in the primitive. The historical slot ids
 * (plan-start-date-error, plan-end-date-error, plan-days-error,
 * plan-budget-error) are preserved verbatim.
 */
function PlanField({
  label,
  value,
  onChange,
  ariaLabel,
  type = "text",
  min,
  disabled,
  id,
  field,
  errorId,
  inputMode,
  onBlurExtra,
  className,
  children
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  type?: "text" | "date" | "number";
  min?: string | number;
  disabled?: boolean;
  id?: string;
  field?: BuiField;
  errorId?: string;
  inputMode?: "decimal" | "numeric" | "text";
  onBlurExtra?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const { translateText } = useI18n();
  return (
    <label className={(field && field.shakeKey > 0 ? "bui-shake block" : "block") + (className ? ` ${className}` : "")}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        id={id}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        type={type}
        min={min}
        disabled={disabled}
        field={field}
        inputMode={inputMode}
        onBlurExtra={onBlurExtra}
      />
      {field && errorId ? (
        <BuiFieldError id={errorId} message={field.error ? translateText(field.error) : ""} reserveLines={2} />
      ) : null}
      {children}
    </label>
  );
}

/** A labelled select on the same pattern. Selects carry no
 *  validators on this form, so there is no error slot — the label
 *  and the input recipe are the BoardUI surface here. */
function PlanSelectField({
  label,
  value,
  onChange,
  options,
  defaultValue,
  className
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <label className={"block" + (className ? ` ${className}` : "")}>
      <FieldLabel>{label}</FieldLabel>
      <SelectField value={value} onChange={onChange} options={options} defaultValue={defaultValue} />
    </label>
  );
}

/** The labelled textarea (Special notes) on the same pattern,
 *  with its calm helper line under the field. */
function PlanAreaField({
  label,
  value,
  onChange,
  ariaLabel,
  helper,
  className
}: {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  helper?: string;
  className?: string;
}) {
  return (
    <label className={"block" + (className ? ` ${className}` : "")}>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        aria-label={ariaLabel}
        className="bui-input mt-2 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold leading-7 text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10"
      />
      {helper ? <p className="mt-2 text-xs leading-5 text-cgray">{helper}</p> : null}
    </label>
  );
}

function Chip({
  label,
  selected,
  onClick,
  isDefault = false
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  isDefault?: boolean;
}) {
  const { translateText } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={classNames(
        "min-h-12 rounded-xl border px-4 py-3 text-left text-sm font-bold transition",
        selected ? selectedOptionClass(label) : unselectedOptionClass
      )}
    >
      <span className="block">{translateText(label)}</span>
      {isDefault ? (
        <span className={classNames("mt-0.5 block text-[0.68rem] font-semibold", selected ? "text-white/80" : "text-cgray")}>
          {translateText("Default")}
        </span>
      ) : null}
    </button>
  );
}

function ToggleButton({
  label,
  enabled,
  onToggle
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  const { translateText } = useI18n();
  /* Feels-right phone set + iPhone-feel springs (2026-11-04): the
   * knob rides the foundation spring (spring.ts) — it STRETCHES
   * with its own velocity mid-travel, overshoots its landing by
   * ~1.5%, and settles; a tap mid-travel reverses it from wherever
   * it is, because the spring retargets with velocity intact. */
  const knob = useSpringNumber(enabled ? 18 : 0, {
    stiffness: 380,
    dampingRatio: 0.8,
    restDelta: 0.02,
    restVelocity: 2
  });
  const stretchPx = Math.min(Math.abs(knob.velocity) / 55, 5.5);
  const knobWidth = 20 + stretchPx;
  /* Growth extends toward the direction of travel and never past
   * the track's inner edge (track 44 - base left 2 - knob 20). */
  const knobX = Math.max(0, Math.min(knob.value, 22 - stretchPx));
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className="bui-tap flex min-h-12 items-center justify-between gap-3 rounded-xl border border-chair bg-white px-4 py-3 text-left text-sm font-semibold text-cink transition hover:border-cblue/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/20"
    >
      <span>{translateText(label)}</span>
      <span
        aria-hidden="true"
        className={classNames(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none",
          enabled ? "bg-cblue" : "bg-cgray2"
        )}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 rounded-full bg-white shadow-sm"
          style={{ width: `${knobWidth}px`, transform: `translateX(${knobX}px)` }}
        />
      </span>
    </button>
  );
}

function StepperField({
  label,
  value,
  min,
  onChange
}: {
  label: string;
  value: string;
  min: number;
  onChange: (value: string) => void;
}) {
  const { translateText } = useI18n();
  // Bounds match the previous typed fields exactly: a floor (min) and no
  // ceiling — the old number inputs carried a min attribute and no max,
  // and step validation only enforces the same floors.
  const count = Math.max(0, toInteger(value, min));
  return (
    <div>
      <FieldLabel>{translateText(label)}</FieldLabel>
      <div className="mt-2 flex min-h-12 items-center justify-between gap-2 rounded-xl border border-chair bg-white px-1.5 py-1">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={count <= min}
          onClick={() => onChange(String(count - 1))}
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-xl font-black text-cink transition hover:bg-csoft hover:text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/20 disabled:opacity-40"
        >
          <span aria-hidden="true">−</span>
        </button>
        <span aria-live="polite" aria-label={label} className="min-w-8 text-center text-base font-bold text-chead">
          {count}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(String(count + 1))}
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-xl font-black text-cink transition hover:bg-csoft hover:text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/20"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}

function StepError({ error }: { error: string }) {
  if (!error) return null;
  return <BuiNotice tone="error" title={error} />;
}

/**
 * BoardUI number-field pattern for the Who step: minus / value / plus,
 * 44px targets, writing to the SAME string state fields the typed
 * inputs wrote to before (adults / children / infants / rooms).
 */
function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  hint
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  hint?: string;
}) {
  const { translateText } = useI18n();
  const current = toInteger(value, min);
  const stepBy = (delta: number) => {
    const next = Math.min(max, Math.max(min, current + delta));
    onChange(String(next));
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-chair bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-black text-chead">{translateText(label)}</p>
        {hint ? <p className="text-xs font-semibold text-cgray">{translateText(hint)}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${translateText("Fewer")} ${translateText(label)}`}
          onClick={() => stepBy(-1)}
          disabled={current <= min}
          className="bui-press bui-tap bui-touch-square inline-flex h-11 w-11 items-center justify-center rounded-full border border-chair bg-white text-lg font-black text-cblue transition hover:border-cblue/50 disabled:opacity-40"
        >
          −
        </button>
        <span aria-live="polite" className="bui-display-number w-8 text-center text-base font-black text-chead">
          {current}
        </span>
        <button
          type="button"
          aria-label={`${translateText("More")} ${translateText(label)}`}
          onClick={() => stepBy(1)}
          disabled={current >= max}
          className="bui-press bui-tap bui-touch-square inline-flex h-11 w-11 items-center justify-center rounded-full border border-chair bg-white text-lg font-black text-cblue transition hover:border-cblue/50 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** One folded summary line for a completed step; tap reopens it. */
function FoldedStepLine({
  title,
  summary,
  onEdit
}: {
  title: string;
  summary: string;
  onEdit: () => void;
}) {
  const { translateText } = useI18n();
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${translateText("Edit")} ${translateText(title)}: ${summary}`}
      className="bui-press flex w-full items-center justify-between gap-3 rounded-xl border border-chair bg-white px-4 py-3 text-left shadow-bui-card transition hover:border-cblue/40"
    >
      <span className="min-w-0">
        <span className="block text-[0.68rem] font-black uppercase tracking-[0.12em] text-cgray">{translateText(title)}</span>
        <span className="mt-0.5 block truncate text-sm font-bold text-chead">{summary}</span>
      </span>
      <span className="shrink-0 text-sm font-black text-cblue">{translateText("Edit")}</span>
    </button>
  );
}

export function TripPlanForm(props: {
  freeItineraryUsed?: boolean;
  testerAccess?: boolean;
  apiAuthToken?: string;
  build2GatesEnabled?: boolean;
  secondTimeGateNotice?: boolean;
}) {
  const [sessionKey, setSessionKey] = useState(0);
  return <TripPlanFormSession key={sessionKey} {...props} onStartNew={() => setSessionKey((value) => value + 1)} />;
}

function TripPlanFormSession({
  freeItineraryUsed = false,
  testerAccess = false,
  apiAuthToken = "",
  build2GatesEnabled = false,
  secondTimeGateNotice = false,
  onStartNew
}: {
  onStartNew: () => void;
  freeItineraryUsed?: boolean;
  testerAccess?: boolean;
  apiAuthToken?: string;
  build2GatesEnabled?: boolean;
  secondTimeGateNotice?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, translateText } = useI18n();
  const shouldShowResumeNotice = searchParams.get("resumePlan") === "1";
  const shouldContinueGenerate = searchParams.get("continueGenerate") === "1";
  const bookingFallbackSource = searchParams.get("source") === "booking_fallback";
  const queryDestination = searchParams.get("destination") || "";
  const fallbackDestination = searchParams.get("destination") || "";
  const fallbackOrigin = searchParams.get("origin") || "";
  const fallbackStartDate = readIsoDate(searchParams.get("startDate") || searchParams.get("checkInDate"));
  const fallbackEndDate = readIsoDate(searchParams.get("endDate") || searchParams.get("checkOutDate"));
  const fallbackCategory = searchParams.get("category") || "travel";
  // Hero search bar (A9) sends one total traveller count. It maps onto the
  // existing adults count — children/infants keep their form defaults —
  // because the plan form's traveller split has no single-count param today.
  const parsedQueryTravelers = Number(searchParams.get("travelers") || "");
  const queryTravelersCount =
    Number.isFinite(parsedQueryTravelers) && parsedQueryTravelers >= 1 ? Math.floor(parsedQueryTravelers) : null;
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [recentSearches, setRecentSearches] = useState<PlanRecentSearch[]>([]);
  // Phase 6 entry gates: the EntryGate component reports readiness;
  // submitPlan refuses while an applicable gate is red, and the
  // generate route enforces the same attestation server-side.
  const [gateReadiness, setGateReadiness] = useState<EntryGateReadiness>({
    applicable: false,
    ready: true,
    reason: null,
    deviceId: null
  });
  const [originPlace, setOriginPlace] = useState<NormalizedPlace | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<NormalizedPlace | null>(null);
  // Fix round D4: snapshot of what a hero deep link carried in (dates,
  // travellers), shown as one quiet line on Step 1. Cleared when the
  // traveller resumes a previous draft, refills from a recent search, or
  // starts over — the values on screen are no longer the hero's then.
  const [carriedSummary, setCarriedSummary] = useState("");
  const [tripType, setTripType] = useState<TripType>("single_destination");
  const [stops, setStops] = useState<StopItem[]>(() => defaultStops());
  const [returnToOrigin, setReturnToOrigin] = useState(true);
  const [flexibleCityOrder, setFlexibleCityOrder] = useState(false);
  const [flexibleDates, setFlexibleDates] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [daysCount, setDaysCount] = useState("");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [infants, setInfants] = useState("0");
  const [rooms, setRooms] = useState("1");
  const [bedPreference, setBedPreference] = useState<(typeof bedPreferenceOptions)[number]>("No preference");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<(typeof currencyOptions)[number]>("CAD");
  const [budgetIncludesFlights, setBudgetIncludesFlights] = useState(true);
  const [budgetIncludesHotel, setBudgetIncludesHotel] = useState(true);
  const [budgetIncludesActivities, setBudgetIncludesActivities] = useState(true);
  const [travelStyle, setTravelStyle] = useState<(typeof planningTravelStyles)[number]>(PLAN_PREFERENCE_DEFAULTS.travelStyle);
  const [interests, setInterests] = useState<string[]>([]);
  const [pace, setPace] = useState<(typeof planningPaces)[number]>(PLAN_PREFERENCE_DEFAULTS.pace);
  const [walkingTolerance, setWalkingTolerance] = useState<(typeof walkingToleranceOptions)[number]>(PLAN_PREFERENCE_DEFAULTS.walkingTolerance);
  const [accommodationPreference, setAccommodationPreference] =
    useState<(typeof accommodationOptions)[number]>(PLAN_PREFERENCE_DEFAULTS.accommodation);
  const [transportationPreference, setTransportationPreference] =
    useState<(typeof transportationOptions)[number]>(PLAN_PREFERENCE_DEFAULTS.transportation);
  const [accessibilityNeeds, setAccessibilityNeeds] = useState("");
  const [dietaryPreference, setDietaryPreference] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [priceChecking, setPriceChecking] = useState(false);
  const [priceDiscovery, setPriceDiscovery] = useState<PriceDiscoveryResult | null>(null);
  const [priceDiscoveryId, setPriceDiscoveryId] = useState<string | null>(null);
  const [budgetConstraint, setBudgetConstraint] = useState("");
  const [restoreNotice, setRestoreNotice] = useState(false);
  const [previousDraft, setPreviousDraft] = useState<Record<string, unknown> | null>(null);
  const [draftHydratedState, setDraftHydratedState] = useState(false);
  const [browserAuthReady, setBrowserAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [authStatus, setAuthStatus] = useState<BrowserAuthStatus>(apiAuthToken ? "authenticated" : "loading");
  const trackedSelections = useRef(new Set<string>());
  const generationInFlight = useRef(false);
  const draftHydrated = useRef(false);
  const resumeGenerateAttempted = useRef(false);
  const submitPlanRef = useRef<(() => Promise<void>) | null>(null);
  const skipNextDraftSave = useRef(false);
  const holdDraftSave = useRef(false);
  const signedIn = Boolean(apiAuthToken) || Boolean(sessionUser);
  const accountFreeUsed = signedIn && freeItineraryUsed;
  const requiresPaidUnlock = accountFreeUsed && !testerAccess;
  const jsonHeaders = useCallback(() => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiAuthToken) headers["x-roamly-session-token"] = apiAuthToken;
    return headers;
  }, [apiAuthToken]);

  const isCheckingSession = authStatus === "loading";

  const resolveSessionUser = useCallback(async ({ refresh = false }: { refresh?: boolean } = {}) => {
    if (typeof window === "undefined") return null;
    if (apiAuthToken) {
      setAuthStatus("authenticated");
      return sessionUser;
    }

    const auth = await resolveBrowserAuthState({ refresh });
    setAuthStatus(auth.status);
    setSessionUser(auth.user);
    return auth.user;
  }, [apiAuthToken, sessionUser]);

  useEffect(() => {
    trackPlanEvent("plan_started");
  }, []);

  useEffect(() => {
    setRecentSearches(readPlanRecents());
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeBrowserAuthState((snapshot) => {
      setAuthStatus(apiAuthToken ? "authenticated" : snapshot.status);
      setSessionUser(snapshot.user);
      if (snapshot.status !== "loading") setBrowserAuthReady(true);
    });
    void resolveBrowserAuthState();
    return unsubscribe;
  }, [apiAuthToken]);

  useEffect(() => {
    if (!shouldShowResumeNotice) return;
    if (authStatus !== "loading") return;
    void resolveSessionUser();
  }, [authStatus, resolveSessionUser, shouldShowResumeNotice]);

  const validStops = useMemo(() => stops.map((stop) => stop.place).filter((place): place is NormalizedPlace => isValidPlaceValue(place?.value)), [stops]);
  const entitlement = planEntitlementCopy({
    signedIn,
    freeItineraryUsed: accountFreeUsed,
    testerAccess,
    // The traveler's own selected destinations — the same rule the server
    // prices by (lib/roamly/billing.ts isPhilippinesTrip): pesos ONLY when
    // every stop is in the Philippines. A multi-country trip prices in
    // CAD no matter which end the Philippines sits on, so the planner
    // flag must never use the final stop alone.
    isPhilippinesTrip:
      tripType === "single_destination"
        ? destinationPlace?.country === "Philippines"
        : validStops.length > 0 && validStops.every((place) => place.country === "Philippines")
  });
  const normalizedDestination = useMemo(() => {
    if (tripType === "multi_city") return validStops.map((place) => place.value).join(" \u2192 ");
    return placeValue(destinationPlace);
  }, [destinationPlace, tripType, validStops]);
  const routePreview = useMemo(() => {
    const items = [placeValue(originPlace), ...(tripType === "multi_city" ? validStops.map((place) => place.value) : [normalizedDestination])].filter(Boolean);
    if (returnToOrigin && originPlace && tripType === "multi_city") items.push(placeValue(originPlace));
    return items.join(" \u2192 ");
  }, [normalizedDestination, originPlace, returnToOrigin, tripType, validStops]);

  const adultCount = Math.max(0, toInteger(adults, 1));
  const childCount = Math.max(0, toInteger(children, 0));
  const infantCount = Math.max(0, toInteger(infants, 0));
  const roomCount = Math.max(1, toInteger(rooms, 1));
  const travelersCount = Math.max(1, adultCount + childCount + infantCount);
  const tripDateRange = calculateTripDateRange(startDate, endDate);
  const resolvedDaysCount = tripDateRange.ok
    ? tripDateRange.days || 1
    : tripDateRange.errorCode === "MISSING_DATES"
      ? positiveDayCount(daysCount)
      : null;
  const progress = Math.round(((step + 1) / steps.length) * 100);

  /* Batch 6 (BoardUI hard-apply — plan flow): the When dates and
     the Budget amount carry useBuiField state on the batch 3/4
     pattern — validate on blur, re-check per keystroke once
     errored, the message in the field's own reserved slot. The
     validators reproduce validateStep's own messages verbatim and
     the checks themselves are unchanged: validateStep + the step
     error string still gate Continue exactly as before. The date
     validators mirror tripDateValidationMessage's synced
     computation with the field's own value swapped in, so a
     field's message is always the step check's message for that
     field. */
  const startDateField = useBuiField((value) => {
    const synced = syncPlanDates(value, endDate, daysCount);
    return planDateFieldErrors(synced.startDate, synced.endDate, daysCount).start;
  });
  const endDateField = useBuiField((value) => {
    const synced = syncPlanDates(startDate, value, daysCount);
    return planDateFieldErrors(synced.startDate, synced.endDate, daysCount).end;
  });
  const daysField = useBuiField((value) => {
    const synced = syncPlanDates(startDate, endDate, value);
    return planDateFieldErrors(synced.startDate, synced.endDate, value).days;
  });
  const budgetField = useBuiField((value) => {
    const amount = toNumberOrNull(value);
    if (amount == null || amount <= 0) return "Add an estimated budget.";
    if (amount < 100) return `Please enter a realistic trip budget (at least 100 ${budgetCurrency}).`;
    return "";
  });

  function validateDateFields() {
    startDateField.runValidation(startDate);
    endDateField.runValidation(endDate);
    daysField.runValidation(daysCount);
  }

  /* The When card is ONE composite field: editing either date can
     create or clear a sibling's message (updateStartDate also
     moves the end date). While any date field is being watched,
     settled state re-runs all three validators, so no slot ever
     shows a stale message — the same freshness the old render-time
     derivation had, kept now that the errors are field-owned. */
  useEffect(() => {
    if (!startDateField.watching && !endDateField.watching && !daysField.watching) return;
    startDateField.runValidation(startDate);
    endDateField.runValidation(endDate);
    daysField.runValidation(daysCount);
    // The field objects are re-created every render; the effect is
    // keyed on the settled date state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, daysCount]);

  function resetDiscovery() {
    setPriceDiscovery(null);
    setPriceDiscoveryId(null);
    setBudgetConstraint("");
  }

  function notePlanEdit() {
    if (holdDraftSave.current) holdDraftSave.current = false;
  }

  function refreshDateError(start: string, end: string, days: string) {
    setError((current) => {
      if (!current) return current;
      if (current.startsWith("Add at least")) return current;
      return tripDateValidationMessage(start, end, days);
    });
  }

  function updateStartDate(value: string) {
    notePlanEdit();
    const currentLength = positiveDayCount(daysCount) ?? (tripDateRange.ok ? tripDateRange.days : null);
    const end = value && currentLength ? shiftIsoDate(value, currentLength - 1) : null;
    const nextEnd = end || endDate;
    setStartDate(value);
    if (end) setEndDate(end);
    refreshDateError(value, nextEnd, currentLength ? String(currentLength) : daysCount);
    resetDiscovery();
  }

  function updateEndDate(value: string) {
    notePlanEdit();
    const range = calculateTripDateRange(startDate, value);
    const nextDays = range.ok && range.days ? String(range.days) : daysCount;
    setEndDate(value);
    if (range.ok && range.days) setDaysCount(nextDays);
    refreshDateError(startDate, value, nextDays);
    resetDiscovery();
  }

  // A10: there is intentionally no updateDaysCount. Days/nights are a
  // computed readout of the start/end range only — setDaysCount is written
  // by the date updaters above and by draft restore, never by a third
  // editable control.

  function applyCurrency(place: NormalizedPlace | null) {
    if (isCurrencyOption(place?.currency)) setBudgetCurrency(place.currency);
  }

  function setOrigin(place: NormalizedPlace | null) {
    notePlanEdit();
    setOriginPlace(place);
    if (place && place.source !== "custom" && !trackedSelections.current.has(`origin:${place.value}`)) {
      trackedSelections.current.add(`origin:${place.value}`);
      trackPlanEvent("origin_selected");
    }
    resetDiscovery();
  }

  function setDestination(place: NormalizedPlace | null) {
    notePlanEdit();
    setDestinationPlace(place);
    if (place && place.source !== "custom" && !trackedSelections.current.has(`destination:${place.value}`)) {
      trackedSelections.current.add(`destination:${place.value}`);
      trackPlanEvent("destination_selected");
    }
    applyCurrency(place);
    resetDiscovery();
  }

  function setStopPlace(id: string, place: NormalizedPlace | null) {
    setStops((current) => current.map((stop) => (stop.id === id ? { ...stop, place } : stop)));
    if (place && place.source !== "custom" && !trackedSelections.current.has(`stop:${id}:${place.value}`)) {
      trackedSelections.current.add(`stop:${id}:${place.value}`);
      trackPlanEvent("destination_selected");
    }
    applyCurrency(place);
    resetDiscovery();
  }

  function addCity() {
    setStops((current) => [...current, { id: `stop-${Date.now()}-${current.length}`, place: null }]);
    trackPlanEvent("city_stop_added", { stopCount: stops.length + 1 });
    resetDiscovery();
  }

  function removeCity(id: string) {
    setStops((current) => (current.length <= 2 ? current : current.filter((stop) => stop.id !== id)));
    resetDiscovery();
  }

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest]
    );
    resetDiscovery();
  }

  const payload: TripPlannerPayload = useMemo(
    () => ({
      tripType,
      origin: placeValue(originPlace),
      originPlaceId: originPlace?.place_id,
      originCity: originPlace?.city,
      originRegion: originPlace?.region,
      originCountry: originPlace?.country,
      originLatitude: originPlace?.latitude,
      originLongitude: originPlace?.longitude,
      originPlace: originPlace || undefined,
      destination: normalizedDestination,
      destinationPlaceId: tripType === "single_destination" ? destinationPlace?.place_id : undefined,
      destinationCity: tripType === "single_destination" ? destinationPlace?.city : validStops[validStops.length - 1]?.city,
      destinationCountry: tripType === "single_destination" ? destinationPlace?.country : validStops[validStops.length - 1]?.country,
      destinationRegion: tripType === "single_destination" ? destinationPlace?.region : validStops[validStops.length - 1]?.region,
      destinationLatitude: tripType === "single_destination" ? destinationPlace?.latitude : validStops[validStops.length - 1]?.latitude,
      destinationLongitude: tripType === "single_destination" ? destinationPlace?.longitude : validStops[validStops.length - 1]?.longitude,
      destinationPlace: tripType === "single_destination" && destinationPlace ? destinationPlace : undefined,
      destinationStops: tripType === "multi_city" ? validStops : undefined,
      returnToOrigin,
      flexibleCityOrder,
      flexibleDates,
      startDate,
      endDate,
      daysCount: resolvedDaysCount,
      travelersCount,
      travelers: {
        adults: adultCount,
        children: childCount,
        infants: infantCount
      },
      rooms: roomCount,
      bedPreference,
      budgetAmount: toNumberOrNull(budgetAmount),
      budgetCurrency,
      budgetIncludesFlights,
      budgetIncludesHotel,
      budgetIncludesActivities,
      travelStyle,
      interests,
      pace,
      walkingTolerance,
      accommodationPreference,
      transportationPreference,
      accessibilityNeeds: accessibilityNeeds.trim(),
      dietaryPreference: dietaryPreference.trim(),
      specialNotes: specialNotes.trim(),
      language: locale,
      priceDiscoveryId,
      budgetConstraint
    }),
    [
      accessibilityNeeds,
      accommodationPreference,
      adultCount,
      bedPreference,
      budgetAmount,
      budgetConstraint,
      budgetCurrency,
      budgetIncludesActivities,
      budgetIncludesFlights,
      budgetIncludesHotel,
      childCount,
      destinationPlace,
      dietaryPreference,
      endDate,
      flexibleCityOrder,
      flexibleDates,
      infantCount,
      interests,
      locale,
      normalizedDestination,
      originPlace,
      pace,
      priceDiscoveryId,
      returnToOrigin,
      resolvedDaysCount,
      roomCount,
      specialNotes,
      startDate,
      transportationPreference,
      travelStyle,
      travelersCount,
      tripType,
      validStops,
      walkingTolerance
    ]
  );

  const planDraft = useMemo(
    () => ({
      version: 1,
      currentStep: step,
      step,
      origin: payload.origin,
      originPlace,
      origin_metadata: originPlace,
      destination: payload.destination,
      destinationPlace,
      destination_metadata: destinationPlace,
      trip_type: tripType,
      tripType,
      stopItems: stops,
      stops,
      destination_stops: validStops,
      destinationStops: validStops,
      return_to_origin: returnToOrigin,
      returnToOrigin,
      flexible_city_order: flexibleCityOrder,
      flexibleCityOrder,
      flexible_dates: flexibleDates,
      flexibleDates,
      start_date: startDate,
      startDate,
      end_date: endDate,
      endDate,
      days_count: resolvedDaysCount,
      daysCount,
      travelers: {
        adults: adultCount,
        children: childCount,
        infants: infantCount
      },
      travelersCount,
      adults,
      children,
      infants,
      rooms,
      bedPreference,
      budget_total: budgetAmount,
      budgetAmount,
      budget_currency: budgetCurrency,
      budgetCurrency,
      budget_includes_flights: budgetIncludesFlights,
      budgetIncludesFlights,
      budget_includes_hotel: budgetIncludesHotel,
      budgetIncludesHotel,
      budget_includes_activities: budgetIncludesActivities,
      budgetIncludesActivities,
      travel_style: travelStyle,
      travelStyle,
      pace,
      walking_tolerance: walkingTolerance,
      walkingTolerance,
      interests,
      accommodationPreference,
      transportationPreference,
      accessibility_needs: accessibilityNeeds,
      accessibilityNeeds,
      dietary_preference: dietaryPreference,
      dietaryPreference,
      specialNotes,
      special_notes: specialNotes,
      language: locale,
      priceDiscoveryId,
      budgetConstraint,
      priceDiscovery,
      itineraryRequest: payload
    }),
    [
      accessibilityNeeds,
      adultCount,
      adults,
      bedPreference,
      budgetAmount,
      budgetConstraint,
      budgetCurrency,
      budgetIncludesActivities,
      budgetIncludesFlights,
      budgetIncludesHotel,
      childCount,
      children,
      daysCount,
      destinationPlace,
      dietaryPreference,
      endDate,
      flexibleCityOrder,
      flexibleDates,
      infantCount,
      infants,
      interests,
      locale,
      originPlace,
      pace,
      payload,
      priceDiscovery,
      priceDiscoveryId,
      returnToOrigin,
      rooms,
      specialNotes,
      startDate,
      step,
      stops,
      travelStyle,
      travelersCount,
      tripType,
      validStops,
      walkingTolerance,
      accommodationPreference,
      transportationPreference,
      resolvedDaysCount
    ]
  );

  const saveCurrentPlanDraft = useCallback(() => {
    const stores = browserPlanDraftStorages();
    if (!stores) return;
    try {
      const ownerUserId = sessionUser?.id || null;
      writeOwnedPlanDraft({
        userId: ownerUserId,
        raw: JSON.stringify({ ...planDraft, ownerUserId }),
        ...stores
      });
    } catch {
      // Draft persistence should never block planning or auth navigation.
    }
  }, [planDraft, sessionUser]);

  const clearCurrentPlanDraft = useCallback(() => {
    const stores = browserPlanDraftStorages();
    if (!stores) return;
    try {
      clearOwnedPlanDraft({ userId: sessionUser?.id || null, ...stores });
    } catch {
      // Clearing local draft state should never block navigation.
    }
  }, [sessionUser]);

  const consumeResumeParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["resumePlan", "continueGenerate"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, "", next || "/plan");
    }
  }, []);

  function redirectToLoginForGeneration() {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Roamly] No active session before generation; redirecting to login");
    }
    saveCurrentPlanDraft();
    router.push(planLoginUrl());
  }

  async function requestGuestFreeItinerary(generationPayload: TripPlannerPayload) {
    const response = await fetch("/api/trips/guest-itinerary", {
      method: "POST",
      credentials: "same-origin",
      headers: jsonHeaders(),
      body: JSON.stringify(generationPayload)
    });
    const data = await response.json().catch(() => null);
    if ((response.ok || response.status === 202) && data?.tripId && data?.unlockSource === "free") {
      setNotice("Opening your free itinerary...");
      router.push(GUEST_ITINERARY_PATH);
      return;
    }
    throw new Error(data?.message || data?.error || GENERATION_ERROR_MESSAGE);
  }

  const restorePlanDraft = useCallback((record: Record<string, unknown>) => {
    const travelers = getRecord(record.travelers);
    setStep(clampStep(record.currentStep ?? record.step));
    setFurthestStep(clampStep(record.currentStep ?? record.step));
    setOriginPlace(readDraftPlace(record.originPlace ?? record.origin_metadata ?? record.origin));
    setDestinationPlace(readDraftPlace(record.destinationPlace ?? record.destination_metadata ?? record.destination));
    setTripType(readDraftTripType(record.tripType ?? record.trip_type));
    setStops(readDraftStops(record));
    setReturnToOrigin(readDraftBoolean(record.returnToOrigin ?? record.return_to_origin, true));
    setFlexibleCityOrder(readDraftBoolean(record.flexibleCityOrder ?? record.flexible_city_order, false));
    setFlexibleDates(readDraftBoolean(record.flexibleDates ?? record.flexible_dates, false));
    setStartDate(readDraftString(record.startDate ?? record.start_date));
    setEndDate(readDraftString(record.endDate ?? record.end_date));
    setDaysCount(readDraftString(record.daysCount ?? record.days_count));
    setAdults(readDraftString(record.adults ?? travelers?.adults, "1"));
    setChildren(readDraftString(record.children ?? travelers?.children, "0"));
    setInfants(readDraftString(record.infants ?? travelers?.infants, "0"));
    setRooms(readDraftString(record.rooms, "1"));
    setBedPreference(readDraftOption(record.bedPreference ?? record.bed_preference, bedPreferenceOptions, "No preference"));
    setBudgetAmount(readDraftString(record.budgetAmount ?? record.budget_total));
    setBudgetCurrency(readDraftOption(record.budgetCurrency ?? record.budget_currency, currencyOptions, "CAD"));
    setBudgetIncludesFlights(readDraftBoolean(record.budgetIncludesFlights ?? record.budget_includes_flights, true));
    setBudgetIncludesHotel(readDraftBoolean(record.budgetIncludesHotel ?? record.budget_includes_hotel, true));
    setBudgetIncludesActivities(readDraftBoolean(record.budgetIncludesActivities ?? record.budget_includes_activities, true));
    setTravelStyle(readDraftOption(record.travelStyle ?? record.travel_style, planningTravelStyles, "Balanced"));
    setInterests(readDraftStringArray(record.interests, []));
    setPace(readDraftOption(record.pace, planningPaces, "Balanced"));
    setWalkingTolerance(readDraftOption(record.walkingTolerance ?? record.walking_tolerance, walkingToleranceOptions, "Medium"));
    setAccommodationPreference(readDraftOption(record.accommodationPreference, accommodationOptions, "Mid-range"));
    setTransportationPreference(readDraftOption(record.transportationPreference, transportationOptions, "Mixed"));
    setAccessibilityNeeds(readDraftString(record.accessibilityNeeds ?? record.accessibility_needs));
    setDietaryPreference(readDraftString(record.dietaryPreference ?? record.dietary_preference));
    setSpecialNotes(readDraftString(record.specialNotes ?? record.special_notes));
    setPriceDiscovery(readDraftPriceDiscovery(record.priceDiscovery));
    setPriceDiscoveryId(readDraftString(record.priceDiscoveryId) || null);
    setBudgetConstraint(readDraftString(record.budgetConstraint));
    setError("");
    setNotice("");
    setLoading(false);
    setPriceChecking(false);
    generationInFlight.current = false;
  }, []);

  function resetPlanner() {
    clearCurrentPlanDraft();
    setCarriedSummary("");
    skipNextDraftSave.current = true;
    trackedSelections.current.clear();
    generationInFlight.current = false;
    onStartNew();
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!browserAuthReady) return;

    skipNextDraftSave.current = true;
    const stores = browserPlanDraftStorages();
    const userId = sessionUser?.id || null;
    const raw = window.localStorage.getItem(PLAN_DRAFT_KEY);
    const owned = stores ? readRestorablePlanDraft({ userId, ...stores }) : null;
    let restoredStoredDraft = false;
    const draftRaw = owned?.raw || null;
    if (draftRaw) {
      try {
        const parsed = JSON.parse(draftRaw) as unknown;
        const record = getRecord(parsed);
        if (record) {
          const freshDestination =
            !bookingFallbackSource && !shouldShowResumeNotice ? normalizePlaceText(queryDestination) : "";
          if (freshDestination) {
            // A homepage destination starts a new plan. The previous draft stays
            // available as a quiet resume action and is not written over until edited.
            setPreviousDraft(record);
            holdDraftSave.current = true;
            // A deep-linked destination that matches a recommended place
            // (e.g. from the /ph door) arrives with its real record —
            // coordinates, timezone, and its currency as the budget default.
            const knownFreshPlace = matchRecommendedPlace(freshDestination);
            setDestinationPlace(knownFreshPlace ?? readDraftPlace(freshDestination));
            if (knownFreshPlace && isCurrencyOption(knownFreshPlace.currency)) setBudgetCurrency(knownFreshPlace.currency);
            // A9: a hero search deep link carries the traveller's dates and
            // count with the destination — apply them to the same existing
            // state the date fields and steppers write, so the new plan
            // starts prefilled instead of silently dropping them.
            if (fallbackStartDate) setStartDate(fallbackStartDate);
            if (fallbackEndDate) setEndDate(fallbackEndDate);
            if (fallbackStartDate && fallbackEndDate) {
              const heroRange = calculateTripDateRange(fallbackStartDate, fallbackEndDate);
              if (heroRange.ok && heroRange.days) setDaysCount(String(heroRange.days));
            }
            if (queryTravelersCount) setAdults(String(queryTravelersCount));
            setCarriedSummary(heroCarriedSummary(fallbackStartDate, fallbackEndDate, queryTravelersCount));
            setRestoreNotice(false);
          } else {
            restorePlanDraft(record);
            // A stored planner draft is always surfaced: the traveler must see
            // the existing draft and get the obvious "Start over" option instead
            // of silently inheriting stale values (e.g. an old Toronto draft).
            setRestoreNotice(true);
            restoredStoredDraft = true;
            if (owned?.source === "legacy" && userId && stores) {
              writeOwnedPlanDraft({
                userId,
                raw: JSON.stringify({ ...record, ownerUserId: userId }),
                ...stores
              });
            }
          }
        }
      } catch {
        window.localStorage.removeItem(PLAN_DRAFT_KEY);
      }
    }
    if (raw && !(owned?.source === "legacy" && userId)) {
      window.localStorage.removeItem(PLAN_DRAFT_KEY);
    }

    if (bookingFallbackSource) {
      if (restoredStoredDraft) {
        setNotice("Your saved trip plan was kept. Review it before continuing.");
      } else {
        setOriginPlace(readDraftPlace(fallbackOrigin));
        setDestinationPlace(readDraftPlace(fallbackDestination));
        if (fallbackStartDate) setStartDate(fallbackStartDate);
        if (fallbackEndDate) setEndDate(fallbackEndDate);
        const categoryLabel = ({ hotel: "stay", flight: "flight", activity: "experience", tour: "tour", transport: "transport" } as Record<string, string>)[fallbackCategory] || "travel";
        const placeLabel = normalizePlaceText(fallbackDestination);
        setNotice(placeLabel ? `Your ${categoryLabel} search for ${placeLabel} is ready to shape into a trip. Adjust the details before continuing.` : "Your travel search is ready to shape into a trip. Add a destination to continue.");
      }
    } else if (!restoredStoredDraft && queryDestination) {
      const placeLabel = normalizePlaceText(queryDestination);
      if (placeLabel) {
        // Same deep-link resolution as the fresh-destination branch above:
        // a recommended place keeps its record (and currency default).
        const knownQueryPlace = matchRecommendedPlace(placeLabel);
        setDestinationPlace(knownQueryPlace ?? readDraftPlace(placeLabel));
        if (knownQueryPlace && isCurrencyOption(knownQueryPlace.currency)) setBudgetCurrency(knownQueryPlace.currency);
        // A9: same hero prefill as the fresh-destination branch above.
        if (fallbackStartDate) setStartDate(fallbackStartDate);
        if (fallbackEndDate) setEndDate(fallbackEndDate);
        if (fallbackStartDate && fallbackEndDate) {
          const heroRange = calculateTripDateRange(fallbackStartDate, fallbackEndDate);
          if (heroRange.ok && heroRange.days) setDaysCount(String(heroRange.days));
        }
        if (queryTravelersCount) setAdults(String(queryTravelersCount));
        setCarriedSummary(heroCarriedSummary(fallbackStartDate, fallbackEndDate, queryTravelersCount));
      }
    }

    draftHydrated.current = true;
    setDraftHydratedState(true);
  }, [bookingFallbackSource, fallbackCategory, fallbackDestination, fallbackEndDate, fallbackOrigin, fallbackStartDate, queryDestination, queryTravelersCount, restorePlanDraft, browserAuthReady, sessionUser, shouldShowResumeNotice]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    if (skipNextDraftSave.current) {
      skipNextDraftSave.current = false;
      return;
    }
    if (holdDraftSave.current) return;
    saveCurrentPlanDraft();
  }, [saveCurrentPlanDraft]);

  function validateStep(stepToValidate: number) {
    if (stepToValidate === 0) {
      // Fix 2 correction (owner verdict 2026-11-06): origin is OPTIONAL.
      // It is asked once, here on Step 1, and never gates Continue — a
      // plan without one generates with the destination alone, and adding
      // one only sharpens the flight and transport estimates.
      if (tripType === "multi_city" && validStops.length < 2) return "Please add at least two cities for a multi-city trip.";
      if (tripType === "single_destination" && !isValidPlaceValue(payload.destination)) {
        return "Please choose or enter a destination before continuing.";
      }
    }
    if (stepToValidate === 1) {
      const dateValidation = tripDateValidationMessage(startDate, endDate, daysCount);
      if (dateValidation) return dateValidation;
    }
    if (stepToValidate === 2) {
      if (adultCount < 1) return "Add at least one adult traveler.";
      if (roomCount < 1) return "Add at least one room.";
    }
    if (stepToValidate === 3) {
      const amount = toNumberOrNull(budgetAmount);
      if (amount == null || amount <= 0) return "Add an estimated budget.";
      if (amount < 100) return `Please enter a realistic trip budget (at least 100 ${budgetCurrency}).`;
    }
    // A12: step 3 has no validation. Interests are optional — an empty
    // selection proceeds on the stated default ("No preference — Roamly
    // balances it"), and every other preference carries a labeled default.
    return "";
  }

  function validateBeforeGenerate() {
    validateDateFields();
    budgetField.runValidation(budgetAmount);
    for (let index = 0; index < steps.length - 1; index += 1) {
      const validation = validateStep(index);
      if (validation) return validation;
    }
    return "";
  }

  function resumePreviousTrip() {
    if (!previousDraft) return;
    holdDraftSave.current = false;
    restorePlanDraft(previousDraft);
    setCarriedSummary("");
    setPreviousDraft(null);
    setRestoreNotice(true);
    setError("");
    setNotice("");
  }

  function goNext() {
    notePlanEdit();
    if (step === 1 && !invalidTypedDayCount(daysCount)) {
      const synced = syncPlanDates(startDate, endDate, daysCount);
      if (synced.endDate !== endDate) setEndDate(synced.endDate);
      if (synced.days && String(synced.days) !== daysCount) setDaysCount(String(synced.days));
    }
    if (step === 1) validateDateFields();
    if (step === 3) budgetField.runValidation(budgetAmount);
    const validation = validateStep(step);
    setError(validation);
    if (validation) return;
    if (step === 2) {
      trackPlanEvent("dates_selected", {
        daysCount: payload.daysCount,
        travelersCount: payload.travelersCount,
        rooms: payload.rooms
      });
    }
    if (step === 3) {
      trackPlanEvent("budget_submitted", {
        budgetIncludesFlights,
        budgetIncludesHotel,
        budgetIncludesActivities
      });
    }
    setStep((current) => {
      const next = Math.min(current + 1, steps.length - 1);
      setFurthestStep((value) => Math.max(value, next));
      return next;
    });
  }

  function goBack() {
    setError("");
    setNotice("");
    setStep((current) => Math.max(current - 1, 0));
  }

  function selectTransportOption(option: TransportOption) {
    if (!priceDiscovery || option.availability === "not_available" || option.presentation === "excluded") return;
    const updated = applyTransportOptionSelection(priceDiscovery as unknown as TripPriceDiscovery, option);
    setPriceDiscovery(updated as unknown as PriceDiscoveryResult);
    // The budget-constraint text steers generation; rebuild it from the
    // updated discovery so the itinerary is built around the pick and
    // the pick's price, not the option it replaced.
    setBudgetConstraint(buildBudgetConstraintForItinerary(updated));
    // Generation resolves the leg's mode from the free-text preference
    // BEFORE it reads the discovery option. If the saved preference
    // would force a different intercity mode (Drive / Rental car),
    // neutralise it to Mixed so the traveller's pick is what gets
    // built. Local-mobility preferences (Walking, Public transit,
    // Rideshare) never match an intercity mode and are left untouched.
    if (option.mode !== "drive" && (transportationPreference === "Drive" || transportationPreference === "Rental car")) {
      setTransportationPreference("Mixed");
    }
    notePlanEdit();
  }

  async function runPriceDiscovery() {

    setPriceChecking(true);
    setNotice("Checking trip costs...");
    setError("");
    trackPlanEvent("price_discovery_started", { tripType });

    try {
      const response = await fetchWithSupabaseAuth("/api/roamly/price-discovery", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        setError("Roamly could not check the budget yet. Please try again.");
        return null;
      }
      if (!response.ok) throw new Error(data?.message || data?.error || "Could not check trip costs.");
      setPriceDiscovery(data.discovery);
      setPriceDiscoveryId(data.discoveryId || null);
      setBudgetConstraint(data.budgetConstraint || "");
      trackPlanEvent("price_discovery_completed", {
        tripType,
        budgetStatus: data.discovery?.budgetStatus
      });
      setNotice("");
      return {
        discovery: data.discovery as PriceDiscoveryResult,
        discoveryId: typeof data.discoveryId === "string" ? data.discoveryId : null,
        budgetConstraint: typeof data.budgetConstraint === "string" ? data.budgetConstraint : ""
      };
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not check trip costs.");
      trackPlanEvent("price_discovery_failed", { tripType });
      return null;
    } finally {
      setPriceChecking(false);
    }
  }

  async function createDraftAndStartCheckout() {
    if (generationInFlight.current) return;
    const validation = validateBeforeGenerate();
    setError(validation);
    setNotice("");
    if (validation) return;

    saveRecentSearch();
    saveCurrentPlanDraft();

    generationInFlight.current = true;
    setLoading(true);
    setNotice("Preparing secure checkout...");
    let draftTripId = "";

    try {
      const draftResponse = await fetchWithSupabaseAuth("/api/trips/draft", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(payload)
      });
      const draftData = await draftResponse.json().catch(() => null);

      if (draftResponse.status === 401) {
        const user = await resolveSessionUser({ refresh: true });
        if (user) {
          setError("Your login session could not be confirmed. Refresh this page and try again.");
          return;
        }
        redirectToLoginForGeneration();
        return;
      }

      if (!draftResponse.ok || !draftData?.tripId) {
        throw new Error(draftData?.message || draftData?.setupHint || draftData?.error || "Trip draft could not be saved.");
      }

      draftTripId = String(draftData.tripId);
      const checkoutResponse = await fetchWithSupabaseAuth("/api/stripe/create-trip-checkout", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ tripId: draftTripId, checkoutKind: "itinerary" })
      });
      const checkoutData = await checkoutResponse.json().catch(() => null);

      if (checkoutResponse.status === 401) {
        const user = await resolveSessionUser({ refresh: true });
        if (user) {
          setError("Your login session could not be confirmed. Refresh this page and try again.");
          return;
        }
        clearCurrentPlanDraft();
        router.push(`/login?next=${encodeURIComponent(`/trip/${draftTripId}`)}`);
        return;
      }

      if (!checkoutResponse.ok) {
        throw new Error(checkoutData?.message || checkoutData?.error || "Stripe checkout could not be opened.");
      }

      clearCurrentPlanDraft();
      if (checkoutData?.alreadyActivated || checkoutData?.alreadyUnlocked) {
        router.push(`/trip/${draftTripId}`);
        return;
      }
      if (!checkoutData?.url) throw new Error("Stripe did not return a checkout link.");
      window.location.href = checkoutData.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe checkout could not be opened.";
      if (draftTripId) {
        clearCurrentPlanDraft();
        router.push(`/trip/${draftTripId}?checkout=failed`);
        return;
      }
      setNotice("");
      setError(message);
    } finally {
      generationInFlight.current = false;
      setLoading(false);
    }
  }

  async function openFinalConfirmation() {
    if (loading || priceChecking || (isCheckingSession && !sessionUser)) return;
    const validation = validateBeforeGenerate();
    setError(validation);
    setNotice("");
    if (validation) return;
    if (requiresPaidUnlock) {
      await createDraftAndStartCheckout();
      return;
    }
    const authenticated = Boolean(apiAuthToken) || Boolean(await resolveSessionUser());
    saveRecentSearch();
    saveCurrentPlanDraft();
    let generationPayload = payload;
    if (!priceDiscovery) {
      const checked = await runPriceDiscovery();
      if (!checked) {
        if (authenticated) return;
        setError("");
      } else {
        generationPayload = {
          ...payload,
          priceDiscoveryId: checked.discoveryId,
          budgetConstraint: checked.budgetConstraint,
          priceDiscovery: checked.discovery as unknown as Record<string, unknown>
        };
      }
    }
    if (!authenticated) {
      if (generationInFlight.current) return;
      generationInFlight.current = true;
      setLoading(true);
      setNotice("Starting itinerary generation...");
      try {
        await requestGuestFreeItinerary(generationPayload);
      } catch (err) {
        setNotice("");
        setError(err instanceof Error ? err.message : GENERATION_ERROR_MESSAGE);
      } finally {
        generationInFlight.current = false;
        setLoading(false);
      }
      return;
    }
    await submitPlan(generationPayload);
  }

  async function submitPlan(generationPayload: TripPlannerPayload = payload) {
    if (generationInFlight.current) return;
    // Phase 6: the itinerary does not proceed past a red entry gate
    // (owner rulings 2026-10-21 18:52 + 19:14 ADT). The gate surface
    // itself is on screen; this line names the block honestly.
    if (build2GatesEnabled && gateReadiness.applicable && !gateReadiness.ready) {
      setNotice("");
      setError(gateReadiness.reason === "ALERTS_REQUIRED" ? ALERTS_BLOCK_MESSAGE : INSTALL_BLOCK_MESSAGE);
      return;
    }
    const validation = validateBeforeGenerate();
    setError(validation);
    setNotice("");
    if (validation) return;

    saveRecentSearch();
    saveCurrentPlanDraft();

    generationInFlight.current = true;
    setLoading(true);
    setNotice("Starting itinerary generation...");
    trackPlanEvent("itinerary_generation_started", { tripType });

    try {
      const response = await fetchWithSupabaseAuth("/api/trips/generate", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...generationPayload,
          // Phase 6: the flow context the server gate enforces against
          // (mobile flows need a green attestation for this device;
          // desktop flows carry no gate).
          gateFlow: {
            surface: gateFlowSurface(),
            deviceId: gateReadiness.deviceId ?? getOrCreateGateDeviceId()
          }
        })
      });

      const data = await response.json().catch(() => null);

      if (
        response.status === 403 &&
        (data?.error === "INSTALL_REQUIRED" || data?.error === "ALERTS_REQUIRED")
      ) {
        setNotice("");
        setError(typeof data?.message === "string" && data.message ? data.message : INSTALL_BLOCK_MESSAGE);
        return;
      }

      if (response.status === 401) {
        const user = await resolveSessionUser({ refresh: true });
        if (user) {
          setError("Your login session could not be confirmed. Refresh this page and try again.");
          return;
        }
        await requestGuestFreeItinerary(generationPayload);
        return;
      }

      if (response.ok && data?.tripId) {
        trackPlanEvent("itinerary_generation_completed", { tripType });
        setNotice("Opening your trip progress...");
        clearCurrentPlanDraft();
        await openTripAfterSessionSync(router, data.previewUrl, data.tripId);
        return;
      }

      if (response.status === 402 && data?.previewUrl) {
        trackPlanEvent("itinerary_generation_failed", {
          tripType
        });
        setNotice("Opening your saved trip...");
        clearCurrentPlanDraft();
        await openTripAfterSessionSync(router, data.previewUrl, data?.tripId);
        return;
      }

      if (response.status === 409 && data?.error === "ITINERARY_GENERATING" && data?.tripId) {
        trackPlanEvent("itinerary_generation_resumed", {
          tripType
        });
        setNotice("Opening your trip progress...");
        clearCurrentPlanDraft();
        await openTripAfterSessionSync(router, data.previewUrl, data.tripId);
        return;
      }

      if (response.status === 404 || response.status === 501) {
        setError(data?.error === AI_NOT_CONFIGURED_MESSAGE ? AI_NOT_CONFIGURED_MESSAGE : GENERATION_ERROR_MESSAGE);
        return;
      }

      if (data?.error === AI_NOT_CONFIGURED_MESSAGE || data?.message === AI_NOT_CONFIGURED_MESSAGE) {
        setError(AI_NOT_CONFIGURED_MESSAGE);
        return;
      }

      throw new Error(GENERATION_ERROR_MESSAGE);
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : GENERATION_ERROR_MESSAGE);
      trackPlanEvent("itinerary_generation_failed", { tripType });
    } finally {
      generationInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    submitPlanRef.current = submitPlan;
  });

  useEffect(() => {
    if (!shouldContinueGenerate) return;
    if (resumeGenerateAttempted.current) return;
    if (!draftHydratedState || isCheckingSession) return;
    if (!sessionUser && !apiAuthToken) return;

    resumeGenerateAttempted.current = true;
    setStep(steps.length - 1);
    setRestoreNotice(false);
    setNotice("Continuing itinerary generation...");
    consumeResumeParams();
    void submitPlanRef.current?.();
  }, [apiAuthToken, consumeResumeParams, draftHydratedState, isCheckingSession, sessionUser, shouldContinueGenerate]);

  // --- Plan-flow redesign helpers (presentation only) -----------------
  const whereSummary =
    tripType === "multi_city"
      ? validStops.map((place) => place.label || place.value).join(" → ") || ""
      : destinationPlace
        ? `${originPlace ? `${originPlace.label || originPlace.value} → ` : ""}${destinationPlace.label || destinationPlace.value}`
        : "";
  const whenSummary =
    startDate && endDate && resolvedDaysCount ? `${startDate} to ${endDate} · ${tripLengthCopy(resolvedDaysCount)}` : "";
  const whoSummary = `${travelerCountPhrase(adultCount, childCount, infantCount)} · ${roomCount} room${roomCount === 1 ? "" : "s"}`;
  const budgetSummary = budgetAmount ? `${budgetCurrency} ${budgetAmount}` : "";
  const prefsSummary = interests.length ? interests.join(", ") : "";
  const stepSummaries: Array<{ title: string; summary: string; complete: boolean }> = [
    { title: "Where", summary: whereSummary, complete: Boolean(whereSummary) && validateStep(0) === "" },
    { title: "When", summary: whenSummary, complete: Boolean(whenSummary) && validateStep(1) === "" },
    { title: "Who", summary: whoSummary, complete: validateStep(2) === "" && (adultCount > 0 || childCount > 0 || infantCount > 0) },
    { title: "Budget", summary: budgetSummary, complete: Boolean(budgetSummary) && validateStep(3) === "" },
    { title: "Preferences", summary: prefsSummary, complete: Boolean(prefsSummary) && validateStep(4) === "" },
    { title: "Review & generate", summary: "", complete: false }
  ];

  function openStep(index: number) {
    // Tapping a folded line reopens that step; the currently open step
    // folds automatically because folded lines render for every
    // complete, already-reached step that is not the open one.
    setError("");
    setNotice("");
    setStep(clampStep(index));
  }

  function saveRecentSearch() {
    const destinationLabel = normalizedDestination || destinationPlace?.label || "";
    if (!destinationLabel) return;
    const recent: PlanRecentSearch = {
      destinationLabel,
      originLabel: placeValue(originPlace),
      startDate,
      endDate,
      adults,
      children,
      rooms,
      savedAt: Date.now()
    };
    writePlanRecent(recent);
    setRecentSearches(readPlanRecents());
  }

  function refillFromRecent(recent: PlanRecentSearch) {
    notePlanEdit();
    setCarriedSummary("");
    if (recent.originLabel) setOriginPlace(readDraftPlace(recent.originLabel));
    const known = matchRecommendedPlace(normalizePlaceText(recent.destinationLabel));
    setDestinationPlace(known ?? readDraftPlace(recent.destinationLabel));
    if (known && isCurrencyOption(known.currency)) setBudgetCurrency(known.currency);
    setTripType("single_destination");
    if (recent.startDate) setStartDate(recent.startDate);
    if (recent.endDate) setEndDate(recent.endDate);
    const range = calculateTripDateRange(recent.startDate, recent.endDate);
    if (range.ok && range.days) setDaysCount(String(range.days)); // A10: restore-class write (see the A10 note above the date updaters) — the removed updateDaysCount is not resurrected.
    if (recent.adults) setAdults(recent.adults);
    if (recent.children) setChildren(recent.children);
    if (recent.rooms) setRooms(recent.rooms);
    resetDiscovery();
    setError("");
    // Keep it simple per the redesign spec: refill + open When.
    setFurthestStep((value) => Math.max(value, 1));
    setStep(1);
  }

  const buildDestinationLabel =
    tripType === "multi_city"
      ? validStops[0]
        ? `${validStops[0].city || validStops[0].label || validStops[0].value}${validStops.length > 1 ? ` + ${validStops.length - 1} more` : ""}`
        : ""
      : destinationPlace?.city || destinationPlace?.label || normalizedDestination || "";
  // Live commit label (element 3): the final button says what it will
  // build — destination + day count — and updates live from state.
  const buildButtonLabel = buildDestinationLabel
    ? resolvedDaysCount
      ? `Build my ${buildDestinationLabel} trip · ${resolvedDaysCount} day${resolvedDaysCount === 1 ? "" : "s"}`
      : `Build my ${buildDestinationLabel} trip`
    : entitlement.cta;
  const nextStepLabel =
    step < steps.length - 1
      ? step === 0 && buildDestinationLabel
        ? `Continue · ${buildDestinationLabel}`
        : `Continue to ${steps[step + 1].title}`
      : buildButtonLabel;

  const summaryRows = [
    ["Route", routePreview || "Route pending"],
    ["Transport", payload.transportationPreference === PLAN_PREFERENCE_DEFAULTS.transportation ? `${payload.transportationPreference} (default)` : payload.transportationPreference || "Transport pending"],
    ["Dates", tripDateRange.ok && tripDateRange.days ? `${tripLengthCopy(tripDateRange.days)} (${startDate} to ${endDate})` : "Dates not set"],
    ["Travelers", travelerCountPhrase(adultCount, childCount, infantCount)],
    ["Rooms", `${roomCount} room${roomCount === 1 ? "" : "s"}${bedPreference !== "No preference" ? `, ${bedPreference}` : ""}`],
    ["Budget", payload.budgetAmount ? `${payload.budgetCurrency} ${payload.budgetAmount}` : "Budget pending"],
    ["Style", preferenceStyleSummary({ travelStyle, pace, walkingTolerance })],
    ["Interests", payload.interests.join(", ") || "No preference — Roamly balances it"],
    ["Notes", specialNotes.trim() || "None"]
  ];
  const notePreview = travelerNoteDisplay(specialNotes);
  const priceBudgetBalance = priceDiscovery
    ? describeBudgetBalanceCents(priceDiscovery.remainingBudgetCents, priceDiscovery.budgetCurrency)
    : null;
  const priceDiscoveryRows = priceDiscovery
    ? [
        ["User budget", payload.budgetAmount ? `${priceDiscovery.budgetCurrency} ${formatRoamlyNumber(payload.budgetAmount, locale)}` : "Not set"],
        [
          "Selected transport",
          `${formatMoney(priceDiscovery.selectedTransportEstimateCents ?? priceDiscovery.flightEstimateCents, priceDiscovery.budgetCurrency)}${
            priceDiscovery.recommendedTransportOption ? ` · ${priceDiscovery.recommendedTransportOption.mode}` : ""
          }`
        ],
        [
          "Hotel/stay",
          budgetValueWithConfidence(priceDiscovery, "hotel", priceDiscovery.hotelEstimateCents)
        ],
        ["Tickets/tours", budgetValueWithConfidence(priceDiscovery, "tickets_tours", priceDiscovery.activitiesEstimateCents)],
        ["Food", budgetValueWithConfidence(priceDiscovery, "food", priceDiscovery.foodEstimateCents)],
        ["Local transport", budgetValueWithConfidence(priceDiscovery, "local_transport", priceDiscovery.localTransportEstimateCents)],
        ["Buffer", budgetValueWithConfidence(priceDiscovery, "buffer", priceDiscovery.bufferEstimateCents)],
        ["Committed bookings", budgetValueWithConfidence(priceDiscovery, "committed_bookings", priceDiscovery.committedBudgetCents)],
        ["Total", formatMoney(priceDiscovery.totalEstimateCents, priceDiscovery.budgetCurrency)],
        [
          "Price sources",
          "Full budget estimate generated using best available price sources."
        ],
        [priceBudgetBalance?.label || "Remaining budget", priceBudgetBalance?.value || "Not set"]
      ]
    : [];

  // Transport prompt face prep (presentation only — the logic map's
  // output is consumed, never recomputed): same option population the
  // old card stack showed, split into pickable radio cards (the map's
  // suggestion first) and quiet one-line unavailable entries.
  const transportFaceOptions = priceDiscovery?.transportOptions?.slice(0, 5) ?? [];
  const transportPickable = transportFaceOptions
    .filter((option) => !(option.presentation === "excluded" || option.availability === "not_available"))
    .sort((a, b) => Number(b.presentation === "suggested") - Number(a.presentation === "suggested"));
  const transportUnavailable = transportFaceOptions.filter(
    (option) => option.presentation === "excluded" || option.availability === "not_available"
  );
  const transportSelectedOption = transportPickable.find(
    (option) =>
      Boolean(priceDiscovery?.transportSelection) &&
      priceDiscovery?.transportSelection?.mode === option.mode &&
      priceDiscovery?.transportSelection?.title === option.title
  );
  const transportProvenanceLine = transportSelectedOption
    ? transportProvenanceShort(transportSelectedOption)
    : [...new Set(transportPickable.map(transportProvenanceShort))].slice(0, 3).join(" · ");
  const transportQuestion = `How will you get to ${buildDestinationLabel || transportFaceOptions[0]?.destination || "your destination"}?`;
  // React Bits EnterContent (BoardUI port): the transport block springs
  // in when it first appears and re-enters when the face itself changes —
  // the options branched, or a pick landed and the block gained its
  // "Added to your itinerary and budget." line.
  const transportEnterKey = `${transportQuestion}|${transportPickable.map((option) => option.mode).join(",")}|${transportSelectedOption?.mode ?? ""}`;

  /* Batch 6: the date and budget messages are field-owned now
     (useBuiField above) rather than derived from the step error
     string at render time. Same messages, same step-notice
     suppression: while a field carries the message, the step
     notice stays quiet so the sentence never renders twice. */
  const budgetFieldError = budgetField.error;
  const dateErrorActive = Boolean(startDateField.error || endDateField.error || daysField.error);
  const lengthHint =
    tripDateRange.ok && tripDateRange.days
      ? tripLengthCopy(tripDateRange.days)
      : resolvedDaysCount
        ? `Add a start date to place these ${tripLengthCopy(resolvedDaysCount)}.`
        : "Pick a start and end date — Roamly works out the days and nights.";

  return (
    <>
    {build2GatesEnabled ? <EntryGate onReadinessChange={setGateReadiness} /> : null}
    {!draftHydratedState ? (
      <section
        aria-busy="true"
        aria-label={translateText("Preparing your trip plan")}
        data-plan-sheet
        className="bui-enter min-h-[70dvh] min-w-0 rounded-bui-card border border-chair bg-white px-4 py-5 shadow-bui-card sm:px-6 sm:py-7"
      >
        <p role="status" className="text-sm font-bold text-cgray">
          {translateText("Preparing your saved trip plan...")}
        </p>
        <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-csoft">
          <div className="h-full w-1/5 rounded-full bg-cblue motion-safe:animate-pulse motion-reduce:animate-none" />
        </div>
        <div aria-hidden="true" className="mt-6 grid gap-3 sm:grid-cols-2">
          <BuiSkeleton className="h-12" />
          <BuiSkeleton className="h-12" />
        </div>
      </section>
    ) : (
    <section data-plan-sheet className="bui-enter min-h-[70dvh] min-w-0 rounded-bui-card border border-chair bg-white px-4 py-5 shadow-bui-card sm:px-6 sm:py-7">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cblue">
            {translateText("Step")} {step + 1} {translateText("of")} {steps.length}
            <span className="text-cgray"> · {translateText(steps[step].detail)}</span>
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-chead sm:text-3xl">{translateText(steps[step].title)}</h2>
          <p className="mt-2 max-w-xl text-xs font-medium leading-5 text-cgray">{translateText(entitlement.stepNote)}</p>
          {testerAccess ? (
            <span className="mt-2 inline-flex">
              <BuiChip tone="primary" bold>
                {translateText("Tester access")}
              </BuiChip>
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-csoft">
        <div
          className="h-full rounded-full bg-cblue transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Fix round D4: one quiet line on Step 1 naming what the homepage
          search carried in, so the traveller can see their answers made it. */}
      {step === 0 && carriedSummary ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-cgray">{carriedSummary}</p>
      ) : null}

      {/* Folded steps: every completed, already-reached step that is not
          the open one collapses to ONE tappable summary line. */}
      {stepSummaries.some((item, index) => index !== step && index <= furthestStep && item.complete) ? (
        <div aria-label="Trip summary" className="mt-4 grid gap-2">
          {stepSummaries.map((item, index) =>
            index !== step && index <= furthestStep && item.complete ? (
              <FoldedStepLine key={item.title} title={item.title} summary={item.summary} onEdit={() => openStep(index)} />
            ) : null
          )}
        </div>
      ) : null}

      {previousDraft ? (
        <p className="mt-4 text-sm leading-6 text-cink">
          {translateText("A previous trip is saved.")}{" "}
          <button
            type="button"
            onClick={resumePreviousTrip}
            className="font-semibold text-cblue underline decoration-cblue/40 underline-offset-2"
          >
            {translateText("Resume previous trip")}
          </button>
        </p>
      ) : null}
      {signedIn && secondTimeGateNotice ? (
        <p className="mt-4 text-sm leading-6 text-cink">
          {translateText("You've already had a trip with Roamly, so this one opens behind three quick setup steps — Gmail for Booking Recon, the app for Live Companion alerts, and location for the companion to go live. Or skip for now and see it with limited features.")}
        </p>
      ) : null}
      {restoreNotice && !previousDraft ? (
        <p className="mt-4 text-sm leading-6 text-cink">
          {translateText("Your saved trip plan is here.")}{" "}
          <button
            type="button"
            onClick={resetPlanner}
            className="font-semibold text-cblue underline decoration-cblue/40 underline-offset-2"
          >
            {translateText("Start over")}
          </button>
        </p>
      ) : null}

      <div key={step} className="bui-enter mt-4">
        {step === 0 ? (
          <div className="grid gap-4">
            {recentSearches.length > 0 && !destinationPlace && !normalizedDestination ? (
              <div>
                <p className="text-sm font-black text-chead">{translateText("Recent searches")}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-cgray">
                  {translateText("One tap refills the plan — no typing.")}
                </p>
                <div className="mt-3 grid gap-2">
                  {recentSearches.map((recent) => (
                    <BuiClickSpark
                      key={`${recent.destinationLabel}-${recent.startDate}-${recent.endDate}-${recent.savedAt}`}
                      className="block"
                    >
                      <button
                        type="button"
                        onClick={() => refillFromRecent(recent)}
                        className="bui-press w-full text-left"
                      >
                        <BuiCard interactive className="px-4 py-3">
                          <span className="block text-sm font-black text-chead">{recent.destinationLabel}</span>
                          <span className="mt-0.5 block text-xs font-semibold text-cgray">
                            {[recent.originLabel ? `${translateText("From")} ${recent.originLabel}` : "", recent.startDate && recent.endDate ? `${recent.startDate} to ${recent.endDate}` : "", recent.adults ? `${recent.adults} adult${recent.adults === "1" ? "" : "s"}` : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </BuiCard>
                      </button>
                    </BuiClickSpark>
                  ))}
                </div>
              </div>
            ) : null}
            <PlaceSelector
              label="Origin / leaving from"
              value={originPlace}
              onChange={setOrigin}
              placeholder="Search origin"
              helper="Optional — adding where you leave from improves flight and transport estimates."
              popularPlaces={popularOriginPlaces}
            />

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["single_destination", "Single destination"],
                ["multi_city", "Multi-city trip"]
              ].map(([value, label]) => (
                <BuiClickSpark key={value} className="block h-full">
                  <button
                    type="button"
                    onClick={() => {
                      setTripType(value as TripType);
                      if (value === "multi_city") trackPlanEvent("multi_city_selected");
                      resetDiscovery();
                    }}
                    className={classNames(
          "h-full min-h-12 w-full rounded-xl border px-4 py-3 text-left text-sm font-bold transition",
                      tripType === value ? selectedOptionClass(label) : unselectedOptionClass
                    )}
                  >
                    {translateText(label)}
                  </button>
                </BuiClickSpark>
              ))}
            </div>

            {tripType === "single_destination" ? (
              <PlaceSelector
                label="Destination"
                value={destinationPlace}
                onChange={setDestination}
                placeholder="Search destination"
                helper="Search worldwide or type a custom place."
                popularPlaces={recommendedPlaces}
              />
            ) : (
              <div className="border-l-2 border-cblue/40 bg-cbg py-3 pl-4 sm:pl-5">
                <p className="text-sm font-black text-chead">{translateText("Multi-city trip")}</p>
                <p className="mt-1 text-sm font-bold leading-6 text-cgray">
                  {translateText("Add each city in the order you want to visit. Roamly will build the route and budget around these stops.")}
                </p>
                <div className="mt-4 grid gap-3">
                  {stops.map((stop, index) => (
                    <div key={stop.id} className="border-b border-chair/80 py-3 first:pt-0 last:border-b-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-cblue">
                          {translateText("City")} {index + 1}
                        </p>
                        {index > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeCity(stop.id)}
                            className="rounded-full px-3 py-1 text-xs font-black text-coral ring-1 ring-coral/20 transition hover:bg-coral/10"
                          >
                            {translateText("Remove")}
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2">
                        <PlaceSelector
                          label="Destination"
                          value={stop.place}
                          onChange={(place) => setStopPlace(stop.id, place)}
                          placeholder="Search city"
                          popularPlaces={recommendedPlaces}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addCity}
                  className="mt-3 min-h-11 rounded-xl border border-chair bg-transparent px-4 py-3 text-sm font-bold text-cink transition hover:border-cblue/50 hover:text-cblue"
                >
                  {translateText("Add city")}
                </button>
              </div>
            )}

            {tripType === "multi_city" ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <ToggleButton label="Return to origin" enabled={returnToOrigin} onToggle={() => setReturnToOrigin((value) => !value)} />
                <ToggleButton label="Flexible city order" enabled={flexibleCityOrder} onToggle={() => setFlexibleCityOrder((value) => !value)} />
                <ToggleButton label="Flexible dates" enabled={flexibleDates} onToggle={() => setFlexibleDates((value) => !value)} />
              </div>
            ) : (
              <ToggleButton label="Flexible dates" enabled={flexibleDates} onToggle={() => setFlexibleDates((value) => !value)} />
            )}

            {routePreview ? (
              <div className="border-l-2 border-cblue bg-cblue/5 py-3 pl-4 sm:pl-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Route")}</p>
                <p className="mt-2 text-base font-black leading-7 text-chead">{routePreview}</p>
              </div>
            ) : null}
            <StepError error={translateText(error)} />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-4">
            {/* When: ONE date-range experience. The duplicate typed
                day-count input is gone — daysCount stays in state and
                is synced from the range by updateStartDate /
                updateEndDate, exactly as the range edits did before. */}
            <BuiCard className="p-4">
              <FieldLabel>{translateText("Trip dates")}</FieldLabel>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <PlanField
                  key={`plan-start-date-${startDateField.shakeKey}`}
                  id="plan-start-date"
                  errorId="plan-start-date-error"
                  label={translateText("Start date")}
                  value={startDate}
                  onChange={updateStartDate}
                  type="date"
                  ariaLabel="Start date"
                  field={startDateField}
                  onBlurExtra={validateDateFields}
                />
                <PlanField
                  key={`plan-end-date-${endDateField.shakeKey}`}
                  id="plan-end-date"
                  errorId="plan-end-date-error"
                  label={translateText("End date")}
                  value={endDate}
                  onChange={updateEndDate}
                  type="date"
                  min={startDate || undefined}
                  ariaLabel="End date"
                  field={endDateField}
                  onBlurExtra={validateDateFields}
                />
              </div>
              <p className="mt-3 text-sm font-bold text-chead" aria-live="polite">
                {translateText(lengthHint)}
              </p>
              <BuiFieldError id="plan-days-error" message={daysField.error ? translateText(daysField.error) : ""} reserveLines={2} />
            </BuiCard>
            {dateErrorActive ? null : <StepError error={translateText(error)} />}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3">
            <Stepper label="Adults" value={adults} onChange={(value) => { notePlanEdit(); setAdults(value); resetDiscovery(); }} min={1} max={16} hint="Ages 18+" />
            <Stepper label="Children" value={children} onChange={(value) => { notePlanEdit(); setChildren(value); resetDiscovery(); }} min={0} max={10} hint="Ages 2-17" />
            <Stepper label="Infants" value={infants} onChange={(value) => { notePlanEdit(); setInfants(value); resetDiscovery(); }} min={0} max={10} hint="Under 2" />
            <Stepper label="Rooms" value={rooms} onChange={(value) => { notePlanEdit(); setRooms(value); resetDiscovery(); }} min={1} max={8} />
            <details className="group border-y border-chair py-3">
              <summary className="cursor-pointer list-none text-sm font-bold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/15">
                {translateText("Stay details")}
                <span className="float-right text-cgray transition group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <PlanSelectField className="mt-3" label={translateText("Bed preference")} value={bedPreference} onChange={(value) => setBedPreference(value as typeof bedPreference)} options={bedPreferenceOptions} />
            </details>
            <StepError error={translateText(error)} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr]">
              <PlanField
                key={`plan-budget-${budgetField.shakeKey}`}
                id="plan-budget"
                errorId="plan-budget-error"
                label={translateText("Budget amount")}
                value={budgetAmount}
                onChange={(value) => {
                  notePlanEdit();
                  setBudgetAmount(value);
                  const amount = toNumberOrNull(value);
                  setError((current) => {
                    if (current.startsWith("Add an estimated budget") && amount != null && amount > 0) return "";
                    if (current.startsWith("Please enter a realistic trip budget") && amount != null && amount >= 100) return "";
                    return current;
                  });
                }}
                type="number"
                inputMode="decimal"
                min={1}
                ariaLabel="Budget amount"
                field={budgetField}
              >
                {budgetAmount.trim() || budgetFieldError ? null : (
                  <p className="mt-1.5 text-xs font-semibold leading-5 text-cgray">
                    {translateText("A rough total is enough. Roamly will not fill this in for you.")}
                  </p>
                )}
              </PlanField>
              <PlanSelectField label={translateText("Currency")} value={budgetCurrency} onChange={(value) => setBudgetCurrency(value as typeof budgetCurrency)} options={currencyOptions} />
            </div>
            <details className="group border-y border-chair/80 py-3">
              <summary className="cursor-pointer list-none text-sm font-bold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/15">
                {translateText("How Roamly uses your budget")}
                <span className="float-right text-cink transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-cink">
                {translateText("Use your comfortable total. Roamly checks flights, stays, food, activities, local transportation, and buffer before generation.")}
              </p>
            </details>
            <div className="grid gap-3 sm:grid-cols-3">
              <ToggleButton label="Budget includes flights" enabled={budgetIncludesFlights} onToggle={() => { notePlanEdit(); setBudgetIncludesFlights((value) => !value); }} />
              <ToggleButton label="Budget includes hotel" enabled={budgetIncludesHotel} onToggle={() => { notePlanEdit(); setBudgetIncludesHotel((value) => !value); }} />
              <ToggleButton label="Budget includes activities" enabled={budgetIncludesActivities} onToggle={() => { notePlanEdit(); setBudgetIncludesActivities((value) => !value); }} />
            </div>
            {/* The budget messages already land in the field's own
                reserved slot above; the step notice would repeat the
                same sentence verbatim (the When step already
                suppresses its step notice the same way). */}
            {budgetFieldError ? null : <StepError error={translateText(error)} />}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-5">
            <p className="text-sm leading-6 text-cink">
              {translateText("Pace, walking, and transport start on a labeled default. Interests are optional — pick any that fit, or leave them empty and Roamly balances your days.")}
            </p>
            <div>
              <FieldLabel>
                {translateText("Travel style")}
                {travelStyle === PLAN_PREFERENCE_DEFAULTS.travelStyle ? <span className="ml-2 text-xs font-semibold text-cgray">{translateText("Default")}</span> : null}
              </FieldLabel>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {planningTravelStyles.map((style) => (
                  <Chip
                    key={style}
                    label={style}
                    selected={travelStyle === style}
                    isDefault={style === PLAN_PREFERENCE_DEFAULTS.travelStyle}
                    onClick={() => {
                      notePlanEdit();
                      setTravelStyle(style);
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>{translateText("Interests")}</FieldLabel>
              <p className="mt-1 text-xs font-semibold leading-5 text-cgray">
                {interests.length ? interests.join(", ") : translateText("No preference — Roamly balances it")}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {planningInterests.map((interest) => (
                  <Chip key={interest} label={interest} selected={interests.includes(interest)} onClick={() => { notePlanEdit(); toggleInterest(interest); }} />
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <PlanSelectField
                label={<>{translateText("Pace")}{pace === PLAN_PREFERENCE_DEFAULTS.pace ? <span className="ml-2 text-xs font-semibold text-cgray">{translateText("Default")}</span> : null}</>}
                value={pace} onChange={(value) => { notePlanEdit(); setPace(value as typeof pace); }} options={planningPaces} defaultValue={PLAN_PREFERENCE_DEFAULTS.pace} />
              <PlanSelectField
                label={<>{translateText("Walking tolerance")}{walkingTolerance === PLAN_PREFERENCE_DEFAULTS.walkingTolerance ? <span className="ml-2 text-xs font-semibold text-cgray">{translateText("Default")}</span> : null}</>}
                value={walkingTolerance}
                onChange={(value) => { notePlanEdit(); setWalkingTolerance(value as typeof walkingTolerance); }}
                options={walkingToleranceOptions}
                defaultValue={PLAN_PREFERENCE_DEFAULTS.walkingTolerance}
              />
              <PlanSelectField
                label={<>{translateText("Transportation")}{transportationPreference === PLAN_PREFERENCE_DEFAULTS.transportation ? <span className="ml-2 text-xs font-semibold text-cgray">{translateText("Default")}</span> : null}</>}
                value={transportationPreference}
                onChange={(value) => { notePlanEdit(); setTransportationPreference(value as typeof transportationPreference); }}
                options={transportationOptions}
                defaultValue={PLAN_PREFERENCE_DEFAULTS.transportation}
              />
            </div>
            <details className="group border-y border-chair/80 py-3">
              <summary className="cursor-pointer list-none text-sm font-bold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/15">
                {translateText("More preferences")}
                <span className="float-right text-cink transition group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <div className="mt-3 grid gap-4">
                <PlanSelectField
                  label={<>{translateText("Accommodation")}{accommodationPreference === PLAN_PREFERENCE_DEFAULTS.accommodation ? <span className="ml-2 text-xs font-semibold text-cgray">{translateText("Default")}</span> : null}</>}
                  value={accommodationPreference}
                  onChange={(value) => setAccommodationPreference(value as typeof accommodationPreference)}
                  options={accommodationOptions}
                  defaultValue={PLAN_PREFERENCE_DEFAULTS.accommodation}
                />
                <div className="border-t border-chair/70 pt-3">
                  <p className="text-xs font-black text-chead">{translateText("Not plan inputs")}</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-cgray">
                    {translateText("Roamly cannot apply these yet, so it does not ask for them — this list is information only, and nothing in it is collected or sent with your plan")}: {PLANNER_BACKEND_CAPABILITY_GAPS.join(" · ")}.
                  </p>
                </div>
              </div>
            </details>
            <details className="group border-y border-chair/80 py-3">
              <summary className="cursor-pointer list-none text-sm font-bold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/15">
                {translateText("Specific needs or notes")}
                <span className="float-right text-cink transition group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <PlanField label={translateText("Accessibility needs")} value={accessibilityNeeds} onChange={setAccessibilityNeeds} ariaLabel="Accessibility needs" />
                <PlanField label={translateText("Dietary preference")} value={dietaryPreference} onChange={setDietaryPreference} ariaLabel="Dietary preference" />
              </div>
              <PlanAreaField
                className="mt-3"
                label={translateText("Special notes")}
                value={specialNotes}
                onChange={setSpecialNotes}
                ariaLabel="Special trip notes"
                helper={translateText("Add mobility needs, must-see spots, food restrictions, celebrations, weather backup plans, or anything Roamly should consider.")}
              />
            </details>
            {/* A12 (merge, 2026-11-05): interests are optional and
                never produce a field error, so there is no field
                slot to duplicate — the step notice renders as-is. */}
            <StepError error={translateText(error)} />
          </div>
        ) : null}

        {step === 5 ? (
          <div className="grid gap-4">
              <div className="border-y border-cblue/20 bg-cblue/5 py-4 text-chead sm:py-5">
              <p className="text-sm font-semibold text-cblue">{translateText("Trip brief")}</p>
              <h3 className="mt-2 whitespace-normal break-words text-xl font-black text-chead">{normalizedDestination || translateText("Destination pending")}</h3>
              <p className="mt-3 text-sm font-semibold leading-6 text-cink">{translateText(entitlement.reviewLead)}</p>
              <div className="mt-4 grid gap-2 text-sm font-bold text-cink">
                {summaryRows.map(([label, value]) => (
                  <p key={label}>
                    <span className="text-chead">{translateText(label)}:</span> {value}
                  </p>
                ))}
              </div>
              {notePreview.constraints.length ? (
                <div className="mt-4 grid gap-2 text-sm font-semibold leading-6 text-cink">
                  {notePreview.constraints.map((line) => <p key={line}>{line}</p>)}
                  {notePreview.hotel ? <p className="text-sm leading-6 text-cink">{notePreview.hotel}</p> : null}
                  {notePreview.flight ? <p className="text-sm leading-6 text-cink">{notePreview.flight}</p> : null}
                  {notePreview.activity ? <p className="text-sm leading-6 text-cink">{notePreview.activity}</p> : null}
                  {notePreview.gaps.length ? <p className="text-xs font-bold leading-5 text-cgray">{notePreview.gaps.join(" ")}</p> : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-corange/30 bg-[#FFF6EE] px-4 py-4">
              <p className="text-sm font-semibold leading-6 text-chead">{translateText(entitlement.nextStep)}</p>
              <p className="mt-2 text-sm leading-6 text-cink">
                {translateText("Review your trip details carefully. After generation, your saved itinerary will not be regenerated in place. Use your trip page to request supported changes.")}
              </p>
            </div>
            <StepError error={translateText(error)} />
          </div>
        ) : null}
      </div>

      {notice && !(priceChecking && notice === "Checking trip costs...") ? (
        <div className="mt-4">
          <BuiNotice tone="info" title={translateText(notice)} />
        </div>
      ) : null}

      {priceChecking ? (
        <div className="mt-4 overflow-hidden rounded-2xl bg-cbg p-4">
          <div className="h-2 animate-pulse rounded-full bg-cblue motion-reduce:animate-none" />
          <p className="mt-3 text-sm font-black text-chead">
            {translateText("Checking trip costs...")}
          </p>
        </div>
      ) : null}

      {step === steps.length - 1 && priceDiscovery ? (
        <div className="mt-4 rounded-[1.5rem] border border-chair bg-white p-4 shadow-bui-card">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateText("Budget check")}</p>
          <h3 className="mt-2 text-xl font-black text-chead">{translateText(budgetStatusCopy(priceDiscovery.budgetStatus))}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {priceDiscoveryRows.map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-cbg p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-cink">{translateText(label as string)}</p>
                <p className="mt-1 text-sm font-black text-chead">
                  {value}
                </p>
              </div>
            ))}
          </div>
          {priceDiscovery.cross_border ? (
            <p className="mt-3 text-xs font-semibold leading-5 text-cgray">
              {translateText(
                [
                  "Cross-border trip",
                  "Passport check",
                  priceDiscovery.currencyChange ? "Currency change" : "",
                  "Border time buffer",
                  "Roaming reminder",
                  "Customs reminder"
                ]
                  .filter(Boolean)
                  .join(" · ")
              )}
            </p>
          ) : null}
          {transportFaceOptions.length ? (
            <BuiEnterContent enterKey={transportEnterKey} className="mt-5">
              <p className="text-base font-black text-chead">{translateText(transportQuestion)}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label={translateText(transportQuestion)}>
                {transportPickable.map((option, index) => {
                  const face = TRANSPORT_MODE_FACE[option.mode];
                  const ModeIcon = face.Icon;
                  const selected = Boolean(
                    priceDiscovery.transportSelection &&
                      priceDiscovery.transportSelection.mode === option.mode &&
                      priceDiscovery.transportSelection.title === option.title
                  );
                  const priceText = formatTransportPriceFace(option, priceDiscovery.budgetCurrency, locale);
                  const durationText = formatTransportDurationFace(option);
                  return (
                    <BuiClickSpark key={`${option.mode}-${option.title}`} className="h-full">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => selectTransportOption(option)}
                      style={{ "--bui-delay": `${index * 70}ms` } as CSSProperties}
                      className={
                        "bui-enter bui-press bui-tap bui-squircle flex h-full min-h-[4.25rem] w-full items-center gap-3 rounded-bui-card border bg-white p-4 text-left shadow-bui-card transition-colors " +
                        (selected
                          ? "border-cblue bg-cblue/5 ring-1 ring-cblue"
                          : "border-chair hover:border-cblue/60")
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " +
                          (selected ? "border-cblue bg-cblue" : "border-chair bg-white")
                        }
                      >
                        {selected ? <Check className="bui-badge-pop h-3.5 w-3.5 text-white" strokeWidth={3.5} /> : null}
                      </span>
                      <ModeIcon className="h-6 w-6 shrink-0 text-cblue" strokeWidth={1.8} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-black leading-6 text-chead">{translateText(face.label)}</span>
                        {durationText ? (
                          <span className="block text-xs font-bold leading-5 text-cgray">{durationText}</span>
                        ) : null}
                        {selected ? (
                          <span className="block text-xs font-bold leading-5 text-cblue">
                            {translateText("Added to your itinerary and budget.")}
                          </span>
                        ) : option.presentation === "suggested" && option.presentation_label ? (
                          <span className="block text-xs font-bold leading-5 text-cblue">
                            {translateText(option.presentation_label)}
                          </span>
                        ) : null}
                      </span>
                      {priceText ? (
                        <span className="shrink-0 text-base font-black leading-6 text-chead">{priceText}</span>
                      ) : null}
                    </button>
                    </BuiClickSpark>
                  );
                })}
              </div>
              {transportUnavailable.length ? (
                <div className="mt-3 space-y-1">
                  {transportUnavailable.map((option) => (
                    <p key={`${option.mode}-${option.title}`} className="text-xs font-semibold leading-5 text-cgray">
                      {translateText(TRANSPORT_MODE_FACE[option.mode].label)} — {translateText(option.presentation_label || option.reason)}
                    </p>
                  ))}
                </div>
              ) : null}
              {transportProvenanceLine ? (
                <p className="mt-3 text-[0.7rem] font-semibold leading-5 text-cgray">{translateText(transportProvenanceLine)}</p>
              ) : null}
            </BuiEnterContent>
          ) : null}
          {priceDiscovery.hotelEstimateNote ? (
            <p className="mt-3 text-xs font-bold leading-5 text-cgray">{translateText(priceDiscovery.hotelEstimateNote)}</p>
          ) : null}
          <p className="mt-3 text-xs font-bold leading-5 text-cgray">{translateText(priceDiscovery.coverageNote)}</p>
        </div>
      ) : null}

      <div className="bui-safe-bottom mt-7 flex gap-3 border-t border-chair pt-5">
        <BuiButton type="button" variant="secondary" className="shrink-0" onClick={goBack} disabled={step === 0 || loading}>
          {translateText("Back")}
        </BuiButton>
        {step < steps.length - 1 ? (
          <BuiButton type="button" className="min-w-0 flex-1 !whitespace-normal text-center leading-snug" onClick={goNext} disabled={loading} aria-live="polite">
            {translateText(nextStepLabel)}
          </BuiButton>
        ) : (
          /* Batch 6: the submit is the BoardUI morph — pill →
             spinner as ONE shape (Smooth-Details set). The phase
             is wired to the form's existing busy state only: busy
             while costs are checked or generation/checkout starts.
             There is deliberately no "done" phase: this flow's
             success leaves the page (the notice + navigation are
             the success surface), and a tick hold would delay the
             navigation — a behaviour change, not a look change.
             The morph disables itself whenever the phase is not
             idle, which preserves the old busy-disable coverage;
             the generationInFlight ref + openFinalConfirmation's
             early return remain the real double-submit guards.
             The flex slot flips with the phase for a mechanical
             reason: flex-1's grow overrides the morph's animated
             width, so while busy the button is flex-none and the
             spring can actually shrink the shape; at rest flex-1
             keeps the full-width pill the footer has always had. */
          <BuiMorphButton
            type="button"
            phase={loading || priceChecking ? "busy" : "idle"}
            className={`min-w-0 !whitespace-normal bg-cblue px-5 py-3 text-center text-sm font-black leading-snug text-white shadow-[0_8px_20px_rgba(8,123,255,0.25)] hover:bg-[#0A6FE0] ${loading || priceChecking ? "flex-none" : "flex-1"}`}
            onClick={openFinalConfirmation}
            disabled={isCheckingSession && !sessionUser}
            aria-live="polite"
          >
            {loading && requiresPaidUnlock
              ? translateText("Opening checkout...")
              : loading
              ? translateText("Starting generation...")
              : priceChecking
              ? translateText("Checking costs...")
              : translateText(buildButtonLabel)}
          </BuiMorphButton>
        )}
      </div>
      {step === steps.length - 1 && buildButtonLabel !== entitlement.cta ? (
        <p className="mt-3 text-center text-xs font-bold leading-5 text-cgray">
          {translateText(entitlement.cta)}
        </p>
      ) : null}

      {step === steps.length - 1 ? (
        <p className="mt-3 text-center text-xs font-bold leading-5 text-cgray">
          {translateText(entitlement.footnote)}
        </p>
      ) : null}

    </section>
    )}
    </>
  );
}
