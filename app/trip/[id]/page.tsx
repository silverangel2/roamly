import Image from "next/image";
import { redirect } from "next/navigation";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { MarketPriceRefreshButton } from "@/components/trip/MarketPriceRefreshButton";
import { TripShareActions } from "@/components/trip/TripShareActions";
import { TripBookingsManager } from "@/components/roamly/TripBookingsManager";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  buildPreviewFromItinerary,
  formatMoney,
  getItineraryTotalEstimateAmount,
  type RoamlyItinerary,
  type RoamlyPreview
} from "@/lib/itinerary";
import { confirmCheckoutSessionForTrip } from "@/lib/payments";
import { isEmailConfigured } from "@/lib/roamly/email";
import { affiliateDisclosure } from "@/lib/roamly/affiliateLinks";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import type { TransportOption } from "@/lib/roamly/transportOptions";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordAppEvent } from "@/lib/roamly/events";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  googleSearchUrl,
  safeExternalUrl,
  type BookingUrlType
} from "@/lib/roamly/bookingLinks";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDaysCount,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, isMissingTableError, type RoamlyTripRecord } from "@/lib/trips";

type TripPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type BadgeTone = "ocean" | "sun" | "coral" | "ink";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getStringList(value: unknown, fallback: string[] = [], limit = 10) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items.slice(0, limit) : fallback;
}

function compact(value: string | null | undefined, fallback: string, max = 190) {
  const text = (value || "").trim() || fallback;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function formatTripDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatDateRange(trip: RoamlyTripRecord) {
  const start = formatTripDate(trip.start_date);
  const end = formatTripDate(trip.end_date);
  if (start && end) return start === end ? start : `${start} - ${end}`;
  return start || end || "Dates flexible";
}

function getTravelStyle(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return trip.travel_style || getString(planning.travelStyle) || getString(planning.travel_style) || "Balanced";
}

function SetupCard({ title, summary }: { title: string; summary: string }) {
  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <Card>
        <Badge tone="sun">Setup</Badge>
        <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{summary}</p>
        <div className="mt-5">
          <Button href="/plan">Plan trip</Button>
        </div>
      </Card>
    </main>
  );
}

function NoticeBanner({ tone = "ocean", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  const toneClass =
    tone === "coral"
      ? "border-coral/25 bg-coral/10 text-coral"
      : tone === "sun"
        ? "border-sun/30 bg-sun/20 text-amber-800"
        : "border-ocean/20 bg-ocean/10 text-ocean";

  return <p className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${toneClass}`}>{children}</p>;
}

function PreviewDayCard({ item }: { item: RoamlyPreview["day_outline"][number] }) {
  const legacyActivityKey = "sam" + "ple_activity";
  const activityPreview =
    item.activity_preview || (item as unknown as Record<string, string>)[legacyActivityKey] || "";

  return (
    <Card className="p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Day {item.day_number}</p>
      <h3 className="mt-2 text-xl font-black text-ink">{item.title}</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{activityPreview}</p>
    </Card>
  );
}

function LockedCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-cloud bg-white/80 p-4 shadow-[0_12px_32px_rgba(16,32,51,0.06)]">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Locked</p>
      <h3 className="mt-2 text-lg font-black text-ink">{title}</h3>
      <p className="mt-2 text-sm font-bold leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function PrimaryTripAction({
  tripId,
  itineraryLocked,
  trackingUnlocked,
  paidForItinerary,
  freeAvailable,
  testerAccess,
  apiAuthToken
}: {
  tripId: string;
  itineraryLocked: boolean;
  trackingUnlocked: boolean;
  paidForItinerary: boolean;
  freeAvailable: boolean;
  testerAccess: boolean;
  apiAuthToken: string;
}) {
  if (itineraryLocked) {
    return trackingUnlocked ? (
      <Button href={`/trip/${tripId}/live`} className="w-full rounded-full px-4 py-3 sm:w-auto">
        Start Live Trip Companion
      </Button>
    ) : (
      <div className="w-full sm:max-w-xs">
        <ActivateTripButton
          tripId={tripId}
          itineraryLocked
          trackingUnlocked={false}
          showItineraryUnlock={false}
          testerAccess={testerAccess}
          apiAuthToken={apiAuthToken}
        />
      </div>
    );
  }

  if (paidForItinerary) {
    return (
      <div className="w-full sm:max-w-xs">
        <GenerateLockedItineraryButton
          tripId={tripId}
          label="Generate itinerary"
          subtext="This will lock the final itinerary permanently."
          apiAuthToken={apiAuthToken}
        />
      </div>
    );
  }

  if (freeAvailable) {
    return (
      <div className="w-full sm:max-w-xs">
        <GenerateLockedItineraryButton
          tripId={tripId}
          label="Generate my free itinerary"
          subtext="You get 1 free itinerary per account."
          apiAuthToken={apiAuthToken}
        />
      </div>
    );
  }

  return (
    <div className="w-full sm:max-w-xs">
      <ActivateTripButton
        tripId={tripId}
        itineraryLocked={false}
        trackingUnlocked={false}
        testerAccess={testerAccess}
        apiAuthToken={apiAuthToken}
      />
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  summary
}: {
  eyebrow: string;
  title: string;
  summary?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-ocean">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-ink sm:text-3xl">{title}</h2>
      </div>
      {summary ? <p className="max-w-xl text-sm font-bold leading-6 text-slate-600">{summary}</p> : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="roamly-print-section rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{label}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{value}</p>
    </article>
  );
}

function TimelineEntry({ label, text }: { label: string; text: string }) {
  return (
    <div className="relative pl-8">
      <span className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-4 border-white bg-lagoon shadow-[0_0_0_1px_rgba(27,154,170,0.25)]" />
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{text}</p>
    </div>
  );
}

function NavigationChipList({ query }: { query: string }) {
  const labels: Record<string, string> = {
    google_maps: "Google Maps",
    apple_maps: "Apple Maps",
    citymapper: "Citymapper"
  };
  const links = buildNavigationLinks({ destinationLabel: query, address: query });

  return (
    <div className="roamly-no-print mt-2 flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.provider}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1.5 text-[0.72rem] font-black text-ocean transition hover:border-ocean/40 hover:bg-ocean/10"
        >
          {labels[link.provider] || link.label}
        </a>
      ))}
    </div>
  );
}

function DayTimelineCard({
  day,
  currency
}: {
  day: RoamlyItinerary["daily_itinerary"][number];
  currency: string;
}) {
  const places = day.map_queries.slice(0, 5);

  return (
    <article className="roamly-day-print rounded-[1.15rem] border border-[#e8dfd0] bg-white p-5 shadow-[0_16px_42px_rgba(16,32,51,0.07)]">
      <div className="flex flex-col gap-3 border-b border-[#eee5d7] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.16em] text-ocean">
            Day {day.day_number}
            {day.city ? ` · ${day.city}` : ""}
            {day.date ? ` · ${formatTripDate(day.date)}` : ""}
          </p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-ink">{day.title}</h3>
        </div>
        <span className="w-fit rounded-full border border-ocean/20 bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
          Est. {formatMoney(day.estimated_cost, currency)}
        </span>
      </div>

      <div className="relative mt-5 grid gap-5 before:absolute before:left-2 before:top-3 before:h-[calc(100%-1.5rem)] before:w-px before:bg-gradient-to-b before:from-lagoon before:to-sun">
        <TimelineEntry label="Morning" text={day.morning} />
        <TimelineEntry label="Afternoon" text={day.afternoon} />
        <TimelineEntry label="Evening" text={day.evening} />
      </div>

      {day.food.length ? (
        <div className="mt-5 rounded-2xl bg-[#f8faf8] px-4 py-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Food ideas</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{day.food.slice(0, 3).join(" · ")}</p>
        </div>
      ) : null}

      {places.length ? (
        <div className="mt-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Places & directions</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {places.map((query) => (
              <div key={query} className="rounded-2xl border border-cloud bg-white px-4 py-3">
                <p className="text-sm font-black leading-5 text-ink">{query}</p>
                <NavigationChipList query={query} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function budgetRows({
  trip,
  itinerary,
  currency
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  currency: string;
}) {
  const estimate = itinerary.estimated_budget_breakdown;
  const budgetAmount = getTripBudgetAmount(trip);
  const totalEstimateAmount = getItineraryTotalEstimateAmount(itinerary);
  const balance = describeBudgetBalanceFromAmounts(budgetAmount, totalEstimateAmount, currency);
  const transportOptions = transportOptionsFromItinerary(itinerary);
  const recommendedTransport = recommendedTransportFromItinerary(itinerary);

  return [
    {
      label: "Recommended transport",
      value:
        trip.budget_includes_flights === false
          ? "Inter-city transport is not included in this trip budget."
          : formatBudgetTransportOption(recommendedTransport, currency)
    },
    {
      label: "Other options",
      value: formatOtherTransportOptions(transportOptions, recommendedTransport, currency)
    },
    {
      label: "Hotel",
      value: trip.budget_includes_hotel === false ? "Not included in trip budget." : estimate.lodging
    },
    { label: "Food", value: estimate.food },
    { label: "Transport", value: estimate.transport },
    { label: "Activities", value: estimate.activities },
    { label: "Buffer", value: estimate.buffer },
    {
      label: "Selected total",
      value: totalEstimateAmount == null ? estimate.total_estimate : formatBudgetMoney(totalEstimateAmount, currency)
    },
    { label: balance?.label || "Remaining budget", value: balance?.value || "Confirm after live booking prices." }
  ];
}

function BudgetTable({
  trip,
  itinerary,
  currency
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  currency: string;
}) {
  return (
    <div className="overflow-hidden rounded-[1.15rem] border border-[#e8dfd0] bg-white shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      {budgetRows({ trip, itinerary, currency }).map((row) => (
        <div key={row.label} className="grid gap-1 border-b border-[#eee5d7] px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-5">
          <p className="text-sm font-black text-ink">{row.label}</p>
          <p className="text-sm font-semibold leading-6 text-slate-700">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function fallbackSearchUrl(query: string) {
  return googleSearchUrl(query);
}

function bookingCategory(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.category || suggestion.booking_category || "attraction";
}

function bookingTitle(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.title || suggestion.booking_label || "Suggested option";
}

function bookingDescription(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.description || suggestion.why_recommended || "Search current availability and verify prices before booking.";
}

function getPositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function tripTravelerDetails(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = getRecord(planning.travelers);
  const adults =
    getPositiveNumber(travelers.adults) ||
    getPositiveNumber(planning.travelersCount) ||
    getPositiveNumber(trip.travelers_count) ||
    1;
  return {
    adults,
    children: getPositiveNumber(travelers.children) || 0,
    infants: getPositiveNumber(travelers.infants) || 0
  };
}

function tripRooms(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return getPositiveNumber(planning.rooms) || 1;
}

function tripDate(trip: RoamlyTripRecord, key: "start" | "end") {
  const planning = getTripPlanningMetadata(trip.metadata);
  if (key === "start") return trip.start_date || getString(planning.startDate) || getString(planning.start_date);
  return trip.end_date || getString(planning.endDate) || getString(planning.end_date);
}

function fallbackBookingUrl(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const category = bookingCategory(suggestion);
  const title = bookingTitle(suggestion);
  const travelers = tripTravelerDetails(trip);
  const destination = suggestion.destination || suggestion.city || getTripDestinationLabel(trip) || "";
  const origin = suggestion.origin || getTripOriginLabel(trip) || "";
  const startDate = suggestion.departure_date || suggestion.date || tripDate(trip, "start") || "";
  const endDate = suggestion.return_date || tripDate(trip, "end") || "";

  if (category === "flight") {
    return buildFlightSearchUrl({
      origin,
      destination,
      departureDate: startDate,
      returnDate: endDate,
      travelers
    });
  }

  if (category === "hotel") {
    return buildHotelSearchUrl({
      destination,
      checkInDate: tripDate(trip, "start"),
      checkOutDate: tripDate(trip, "end"),
      adults: travelers.adults,
      children: travelers.children,
      rooms: tripRooms(trip),
      neighborhood: suggestion.neighborhood || suggestion.location,
      roomType: suggestion.room_type
    });
  }

  if (category === "attraction") {
    return buildAttractionTicketSearchUrl({
      attractionName: title,
      destination,
      date: suggestion.date || startDate
    });
  }

  if (category === "tour") {
    return buildTourSearchUrl({
      tourName: title,
      destination,
      date: suggestion.date || startDate
    });
  }

  if (category === "transport" || category === "car_rental") {
    return buildTransportSearchUrl({
      origin,
      destination: suggestion.destination || suggestion.location || destination || title,
      date: startDate
    });
  }

  if (category === "restaurant") {
    return fallbackSearchUrl(`${title} ${destination} reservations ${suggestion.date || ""}`);
  }

  return fallbackSearchUrl(`${title} ${destination}`);
}

function bookingProvider(suggestion: RoamlyItinerary["booking_suggestions"][number], fallback: string) {
  return suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || fallback;
}

function resolveBookingLink(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const affiliate = safeExternalUrl(suggestion.affiliate_url);
  if (affiliate) {
    return {
      href: affiliate,
      provider: bookingProvider(suggestion, "Affiliate partner"),
      hasAffiliateUrl: true,
      urlType: "affiliate" as BookingUrlType
    };
  }

  const normal = safeExternalUrl(suggestion.normal_search_url);
  if (normal) {
    return {
      href: normal,
      provider: bookingProvider(suggestion, "Normal search"),
      hasAffiliateUrl: false,
      urlType: "normal_search" as BookingUrlType
    };
  }

  const fallback = safeExternalUrl(fallbackBookingUrl(suggestion, trip));
  if (fallback) {
    return {
      href: fallback,
      provider: bookingProvider(suggestion, "Fallback search"),
      hasAffiliateUrl: false,
      urlType: "fallback" as BookingUrlType
    };
  }

  return null;
}

function priceConfidenceLabel(value?: string) {
  if (value === "partner") return "Partner price";
  if (value === "user_uploaded") return "Uploaded booking";
  if (value === "unknown") return "Price unknown";
  return "Estimated price";
}

function isExpired(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
}

function formatMarketDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function priceSourceLabel(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  if (suggestion.price_confidence === "user_uploaded") return "Uploaded booking price";
  if (isExpired(suggestion.expires_at) && (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent")) {
    return "Refresh price";
  }
  if (suggestion.price_type === "live_partner") return "Live partner price";
  if (suggestion.price_type === "cached_recent") return "Recently searched price";
  if (suggestion.price_type === "search_ready") return "Search-ready, price must be verified";
  if (suggestion.price_type === "estimated_fallback") return "Estimated fallback";
  return priceConfidenceLabel(suggestion.price_confidence);
}

function bookingStatusLabel(value?: string) {
  if (value === "user_uploaded") return "User-uploaded";
  if (value === "suggested") return "Suggested option";
  return "Needs booking";
}

function formatRange(min: number | null | undefined, max: number | null | undefined, currency: string) {
  if (min == null && max == null) return "";
  if (min != null && max != null) return `${formatMoney(min, currency)}-${formatMoney(max, currency)}`;
  return formatMoney(min ?? max, currency);
}

function transportOptionsFromItinerary(itinerary: RoamlyItinerary) {
  return itinerary.estimated_budget_breakdown.transport_options || [];
}

function recommendedTransportFromItinerary(itinerary: RoamlyItinerary) {
  return (
    itinerary.estimated_budget_breakdown.recommended_transport_option ||
    transportOptionsFromItinerary(itinerary).find((option) => option.budget_fit === "best") ||
    null
  );
}

function transportModeLabel(mode: TransportOption["mode"]) {
  if (mode === "drive") return "Drive";
  if (mode === "train") return "Train";
  if (mode === "bus") return "Bus";
  if (mode === "mixed") return "Mixed route";
  return "Flight";
}

function transportActionLabel(mode: TransportOption["mode"]) {
  if (mode === "flight") return "Find this flight";
  if (mode === "train") return "Check train";
  if (mode === "bus") return "Check bus";
  if (mode === "drive") return "Open driving route";
  return "Search mixed route";
}

function transportSourceLabel(option: TransportOption) {
  if (option.price_confidence === "live_partner") return "Live partner price";
  if (option.price_confidence === "cached_recent") return "Recently searched price";
  if (option.mode === "train" || option.mode === "bus") return "Search-ready, verify live schedule and price";
  if (option.mode === "drive") return "Estimated fuel and parking";
  return "Estimated fallback";
}

function transportEstimate(option: TransportOption) {
  const range = formatRange(option.estimated_cost_min, option.estimated_cost_max, option.currency || "CAD");
  return range || "Search-ready. Verify live price.";
}

function transportHref(option: TransportOption) {
  const direct = safeExternalUrl(option.booking_url) || safeExternalUrl(option.search_url);
  if (direct) return direct;
  if (option.mode === "flight") {
    return buildFlightSearchUrl({
      origin: option.origin,
      destination: option.destination,
      departureDate: option.departure_date,
      returnDate: option.return_date
    });
  }
  return buildTransportSearchUrl({
    origin: option.origin,
    destination: option.destination,
    date: option.departure_date
  });
}

function formatBudgetTransportOption(option: TransportOption | null, currency: string) {
  if (!option) return "Compare transport before booking.";
  return `${transportModeLabel(option.mode)}: ${transportEstimate({ ...option, currency: option.currency || currency })}. ${option.why_recommended}`;
}

function formatOtherTransportOptions(options: TransportOption[], recommended: TransportOption | null, currency: string) {
  const others = options.filter((option) => option !== recommended && option.budget_fit !== "best");
  if (!others.length) return "No alternatives returned yet.";
  return others
    .map((option) => `${transportModeLabel(option.mode)} ${transportEstimate({ ...option, currency: option.currency || currency })}`)
    .join(" | ");
}

function bookingEstimate(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const currency = suggestion.currency || "CAD";
  const nightly = formatRange(suggestion.estimated_nightly_cost_min, suggestion.estimated_nightly_cost_max, currency);
  const total = formatRange(
    suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min,
    suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max,
    currency
  );
  if (isExpired(suggestion.expires_at) && (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent")) {
    return total ? `Previously searched ${total}. Refresh price before using it for booking.` : "Refresh price before using this option.";
  }
  if (suggestion.price_type === "search_ready") return "Search-ready option. Verify live price and availability before booking.";
  if (nightly && total) return `${suggestion.price_type === "estimated_fallback" ? "Estimated fallback" : "Estimated"} nightly ${nightly}; stay ${total}.`;
  if (total) return `${suggestion.price_type === "estimated_fallback" ? "Estimated fallback" : "Estimated"} ${total}.`;
  if (suggestion.free_or_paid === "free") return "Free option. Verify hours and access rules.";
  return "Search-ready option. Verify current prices before booking.";
}

function bookingMeta(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return [
    suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider,
    suggestion.market_source,
    suggestion.location || suggestion.neighborhood || suggestion.city,
    suggestion.date || suggestion.departure_date,
    suggestion.time_window,
    suggestion.duration,
    suggestion.room_type,
    suggestion.searched_at ? `Searched ${formatMarketDateTime(suggestion.searched_at)}` : "",
    suggestion.expires_at
      ? isExpired(suggestion.expires_at)
        ? "Refresh price"
        : `Expires ${formatMarketDateTime(suggestion.expires_at)}`
      : ""
  ]
    .map((item) => getString(item))
    .filter(Boolean)
    .slice(0, 5);
}

function BookingRecommendationCard({
  suggestion,
  trip,
  tripId
}: {
  suggestion: RoamlyItinerary["booking_suggestions"][number];
  trip: RoamlyTripRecord;
  tripId: string;
}) {
  const category = bookingCategory(suggestion);
  const title = bookingTitle(suggestion);
  const link = resolveBookingLink(suggestion, trip);
  const mapQuery = suggestion.location || suggestion.neighborhood || suggestion.city || title;
  const confidence = priceSourceLabel(suggestion);
  const actionLabel =
    suggestion.price_confidence !== "user_uploaded" && suggestion.price_type === "live_partner" && !isExpired(suggestion.expires_at)
      ? "View live price"
      : "Book/search option";

  return (
    <article className="rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {[bookingStatusLabel(suggestion.booking_status), confidence, suggestion.free_or_paid && suggestion.free_or_paid !== "unknown" ? suggestion.free_or_paid : ""]
              .filter((label): label is string => Boolean(label))
              .map((label) => (
                <span key={label} className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                  {label}
                </span>
              ))}
          </div>
          <h3 className="mt-2 text-lg font-black leading-6 text-ink">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{bookingDescription(suggestion)}</p>
          <p className="mt-2 text-sm font-black text-ink">{bookingEstimate(suggestion)}</p>
          {suggestion.why_recommended ? (
            <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{suggestion.why_recommended}</p>
          ) : null}
          {bookingMeta(suggestion).length ? (
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{bookingMeta(suggestion).join(" · ")}</p>
          ) : null}
          {category === "transport" || category === "car_rental" ? <NavigationChipList query={mapQuery} /> : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:items-end">
          <p className="roamly-no-print max-w-[13rem] text-xs font-bold leading-5 text-slate-500">
            Search-ready suggestion. Verify live price and availability before booking.
          </p>
          <BookingRecommendationButton
            href={link?.href || ""}
            label={actionLabel}
            tripId={tripId}
            category={category}
            title={title}
            provider={link?.provider || "unavailable"}
            hasAffiliateUrl={Boolean(link?.hasAffiliateUrl)}
            urlType={link?.urlType || "fallback"}
          />
          <p className="roamly-print-only hidden text-xs font-black text-ocean">
            {link?.href ? `Search: ${actionLabel}` : "Search link unavailable"}
          </p>
        </div>
      </div>
    </article>
  );
}

function TransportComparison({ itinerary, tripId }: { itinerary: RoamlyItinerary; tripId: string }) {
  const options = transportOptionsFromItinerary(itinerary);
  const recommended = recommendedTransportFromItinerary(itinerary);
  if (!options.length) return null;
  const ordered = [
    ...(recommended ? [recommended] : []),
    ...options.filter((option) => option !== recommended && option.budget_fit !== "best")
  ].slice(0, 6);

  return (
    <section className="roamly-print-section">
      <h3 className="text-lg font-black text-ink">Transport comparison</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {ordered.map((option, index) => {
          const isRecommended = option.budget_fit === "best" || option === recommended;
          const href = transportHref(option);
          const title = isRecommended ? `Recommended: ${transportModeLabel(option.mode)}` : `${transportModeLabel(option.mode)} option`;
          const provider = transportSourceLabel(option);
          return (
            <article key={`${option.mode}-${option.title}-${index}`} className="rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                      {title}
                    </span>
                    <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                      {provider}
                    </span>
                  </div>
                  <h4 className="mt-2 text-lg font-black leading-6 text-ink">{option.title}</h4>
                  <p className="mt-1 text-sm font-black text-ink">{transportEstimate(option)}</p>
                  {option.duration_label ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{option.duration_label}</p> : null}
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{option.why_recommended}</p>
                  {option.mode === "drive" ? (
                    <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                      Driving estimate uses fuel assumptions until live maps/gas providers are connected.
                    </p>
                  ) : null}
                  {option.mode === "train" || option.mode === "bus" ? (
                    <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Verify live schedule and price.</p>
                  ) : null}
                </div>
                <BookingRecommendationButton
                  href={href}
                  label={transportActionLabel(option.mode)}
                  tripId={tripId}
                  category={option.mode === "flight" ? "flight" : "transport"}
                  title={option.title}
                  provider={provider}
                  hasAffiliateUrl={false}
                  urlType="normal_search"
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BookingPlan({ itinerary, trip, tripId }: { itinerary: RoamlyItinerary; trip: RoamlyTripRecord; tripId: string }) {
  const suggestions = itinerary.booking_suggestions || [];
  const groups = [
    { title: "Flights", categories: ["flight"] },
    { title: "Stays", categories: ["hotel"] },
    { title: "Tickets & attractions", categories: ["attraction"] },
    { title: "Tours & activities", categories: ["tour"] },
    { title: "Transport", categories: ["transport", "car_rental"] },
    { title: "Restaurants", categories: ["restaurant"] }
  ];

  return (
    <div className="grid gap-5">
      <p className="rounded-2xl border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        Suggested options are search-ready planning recommendations, not completed bookings. Estimated prices may change before booking.
        {" "}
        {affiliateDisclosure}
      </p>
      <TransportComparison itinerary={itinerary} tripId={tripId} />
      {groups.map((group) => {
        const items = suggestions.filter((suggestion) => group.categories.includes(bookingCategory(suggestion)));
        return (
          <section key={group.title} className="roamly-print-section">
            <h3 className="text-lg font-black text-ink">{group.title}</h3>
            {items.length ? (
              <div className="mt-3 grid gap-3">
                {items.map((suggestion, index) => (
                  <BookingRecommendationCard
                    key={`${group.title}-${bookingTitle(suggestion)}-${index}`}
                    suggestion={suggestion}
                    trip={trip}
                    tripId={tripId}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-[#e8dfd0] bg-white px-4 py-3 text-sm font-black leading-6 text-slate-500">
                Roamly could not produce a specific option for this category. Try regenerating this itinerary or narrowing your preferences.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BookingSummaryList({ bookings }: { bookings: Array<Record<string, unknown>> }) {
  if (!bookings.length) {
    return <p className="rounded-2xl border border-dashed border-[#e8dfd0] bg-white px-4 py-3 text-sm font-black text-slate-500">No confirmed bookings saved yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {bookings.slice(0, 6).map((booking, index) => {
        const title = getString(booking.title) || "Saved booking";
        const details = [booking.provider_name, booking.start_date, booking.start_time]
          .map((item) => getString(item))
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={`${title}-${index}`} className="rounded-2xl border border-cloud bg-white px-4 py-3">
            <p className="text-sm font-black text-ink">{title}</p>
            {details ? <p className="mt-1 text-xs font-bold text-slate-500">{details}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function ChecklistGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="roamly-print-section rounded-[1.15rem] border border-[#e8dfd0] bg-white p-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      <h3 className="text-lg font-black text-ink">{title}</h3>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <p key={item} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border border-ocean/30 bg-ocean/5" />
            <span>{item}</span>
          </p>
        ))}
      </div>
    </article>
  );
}

function isItineraryPaid(trip: {
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
}) {
  return (
    trip.itinerary_payment_status === "paid" ||
    trip.itinerary_payment_status === "bundled" ||
    trip.itinerary_unlock_source === "paid" ||
    trip.itinerary_unlock_source === "bundle" ||
    trip.itinerary_unlock_source === "admin"
  );
}

export default async function TripPage({ params, searchParams }: TripPageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const current = await getCurrentUser();

  if (!current.configured) {
    return <SetupCard title="Connect Supabase to open trips." summary="Roamly trips need the roamly_ tables and Supabase auth." />;
  }

  if (!current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}`)}`);
  }

  const sessionId = one(search.session_id);
  let checkoutSyncError = "";
  const access = getRoamlyAccessForUser(current.user.email);
  const apiAuthToken = createRoamlySessionToken(current.user);
  if (sessionId && one(search.checkout) === "success") {
    const confirmation = await confirmCheckoutSessionForTrip({ sessionId, tripId: id, userId: current.user.id });
    if (!confirmation.ok) {
      checkoutSyncError = confirmation.error || "Checkout confirmation failed.";
      console.error("[Roamly trip] Checkout confirmation failed", {
        tripId: id,
        userId: current.user.id,
        error: checkoutSyncError
      });
    }
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <SetupCard title="Supabase is unavailable." summary="Check Roamly environment variables." />;
  }

  if (one(search.checkout) === "cancelled") {
    await recordAppEvent(supabase, {
      userId: current.user.id,
      eventType: "checkout_cancelled",
      metadata: { tripId: id }
    });
  }

  const [bundleResult, freeResult] = await Promise.all([
    getTripBundle(supabase, current.user.id, id),
    hasUsedFreeItinerary(supabase, current.user.id)
  ]);

  if (!bundleResult.data) {
    if (isMissingTableError(bundleResult.error)) {
      return (
        <SetupCard
          title="Trip tables are not ready."
          summary="Run the Roamly schema, tracking, itinerary locking, and budget/booking/companion migrations, then generate the trip again."
        />
      );
    }
    redirect("/dashboard?tripAccess=denied");
  }

  const { trip, itinerary, checklist } = bundleResult.data;
  const destinationLabel = getTripDestinationLabel(trip) || "your destination";
  const currency = getTripBudgetCurrency(trip);
  const full = itinerary?.full_json || null;
  const itineraryLocked = isTripLocked(trip);
  const trackingUnlocked = tripHasTrackingUnlock(trip) || (access.hasQaAccess && itineraryLocked);
  const paidForItinerary = isItineraryPaid(trip) || access.hasQaAccess;
  const checkoutNeedsAttention = Boolean(checkoutSyncError && !paidForItinerary && !trackingUnlocked);
  const checkoutStartFailed = one(search.checkout) === "failed";
  const shouldCleanCheckoutUrl = Boolean((one(search.checkout) || sessionId) && !checkoutNeedsAttention);
  const freeAvailable = !freeResult.used;
  const generationRequiresPayment = !itineraryLocked && !paidForItinerary && !freeAvailable;
  const preview = full ? buildPreviewFromItinerary(full) : itinerary?.preview_json || null;
  const canShowFull = Boolean(itineraryLocked && full);
  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const importedBookings = bookingsResult.error && isMissingTableError(bookingsResult.error.message) ? [] : bookingsResult.data || [];
  const tripTitle = trip.title || preview?.trip_title || destinationLabel;
  const dayCount = getTripDaysCount(trip) || full?.daily_itinerary.length || preview?.day_outline.length || trip.days_count || 0;
  const tripBudgetAmount = getTripBudgetAmount(trip);
  const itineraryTotalEstimate = full ? getItineraryTotalEstimateAmount(full) : null;
  const headerBudgetBalance = full ? describeBudgetBalanceFromAmounts(tripBudgetAmount, itineraryTotalEstimate, currency) : null;
  const budgetDisplay = tripBudgetAmount
    ? `${formatBudgetMoney(tripBudgetAmount, currency)}${headerBudgetBalance ? ` · ${headerBudgetBalance.text}` : ""}`
    : full?.estimated_budget_breakdown.total_estimate || "Flexible";
  const travelStyle = getTravelStyle(trip);
  const emailConfigured = isEmailConfigured().configured;

  if (checkoutNeedsAttention) {
    await recordAppEvent(supabase, {
      userId: current.user.id,
      eventType: "checkout_sync_failed",
      metadata: { tripId: id, error: checkoutSyncError }
    });
  }

  return (
    <main className="safe-bottom roamly-print-document w-full bg-[#fbf8ef] px-4 py-8 text-ink sm:px-6">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <div className="roamly-print-paper mx-auto max-w-6xl">
        <section className="rounded-[1.35rem] border border-[#e8dfd0] bg-[#fffdf8] p-5 shadow-[0_20px_60px_rgba(16,32,51,0.08)] sm:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Image src="/roamly-wordmark.png" alt="Roamly" width={122} height={50} className="h-8 w-auto object-contain" priority />
                <span className="rounded-full border border-ocean/20 bg-ocean/5 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-ocean">
                  Trip itinerary
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Badge tone={itineraryLocked ? "ocean" : paidForItinerary || freeAvailable ? "sun" : "coral"}>
                  {itineraryLocked ? "Locked itinerary" : paidForItinerary ? "Ready to generate" : freeAvailable ? "Free itinerary available" : "Payment required"}
                </Badge>
                {access.hasQaAccess ? <Badge tone="sun">Tester access</Badge> : null}
                {trackingUnlocked ? <Badge tone="ocean">Live Companion</Badge> : null}
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">{tripTitle}</h1>
              <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-700">
                {canShowFull
                  ? full?.destination_summary
                  : preview?.destination_summary ||
                    "Review your trip details before generating. Once generated, this itinerary is locked permanently."}
              </p>
              {itineraryLocked ? <NoticeBanner>This itinerary is locked. To make major changes, create a new itinerary.</NoticeBanner> : null}
              {checkoutNeedsAttention ? (
                <NoticeBanner tone="coral">
                  Stripe returned successfully, but Roamly could not confirm the payment yet. Refresh this page in a moment; if it stays locked, contact support with your checkout receipt.
                </NoticeBanner>
              ) : null}
              {checkoutStartFailed ? (
                <NoticeBanner tone="coral">Checkout could not start. Your trip draft was saved, so you can try unlocking it again from this page.</NoticeBanner>
              ) : null}
              {generationRequiresPayment ? (
                <NoticeBanner tone="coral">You have used your free itinerary. Unlock this trip to generate a new full itinerary.</NoticeBanner>
              ) : null}
            </div>

            <div className="grid min-w-0 gap-3 rounded-2xl border border-[#eee5d7] bg-white/80 p-4 sm:min-w-[20rem]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Destination</p>
                  <p className="mt-1 text-sm font-black text-ink">{destinationLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Dates</p>
                  <p className="mt-1 text-sm font-black text-ink">{formatDateRange(trip)}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Days</p>
                  <p className="mt-1 text-sm font-black text-ink">{dayCount ? `${dayCount} days` : "Flexible"}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Budget</p>
                  <p className="mt-1 text-sm font-black text-ink">{budgetDisplay}</p>
                </div>
              </div>
              <div className="border-t border-[#eee5d7] pt-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Travel style</p>
                <p className="mt-1 text-sm font-black text-ink">{travelStyle}</p>
              </div>
            </div>
          </div>

          <div className="roamly-no-print mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
            <PrimaryTripAction
              tripId={id}
              itineraryLocked={itineraryLocked}
              trackingUnlocked={trackingUnlocked}
              paidForItinerary={paidForItinerary}
              freeAvailable={freeAvailable}
              testerAccess={access.hasQaAccess}
              apiAuthToken={apiAuthToken}
            />
            {canShowFull ? <TripShareActions tripId={id} tripTitle={tripTitle} emailConfigured={emailConfigured} /> : null}
          </div>
        </section>

        {canShowFull && full ? (
          <>
            <nav className="roamly-no-print sticky top-[5.15rem] z-20 -mx-4 mt-5 overflow-x-auto border-y border-[#e8dfd0] bg-[#fffdf8]/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-full sm:border sm:px-3">
              <div className="flex min-w-max gap-2">
                {[
                  ["day-by-day", "Day-by-day"],
                  ["overview", "Overview"],
                  ["budget", "Budget"],
                  ["bookings", "Bookings"],
                  ["travel-notes", "Travel notes"]
                ].map(([href, label], index) => (
                  <a
                    key={href}
                    href={`#${href}`}
                    className={`rounded-full px-4 py-2 text-sm font-black transition ${
                      index === 0
                        ? "bg-ocean text-white shadow-[0_10px_24px_rgba(27,154,170,0.22)]"
                        : "bg-white text-slate-600 ring-1 ring-[#e8dfd0] hover:text-ocean"
                    }`}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </nav>

            <section id="day-by-day" className="mt-8 scroll-mt-32">
              <SectionHeading
                eyebrow="Day-by-day"
                title="Your travel timeline"
                summary="Each day is grouped by time of day, with directions kept in compact place chips."
              />
              <div className="grid gap-5">
                {full.daily_itinerary.map((day) => (
                  <DayTimelineCard key={day.day_number} day={day} currency={currency} />
                ))}
              </div>
            </section>

            <section id="overview" className="mt-8 scroll-mt-32">
              <SectionHeading eyebrow="Overview" title="Trip summary" summary="Short planning notes to keep the document easy to scan." />
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <SummaryTile label="Best for" value={full.best_for.slice(0, 4).join(" · ") || travelStyle} />
                <SummaryTile label="Budget fit" value={compact(full.budget_fit_summary, "Verify current prices before booking.", 170)} />
                <SummaryTile label="Route logic" value={compact(full.route_reasoning, "The route keeps each day focused and realistic.", 170)} />
                <SummaryTile label="Booking status" value={compact(full.booking_status_summary, "No bookings are assumed until you upload or save them.", 170)} />
                <SummaryTile label="Transport" value={compact(full.transport_overview, "Use clustered routes to reduce travel time.", 170)} />
                <SummaryTile
                  label="Important reminders"
                  value={compact(full.free_or_low_cost_notes[0] || full.generation_note || "Save offline maps and verify opening hours before each day.", "Save offline maps and verify opening hours before each day.", 170)}
                />
              </div>
            </section>

            <section id="budget" className="mt-8 scroll-mt-32">
              <SectionHeading eyebrow="Budget" title="Budget status" summary={full.estimated_budget_breakdown.notes} />
              <BudgetTable trip={trip} itinerary={full} currency={currency} />
            </section>

            <section id="bookings" className="mt-8 scroll-mt-32">
              <SectionHeading eyebrow="Bookings" title="What to reserve" summary="Use direct search links unless a configured Roamly partner link is available." />
              <div className="mb-4">
                <MarketPriceRefreshButton tripId={id} />
              </div>
              <BookingPlan itinerary={full} trip={trip} tripId={id} />
              <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div>
                  <h3 className="text-lg font-black text-ink">Confirmed bookings</h3>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">Saved flights, stays, tickets, and reservations appear here.</p>
                </div>
                <BookingSummaryList bookings={importedBookings as Array<Record<string, unknown>>} />
              </div>
              <details className="roamly-no-print mt-5 rounded-2xl border border-[#e8dfd0] bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-black text-ocean">Manage confirmed bookings</summary>
                <div className="mt-4">
                  <TripBookingsManager tripId={id} initialBookings={importedBookings} />
                </div>
              </details>
            </section>

            <section id="travel-notes" className="mt-8 scroll-mt-32">
              <SectionHeading eyebrow="Travel notes" title="Checklist and local notes" />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <ChecklistGroup
                  title="Packing checklist"
                  items={checklist.length ? checklist.slice(0, 14).map((item) => item.item) : full.packing_checklist.slice(0, 14)}
                />
                <ChecklistGroup title="Local tips" items={full.local_tips.slice(0, 8)} />
                <ChecklistGroup title="Safety" items={full.safety_notes.slice(0, 8)} />
                <ChecklistGroup
                  title="Documents"
                  items={getStringList(trip.document_checklist, ["Passport/ID", "Booking confirmations", "Travel insurance details"], 8)}
                />
                <ChecklistGroup title="Emergency info" items={full.emergency_notes.slice(0, 8)} />
                <ChecklistGroup
                  title="Low-cost reminders"
                  items={full.free_or_low_cost_notes.length ? full.free_or_low_cost_notes.slice(0, 6) : ["Keep a buffer for weather, taxis, and spontaneous stops."]}
                />
              </div>
            </section>

            <footer className="mt-10 border-t border-[#e8dfd0] py-6 text-sm font-bold text-slate-500">
              Generated by Roamly
            </footer>
          </>
        ) : (
          <>
            <section className="mt-7 rounded-[1.15rem] border border-[#e8dfd0] bg-white p-5 shadow-[0_16px_42px_rgba(16,32,51,0.07)]">
              {preview ? (
                <>
                  <Badge tone="sun">Preview</Badge>
                  <h2 className="mt-3 text-3xl font-black tracking-tight text-ink">Preview only.</h2>
                  <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">
                    Full timing, maps, budget, notes, bookings, and export actions appear after this itinerary is generated and locked.
                  </p>
                  <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {preview.day_outline.map((item) => (
                      <PreviewDayCard key={item.day_number} item={item} />
                    ))}
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {preview.locked_sections.map((section) => (
                      <LockedCard key={section} title={section} text="Generate and lock this itinerary to see the full details." />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <Badge tone="sun">No itinerary yet</Badge>
                  <h2 className="mt-3 text-3xl font-black text-ink">Generate this trip when the details are final.</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    Once generated, the itinerary cannot be edited or regenerated.
                  </p>
                </>
              )}
            </section>

            <section className="roamly-no-print mt-7 rounded-[1.15rem] border border-[#e8dfd0] bg-white p-5 shadow-[0_16px_42px_rgba(16,32,51,0.07)]">
              <TripBookingsManager tripId={id} initialBookings={importedBookings} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
