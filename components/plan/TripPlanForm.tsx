"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  normalizePlaceText,
  popularOriginPlaces,
  recommendedPlaces,
  type NormalizedPlace
} from "@/lib/roamly/places";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
import { RoamlyGeneratingLoader } from "@/components/roamly/RoamlyGeneratingLoader";
import { useI18n } from "@/components/i18n/I18nProvider";

const steps = [
  { title: "Route", detail: "Origin and stops" },
  { title: "Dates & travelers", detail: "When and who" },
  { title: "Budget", detail: "What the total includes" },
  { title: "Preferences", detail: "Pace, access, interests" },
  { title: "Review & generate", detail: "Check costs first" }
];

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
  bufferEstimateCents: number;
  totalEstimateCents: number;
  committedBudgetCents: number;
  remainingBudgetCents: number | null;
  budgetStatus: "within_budget" | "tight" | "over_budget" | "unknown";
  budgetCurrency: string;
  coverageNote: string;
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

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

const primaryActionClass =
  "bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60";
const selectedPrimaryOptionClass =
  "border-cyan-300 bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20";
const selectedWarmOptionClass =
  "border-orange-300 bg-gradient-to-r from-orange-400 to-rose-400 text-white shadow-lg shadow-orange-400/20";
const unselectedOptionClass =
  "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 hover:shadow-lg hover:shadow-cyan-500/10";
const GENERATION_ERROR_MESSAGE = "Roamly could not generate this itinerary. Please adjust your trip details and try again.";
const AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
const GENERATION_TIMEOUT_MS = 120_000;
const PLAN_DRAFT_KEY = "roamly.plan.draft.v1";
const PLAN_RESUME_PATH = "/plan?resumePlan=1";

function selectedOptionClass(label: string) {
  return ["Food", "Nightlife", "Romance", "Premium"].includes(label)
    ? selectedWarmOptionClass
    : selectedPrimaryOptionClass;
}

function planLoginUrl() {
  return `/login?next=${encodeURIComponent(PLAN_RESUME_PATH)}`;
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-black text-ink">{children}</span>;
}

function formatMoney(cents: number | null, currency: string) {
  if (cents == null) return "Not set";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function budgetStatusCopy(status: PriceDiscoveryResult["budgetStatus"]) {
  if (status === "unknown") {
    return "Add a total budget to compare this estimate against your comfort zone.";
  }
  if (status === "tight") {
    return "Your budget is tight. Roamly will prioritize affordable stays, free attractions, public transit, and low-cost food.";
  }
  if (status === "over_budget") {
    return "This trip may exceed your budget. Roamly can suggest cheaper city order, shorter stays, fewer paid activities, lower-cost hotel areas, public transit, excluding flights or hotel, or increasing budget.";
  }
  return "Your trip looks possible within budget.";
}

function TextInput({
  value,
  onChange,
  ariaLabel,
  type = "text",
  min
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  type?: "text" | "date" | "number";
  min?: string | number;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={type}
      min={min ?? (type === "date" ? todayIsoDate() : undefined)}
      aria-label={ariaLabel}
      className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
    />
  );
}

function SelectField({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  const { translateText } = useI18n();

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {translateText(option)}
        </option>
      ))}
    </select>
  );
}

function Chip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { translateText } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-2xl border px-4 py-3 text-sm font-black transition",
        selected ? selectedOptionClass(label) : unselectedOptionClass
      )}
    >
      {translateText(label)}
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
  return (
    <button
      type="button"
      onClick={onToggle}
      className={classNames(
        "rounded-2xl px-4 py-3 text-left text-sm font-black ring-1 transition",
        enabled
          ? "bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-lg shadow-cyan-500/20 ring-cyan-300"
          : "bg-white text-slate-700 ring-slate-200 hover:ring-cyan-300 hover:text-cyan-700"
      )}
    >
      <span className="block">{translateText(label)}</span>
      <span className={classNames("mt-1 block text-xs", enabled ? "text-white/85" : "text-slate-500")}>
        {enabled ? translateText("Yes") : translateText("No")}
      </span>
    </button>
  );
}

export function TripPlanForm({
  freeItineraryUsed = false,
  testerAccess = false
}: {
  freeItineraryUsed?: boolean;
  testerAccess?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, translateText } = useI18n();
  const shouldShowResumeNotice = searchParams.get("resumePlan") === "1";
  const [step, setStep] = useState(0);
  const [originPlace, setOriginPlace] = useState<NormalizedPlace | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<NormalizedPlace | null>(null);
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
  const [travelStyle, setTravelStyle] = useState<(typeof planningTravelStyles)[number]>("Balanced");
  const [interests, setInterests] = useState<string[]>(["Food", "Culture"]);
  const [pace, setPace] = useState<(typeof planningPaces)[number]>("Balanced");
  const [walkingTolerance, setWalkingTolerance] = useState<(typeof walkingToleranceOptions)[number]>("Medium");
  const [accommodationPreference, setAccommodationPreference] =
    useState<(typeof accommodationOptions)[number]>("Mid-range");
  const [transportationPreference, setTransportationPreference] =
    useState<(typeof transportationOptions)[number]>("Mixed");
  const [accessibilityNeeds, setAccessibilityNeeds] = useState("");
  const [dietaryPreference, setDietaryPreference] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [priceChecking, setPriceChecking] = useState(false);
  const [priceDiscovery, setPriceDiscovery] = useState<PriceDiscoveryResult | null>(null);
  const [priceDiscoveryId, setPriceDiscoveryId] = useState<string | null>(null);
  const [budgetConstraint, setBudgetConstraint] = useState("");
  const [restoreNotice, setRestoreNotice] = useState(false);
  const trackedSelections = useRef(new Set<string>());
  const generationInFlight = useRef(false);
  const draftHydrated = useRef(false);
  const skipNextDraftSave = useRef(false);

  useEffect(() => {
    trackPlanEvent("plan_started");
  }, []);

  const validStops = useMemo(() => stops.map((stop) => stop.place).filter((place): place is NormalizedPlace => isValidPlaceValue(place?.value)), [stops]);
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
  const progress = Math.round(((step + 1) / steps.length) * 100);

  function resetDiscovery() {
    setPriceDiscovery(null);
    setPriceDiscoveryId(null);
    setBudgetConstraint("");
  }

  function applyCurrency(place: NormalizedPlace | null) {
    if (isCurrencyOption(place?.currency)) setBudgetCurrency(place.currency);
  }

  function setOrigin(place: NormalizedPlace | null) {
    setOriginPlace(place);
    if (place && place.source !== "custom" && !trackedSelections.current.has(`origin:${place.value}`)) {
      trackedSelections.current.add(`origin:${place.value}`);
      trackPlanEvent("origin_selected", { origin: place.value, source: place.source, country: place.country || null });
    }
    resetDiscovery();
  }

  function setDestination(place: NormalizedPlace | null) {
    setDestinationPlace(place);
    if (place && place.source !== "custom" && !trackedSelections.current.has(`destination:${place.value}`)) {
      trackedSelections.current.add(`destination:${place.value}`);
      trackPlanEvent("destination_selected", { destination: place.value, source: place.source, country: place.country || null });
    }
    applyCurrency(place);
    resetDiscovery();
  }

  function setStopPlace(id: string, place: NormalizedPlace | null) {
    setStops((current) => current.map((stop) => (stop.id === id ? { ...stop, place } : stop)));
    if (place && place.source !== "custom" && !trackedSelections.current.has(`stop:${id}:${place.value}`)) {
      trackedSelections.current.add(`stop:${id}:${place.value}`);
      trackPlanEvent("destination_selected", { destination: place.value, source: place.source, stopId: id });
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
      daysCount: toNumberOrNull(daysCount),
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
      daysCount,
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
      days_count: daysCount,
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
      transportationPreference
    ]
  );

  const saveCurrentPlanDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify(planDraft));
    } catch {
      // Draft persistence should never block planning or auth navigation.
    }
  }, [planDraft]);

  const restorePlanDraft = useCallback((record: Record<string, unknown>) => {
    const travelers = getRecord(record.travelers);
    setStep(clampStep(record.currentStep ?? record.step));
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
    setInterests(readDraftStringArray(record.interests, ["Food", "Culture"]));
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
    setConfirming(false);
    setPriceChecking(false);
    generationInFlight.current = false;
  }, []);

  function resetPlanner() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PLAN_DRAFT_KEY);
    }
    skipNextDraftSave.current = true;
    trackedSelections.current.clear();
    generationInFlight.current = false;
    setRestoreNotice(false);
    setStep(0);
    setOriginPlace(null);
    setDestinationPlace(null);
    setTripType("single_destination");
    setStops(defaultStops());
    setReturnToOrigin(true);
    setFlexibleCityOrder(false);
    setFlexibleDates(false);
    setStartDate("");
    setEndDate("");
    setDaysCount("");
    setAdults("1");
    setChildren("0");
    setInfants("0");
    setRooms("1");
    setBedPreference("No preference");
    setBudgetAmount("");
    setBudgetCurrency("CAD");
    setBudgetIncludesFlights(true);
    setBudgetIncludesHotel(true);
    setBudgetIncludesActivities(true);
    setTravelStyle("Balanced");
    setInterests(["Food", "Culture"]);
    setPace("Balanced");
    setWalkingTolerance("Medium");
    setAccommodationPreference("Mid-range");
    setTransportationPreference("Mixed");
    setAccessibilityNeeds("");
    setDietaryPreference("");
    setSpecialNotes("");
    setError("");
    setNotice("");
    setLoading(false);
    setConfirming(false);
    setPriceChecking(false);
    setPriceDiscovery(null);
    setPriceDiscoveryId(null);
    setBudgetConstraint("");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    skipNextDraftSave.current = true;
    const raw = window.localStorage.getItem(PLAN_DRAFT_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const record = getRecord(parsed);
        if (record) {
          restorePlanDraft(record);
          setRestoreNotice(shouldShowResumeNotice);
        }
      } catch {
        window.localStorage.removeItem(PLAN_DRAFT_KEY);
      }
    }

    draftHydrated.current = true;
  }, [restorePlanDraft, shouldShowResumeNotice]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    if (skipNextDraftSave.current) {
      skipNextDraftSave.current = false;
      return;
    }
    saveCurrentPlanDraft();
  }, [saveCurrentPlanDraft]);

  function validateStep(stepToValidate: number) {
    if (stepToValidate === 0) {
      if (!isValidPlaceValue(payload.origin)) return "Please choose or enter your origin before continuing.";
      if (tripType === "multi_city" && validStops.length < 2) return "Please add at least two cities for a multi-city trip.";
      if (tripType === "single_destination" && !isValidPlaceValue(payload.destination)) {
        return "Please choose or enter a destination before continuing.";
      }
    }
    if (stepToValidate === 1) {
      if (!daysCount && (!startDate || !endDate)) return "Add dates or a number of days.";
      if (adultCount < 1) return "Add at least one adult traveler.";
      if (roomCount < 1) return "Add at least one room.";
    }
    if (stepToValidate === 2 && !budgetAmount) return "Add an estimated budget.";
    if (stepToValidate === 3 && interests.length === 0) return "Pick at least one interest.";
    return "";
  }

  function validateBeforeGenerate() {
    for (let index = 0; index < steps.length - 1; index += 1) {
      const validation = validateStep(index);
      if (validation) return validation;
    }
    return "";
  }

  function goNext() {
    const validation = validateStep(step);
    setError(validation);
    if (validation) return;
    if (step === 1) {
      trackPlanEvent("dates_selected", {
        startDate,
        endDate,
        daysCount: payload.daysCount,
        travelersCount: payload.travelersCount,
        rooms: payload.rooms
      });
    }
    if (step === 2) {
      trackPlanEvent("budget_submitted", {
        budgetAmount: payload.budgetAmount,
        budgetCurrency: payload.budgetCurrency,
        budgetIncludesFlights,
        budgetIncludesHotel,
        budgetIncludesActivities
      });
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setError("");
    setNotice("");
    setStep((current) => Math.max(current - 1, 0));
  }

  async function runPriceDiscovery() {
    setPriceChecking(true);
    setNotice("Checking trip costs...");
    setError("");
    trackPlanEvent("price_discovery_started", { tripType, destination: payload.destination });

    try {
      const response = await fetch("/api/roamly/price-discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        saveCurrentPlanDraft();
        router.push(planLoginUrl());
        return false;
      }
      if (!response.ok) throw new Error(data?.message || data?.error || "Could not check trip costs.");
      setPriceDiscovery(data.discovery);
      setPriceDiscoveryId(data.discoveryId || null);
      setBudgetConstraint(data.budgetConstraint || "");
      trackPlanEvent("price_discovery_completed", {
        tripType,
        destination: payload.destination,
        budgetStatus: data.discovery?.budgetStatus,
        totalEstimateCents: data.discovery?.totalEstimateCents
      });
      setNotice("");
      return true;
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not check trip costs.");
      trackPlanEvent("price_discovery_failed", {
        tripType,
        destination: payload.destination,
        error: err instanceof Error ? err.message : "Could not check trip costs."
      });
      return false;
    } finally {
      setPriceChecking(false);
    }
  }

  async function openFinalConfirmation() {
    if (loading || priceChecking) return;
    const validation = validateBeforeGenerate();
    setError(validation);
    setNotice("");
    if (validation) return;
    saveCurrentPlanDraft();
    const checked = await runPriceDiscovery();
    if (!checked) return;
    setConfirming(true);
  }

  async function submitPlan() {
    if (generationInFlight.current) return;
    const validation = validateBeforeGenerate();
    setError(validation);
    setNotice("");
    if (validation) return;

    saveCurrentPlanDraft();
    generationInFlight.current = true;
    setLoading(true);
    trackPlanEvent("itinerary_generation_started", { tripType, destination: payload.destination });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch("/api/trips/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        setConfirming(false);
        saveCurrentPlanDraft();
        router.push(planLoginUrl());
        return;
      }

      if (response.ok && data?.tripId) {
        trackPlanEvent("itinerary_generation_completed", { tripType, destination: payload.destination, tripId: data.tripId });
        setConfirming(false);
        router.push(data.previewUrl || `/trip/${data.tripId}`);
        return;
      }

      if (response.status === 402 && data?.previewUrl) {
        trackPlanEvent("itinerary_generation_failed", {
          tripType,
          destination: payload.destination,
          error: "PAYMENT_REQUIRED"
        });
        setConfirming(false);
        router.push(data.previewUrl);
        return;
      }

      if (response.status === 404 || response.status === 501) {
        setConfirming(false);
        setError(GENERATION_ERROR_MESSAGE);
        return;
      }

      const failureMessage = data?.message || data?.setupHint || data?.error || GENERATION_ERROR_MESSAGE;
      if (failureMessage === AI_NOT_CONFIGURED_MESSAGE) {
        setConfirming(false);
        setError(AI_NOT_CONFIGURED_MESSAGE);
        return;
      }

      throw new Error(failureMessage);
    } catch (err) {
      setNotice("");
      setConfirming(false);
      setError(GENERATION_ERROR_MESSAGE);
      trackPlanEvent("itinerary_generation_failed", {
        tripType,
        destination: payload.destination,
        error: err instanceof Error ? err.message : GENERATION_ERROR_MESSAGE
      });
    } finally {
      window.clearTimeout(timeout);
      generationInFlight.current = false;
      setLoading(false);
    }
  }

  const summaryRows = [
    ["Route", routePreview || "Route pending"],
    ["Dates", payload.daysCount ? `${payload.daysCount} days` : `${payload.startDate || "Start"} to ${payload.endDate || "End"}`],
    ["Travelers", `${adultCount} adults, ${childCount} children${infantCount ? `, ${infantCount} infants` : ""}`],
    ["Rooms", `${roomCount} room${roomCount === 1 ? "" : "s"}${bedPreference !== "No preference" ? `, ${bedPreference}` : ""}`],
    ["Budget", payload.budgetAmount ? `${payload.budgetCurrency} ${payload.budgetAmount}` : "Budget pending"],
    ["Style", `${payload.travelStyle} style, ${payload.pace} pace, ${payload.walkingTolerance} walking`],
    ["Interests", payload.interests.join(", ") || "No interests selected"]
  ];

  return (
    <section className="rounded-[2rem] border border-cloud bg-white/92 p-4 shadow-soft backdrop-blur sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            {translateText("Step")} {step + 1} {translateText("of")} {steps.length}
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">{translateText(steps[step].title)}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">{translateText(steps[step].detail)}</p>
          {testerAccess ? (
            <p className="mt-2 w-fit rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
              {translateText("Tester access")}
            </p>
          ) : null}
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-mist text-sm font-black text-ocean">
          {progress}%
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-cloud">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ocean to-lagoon transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {restoreNotice ? (
        <div className="mt-5 flex flex-col gap-3 rounded-[1.25rem] border border-ocean/20 bg-ocean/10 p-4 text-ocean sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black">Your trip plan was restored. Continue where you left off.</p>
          <button
            type="button"
            onClick={resetPlanner}
            className="w-fit rounded-2xl bg-white px-4 py-2 text-xs font-black text-ocean shadow-soft transition hover:text-ink"
          >
            Start over
          </button>
        </div>
      ) : null}

      <div className="mt-5 min-h-[24rem]">
        {step === 0 ? (
          <div className="grid gap-4">
            <PlaceSelector
              label="Origin / leaving from"
              value={originPlace}
              onChange={setOrigin}
              placeholder="Search origin"
              helper="Choose a known origin to improve flight and transport estimates. You can still type a custom origin if it is not listed."
              popularPlaces={popularOriginPlaces}
            />

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["single_destination", "Single destination"],
                ["multi_city", "Multi-city trip"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setTripType(value as TripType);
                    if (value === "multi_city") trackPlanEvent("multi_city_selected");
                    resetDiscovery();
                  }}
                  className={classNames(
                    "rounded-2xl border px-4 py-3 text-left text-sm font-black transition",
                    tripType === value ? selectedOptionClass(label) : unselectedOptionClass
                  )}
                >
                  {translateText(label)}
                </button>
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
              <div className="rounded-[1.5rem] border border-cloud bg-mist/60 p-4">
                <p className="text-sm font-black text-ink">{translateText("Multi-city trip")}</p>
                <p className="mt-1 text-sm font-bold leading-6 text-slate-500">
                  {translateText("Add each city in the order you want to visit. Roamly will build the route and budget around these stops.")}
                </p>
                <div className="mt-4 grid gap-3">
                  {stops.map((stop, index) => (
                    <div key={stop.id} className="rounded-2xl border border-cloud bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
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
                  className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 hover:shadow-lg hover:shadow-cyan-500/10"
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
              <div className="rounded-[1.5rem] border border-ocean/20 bg-ocean/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Route")}</p>
                <p className="mt-2 text-base font-black leading-7 text-ink">{routePreview}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>{translateText("Start date")}</FieldLabel>
                <TextInput value={startDate} onChange={setStartDate} type="date" ariaLabel="Start date" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("End date")}</FieldLabel>
                <TextInput value={endDate} onChange={setEndDate} type="date" ariaLabel="End date" />
              </label>
            </div>
            <label className="block">
              <FieldLabel>{translateText("Or number of days")}</FieldLabel>
              <TextInput value={daysCount} onChange={setDaysCount} type="number" min={1} ariaLabel="Number of travel days" />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <FieldLabel>{translateText("Adults")}</FieldLabel>
                <TextInput value={adults} onChange={setAdults} type="number" min={1} ariaLabel="Adults" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Children")}</FieldLabel>
                <TextInput value={children} onChange={setChildren} type="number" min={0} ariaLabel="Children" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Infants")}</FieldLabel>
                <TextInput value={infants} onChange={setInfants} type="number" min={0} ariaLabel="Infants" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[0.6fr_1fr]">
              <label className="block">
                <FieldLabel>{translateText("Rooms")}</FieldLabel>
                <TextInput value={rooms} onChange={setRooms} type="number" min={1} ariaLabel="Rooms" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Bed preference")}</FieldLabel>
                <SelectField value={bedPreference} onChange={(value) => setBedPreference(value as typeof bedPreference)} options={bedPreferenceOptions} />
              </label>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr]">
              <label className="block">
                <FieldLabel>{translateText("Budget amount")}</FieldLabel>
                <TextInput value={budgetAmount} onChange={setBudgetAmount} type="number" min={1} ariaLabel="Budget amount" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Currency")}</FieldLabel>
                <SelectField value={budgetCurrency} onChange={(value) => setBudgetCurrency(value as typeof budgetCurrency)} options={currencyOptions} />
              </label>
            </div>
            <div className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{translateText("Roamly budget rule")}</p>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                {translateText("Use your comfortable total. Roamly checks flights, stays, food, activities, local transportation, and buffer before generation.")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ToggleButton label="Budget includes flights" enabled={budgetIncludesFlights} onToggle={() => setBudgetIncludesFlights((value) => !value)} />
              <ToggleButton label="Budget includes hotel" enabled={budgetIncludesHotel} onToggle={() => setBudgetIncludesHotel((value) => !value)} />
              <ToggleButton label="Budget includes activities" enabled={budgetIncludesActivities} onToggle={() => setBudgetIncludesActivities((value) => !value)} />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-5">
            <div>
              <FieldLabel>{translateText("Travel style")}</FieldLabel>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {planningTravelStyles.map((style) => (
                  <Chip key={style} label={style} selected={travelStyle === style} onClick={() => setTravelStyle(style)} />
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>{translateText("Pace")}</FieldLabel>
                <SelectField value={pace} onChange={(value) => setPace(value as typeof pace)} options={planningPaces} />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Walking tolerance")}</FieldLabel>
                <SelectField
                  value={walkingTolerance}
                  onChange={(value) => setWalkingTolerance(value as typeof walkingTolerance)}
                  options={walkingToleranceOptions}
                />
              </label>
            </div>
            <div>
              <FieldLabel>{translateText("Interests")}</FieldLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {planningInterests.map((interest) => (
                  <Chip key={interest} label={interest} selected={interests.includes(interest)} onClick={() => toggleInterest(interest)} />
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>{translateText("Accommodation")}</FieldLabel>
                <SelectField
                  value={accommodationPreference}
                  onChange={(value) => setAccommodationPreference(value as typeof accommodationPreference)}
                  options={accommodationOptions}
                />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Transportation")}</FieldLabel>
                <SelectField
                  value={transportationPreference}
                  onChange={(value) => setTransportationPreference(value as typeof transportationPreference)}
                  options={transportationOptions}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>{translateText("Accessibility needs")}</FieldLabel>
                <TextInput value={accessibilityNeeds} onChange={setAccessibilityNeeds} ariaLabel="Accessibility needs" />
              </label>
              <label className="block">
                <FieldLabel>{translateText("Dietary preference")}</FieldLabel>
                <TextInput value={dietaryPreference} onChange={setDietaryPreference} ariaLabel="Dietary preference" />
              </label>
            </div>
            <label className="block">
              <FieldLabel>{translateText("Special notes")}</FieldLabel>
              <textarea
                value={specialNotes}
                onChange={(event) => setSpecialNotes(event.target.value)}
                rows={4}
                aria-label="Special trip notes"
                className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold leading-7 text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
              />
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                {translateText("Add mobility needs, must-see spots, food restrictions, celebrations, weather backup plans, or anything Roamly should consider.")}
              </p>
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4">
            <div className="rounded-[1.5rem] border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_55%,#fff7ed_100%)] p-4 text-ink shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{translateText("Trip brief")}</p>
              <h3 className="mt-2 text-xl font-black text-ink">{normalizedDestination || translateText("Destination pending")}</h3>
              <div className="mt-4 grid gap-2 text-sm font-bold text-slate-600">
                {summaryRows.map(([label, value]) => (
                  <p key={label}>
                    <span className="text-ink">{translateText(label)}:</span> {value}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-sun/30 bg-sun/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">{translateText("Before you generate")}</p>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
                {translateText("Review your trip details carefully. Once your itinerary is generated, it cannot be edited. New destinations, date changes, or major changes require a new itinerary.")}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {translateText(error)}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-4 rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {translateText(notice)}
        </p>
      ) : null}

      {loading && !confirming ? (
        <RoamlyGeneratingLoader className="mt-4" />
      ) : null}

      {priceChecking ? (
        <div className="mt-4 overflow-hidden rounded-2xl bg-mist p-4">
          <div className="h-2 animate-pulse rounded-full bg-lagoon" />
          <p className="mt-3 text-sm font-black text-ink">
            {translateText("Checking trip costs...")}
          </p>
        </div>
      ) : null}

      {step === steps.length - 1 && priceDiscovery ? (
        <div className="mt-4 rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{translateText("Budget check")}</p>
          <h3 className="mt-2 text-xl font-black text-ink">{translateText(budgetStatusCopy(priceDiscovery.budgetStatus))}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              ["Flights", priceDiscovery.flightEstimateCents],
              ["Hotel/stay", priceDiscovery.hotelEstimateCents],
              ["Activities", priceDiscovery.activitiesEstimateCents],
              ["Food", priceDiscovery.foodEstimateCents],
              ["Local transport", priceDiscovery.localTransportEstimateCents],
              ["Buffer", priceDiscovery.bufferEstimateCents],
              ["Committed bookings", priceDiscovery.committedBudgetCents],
              ["Total estimate", priceDiscovery.totalEstimateCents],
              ["Remaining budget", priceDiscovery.remainingBudgetCents]
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-mist p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-slate-400">{translateText(label as string)}</p>
                <p className="mt-1 text-sm font-black text-ink">
                  {formatMoney(value as number | null, priceDiscovery.budgetCurrency)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{translateText(priceDiscovery.coverageNote)}</p>
        </div>
      ) : null}

      <div className="sticky bottom-3 z-20 mt-5 grid grid-cols-2 gap-3 rounded-[1.25rem] bg-white/95 p-2 shadow-soft backdrop-blur sm:static sm:p-0 sm:shadow-none">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || loading}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-soft transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-cyan-700 disabled:translate-y-0 disabled:opacity-40"
        >
          {translateText("Back")}
        </button>
        {step < steps.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={loading}
            className={classNames("rounded-2xl px-5 py-3 text-sm font-black", primaryActionClass)}
          >
            {translateText("Continue")}
          </button>
        ) : (
          <button
            type="button"
            onClick={openFinalConfirmation}
            disabled={loading || priceChecking}
            className={classNames("rounded-2xl px-5 py-3 text-sm font-black", primaryActionClass)}
          >
            {priceChecking
              ? translateText("Checking costs...")
              : testerAccess && freeItineraryUsed
                ? translateText("Continue as tester")
                : freeItineraryUsed
                ? translateText("Unlock itinerary — $4.99 CAD")
                : translateText("Generate my free itinerary")}
          </button>
        )}
      </div>

      {step === steps.length - 1 ? (
        <p className="mt-3 text-center text-xs font-bold leading-5 text-slate-500">
          {freeItineraryUsed
            ? testerAccess
              ? translateText("Tester activity is excluded from revenue totals where possible.")
              : translateText("One custom itinerary for one trip. No subscription.")
            : translateText("You get 1 free itinerary per account.")}
        </p>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 px-4 backdrop-blur-sm">
          {loading ? (
            <RoamlyGeneratingLoader className="w-full max-w-xl" />
          ) : (
            <div className="w-full max-w-md rounded-[1.5rem] border border-cloud bg-white p-5 shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{translateText("Final step")}</p>
              <h2 className="mt-2 text-2xl font-black text-ink">{translateText("Generate and lock this itinerary?")}</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
                {translateText("Once generated, this itinerary cannot be edited or regenerated. Please confirm your destination, dates, travelers, budget, and preferences are correct.")}
              </p>
              {priceDiscovery ? (
                <div className="mt-4 rounded-2xl bg-mist p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{translateText("Budget status")}</p>
                  <p className="mt-1 text-sm font-black text-ink">{translateText(budgetStatusCopy(priceDiscovery.budgetStatus))}</p>
                  <p className="mt-2 text-xs font-bold text-slate-500">
                    {translateText("Total estimate")}: {formatMoney(priceDiscovery.totalEstimateCents, priceDiscovery.budgetCurrency)}
                  </p>
                </div>
              ) : null}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-60"
                >
                  {translateText("Go back and edit")}
                </button>
                <button
                  type="button"
                  onClick={submitPlan}
                  disabled={loading}
                  className={classNames("rounded-2xl px-5 py-3 text-sm font-black", primaryActionClass)}
                >
                  {testerAccess && freeItineraryUsed ? translateText("Continue as tester") : translateText("Generate itinerary")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
