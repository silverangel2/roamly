import Image from "next/image";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TripAuthSessionCheck } from "@/components/auth/TripAuthSessionCheck";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import { GuardedHotelActionButton } from "@/components/trip/GuardedHotelActionButton";
import { HotelProductOptions } from "@/components/trip/HotelProductOptions";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { GenerationNavigationRefresh } from "@/components/trip/GenerationNavigationRefresh";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { MarketPriceRefreshButton } from "@/components/trip/MarketPriceRefreshButton";
import { StagedGenerationProgress } from "@/components/trip/StagedGenerationProgress";
import { TranslateItineraryButton } from "@/components/trip/TranslateItineraryButton";
import { TripShareActions } from "@/components/trip/TripShareActions";
import {
  SectionHeading,
  NavigationChipList,
  buildDisplayTimelineItems,
  DayTimelineCard,
  BuildingDayCard
} from "@/components/trip/ItineraryDayPlan";
import { TripBookingsManager } from "@/components/roamly/TripBookingsManager";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  buildPreviewFromItinerary,
  formatMoney,
  getItineraryTotalEstimateAmount,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { TripContextNav } from "@/components/roamly/TripContextNav";
import { confirmCheckoutSessionForTrip } from "@/lib/payments";
import { isEmailConfigured } from "@/lib/roamly/email";
import { affiliateDisclosure, enrichItineraryBookingSuggestions, klookActivityActionState } from "@/lib/roamly/affiliateLinks";
import { flightMarketFreshness } from "@/lib/roamly/selectedFlightIdentity";
import { amazonAffiliateDisclosure, type RoamlyPreTripEssential } from "@/lib/roamly/amazonAffiliate";
import { esimVerificationCopy } from "@/lib/roamly/esim";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import { buildBudgetPresentation } from "@/lib/roamly/budgetPresentation";
import { hasConfirmedFlightBooking, isDriveMode, isMixedMode, looksLikeProviderSearchTitle, presentGroundTransportText, presentTravelerArea, presentTravelerTitle, shouldSuppressFlightFraming } from "@/lib/roamly/itineraryPresentation";
import { rankChoicesForNotes, readTripNoteText, travelerNoteDisplay } from "@/lib/roamly/travelerNotes";
import { mapTravelerTripStatus } from "@/lib/roamly/tripStatusDisplay";
import type { TransportOption } from "@/lib/roamly/transportOptions";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordAppEvent } from "@/lib/roamly/events";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { getLocalizedItinerary, getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { isLegacyBookingUrl, isTravelerSafeStay22Url, resolveAffiliateLink } from "@/lib/roamly/affiliateResolver";
import {
  getPublicSupabaseHost,
  logGenerationDiagnostic,
  summarizeItineraryShape
} from "@/lib/roamly/generationDiagnostics";
import {
  buildTransportSearchUrl,
  type BookingUrlType
} from "@/lib/roamly/bookingLinks";
import {
  isBareDomainName,
  safeConsumerTravelUrl,
  validateTravelResultForDisplay
} from "@/lib/roamly/travelResultValidation";
import { resolveCityPlace } from "@/lib/roamly/placeResolver";
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
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { buildRecommendedActivitySuggestions, buildRecommendedStaySuggestions } from "@/lib/roamly/recommendationBrain";
import { confirmedNeedSatisfied, reconcileAffiliateAction } from "@/lib/roamly/affiliateActionReconciliation";
import { resolveSelectedHotelProductDecision } from "@/lib/roamly/selectedHotelProductDecision";
import { buildHotelProductPresentation } from "@/lib/roamly/hotelProductPresentation";
import { getPendingHotelProductChoice } from "@/lib/roamly/hotelProductChoiceStorage";
import { deriveTripReadiness, generationIsRunning, parseTripActionFocus, travelerDraftCommand } from "@/lib/roamly/tripReadiness";
import { findRepairTarget } from "@/lib/roamly/itineraryRepair";
import PlanningConflictRepair from "@/components/roamly/PlanningConflictRepair";
import { getTravelerMemory } from "@/lib/roamly/travelerMemory";
import { countMaterialTravelRequirements } from "@/lib/roamly/travelRequirements";
import { buildTripTravelerRequirements, listTripTravelers } from "@/lib/roamly/tripTravelers";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingWallet";
import { isConfirmedItineraryBookingAnchor } from "@/lib/roamly/confirmedItineraryAnchor";
import { customerTripLifecycleState, isCustomerTripTerminalState } from "@/lib/roamly/liveCompanion";
import { TripTravelerRequirements } from "@/components/trip/TripTravelerRequirements";
import CustomerActivityRemoval from "@/components/roamly/CustomerActivityRemoval";
import CustomerActivityReplacement from "@/components/roamly/CustomerActivityReplacement";
import CustomerBudgetChange from "@/components/roamly/CustomerBudgetChange";
import CustomerDateChange from "@/components/roamly/CustomerDateChange";
import CustomerDestinationChange from "@/components/roamly/CustomerDestinationChange";
import CustomerTripIntentChange from "@/components/roamly/CustomerTripIntentChange";

type TripPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Skeleton stays on the trip home page only. Live must not inherit it, or returning there flashes an empty shell while the saved trip is about to render. */
function TripHomeLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading trip"
    >
      <div className="h-9 w-2/3 rounded-2xl bg-slate-200" />
      <div className="mt-3 h-5 w-1/3 rounded-xl bg-slate-200" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="h-64 rounded-[1.5rem] bg-slate-200" />
        <div className="h-64 rounded-[1.5rem] bg-slate-200" />
      </div>
      <div className="mt-4 h-40 rounded-[1.5rem] bg-slate-200" />
      <span className="sr-only">Loading your trip…</span>
    </div>
  );
}

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

function formatTripDate(value?: string | null, locale = "en") {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatBookingTimestamp(value: unknown, locale = "en") {
  const text = getString(value);
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function isConfirmedBookingSnapshot(booking: Record<string, unknown>) {
  if (!isOperationalCurrentBooking(booking)) return false;
  const status = getString(booking.booking_status || booking.status).toLowerCase();
  return booking.traveler_confirmed === true || ["confirmed", "booked", "ticketed", "issued"].includes(status);
}

function bookingDetailText(booking: Record<string, unknown>, locale = "en") {
  const timestamp = formatBookingTimestamp(booking.start_at, locale);
  const legacyDate = getString(booking.start_date);
  const legacyTime = getString(booking.start_time);
  const legacyTimestamp = [legacyDate, legacyTime].filter(Boolean).join(" ");
  return [
    getString(booking.provider_name) || getString(booking.provider),
    getString(booking.flight_number),
    timestamp || legacyTimestamp
  ].filter(Boolean).join(" · ");
}

function formatDateRange(trip: RoamlyTripRecord, locale = "en") {
  const start = formatTripDate(trip.start_date, locale);
  const end = formatTripDate(trip.end_date, locale);
  if (start && end) return start === end ? start : `${start} - ${end}`;
  return start || end || "Dates flexible";
}

/** "1 day" / "3 days" — never "1 days". */
function formatDayCount(dayCount: number, flexibleLabel = "Dates flexible") {
  if (!dayCount) return flexibleLabel;
  return dayCount === 1 ? "1 day" : `${dayCount} days`;
}

function maskEmailAddress(email?: string | null) {
  const value = (email || "").trim();
  const [local, domain] = value.split("@");
  if (!local || !domain) return null;
  const first = local.slice(0, 1);
  const maskLength = Math.min(6, Math.max(4, local.length - 1));
  return `${first}${"•".repeat(maskLength)}@${domain}`;
}

function getTravelStyle(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return trip.travel_style || getString(planning.travelStyle) || getString(planning.travel_style) || "Balanced";
}

function SetupCard({ title, summary }: { title: string; summary: string }) {
  return (
    <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <Card>
        <Badge tone="sun">Setup</Badge>
        <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{summary}</p>
        <div className="mt-5">
          <Button href="/plan">Plan trip</Button>
        </div>
      </Card>
    </div>
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



function PrimaryTripAction({
  tripId,
  itineraryLocked,
  generationInProgress,
  trackingUnlocked,
  paidForItinerary,
  freeAvailable,
  testerAccess,
  apiAuthToken
}: {
  tripId: string;
  itineraryLocked: boolean;
  generationInProgress: boolean;
  trackingUnlocked: boolean;
  paidForItinerary: boolean;
  freeAvailable: boolean;
  testerAccess: boolean;
  apiAuthToken: string;
}) {
  if (generationInProgress) {
    return (
      <span className="inline-flex w-full rounded-2xl border border-ocean/20 bg-ocean/10 px-5 py-4 text-sm font-black text-ocean sm:w-auto">
        Generation in progress
      </span>
    );
  }

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

/* Day-plan UI moved to @/components/trip/ItineraryDayPlan.tsx */

function BudgetSummary({
  trip,
  itinerary,
  currency,
  priceDiscovery,
  confirmedBookingCount
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  currency: string;
  priceDiscovery: Record<string, unknown> | null;
  confirmedBookingCount: number;
}) {
  const estimate = itinerary.estimated_budget_breakdown;
  const budgetAmount = getTripBudgetAmount(trip);
  const intentPlanning = getTripPlanningMetadata(trip.metadata);
  const intentTravelers = tripTravelerDetails(trip);
  const totalEstimateAmount = getItineraryTotalEstimateAmount(itinerary, priceDiscovery);
  const unknownLineItemCount = itinerary.daily_itinerary.reduce((count, day) => {
    return count + (day.live_timeline || []).filter((item) => String(item.cost_status || "").toUpperCase() === "UNKNOWN").length;
  }, 0);
  const presentation = buildBudgetPresentation({ budgetAmount, currency, totalEstimateAmount, breakdown: estimate, priceDiscovery, confirmedBookingCount, unknownLineItemCount });
  const statusTone = presentation.status === "OVER_BUDGET" ? "border-coral/25 bg-coral/10 text-coral" : presentation.status === "BUDGET_UNCERTAIN" ? "border-sun/30 bg-sun/10 text-amber-900" : "border-ocean/20 bg-ocean/10 text-ocean";

  return (
    <div className="grid gap-4">
      <section className="border-y border-[#e8dfd0] bg-[#fffdf8]/70 py-4 sm:py-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">How am I doing?</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500">Your target</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-ink sm:text-4xl">{presentation.targetLabel}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold text-slate-500">{presentation.totalCaption}</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-ink">{presentation.totalLabel}</p>
          </div>
        </div>
        <div className={`mt-4 border-l-2 px-4 py-3 ${statusTone}`}>
          <p className="text-base font-black">{presentation.statusLabel}</p>
          <p className="mt-1 text-sm font-semibold leading-6">{presentation.statusDetail}</p>
          <p className="mt-2 text-sm font-black">{presentation.pricedCaption}: {presentation.pricedLabel}</p>
          <p className="mt-1 text-sm font-bold">Unpriced: {presentation.unpricedLabel}</p>
          {presentation.remainingLabel ? <p className="mt-2 text-sm font-black">{presentation.remainingLabel}</p> : null}
        </div>
        {!['archived', 'cancelled', 'completed'].includes(trip.status) ? <CustomerBudgetChange tripId={trip.id} currentAmount={budgetAmount} currency={currency} /> : null}
        {!['archived', 'cancelled', 'completed'].includes(trip.status) ? <CustomerDateChange tripId={trip.id} startDate={trip.start_date} endDate={trip.end_date} status={trip.status} /> : null}
        {!['archived', 'cancelled', 'completed'].includes(trip.status) ? <CustomerDestinationChange tripId={trip.id} currentLabel={getTripDestinationLabel(trip)} status={trip.status} /> : null}
        {!['archived', 'cancelled', 'completed'].includes(trip.status) ? <CustomerTripIntentChange tripId={trip.id} status={trip.status} adults={intentTravelers.adults} childrenCount={intentTravelers.children} infants={intentTravelers.infants} travelStyle={getTravelStyle(trip)} interests={getStringList(trip.interests || intentPlanning.interests, [], 20)} accommodationPreference={trip.accommodation_preference || getString(intentPlanning.accommodationPreference || intentPlanning.accommodation_preference) || "Not sure"} transportationPreference={trip.transportation_preference || getString(intentPlanning.transportationPreference || intentPlanning.transportation_preference) || "Mixed"} pace={getString(intentPlanning.pace) || "Balanced"} walkingTolerance={getString(intentPlanning.walkingTolerance || intentPlanning.walking_tolerance) || "Medium"} specialNotes={trip.special_notes || getString(intentPlanning.specialNotes || intentPlanning.special_notes)} /> : null}
      </section>

      {presentation.committedCount || presentation.uncertainty.length ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {presentation.committedCount ? (
            <div className="border-b border-[#e8dfd0] pb-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">Already committed</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{presentation.committedCount} confirmed {presentation.committedCount === 1 ? "booking" : "bookings"} stay protected.</p>
            </div>
          ) : null}
          {presentation.uncertainty.length ? (
            <div className="border-b border-[#e8dfd0] pb-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Not priced yet</p>
              {presentation.uncertainty.map((item) => <p key={item} className="mt-1 text-sm font-bold text-slate-700">{item}</p>)}
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="border-y border-[#e8dfd0] py-3">
        <summary className="min-h-11 cursor-pointer text-base font-black text-ocean">See cost drivers</summary>
        <div className="mt-3 divide-y divide-[#e8dfd0]">
          {presentation.costDrivers.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-ink">{row.label}</p>
                <p className="text-xs font-bold text-slate-500">{row.status === "committed" ? "Committed" : row.status === "unknown" ? "Not priced yet" : "Expected"}</p>
              </div>
              <p className="shrink-0 text-sm font-black text-ink">{row.value}</p>
            </div>
          ))}
          {!presentation.costDrivers.length ? <p className="py-3 text-sm font-bold text-slate-500">No category-level costs are available yet.</p> : null}
        </div>
      </details>
    </div>
  );
}

function isAllowedBookingHost(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "aviasales.com") return true;
  if (host === "stay22.com" || host.endsWith(".stay22.com")) return true;
  if (host === "klook.com" || host.endsWith(".klook.com")) return true;
  if (host === "booking.com" || host.endsWith(".booking.com")) return true;
  if (host === "hotels.com" || host.endsWith(".hotels.com")) return true;
  if (host === "expedia.com" || host.endsWith(".expedia.com")) return true;
  if (host === "tripadvisor.com" || host.endsWith(".tripadvisor.com")) return true;
  if (host === "opentable.com" || host.endsWith(".opentable.com")) return true;
  if (host === "resy.com" || host.endsWith(".resy.com")) return true;
  if (host === "thefork.com" || host.endsWith(".thefork.com")) return true;
  if (host === "viator.com" || host.endsWith(".viator.com")) return true;
  if (host === "getyourguide.com" || host.endsWith(".getyourguide.com")) return true;
  if (host === "kayak.com" || host.endsWith(".kayak.com")) return true;
  if (host === "skyscanner.com" || host.endsWith(".skyscanner.com")) return true;
  if (/^amazon\.[a-z.]+$/.test(host)) return true;
  if ((host === "google.com" || host === "maps.google.com") && /^\/maps\//.test(url.pathname)) return true;
  if (host === "google.com" && url.pathname === "/search") return true;
  return false;
}

function safeBookingUrl(value?: string | null) {
  const raw = getString(value);
  if (!raw) return "";
  if (isLegacyBookingUrl(raw)) return "";
  if (raw === "#" || /^javascript:/i.test(raw) || /placeholder|example\.com/i.test(raw)) return "";
  if (raw.startsWith("/")) return "";
  const external = safeConsumerTravelUrl(raw);
  if (!external) return "";
  try {
    const url = new URL(external);
    if (/^(www\.)?roamlyhq\.com$/i.test(url.hostname) && url.pathname === "/plan") return "";
    if (url.hostname.toLowerCase().includes("stay22.com") && !isTravelerSafeStay22Url(external)) return "";
    if (!isAllowedBookingHost(url)) return "";
  } catch {
    return "";
  }
  return external;
}

function bookingCategory(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.category || suggestion.booking_category || "attraction";
}

function bookingTitle(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const category = bookingCategory(suggestion);
  const title = suggestion.title || suggestion.booking_label || "Suggested option";
  if (looksLikeProviderSearchTitle(title)) {
    return presentTravelerTitle({ title, category: String(category) }).title;
  }
  if (["activity", "attraction", "tour"].includes(String(category))) {
    return title
      .replace(/^recommended activity:\s*/i, "")
      .replace(/^visit\s+/i, "")
      .trim() || "Suggested option";
  }
  return title;
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

function savedTripPayload(trip: RoamlyTripRecord, locale: string): TripPlannerPayload {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = tripTravelerDetails(trip);
  const destination = getTripDestinationLabel(trip) || getString(planning.destination) || "your destination";
  return {
    tripType: planning.tripType === "multi_city" || planning.trip_type === "multi_city" ? "multi_city" : "single_destination",
    origin: getTripOriginLabel(trip) || getString(planning.origin) || "",
    originCity: getString(planning.originCity || planning.origin_city) || undefined,
    originRegion: getString(planning.originRegion || planning.origin_region) || undefined,
    originCountry: getString(planning.originCountry || planning.origin_country) || undefined,
    destination,
    destinationCity: trip.destination_city || getString(planning.destinationCity || planning.destination_city) || undefined,
    destinationCountry: trip.destination_country || getString(planning.destinationCountry || planning.destination_country) || undefined,
    destinationRegion: trip.destination_region || getString(planning.destinationRegion || planning.destination_region) || undefined,
    destinationStops: Array.isArray(planning.destinationStops) ? planning.destinationStops as TripPlannerPayload["destinationStops"] : undefined,
    returnToOrigin: typeof planning.returnToOrigin === "boolean" ? planning.returnToOrigin : planning.return_to_origin !== false,
    flexibleCityOrder: typeof planning.flexibleCityOrder === "boolean" ? planning.flexibleCityOrder : planning.flexible_city_order === true,
    flexibleDates: typeof planning.flexibleDates === "boolean" ? planning.flexibleDates : planning.flexible_dates === true,
    startDate: tripDate(trip, "start") || "",
    endDate: tripDate(trip, "end") || "",
    daysCount: getTripDaysCount(trip) || trip.days_count || 1,
    travelersCount: travelers.adults + travelers.children + travelers.infants,
    travelers,
    rooms: tripRooms(trip),
    bedPreference: getString(planning.bedPreference || planning.bed_preference) || "No preference",
    budgetAmount: getTripBudgetAmount(trip),
    budgetCurrency: getTripBudgetCurrency(trip),
    budgetIncludesFlights: trip.budget_includes_flights !== false,
    budgetIncludesHotel: trip.budget_includes_hotel !== false,
    budgetIncludesActivities: planning.budgetIncludesActivities !== false && planning.budget_includes_activities !== false,
    travelStyle: getTravelStyle(trip),
    interests: getStringList(trip.interests || planning.interests, [], 20),
    pace: getString(planning.pace) || "Balanced",
    walkingTolerance: getString(planning.walkingTolerance || planning.walking_tolerance) || "Medium",
    accommodationPreference: trip.accommodation_preference || getString(planning.accommodationPreference || planning.accommodation_preference) || "Not sure",
    transportationPreference: trip.transportation_preference || getString(planning.transportationPreference || planning.transportation_preference) || "Mixed",
    accessibilityNeeds: getString(planning.accessibilityNeeds || planning.accessibility_needs),
    dietaryPreference: getString(planning.dietaryPreference || planning.dietary_preference),
    specialNotes: trip.special_notes || getString(planning.specialNotes || planning.special_notes),
    language: locale,
    priceDiscoveryId: trip.latest_price_discovery_id || getString(planning.priceDiscoveryId || planning.price_discovery_id) || null
  };
}

function googleActivitySearchUrl(title: string, destination: string) {
  const place = destination ? resolveCityPlace(destination)?.searchLabel || "" : "";
  if (destination && !place) return "";
  const query = [title, place, "official site details"]
    .filter(Boolean)
    .join(" ");

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function fallbackBookingUrl(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const category = bookingCategory(suggestion);
  const categoryValue = String(category);
  const title = bookingTitle(suggestion);
  const travelers = tripTravelerDetails(trip);
  const destination = suggestion.destination || suggestion.city || getTripDestinationLabel(trip) || "";
  const origin = suggestion.origin || getTripOriginLabel(trip) || "";
  const startDate = suggestion.departure_date || suggestion.date || tripDate(trip, "start") || "";
  const endDate = suggestion.return_date || tripDate(trip, "end") || "";

  if (category === "flight") {
    return resolveAffiliateLink({
      category: "flight",
      origin,
      destination,
      startDate,
      endDate,
      travelers
    }).finalUrl;
  }

  if (category === "hotel") {
    return resolveAffiliateLink({
      category: "hotel",
      title,
      query: title,
      destination,
      startDate,
      endDate,
      travelers,
      adults: travelers.adults,
      children: travelers.children,
      rooms: tripRooms(trip),
      neighborhood: suggestion.neighborhood || suggestion.location,
      roomType: suggestion.room_type
    }).finalUrl;
  }

  if (["attraction", "activity", "experience"].includes(categoryValue)) {
    return resolveAffiliateLink({
      category: "activity",
      title,
      destination,
      startDate: suggestion.date || startDate
    }).finalUrl;
  }

  if (category === "tour") {
    return resolveAffiliateLink({
      category: "tour",
      title,
      destination,
      startDate: suggestion.date || startDate
    }).finalUrl;
  }

  if (category === "transport" || category === "car_rental") {
    return resolveAffiliateLink({
      category: "transport",
      origin,
      destination: suggestion.destination || suggestion.location || destination || title,
      startDate
    }).finalUrl;
  }

  if (category === "restaurant") {
    const query = [title, suggestion.location || suggestion.neighborhood || destination].filter(Boolean).join(" ");
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
  }

  if (["activity", "attraction", "tour", "experience"].includes(category)) {
    return googleActivitySearchUrl(title, destination);
  }

  return "";
}

function bookingProvider(suggestion: RoamlyItinerary["booking_suggestions"][number], fallback: string) {
  const provider = suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || fallback;
  if (/stay22/i.test(provider)) return "Hotel search";
  return provider;
}

function isGoogleSearchFallbackUrl(value?: string | null) {
  const href = safeBookingUrl(value);
  if (!href) return false;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "google.com" && (url.pathname === "/search" || url.pathname.startsWith("/maps/"));
  } catch {
    return false;
  }
}

function providerForBookingHref(href: string, fallback: string) {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "aviasales.com") return "Travelpayouts";
    if (host === "stay22.com" || host.endsWith(".stay22.com")) return "Hotel search";
    if (host === "klook.com" || host.endsWith(".klook.com")) return "Klook";
    if (host === "google.com" && href.includes("/maps/")) return "Google Maps";
    if (host === "google.com") return "Google search";
  } catch {
    return fallback;
  }
  return fallback;
}

function isAffiliateBookingHref(href: string) {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return host === "aviasales.com" || host === "stay22.com" || host.endsWith(".stay22.com") || host === "klook.com" || host.endsWith(".klook.com");
  } catch {
    return false;
  }
}

function bookingHrefHost(href: string) {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isActivityBookingCategory(category: unknown) {
  const value = String(category || "").toLowerCase();
  return value === "activity" || value === "attraction" || value === "tour" || value === "experience";
}

function isVerifiedKlookActivitySuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number], href: string) {
  if (!isActivityBookingCategory(bookingCategory(suggestion))) return false;
  const host = bookingHrefHost(href);
  if (host !== "klook.com" && !host.endsWith(".klook.com")) return false;
  return (
    suggestion.market_source === "klook" &&
    klookActivityActionState({
      source: suggestion.market_source,
      price_type: suggestion.price_type,
      expires_at: suggestion.expires_at
    }) === "verified_partner"
  );
}

function normalizedSearchContext(value?: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStay22HotelFallbackUrl(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  if (bookingCategory(suggestion) !== "hotel") return "";
  return safeBookingUrl(fallbackBookingUrl(suggestion, trip));
}

function isCompleteStay22HotelContext(href: string, suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "stay22.com" && !host.endsWith(".stay22.com")) return false;

    const address = normalizedSearchContext(url.searchParams.get("address") || url.searchParams.get("q") || url.searchParams.get("query"));
    const title = normalizedSearchContext(bookingTitle(suggestion));
    const destination = normalizedSearchContext(suggestion.destination || suggestion.city || getTripDestinationLabel(trip));
    return Boolean(
      address &&
      title &&
      address.includes(title) &&
      (!destination || address.includes(destination.split(" ")[0] || destination)) &&
      url.searchParams.get("checkin") &&
      url.searchParams.get("checkout") &&
      (url.searchParams.get("guests") || url.searchParams.get("adults"))
    );
  } catch {
    return false;
  }
}

function resolveBookingLink(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const category = bookingCategory(suggestion);
  const categoryValue = String(category);
  const rawAffiliate = safeBookingUrl(suggestion.affiliate_url);
  const affiliate = isActivityBookingCategory(category) && rawAffiliate && !isVerifiedKlookActivitySuggestion(suggestion, rawAffiliate)
    ? ""
    : rawAffiliate;
  if (category === "hotel") {
    if (suggestion.provider_action_origin === "provider_response" && suggestion.factual_status === "verified") {
      const providerAction = safeBookingUrl(suggestion.provider_action_url);
      if (providerAction) {
        return {
          href: providerAction,
          provider: bookingProvider(suggestion, "Booking.com"),
          hasAffiliateUrl: false,
          urlType: "normal_search" as BookingUrlType
        };
      }
    }
    const stay22Fallback = buildStay22HotelFallbackUrl(suggestion, trip);
    if (affiliate && isCompleteStay22HotelContext(affiliate, suggestion, trip)) {
      return {
        href: affiliate,
        provider: providerForBookingHref(affiliate, bookingProvider(suggestion, "Affiliate partner")),
        hasAffiliateUrl: true,
        urlType: "affiliate" as BookingUrlType
      };
    }

    if (stay22Fallback) {
      return {
        href: stay22Fallback,
        provider: providerForBookingHref(stay22Fallback, bookingProvider(suggestion, "Stay22")),
        hasAffiliateUrl: true,
        urlType: "affiliate" as BookingUrlType
      };
    }
  }

  if (suggestion.market_source === "public_web" && suggestion.factual_status === "unknown") return null;

  if (affiliate) {
    return {
      href: affiliate,
      provider: providerForBookingHref(affiliate, bookingProvider(suggestion, "Affiliate partner")),
      hasAffiliateUrl: true,
      urlType: "affiliate" as BookingUrlType
    };
  }

  const normal = safeBookingUrl(suggestion.normal_search_url);
  const fallback = safeBookingUrl(fallbackBookingUrl(suggestion, trip));
  const shouldPreferAffiliateFallback =
    fallback &&
    isAffiliateBookingHref(fallback) &&
    ["hotel", "flight"].includes(categoryValue) &&
    (category === "hotel" || !normal || isGoogleSearchFallbackUrl(normal));

  if (shouldPreferAffiliateFallback) {
    return {
      href: fallback,
      provider: providerForBookingHref(fallback, bookingProvider(suggestion, "Affiliate partner")),
      hasAffiliateUrl: true,
      urlType: "affiliate" as BookingUrlType
    };
  }

  if (normal) {
    return {
      href: normal,
      provider: providerForBookingHref(normal, bookingProvider(suggestion, "Normal search")),
      hasAffiliateUrl: false,
      urlType: "normal_search" as BookingUrlType
    };
  }

  if (fallback) {
    return {
      href: fallback,
      provider: providerForBookingHref(fallback, bookingProvider(suggestion, "Fallback search")),
      hasAffiliateUrl: isAffiliateBookingHref(fallback),
      urlType: isAffiliateBookingHref(fallback) ? "affiliate" as BookingUrlType : "fallback" as BookingUrlType
    };
  }

  return null;
}

function priceConfidenceLabel(value?: string) {
  if (value === "partner") return "Live price";
  if (value === "user_uploaded") return "Live price";
  if (value === "unknown") return "Search only";
  return "Estimated";
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
  if (suggestion.free_or_paid === "free") return "Free";
  if (suggestion.price_confidence === "user_uploaded") return "Live price";
  if (isExpired(suggestion.expires_at) && (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent")) {
    return "Search only";
  }
  if (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent") return "Live price";
  if (suggestion.price_type === "search_ready") return "Search only";
  if (suggestion.price_type === "estimated_fallback") return "Estimated";
  if (suggestion.advance_booking_recommended) return "Booking required";
  return priceConfidenceLabel(suggestion.price_confidence);
}

function hasLiveFlightPrice(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  if (suggestion.price_confidence === "user_uploaded") return true;
  if (flightMarketFreshness(suggestion) !== "fresh") return false;
  return (
    suggestion.price_confidence === "partner" ||
    suggestion.price_type === "live_partner" ||
    suggestion.price_type === "cached_recent"
  );
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
  if (mode === "flight") return "Search flights";
  if (mode === "train") return "Check train";
  if (mode === "bus") return "Check bus";
  if (mode === "drive") return "Open driving route";
  return "Search route";
}

function transportSourceLabel(option: TransportOption) {
  if (option.price_confidence === "live_partner") return "Live partner price";
  if (option.price_confidence === "cached_recent") return "Recently searched price";
  if (option.availability === "verified") return "Verified route";
  if (option.availability === "search_ready") return "Search-ready";
  if (option.availability === "not_available") return "Not available";
  if (option.availability === "unverified") return "Unverified";
  if (option.mode === "drive") return "Drive estimate";
  return "Planning estimate";
}

function transportEstimate(option: TransportOption) {
  if ((option.mode === "flight" || option.mode === "mixed") && option.price_confidence !== "live_partner" && option.price_confidence !== "cached_recent") {
    return "Search live prices";
  }
  const range = formatRange(option.estimated_cost_min, option.estimated_cost_max, option.currency || "CAD");
  return range || "Search-ready. Verify live price.";
}

function transportHref(option: TransportOption) {
  const direct = safeBookingUrl(option.booking_url) || safeBookingUrl(option.search_url);
  if (direct) return direct;
  if (option.mode === "drive") {
    return safeBookingUrl(buildTransportSearchUrl({
      origin: option.origin,
      destination: option.destination,
      date: option.departure_date
    }));
  }
  return "";
}

function transportProviderForLink(option: TransportOption, href: string, fallback: string) {
  if (!href) return fallback;
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (host.includes("aviasales.com")) return "Travelpayouts";
    if (host.includes("google.com")) return "Google Maps";
  } catch {
    return fallback;
  }
  return fallback;
}

function transportHasAffiliateLink(option: TransportOption, href: string) {
  if (!href) return false;
  if (option.mode !== "flight" && option.mode !== "mixed") return false;
  try {
    return new URL(href).hostname.toLowerCase().includes("aviasales.com");
  } catch {
    return false;
  }
}

function transportMissingNote(option: TransportOption, href: string) {
  if (href) return "";
  if ((option.mode === "train" || option.mode === "bus") && option.availability === "not_available") return "";
  if (option.mode === "flight" || option.mode === "mixed") return "Live booking search is temporarily unavailable";
  return "";
}

function transportBadges(option: TransportOption) {
  return [
    transportSourceLabel(option),
    option.realistic ? "" : "Not recommended",
    option.warning?.toLowerCase().includes("too long") ? "Too long for this trip" : "",
    option.price_confidence === "estimated" || option.price_confidence === "unknown" ? "Needs live price check" : "",
    option.warning?.toLowerCase().includes("border") ? "Border time buffer" : ""
  ].filter((label): label is string => Boolean(label));
}

function bookingEstimate(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  if (bookingCategory(suggestion) === "flight" && !hasLiveFlightPrice(suggestion)) {
    return "Search live prices";
  }
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
  if (suggestion.price_type === "search_ready") return "Search-only result. Verify price and availability.";
  if (nightly && total) return `Estimate: nightly ${nightly}; stay ${total}.`;
  if (total) return `Estimate: ${total}.`;
  if (suggestion.free_or_paid === "free") return "Free option. Verify hours and access rules.";
  return "Verify current prices before booking.";
}

function bookingMeta(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const source = suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || "Search link";
  return [
    `Source: ${/stay22/i.test(source) ? "Hotel search" : source}`,
    `Verification: ${priceSourceLabel(suggestion)}`,
    suggestion.market_source,
    presentTravelerArea(suggestion.location || suggestion.neighborhood || suggestion.city, false, String(bookingCategory(suggestion))),
    suggestion.date || suggestion.departure_date,
    suggestion.time_window,
    suggestion.duration,
    suggestion.room_type,
    suggestion.searched_at ? `Retrieved ${formatMarketDateTime(suggestion.searched_at)}` : "Retrieved: not live-verified",
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

function bookingActionLabel(category: string, suggestion: RoamlyItinerary["booking_suggestions"][number], link: ReturnType<typeof resolveBookingLink>) {
  if (category === "flight") return link?.hasAffiliateUrl ? "Compare flights" : "Search flights";
  if (category === "hotel") return "View hotel options";
  if (suggestion.market_source === "public_web") return "Check current event details";
  if (category === "attraction" || category === "tour" || category === "activity") return link?.hasAffiliateUrl ? "Book activity" : "Open official search";
  if (category === "transport" || category === "car_rental") return link?.hasAffiliateUrl ? "Book transfer" : "Open route";
  if (category === "restaurant") return "View on Google Maps";
  return suggestion.booking_label || "View option";
}

function bookingStatusBadge(category: string, suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  if (category === "flight" && !hasLiveFlightPrice(suggestion)) return "Estimate";
  const source = priceSourceLabel(suggestion);
  if (source) return source;
  if (category === "restaurant" && suggestion.advance_booking_recommended) return "Reservation recommended";
  if (suggestion.advance_booking_recommended) return "Booking required";
  return "";
}

function validBookingSuggestionForTrip(
  suggestion: RoamlyItinerary["booking_suggestions"][number],
  trip: RoamlyTripRecord,
  confirmedBookings: Array<Record<string, unknown>> = []
) {
  const category = bookingCategory(suggestion);
  const title = bookingTitle(suggestion);
  const provider = bookingProvider(suggestion, "");
  if (!title || isBareDomainName(title)) return false;
  const reconciliation = reconcileAffiliateAction({
    tripId: trip.id,
    category,
    title,
    origin: suggestion.origin,
    destination: suggestion.destination || suggestion.city,
    startDate: suggestion.departure_date || suggestion.date,
    endDate: suggestion.return_date,
    flightNumber: (suggestion as unknown as Record<string, unknown>).flight_number as string | undefined,
    address: (suggestion as unknown as Record<string, unknown>).address as string | undefined,
    city: suggestion.city
  }, confirmedBookings);
  if (reconciliation.decision === "SUPPRESS") return false;
  if (category === "hotel" && /\bstay22\b/i.test(`${title} ${provider}`)) return false;
  if (category === "flight" && /reviewintel/i.test(`${provider} ${suggestion.market_source || ""}`)) return false;
  const link = resolveBookingLink(suggestion, trip);
  if (!link?.href) return false;
  return validateTravelResultForDisplay({
    category,
    expectedCategory: category,
    title,
    provider,
    url: link.href,
    destination: suggestion.destination || suggestion.city || getTripDestinationLabel(trip),
    city: suggestion.city || trip.destination_city,
    country: suggestion.country || trip.destination_country,
    requestedDestination: getTripDestinationLabel(trip),
    requestedCity: trip.destination_city,
    source: suggestion.provider_or_search_source || suggestion.provider || suggestion.market_source,
    allowSearchFallback: true
  }).ok;
}

function BookingRecommendationCard({
  suggestion,
  trip,
  tripId,
  suppressFlightFraming = false
}: {
  suggestion: RoamlyItinerary["booking_suggestions"][number];
  trip: RoamlyTripRecord;
  tripId: string;
  suppressFlightFraming?: boolean;
}) {
  const category = bookingCategory(suggestion);
  const title = presentTravelerTitle({
    title: bookingTitle(suggestion),
    category: String(category),
    origin: suggestion.origin || getTripOriginLabel(trip),
    destination: suggestion.destination || suggestion.city || getTripDestinationLabel(trip),
    suppressFlightFraming
  }).title;
  const link = resolveBookingLink(suggestion, trip);
  if (!link?.href) return null;
  const mapQuery = category === "hotel"
    ? [title, suggestion.neighborhood || suggestion.city || getTripDestinationLabel(trip)].filter(Boolean).join(" ")
    : suggestion.location || suggestion.neighborhood || suggestion.city || title;
  const statusBadge = bookingStatusBadge(category, suggestion);
  const actionLabel = bookingActionLabel(category, suggestion, link);
  const guardedHotelAction = category === "hotel" && suggestion.provider_action_origin === "provider_response" && suggestion.factual_status === "verified";

  return (
    <article className="rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      {category === "hotel" && suggestion.photo_urls?.[0] ? (
        <div className="relative mb-4 h-52 overflow-hidden rounded-xl bg-[#f3f5f1] sm:h-64">
          <Image src={suggestion.photo_urls[0]} alt={`${title} property photo`} fill unoptimized sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-[0.68rem] font-extrabold text-[#31594f] shadow-sm">Property photo · Booking.com</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {[statusBadge]
              .filter((label): label is string => Boolean(label))
              .map((label) => (
                <span key={label} className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                  {label}
                </span>
              ))}
          </div>
          <h3 className="mt-2 text-lg font-black leading-6 text-ink">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{suppressFlightFraming ? presentGroundTransportText(bookingDescription(suggestion)) : bookingDescription(suggestion)}</p>
          <p className="mt-2 text-sm font-black text-ink">{bookingEstimate(suggestion)}</p>
          {suggestion.why_recommended || bookingMeta(suggestion).length ? (
            <details className="mt-3 rounded-[0.9rem] bg-[#f8faf8] px-3 py-2">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500">Details</summary>
              {suggestion.why_recommended ? (
                <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{suggestion.why_recommended}</p>
              ) : null}
              {bookingMeta(suggestion).length ? (
                <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{bookingMeta(suggestion).join(" · ")}</p>
              ) : null}
            </details>
          ) : null}
          {category === "hotel" || category === "transport" || category === "car_rental" ? <NavigationChipList query={mapQuery} /> : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:items-end">
          {guardedHotelAction ? (
            <GuardedHotelActionButton tripId={tripId} label={actionLabel} />
          ) : (
            <BookingRecommendationButton
              href={link.href}
              label={actionLabel}
              tripId={tripId}
              category={category}
              title={title}
              provider={link.provider}
              recommendationId={suggestion.candidateId || null}
              hasAffiliateUrl={Boolean(link.hasAffiliateUrl)}
              urlType={link.urlType}
            />
          )}
          <p className="roamly-print-only hidden text-xs font-black text-ocean">
            Search: {actionLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

function isGenericBookingSuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const title = bookingTitle(suggestion).toLowerCase();
  const category = String(bookingCategory(suggestion));
  if (
    ["activity", "attraction", "tour"].includes(category) &&
    /\b(casual nightlife|nearby lounge|walk along|stroll|wander|free time|explore nearby|open evening)\b/i.test(title)
  ) {
    return true;
  }
  return /^(local bistro|museum or gallery|nightlife district|hotel room|hotel\/stay to book|flights? to book|things to do|book activities|find hotels?|activities\/tours to reserve)$/i.test(title);
}

function isImpracticalBookingSuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const category = bookingCategory(suggestion);
  if (category !== "flight" && category !== "transport" && category !== "car_rental") return false;
  const text = `${bookingTitle(suggestion)} ${suggestion.description || ""} ${suggestion.why_recommended || ""}`.toLowerCase();
  return /\b(not available|not recommended|too long for this trip|impractical|unrealistic|miserable)\b/.test(text);
}

function bookingRank(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const link = resolveBookingLink(suggestion, trip);
  const notePriority = getRecord(suggestion as unknown as Record<string, unknown>).note_priority === true;
  if (notePriority) return -1;
  if (suggestion.price_type === "live_partner") return 0;
  if (suggestion.price_type === "cached_recent") return 1;
  if (link?.hasAffiliateUrl) return 2;
  if (suggestion.advance_booking_recommended) return 3;
  if (link?.href) return 4;
  return 8;
}

function curatedBookingSuggestions(
  suggestions: RoamlyItinerary["booking_suggestions"],
  trip: RoamlyTripRecord,
  categories: string[],
  limit: number,
  confirmedBookings: Array<Record<string, unknown>> = []
) {
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => categories.includes(bookingCategory(suggestion)))
    .filter((suggestion) => !isGenericBookingSuggestion(suggestion))
    .filter((suggestion) => !isImpracticalBookingSuggestion(suggestion))
    .filter((suggestion) => validBookingSuggestionForTrip(suggestion, trip, confirmedBookings))
    .sort((a, b) => bookingRank(a, trip) - bookingRank(b, trip))
    .filter((suggestion) => {
      const key = `${bookingCategory(suggestion)}|${bookingTitle(suggestion).toLowerCase()}|${suggestion.normal_search_url || suggestion.affiliate_url || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function bookingSuggestionsWithRecommendations(itinerary: RoamlyItinerary, trip: RoamlyTripRecord) {
  const rawSuggestions = itinerary.booking_suggestions || [];
  const recommendedStays = buildRecommendedStaySuggestions({ trip, itinerary }) as unknown as RoamlyItinerary["booking_suggestions"];
  const recommendedActivities = buildRecommendedActivitySuggestions({ trip, itinerary }) as unknown as RoamlyItinerary["booking_suggestions"];
  const notePriorityActivities = recommendedActivities.filter((activity) => getRecord(activity as unknown as Record<string, unknown>).note_priority === true);
  const initialHotelItems = curatedBookingSuggestions(rawSuggestions, trip, ["hotel"], 3);
  const suggestions = !recommendedStays.length || initialHotelItems.length >= Math.min(3, recommendedStays.length)
    ? rawSuggestions
    : [
        ...rawSuggestions,
        ...recommendedStays.filter((stay) => {
          const stayTitle = bookingTitle(stay).toLowerCase();
          return !rawSuggestions.some((suggestion) => bookingCategory(suggestion) === "hotel" && bookingTitle(suggestion).toLowerCase() === stayTitle);
        })
      ];

  const withNotePriorityActivities = notePriorityActivities.length
    ? [
        ...notePriorityActivities.filter((activity) => {
          const activityTitle = bookingTitle(activity).toLowerCase();
          return !suggestions.some((suggestion) =>
            ["activity", "attraction", "tour"].includes(String(bookingCategory(suggestion))) &&
            bookingTitle(suggestion).toLowerCase() === activityTitle
          );
        }),
        ...suggestions
      ]
    : suggestions;

  const initialActivityItems = curatedBookingSuggestions(withNotePriorityActivities, trip, ["attraction", "tour", "activity"], 3);
  if (!recommendedActivities.length || initialActivityItems.length >= 2) return withNotePriorityActivities;

  return [
    ...withNotePriorityActivities,
    ...recommendedActivities.filter((activity) => {
      const activityTitle = bookingTitle(activity).toLowerCase();
      return !withNotePriorityActivities.some((suggestion) =>
        ["activity", "attraction", "tour"].includes(String(bookingCategory(suggestion))) &&
        bookingTitle(suggestion).toLowerCase() === activityTitle
      );
    })
  ];
}

function routeNeedsTransport(trip: RoamlyTripRecord) {
  const origin = getTripOriginLabel(trip).toLowerCase().trim();
  const destination = getTripDestinationLabel(trip).toLowerCase().trim();
  return Boolean(origin && destination && origin !== destination);
}

function tripIncludesActivities(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return planning.budgetIncludesActivities !== false && planning.budget_includes_activities !== false;
}

function bookingGroupMode(itinerary: RoamlyItinerary) {
  return getString(recommendedTransportFromItinerary(itinerary)?.mode).toLowerCase();
}

function buildRelevantBookingGroups(params: {
  itinerary: RoamlyItinerary;
  trip: RoamlyTripRecord;
  flightItems: RoamlyItinerary["booking_suggestions"];
  hotelItems: RoamlyItinerary["booking_suggestions"];
  activityItems: RoamlyItinerary["booking_suggestions"];
  transportItems: RoamlyItinerary["booking_suggestions"];
  confirmedBookings: Array<Record<string, unknown>>;
}) {
  const notes = readTripNoteText(params.trip);
  const rank = <T extends { title?: string | null; booking_label?: string | null }>(items: readonly T[]) => rankChoicesForNotes(items, notes, (item) => `${item.title || ""} ${item.booking_label || ""}`);
  const mode = bookingGroupMode(params.itinerary);
  const needsTransport = routeNeedsTransport(params.trip);
  const showFlightFallback =
    needsTransport &&
    params.trip.budget_includes_flights !== false &&
    (!mode || mode === "flight" || mode === "mixed");
  const showFlightItems = params.flightItems.length > 0 && (!mode || mode === "flight" || mode === "mixed");
  const hasRecommendedTransport = Boolean(recommendedTransportFromItinerary(params.itinerary));
  return [
    (showFlightItems || (showFlightFallback && !confirmedNeedSatisfied("flight", params.confirmedBookings, params.trip.id)))
      ? { title: "Flights", fallback: "flight" as const, items: rank(params.flightItems) }
      : null,
    (params.hotelItems.length > 0 || (params.trip.budget_includes_hotel !== false && !confirmedNeedSatisfied("hotel", params.confirmedBookings, params.trip.id)))
      ? { title: "Hotels", fallback: "hotel" as const, items: rank(params.hotelItems) }
      : null,
    (params.activityItems.length > 0 || tripIncludesActivities(params.trip))
      ? { title: "Important activities", fallback: "activity" as const, items: rank(params.activityItems) }
      : null,
    params.transportItems.length > 0 && !hasRecommendedTransport
      ? { title: "Transport", fallback: null, items: params.transportItems }
      : null
  ].filter((group): group is {
    title: string;
    fallback: "flight" | "hotel" | "activity" | null;
    items: RoamlyItinerary["booking_suggestions"];
  } => Boolean(group));
}

function fallbackSearchHref(category: "flight" | "hotel" | "activity", trip: RoamlyTripRecord) {
  const destination = getTripDestinationLabel(trip);
  const origin = getTripOriginLabel(trip);
  const start = tripDate(trip, "start");
  const end = tripDate(trip, "end");
  if (category === "flight") {
    const affiliate = resolveAffiliateLink({
      category: "flight",
      origin,
      destination,
      startDate: start,
      endDate: end,
      travelers: tripTravelerDetails(trip)
    }).finalUrl;
    if (affiliate) return affiliate;
  }
  if (category === "hotel") {
    const travelers = tripTravelerDetails(trip);
    const affiliate = resolveAffiliateLink({
      category: "hotel",
      destination,
      startDate: start,
      endDate: end,
      travelers,
      adults: travelers.adults,
      children: travelers.children,
      rooms: tripRooms(trip)
    }).finalUrl;
    if (affiliate) return affiliate;
  }
  const query =
    category === "flight"
      ? [origin, "to", destination, start, end, "flights"].filter(Boolean).join(" ")
      : category === "hotel"
        ? [destination, start, end, "hotels"].filter(Boolean).join(" ")
        : [destination, start, "top attractions official tickets"].filter(Boolean).join(" ");
  return query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : "";
}

function BookingSearchFallbackCard({
  category,
  trip,
  tripId
}: {
  category: "flight" | "hotel" | "activity";
  trip: RoamlyTripRecord;
  tripId: string;
}) {
  const href = safeBookingUrl(fallbackSearchHref(category, trip));
  if (!href) return null;
  const label = category === "flight" ? "Search flights" : category === "hotel" ? "Search hotels" : "Search activities";
  const preference = trip.transportation_preference || "";
  if (category === "flight" && isDriveMode(preference)) return null;
  const title = category === "flight"
    ? isMixedMode(preference) ? "Ways to get there" : "Flights to compare"
    : category === "hotel" ? "Stay to confirm" : "Events to confirm";
  const hasAffiliateUrl = isAffiliateBookingHref(href);
  const provider = providerForBookingHref(href, category === "flight" ? "Travelpayouts" : "Google search");
  return (
    <article className="rounded-[1rem] border border-dashed border-[#e8dfd0] bg-white px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black leading-6 text-ink">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
            {category === "flight"
              ? "Estimate only. Search live prices for the trip dates, baggage, seats, schedule, and currency before booking."
              : "Search current options for the trip dates and verify price, schedule, and availability."}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500">{category === "flight" ? "Estimate only" : "Search only"}</p>
        </div>
        <BookingRecommendationButton
          href={href}
          label={label}
          tripId={tripId}
          category={category}
          title={title}
          provider={provider}
          recommendationId={null}
          hasAffiliateUrl={hasAffiliateUrl}
          urlType={hasAffiliateUrl ? "affiliate" : "normal_search"}
        />
      </div>
    </article>
  );
}

function RecommendedTransportCard({ itinerary, tripId, confirmedBookings, suppressFlightFraming = false }: { itinerary: RoamlyItinerary; tripId: string; confirmedBookings: Array<Record<string, unknown>>; suppressFlightFraming?: boolean }) {
  const recommended = recommendedTransportFromItinerary(itinerary);
  if (!recommended || !recommended.realistic || recommended.availability === "not_available") return null;
  if ((recommended.mode === "flight" || recommended.mode === "mixed") && reconcileAffiliateAction({
    tripId,
    category: "flight",
    title: recommended.title,
    origin: recommended.origin,
    destination: recommended.destination,
    startDate: recommended.departure_date,
    endDate: recommended.return_date
  }, confirmedBookings).decision === "SUPPRESS") return null;
  const href = transportHref(recommended);
  const provider = transportProviderForLink(recommended, href, transportSourceLabel(recommended));
  const hasAffiliateUrl = transportHasAffiliateLink(recommended, href);
  const missingNote = transportMissingNote(recommended, href);

  return (
    <section className="roamly-print-section">
      <h3 className="text-lg font-black text-ink">Recommended transport</h3>
      <article className="mt-3 rounded-[1rem] border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                {transportModeLabel(recommended.mode)}
              </span>
              {transportBadges(recommended).slice(0, 3).map((badge) => (
                <span key={badge} className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                  {badge}
                </span>
              ))}
            </div>
            <h4 className="mt-2 text-lg font-black leading-6 text-ink">{presentTravelerTitle({
              title: recommended.title,
              mode: recommended.mode,
              origin: recommended.origin,
              destination: recommended.destination,
              category: "transport",
              suppressFlightFraming: suppressFlightFraming || recommended.mode === "drive" || recommended.mode === "mixed"
            }).title}</h4>
            <p className="mt-1 text-sm font-black text-ink">{transportEstimate(recommended)}</p>
            {recommended.duration_label ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{recommended.duration_label}</p> : null}
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{suppressFlightFraming ? presentGroundTransportText(recommended.why_recommended) : recommended.why_recommended}</p>
            {recommended.warning ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{recommended.warning}</p> : null}
          </div>
          {href ? (
            <BookingRecommendationButton
              href={href}
              label={transportActionLabel(recommended.mode)}
              tripId={tripId}
              category={recommended.mode === "flight" || recommended.mode === "mixed" ? "flight" : "transport"}
              title={recommended.title}
              provider={provider}
              recommendationId={null}
              hasAffiliateUrl={hasAffiliateUrl}
              urlType={hasAffiliateUrl ? "affiliate" : "normal_search"}
            />
          ) : missingNote ? (
            <p className="roamly-no-print max-w-[13rem] rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black leading-5 text-slate-500">
              {missingNote}
            </p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

function BookingPlan({ itinerary, trip, tripId, confirmedBookings, suppressFlightFraming = false }: { itinerary: RoamlyItinerary; trip: RoamlyTripRecord; tripId: string; confirmedBookings: Array<Record<string, unknown>>; suppressFlightFraming?: boolean }) {
  const suggestions = bookingSuggestionsWithRecommendations(itinerary, trip);
  // The fourth argument remains the one-card flight cap: curatedBookingSuggestions(suggestions, trip, ["flight"], 1)
  const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 1, confirmedBookings);
  const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3, confirmedBookings);
  const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3, confirmedBookings);
  const transportItems = curatedBookingSuggestions(suggestions, trip, ["transport", "car_rental"], 2, confirmedBookings);
  const groups = buildRelevantBookingGroups({ itinerary, trip, flightItems, hotelItems, activityItems, transportItems, confirmedBookings });

  return (
    <div className="grid gap-5">
      <p className="roamly-no-print rounded-[1rem] border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        Recommended transport, stays, flights, and important activities. Live prices appear only when a connected provider returned them. {affiliateDisclosure}
      </p>
      {["flight", "mixed"].includes(bookingGroupMode(itinerary)) ? null : <RecommendedTransportCard itinerary={itinerary} tripId={tripId} confirmedBookings={confirmedBookings} suppressFlightFraming={suppressFlightFraming} />}
      {groups.map((group) => {
        return (
          <section key={group.title} className="roamly-print-section">
            <h3 className="text-lg font-black text-ink">{group.title}</h3>
            {group.items.length ? (
              <div className="mt-3 grid gap-3">
                {group.items.map((suggestion, index) => (
                  <BookingRecommendationCard
                    key={`${group.title}-${bookingTitle(suggestion)}-${index}`}
                    suggestion={suggestion}
                    trip={trip}
                    tripId={tripId}
                    suppressFlightFraming={suppressFlightFraming}
                  />
                ))}
              </div>
            ) : group.fallback ? (
              <div className="mt-3">
                <BookingSearchFallbackCard category={group.fallback} trip={trip} tripId={tripId} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function essentialActionLabel(item: RoamlyPreTripEssential) {
  if (item.action_label) return item.action_label;
  const text = `${item.title} ${item.search_query}`.toLowerCase();
  if (item.item_type === "connectivity" || /\b(e-?sim|mobile data|roaming plan)\b/.test(text)) return "Compare travel eSIM";
  if (/\bcarry[- ]?on\b|luggage/.test(text)) return "Find carry-on luggage";
  if (/packing cube/.test(text)) return "Find packing cubes";
  if (/adapter/.test(text)) return "Find travel adapter";
  return "Shop on Amazon";
}

function priorityLabel(priority: RoamlyPreTripEssential["priority"]) {
  if (priority === "high") return "High priority";
  if (priority === "low") return "Low priority";
  return "Medium priority";
}

function PreTripEssentialCard({
  item,
  tripId
}: {
  item: RoamlyPreTripEssential;
  tripId: string;
}) {
  const href = safeBookingUrl(item.action_url) || safeBookingUrl(item.amazon_url);
  const label = essentialActionLabel(item);
  const isConnectivity = item.item_type === "connectivity" || item.category === "Connectivity";
  const provider = item.provider || (isConnectivity ? "Connectivity options" : "Amazon Associates");
  const verificationNote = item.verification_note || (isConnectivity ? esimVerificationCopy : "");
  const urlType: BookingUrlType = item.action_url_type || (href && href.includes("tag=") ? "affiliate" : "normal_search");
  const hasAffiliateUrl = Boolean(item.has_affiliate_url || (href && href.includes("tag=")));

  return (
    <article className="roamly-print-section rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
      <div className="flex h-full flex-col gap-4">
        <div className="flex grow gap-3">
          <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border border-ocean/30 bg-ocean/5" />
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                {item.category}
              </span>
              <span className="rounded-full border border-sun/30 bg-sun/10 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-amber-800">
                {priorityLabel(item.priority)}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-black leading-6 text-ink">{item.title}</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{item.reason}</p>
            {verificationNote ? <p className="mt-2 text-xs font-black leading-5 text-amber-800">{verificationNote}</p> : null}
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Search: {item.search_query}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="roamly-no-print text-xs font-bold leading-5 text-slate-500">
            {isConnectivity
              ? "Connectivity options are not guaranteed. Verify coverage, compatibility, price, and terms before buying."
              : "Amazon prices are not shown in Roamly. Verify price and availability on Amazon."}
          </p>
          <BookingRecommendationButton
            href={href}
            label={label}
            tripId={tripId}
            category={isConnectivity ? "connectivity" : "travel_essentials"}
            title={item.title}
            provider={provider}
            recommendationId={null}
            hasAffiliateUrl={hasAffiliateUrl}
            urlType={urlType}
          />
        </div>
        {href ? <p className="roamly-print-only hidden text-xs font-black text-ocean">{provider} search: {label}</p> : null}
      </div>
    </article>
  );
}

function PreTripEssentialsSection({
  essentials,
  tripId
}: {
  essentials: RoamlyPreTripEssential[];
  tripId: string;
}) {
  if (!essentials.length) return null;
  const hasConnectivity = essentials.some((item) => item.item_type === "connectivity" || item.category === "Connectivity");

  return (
    <section id="pre-trip-essentials" className="mt-8 scroll-mt-32">
      <SectionHeading
        eyebrow="Pre-trip essentials"
        title="Essentials checklist"
        summary="Travel item recommendations are based on the destination, dates, activities, season, trip length, and travel style."
      />
      <p className="mb-4 rounded-2xl border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        {amazonAffiliateDisclosure}
        {hasConnectivity ? " Connectivity recommendations are for mobile data planning only, not flights, hotels, tours, or tickets." : ""}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {essentials.map((item, index) => (
          <PreTripEssentialCard key={`${item.title}-${index}`} item={item} tripId={tripId} />
        ))}
      </div>
    </section>
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
        const details = bookingDetailText(booking);
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

function travelerSummary(trip: RoamlyTripRecord) {
  const travelers = tripTravelerDetails(trip);
  const rooms = tripRooms(trip);
  return [
    `${travelers.adults} ${travelers.adults === 1 ? "adult" : "adults"}`,
    travelers.children ? `${travelers.children} ${travelers.children === 1 ? "child" : "children"}` : "",
    travelers.infants ? `${travelers.infants} ${travelers.infants === 1 ? "infant" : "infants"}` : "",
    `${rooms} ${rooms === 1 ? "room" : "rooms"}`
  ].filter(Boolean).join(" · ");
}

function PrintInfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="roamly-pdf-info-cell">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function CompactPrintDay({ day, currency, confirmedBookings, suppressFlightFraming = false }: { day: RoamlyItinerary["daily_itinerary"][number]; currency: string; confirmedBookings: readonly Record<string, unknown>[]; suppressFlightFraming?: boolean }) {
  const items = buildDisplayTimelineItems(day, confirmedBookings, { suppressFlightFraming }).items.slice(0, 6);
  const dayCity = presentTravelerArea(day.city, suppressFlightFraming);

  return (
    <section className="roamly-pdf-day">
      <div className="roamly-pdf-day-heading">
        <p>
          Day {day.day_number}
          {dayCity ? ` · ${dayCity}` : ""}
          {day.date ? ` · ${formatTripDate(day.date)}` : ""}
        </p>
        <span>Est. {formatMoney(day.estimated_cost, currency)}</span>
      </div>
      <h3>{presentTravelerTitle({ title: day.title, destination: dayCity || day.city, suppressFlightFraming }).title || day.title}</h3>
      {items.length ? (
        <div className="roamly-pdf-timeline">
          {items.map((item, index) => (
            <div key={`${day.day_number}-print-${item.time}-${item.title}-${index}`} className="roamly-pdf-timeline-row">
              <p className="roamly-pdf-time">{item.time}</p>
              <div>
                <strong>{item.title}</strong>
                <p>{[item.location, item.durationLabel, item.travelLabel].filter(Boolean).join(" · ")}</p>
                {item.transferNote ? <p>Transfer: {item.transferNote}</p> : null}
                {item.description ? <p>{compact(item.description, "", 120)}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="roamly-pdf-timeline">
          <div className="roamly-pdf-timeline-row"><p className="roamly-pdf-time">Morning</p><p>{day.morning}</p></div>
          <div className="roamly-pdf-timeline-row"><p className="roamly-pdf-time">Afternoon</p><p>{day.afternoon}</p></div>
          <div className="roamly-pdf-timeline-row"><p className="roamly-pdf-time">Evening</p><p>{day.evening}</p></div>
        </div>
      )}
      {day.food.length ? <p className="roamly-pdf-food">Food: {day.food.slice(0, 3).join(" · ")}</p> : null}
    </section>
  );
}

function CompactPrintItinerary({
  trip,
  itinerary,
  bookings,
  tripTitle,
  destinationLabel,
  currency,
  budgetDisplay,
  travelStyle,
  dayCount,
  locale,
  suppressFlightFraming = false
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  bookings: Array<Record<string, unknown>>;
  tripTitle: string;
  destinationLabel: string;
  currency: string;
  budgetDisplay: string;
  travelStyle: string;
  dayCount: number;
  locale: string;
  suppressFlightFraming?: boolean;
}) {
  const confirmedBookings = bookings.filter((booking) => isConfirmedBookingSnapshot(booking));
  const recommendedTransport = recommendedTransportFromItinerary(itinerary);
  const suggestions = bookingSuggestionsWithRecommendations(itinerary, trip);
  const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3, bookings);
  const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 1, bookings);
  const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3, bookings);
  const essentials = [
    ...packingChecklistItems([], itinerary).slice(0, 5),
    ...itinerary.local_tips.slice(0, 4)
  ].slice(0, 8);
  const notes = [
    ...itinerary.safety_notes.slice(0, 4),
    ...itinerary.emergency_notes.slice(0, 4)
  ].slice(0, 8);

  return (
    <article className="roamly-compact-print hidden">
      <section className="roamly-pdf-page roamly-pdf-cover">
        <div className="roamly-pdf-brand">
          <Image src="/roamly-wordmark.png" alt="Roamly" width={92} height={38} />
          <span>Offline itinerary</span>
        </div>
        <h1>{tripTitle}</h1>
        <p className="roamly-pdf-summary">{compact(itinerary.destination_summary, "Trip plan", 240)}</p>
        <div className="roamly-pdf-info-grid">
          <PrintInfoCell label="Destination" value={destinationLabel} />
          <PrintInfoCell label="Dates" value={formatDateRange(trip, locale)} />
          <PrintInfoCell label="Travellers" value={travelerSummary(trip)} />
          <PrintInfoCell label="Days" value={formatDayCount(dayCount, "Flexible")} />
          <PrintInfoCell label="Budget" value={budgetDisplay} />
          <PrintInfoCell label="Style" value={travelStyle} />
        </div>
        <div className="roamly-pdf-two-col">
          <section>
            <h2>Transport</h2>
            <p>{recommendedTransport ? `${recommendedTransport.title}. ${transportEstimate(recommendedTransport)}` : compact(itinerary.transport_overview, "Verify transport before travel.", 180)}</p>
          </section>
          <section>
            <h2>Stay</h2>
            {hotelItems.length ? (
              <ul>
                {hotelItems.map((item) => (
                  <li key={`print-hotel-${bookingTitle(item)}`}>
                    <strong>{bookingTitle(item)}</strong>
                    <span>{[presentTravelerArea(item.neighborhood || item.location, suppressFlightFraming, "hotel"), item.room_type, item.why_recommended].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Hotel options should be verified for the trip dates before departure.</p>
            )}
          </section>
        </div>
        <div className="roamly-pdf-two-col">
          <section>
            <h2>Flight/Search References</h2>
            {flightItems.length ? (
              <ul>{flightItems.map((item) => <li key={`print-flight-${bookingTitle(item)}`}>{bookingTitle(item)}</li>)}</ul>
            ) : (
              <p>Use the flight search action on the trip page to verify schedules and fares.</p>
            )}
          </section>
          <section>
            <h2>Important Activities</h2>
            {activityItems.length ? (
              <ul>{activityItems.map((item) => <li key={`print-activity-${bookingTitle(item)}`}>{bookingTitle(item)}</li>)}</ul>
            ) : (
              <p>No paid activity bookings are required by default.</p>
            )}
          </section>
        </div>
      </section>

      <section className="roamly-pdf-days">
        {itinerary.daily_itinerary.map((day) => (
          <CompactPrintDay key={`print-day-${day.day_number}`} day={day} currency={currency} confirmedBookings={confirmedBookings} suppressFlightFraming={suppressFlightFraming} />
        ))}
      </section>

      <section className="roamly-pdf-page roamly-pdf-final">
        <h2>Bookings And Essentials</h2>
        <div className="roamly-pdf-two-col">
          <section>
            <h3>Confirmed bookings</h3>
            {bookings.length ? (
              <ul>
                {bookings.slice(0, 8).map((booking, index) => (
                  <li key={`print-booking-${index}`}>
                    <strong>{getString(booking.title) || "Saved booking"}</strong>
                    <span>{bookingDetailText(booking, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No confirmed bookings saved in Roamly yet.</p>
            )}
          </section>
          <section>
            <h3>Essentials</h3>
            <ul>{essentials.map((item) => <li key={`print-essential-${item}`}>{item}</li>)}</ul>
          </section>
        </div>
        <section>
          <h3>Important notes</h3>
          <ul>{notes.map((item) => <li key={`print-note-${item}`}>{item}</li>)}</ul>
        </section>
      </section>
    </article>
  );
}

function ChecklistGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

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

function packingChecklistItems(_checklist: Array<{ item: string; category: string | null }>, itinerary: RoamlyItinerary) {
  return itinerary.packing_checklist.slice(0, 14);
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

async function TripPage({ params, searchParams }: TripPageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (!current.configured) {
    return <SetupCard title="Connect Supabase to open trips." summary="Roamly trips need the roamly_ tables and Supabase auth." />;
  }

  if (!current.user) {
    return <TripAuthSessionCheck tripId={id} nextPath={`/trip/${id}`} />;
  }

  const sessionId = one(search.session_id);
  let checkoutSyncError = "";
  let checkoutAwaitingWebhook = false;
  const access = getRoamlyAccessForUser(current.user.email);
  const apiAuthToken = createRoamlySessionToken(current.user, [
    { method: "POST", path: "/api/stripe/create-trip-checkout" },
    { method: "POST", path: "/api/trips/generate" },
    { method: "GET", path: `/api/trips/${id}/generation/status` },
    { method: "POST", path: `/api/trips/${id}/generation/advance` }
  ]);
  if (sessionId && one(search.checkout) === "success") {
    const confirmation = await confirmCheckoutSessionForTrip({ sessionId, tripId: id, userId: current.user.id });
    if (!confirmation.ok) {
      checkoutSyncError = confirmation.error || "Checkout confirmation failed.";
      console.error("[Roamly trip] Checkout confirmation failed", {
        tripId: id,
        userId: current.user.id,
        error: checkoutSyncError
      });
    } else {
      // Only waits on the webhook when the immediate return-path apply failed.
      checkoutAwaitingWebhook = confirmation.awaitingWebhook === true;
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

  const [bundleResult, freeResult, travelerMemory] = await Promise.all([
    getTripBundle(supabase, current.user.id, id),
    hasUsedFreeItinerary(supabase, current.user.id),
    getTravelerMemory(supabase, current.user.id)
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

  const { trip, itinerary, days, activities, checklist } = bundleResult.data;
  const destinationLabel = getTripDestinationLabel(trip) || "your destination";
  const currency = getTripBudgetCurrency(trip);
  const baseFull = itinerary?.full_json || null;
  const localizedItinerary = baseFull ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: baseFull, locale }) : null;
  const displayedItineraryLanguage = localizedItinerary?.language || getTripItineraryLanguage(trip.metadata);
  const itineraryLocked = isTripLocked(trip);
  const generationProgress = publicStagedGenerationProgress(trip.metadata, id);
  const generationStatus = generationProgress?.status || "";
  const generationFailed = generationStatus === "failed" || generationStatus === "partially_failed";
  const preview = localizedItinerary?.itinerary ? localizedItinerary?.preview || buildPreviewFromItinerary(localizedItinerary.itinerary) : itinerary?.preview_json || null;
  const canonicalDays = localizedItinerary?.itinerary?.daily_itinerary || [];
  const canShowFull = canonicalDays.length > 0;
  const generationInProgress = Boolean(
    !canShowFull &&
      generationProgress &&
      generationStatus !== "complete" &&
      generationStatus !== "failed" &&
      generationStatus !== "partially_failed"
  );
  const generationPanelVisible = Boolean(
    generationProgress &&
      generationStatus !== "complete" &&
      (!canShowFull || generationFailed)
  );
  const generationBusy = Boolean(
    generationProgress &&
      !["complete", "failed", "partially_failed"].includes(generationStatus)
  );
  const generationRunning = generationIsRunning(generationStatus);
  const trackingUnlocked = tripHasTrackingUnlock(trip);
  const paidForItinerary = isItineraryPaid(trip);
  const checkoutNeedsAttention = Boolean(checkoutSyncError && !paidForItinerary && !trackingUnlocked);
  const checkoutProcessing = Boolean(checkoutAwaitingWebhook && !paidForItinerary && !trackingUnlocked);
  const checkoutStartFailed = one(search.checkout) === "failed";
  const shouldCleanCheckoutUrl = Boolean((one(search.checkout) || sessionId) && !checkoutNeedsAttention && !checkoutProcessing);
  const freeAvailable = !freeResult.used;
  const generationRequiresPayment = !itineraryLocked && !paidForItinerary && !freeAvailable;
  const canonicalDayByNumber = new Map(canonicalDays.map((day) => [day.day_number, day]));
  const generationDayProgress = generationProgress?.days || [];
  const dayNumbersToRender = generationDayProgress.length
    ? generationDayProgress.map((day) => day.dayNumber)
    : canonicalDays.map((day) => day.day_number);
  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("start_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const importedBookings = bookingsResult.error && isMissingTableError(bookingsResult.error.message) ? [] : bookingsResult.data || [];
  const currentImportedBookings = importedBookings.filter(isOperationalCurrentBooking);
  const priceDiscoveryResult = trip.latest_price_discovery_id
    ? await supabase
        .from("roamly_price_discoveries")
        .select("metadata")
        .eq("id", trip.latest_price_discovery_id)
        .eq("trip_id", id)
        .eq("user_id", current.user.id)
        .maybeSingle()
    : { data: null };
  const persistedPriceDiscovery = priceDiscoveryResult.data?.metadata && typeof priceDiscoveryResult.data.metadata === "object"
    ? priceDiscoveryResult.data.metadata as Record<string, unknown>
    : null;
  const full = localizedItinerary?.itinerary
    ? enrichItineraryBookingSuggestions(localizedItinerary.itinerary, {
        ...savedTripPayload(trip, locale),
        priceDiscovery: persistedPriceDiscovery || undefined
      })
    : null;
  const hotelProductDecision = resolveSelectedHotelProductDecision({
    priceDiscovery: persistedPriceDiscovery,
    confirmedBookings: currentImportedBookings as Array<{ booking_type?: string | null; booking_status?: string | null }>
  });
  const hotelProductPresentation = buildHotelProductPresentation({ selectedHotelDecision: hotelProductDecision, comparisonCurrency: currency });
  const pendingHotelProductChoiceResult = await getPendingHotelProductChoice(supabase, id);
  const pending = pendingHotelProductChoiceResult.error ? null : pendingHotelProductChoiceResult.choice;
  const pendingHotelProductChoice = pending ? {
    tripId: pending.tripId,
    provider: pending.choice.provider,
    providerPropertyId: pending.choice.providerPropertyId,
    selectedHotelCandidateId: pending.choice.selectedHotelCandidateId,
    providerProductId: pending.choice.providerProductId,
    revalidatedAt: pending.choice.revalidatedAt,
    chosenAt: pending.choice.chosenAt,
    acknowledgedMaterialChanges: pending.acknowledgedMaterialChanges,
    bookingContinuity: pending.choice.bookingContinuity,
    actionability: pending.choice.actionability
  } : null;
  const tripTitle = full?.trip_title || preview?.trip_title || trip.title || destinationLabel;
  const dayCount = getTripDaysCount(trip) || full?.daily_itinerary.length || preview?.day_outline.length || trip.days_count || 0;
  const tripBudgetAmount = getTripBudgetAmount(trip);
  const itineraryTotalEstimate = full ? getItineraryTotalEstimateAmount(full, persistedPriceDiscovery) : null;
  const headerBudgetBalance = full ? describeBudgetBalanceFromAmounts(tripBudgetAmount, itineraryTotalEstimate, currency) : null;
  const budgetDisplay = tripBudgetAmount
    ? `${formatBudgetMoney(tripBudgetAmount, currency)}${headerBudgetBalance ? ` · ${headerBudgetBalance.text}` : ""}`
    : full?.estimated_budget_breakdown.total_estimate || "Flexible";
  const travelStyle = getTravelStyle(trip);
  const travelerDetails = tripTravelerDetails(trip);
  const travelerCount = travelerDetails.adults + travelerDetails.children + travelerDetails.infants;
  const travelerLabel = `${travelerCount} ${travelerCount === 1 ? "traveler" : "travelers"}`;
  const noteDisplay = travelerNoteDisplay(readTripNoteText(trip));
  const emailConfigured = isEmailConfigured().configured;
  const maskedEmail = maskEmailAddress(current.user.email);
  const backgroundWorkerConfigured = Boolean(process.env.ROAMLY_GENERATION_CRON_SECRET || process.env.CRON_SECRET);
  const confirmedBookingSnapshot = importedBookings.filter((booking) => isConfirmedBookingSnapshot(booking as Record<string, unknown>));
  const transportPreference = trip.transportation_preference || getString(getTripPlanningMetadata(trip.metadata).transportationPreference || getTripPlanningMetadata(trip.metadata).transportation_preference);
  const suppressFlightFraming = shouldSuppressFlightFraming({
    transportationPreference: transportPreference,
    hasConfirmedFlight: hasConfirmedFlightBooking(confirmedBookingSnapshot as Array<Record<string, unknown>>)
  });
  const unresolvedBookingSnapshot = importedBookings.filter((booking) => !isConfirmedBookingSnapshot(booking as Record<string, unknown>));
  const tripLifecycle = customerTripLifecycleState({
    status: trip.status,
    itineraryStatus: trip.itinerary_status,
    startDate: trip.start_date,
    endDate: trip.end_date,
    metadata: trip.metadata
  });
  const completedTrip = isCustomerTripTerminalState(tripLifecycle);
  const postTripFeedbackResult = completedTrip
    ? await supabase.from("trip_feedback").select("id").eq("trip_id", id).eq("user_id", current.user.id).eq("feedback_type", "post_trip").limit(1)
    : { data: [] as Array<{ id: string }>, error: null };
  const hasPostTripFeedback = postTripFeedbackResult.error ? null : Boolean(postTripFeedbackResult.data?.length);
  const focusDay = full?.daily_itinerary.find((day) => day.date === new Date().toISOString().slice(0, 10)) || full?.daily_itinerary[0] || null;
  const focusDayItems = focusDay ? buildDisplayTimelineItems(focusDay, confirmedBookingSnapshot as Array<Record<string, unknown>>, { suppressFlightFraming }).items : [];
  const focusNextItem = focusDayItems.find((item) => item.authority !== "flexible") || focusDayItems[0] || null;
  const unknownLineItemCount = full?.daily_itinerary.reduce((count, day) => {
    return count + (day.live_timeline || []).filter((item) => String(item.cost_status || "").toUpperCase() === "UNKNOWN").length;
  }, 0) || 0;
  const budgetPresentation = full
    ? buildBudgetPresentation({
        budgetAmount: tripBudgetAmount,
        currency,
        totalEstimateAmount: itineraryTotalEstimate,
        breakdown: full.estimated_budget_breakdown,
        priceDiscovery: persistedPriceDiscovery,
        confirmedBookingCount: confirmedBookingSnapshot.length,
        unknownLineItemCount
      })
    : null;
  const readinessBookingGroups = full
    ? (() => {
        const suggestions = bookingSuggestionsWithRecommendations(full, trip);
        const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 1, confirmedBookingSnapshot);
        const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3, confirmedBookingSnapshot);
        const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3, confirmedBookingSnapshot);
        const transportItems = curatedBookingSuggestions(suggestions, trip, ["transport", "car_rental"], 2, confirmedBookingSnapshot);
        return buildRelevantBookingGroups({ itinerary: full, trip, flightItems, hotelItems, activityItems, transportItems, confirmedBookings: confirmedBookingSnapshot });
      })()
    : [];
  const bookingsToArrange = readinessBookingGroups.filter((group) => Boolean(group.fallback) && group.items.length === 0).length;
  const bookingFocus = getString(unresolvedBookingSnapshot[0]?.booking_type).toLowerCase();
  const missingBookingFocus = readinessBookingGroups.find((group) => Boolean(group.fallback) && group.items.length === 0)?.fallback || null;
  const resolvedBookingFocus = ["flight", "hotel", "activity"].includes(bookingFocus)
    ? bookingFocus as "flight" | "hotel" | "activity"
    : missingBookingFocus;
  const conflictCount = full?.daily_itinerary.filter((day) => day.plan_status === "conflict").length || 0;
  const conflictDay = full?.daily_itinerary.find((day) => day.plan_status === "conflict")?.day_number || null;
  const tripTravelersResult = await listTripTravelers(supabase, id);
  const travelerRequirementState = buildTripTravelerRequirements({
    trip,
    travelers: tripTravelersResult.error ? [] : tripTravelersResult.travelers,
    accountHolderPassportCountry: travelerMemory.profile?.passport_issuing_country
  });
  const travelRequirements = travelerRequirementState.evaluations.flatMap((evaluation) => evaluation.requirements);
  const uncertainItemCount = full?.daily_itinerary.reduce((count, day) => {
    const uncertainTimeline = (day.live_timeline || []).some((item) => {
      const record = item as unknown as Record<string, unknown>;
      return getString(record.routing_status).toUpperCase() === "UNCERTAIN" || getString(record.cost_status).toUpperCase() === "UNKNOWN";
    });
    return count + (day.plan_status === "uncertain" || uncertainTimeline ? 1 : 0);
  }, 0) || 0;
  const readiness = deriveTripReadiness({
    tripId: id,
    startDate: trip.start_date,
    endDate: trip.end_date,
    generationStatus,
    hasItinerary: canShowFull,
    confirmedBookingCount: confirmedBookingSnapshot.length,
    bookingsNeedingReview: unresolvedBookingSnapshot.length,
    bookingsToArrange,
    bookingFocus: resolvedBookingFocus,
    conflictCount,
    conflictDay,
    uncertainItemCount,
    budgetStatus: budgetPresentation?.status || null,
    preparationRequirementsNeedingReview: countMaterialTravelRequirements(travelRequirements),
    paymentNeedsAttention: checkoutNeedsAttention,
    completedTrip,
    hasPostTripFeedback,
    generationAwaitingUnlock: generationRequiresPayment && !generationRunning
  });
  const unlockRequired = generationRequiresPayment && !generationRunning && !checkoutNeedsAttention;
  const draftCommand = travelerDraftCommand({
    unlockRequired,
    hasItinerary: canShowFull,
    generationRunning
  });
  const attentionText = draftCommand?.title || readiness.urgentItems[0] || "";
  const actionFocus = parseTripActionFocus(one(search.focus));
  const focusAnchor = actionFocus === "budget"
    ? "budget"
    : actionFocus === "requirements"
      ? "requirements"
      : typeof actionFocus === "string" && actionFocus.startsWith("day-")
        ? "day-by-day"
        : null;
  const focusedBooking = actionFocus === "flight" || actionFocus === "hotel" || actionFocus === "activity" ? actionFocus : null;
  const focusedBookingLabel = focusedBooking === "flight" ? "flight" : focusedBooking === "hotel" ? "stay" : focusedBooking === "activity" ? "activity" : null;
  const focusedBudget = actionFocus === "budget";
  const timedNextAction = readiness.primaryAction.id === "plan" || readiness.primaryAction.id === "conflict";
  const commandNextTitle = completedTrip ? null : attentionText || readiness.upcomingActions[0] || (timedNextAction && focusNextItem && !looksLikeProviderSearchTitle(focusNextItem.title) ? focusNextItem.title : "") || "Your trip is ready to review.";
  const commandNextMeta = completedTrip || !timedNextAction ? "" : focusNextItem && !looksLikeProviderSearchTitle(focusNextItem.title) ? focusNextItem.time : "";
  const packingItems = full ? packingChecklistItems(checklist, full).slice(0, 8) : [];
  const localTipItems = full?.local_tips.slice(0, 6) || [];
  const safetyItems = full?.safety_notes.slice(0, 6) || [];
  const documentItems = getStringList(trip.document_checklist, [], 6);
  const emergencyItems = full?.emergency_notes.slice(0, 6) || [];
  const lowCostItems = full?.free_or_low_cost_notes.slice(0, 5) || [];
  const hasEssentials = Boolean(full?.pre_trip_essentials.length);
  const hasTravelNotes = [packingItems, localTipItems, safetyItems, documentItems, emergencyItems, lowCostItems].some((items) => items.length > 0);
  const hasRequirements = countMaterialTravelRequirements(travelRequirements) > 0;
  const briefingTabs = [
    ["roamly-tab-overview", "Snapshot"],
    ...(hasRequirements ? [["roamly-tab-requirements", "Entry requirements"]] : []),
    ...(hasEssentials ? [["roamly-tab-essentials", "Before you go"]] : []),
    ...(hasTravelNotes ? [["roamly-tab-travel-notes", "Practical"]] : [])
  ];
  const panelTabs = [
    ["roamly-tab-day-by-day", "Itinerary"],
    ["roamly-tab-budget", "Budget"],
    ["roamly-tab-bookings", "Bookings"],
    ...briefingTabs
  ];
  const travelerStatus = mapTravelerTripStatus({
    completed: completedTrip,
    phase: readiness.phase,
    readinessState: readiness.state,
    hasItinerary: canShowFull,
    companionUnlocked: trackingUnlocked,
    budgetOver: budgetPresentation?.status === "OVER_BUDGET",
    building: generationRunning || (generationBusy && !generationRequiresPayment),
    awaitingUnlock: Boolean(draftCommand),
    signalsUnknown: canShowFull && !budgetPresentation && readiness.state == null
  });
  const defaultPanelTab = actionFocus === "requirements" && hasRequirements
    ? "roamly-tab-requirements"
    : actionFocus === "budget"
      ? "roamly-tab-budget"
      : typeof actionFocus === "string" && actionFocus.startsWith("day-")
        ? "roamly-tab-day-by-day"
        : null;
  const showGenerationPanel = generationPanelVisible && (generationRunning || (!generationRequiresPayment && generationBusy));
  const showPaymentWall = Boolean(draftCommand);
  const headerBudgetText = budgetPresentation?.status === "BUDGET_UNCERTAIN"
    ? `${budgetPresentation.targetLabel === "Budget target not set" ? "Budget not set" : `Your budget ${budgetPresentation.targetLabel}`}. Some item prices are not available, and those are not $0.`
    : budgetPresentation?.status === "OVER_BUDGET"
      ? `${budgetPresentation.remainingLabel || "Over budget"} · priced and estimated amounts`
      : headerBudgetBalance?.text || (tripBudgetAmount ? formatBudgetMoney(tripBudgetAmount, currency) : "Still uncertain");

  if (checkoutNeedsAttention) {
    await recordAppEvent(supabase, {
      userId: current.user.id,
      eventType: "checkout_sync_failed",
      metadata: { tripId: id, error: checkoutSyncError }
    });
  }

  logGenerationDiagnostic(canShowFull && full ? "itinerary_render_full_loaded" : "itinerary_render_full_unavailable", {
    route: "/trip/[id]",
    tripId: id,
    supabaseHost: getPublicSupabaseHost(),
    fullJsonPresent: Boolean(baseFull),
    localizedFullPresent: Boolean(full),
    itineraryLocked,
    canShowFull,
    displayDayRowsLoaded: days.length,
    activityRowsLoaded: activities.length,
    canonicalDayCount: canonicalDays.length,
    ...(full ? summarizeItineraryShape(full) : {})
  });

  return (
    <div className="safe-bottom roamly-print-document w-full bg-[#fbf8ef] px-4 pb-28 pt-5 text-ink sm:px-6 sm:py-8">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <GenerationNavigationRefresh active={one(search.generating) === "1" && !generationPanelVisible && !canShowFull} />
      <div className="roamly-print-paper mx-auto max-w-6xl">
        <div className="roamly-screen-document">
        <section className="border-b border-[#e8dfd0] bg-transparent pb-5 pt-1 sm:pb-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-ocean">Trip Home</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-ink sm:text-4xl">{tripTitle}</h1>
              <p className="mt-1 text-sm font-bold text-slate-600">{destinationLabel} · {formatDateRange(trip, locale)}</p>
              {(full?.destination_summary || preview?.destination_summary) ? (
                <details className="mt-2 max-w-2xl">
                  <summary className="min-h-8 cursor-pointer text-sm font-black text-ocean">Trip context</summary>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{compact(full?.destination_summary || preview?.destination_summary, "", 150)}</p>
                </details>
              ) : null}
            </div>
            <Badge tone={travelerStatus.tone === "sun" ? "sun" : travelerStatus.tone === "coral" ? "coral" : travelerStatus.tone === "ink" ? "ink" : "ocean"}>
              {travelerStatus.badge}
            </Badge>
          </div>

          {!draftCommand && commandNextTitle ? (
            <div className="roamly-now-next mt-5 border-l-2 border-ocean bg-[#e8f5f0] px-4 py-4 text-ink sm:px-5">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">What matters now</p>
              <p className="mt-1 text-lg font-black">{commandNextTitle}</p>
              {commandNextMeta ? <p className="mt-1 text-sm font-bold text-slate-600">{commandNextMeta}</p> : null}
              <a href={readiness.primaryAction.href} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white">{readiness.primaryAction.label}</a>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-bold text-slate-600">
            <span>Budget: {headerBudgetText}</span>
            <span>{formatDayCount(dayCount)}</span>
            <span>{travelerLabel}</span>
            {confirmedBookingSnapshot.length ? <a href="#bookings" className="text-ocean">{confirmedBookingSnapshot.length} {confirmedBookingSnapshot.length === 1 ? "booking" : "bookings"} confirmed →</a> : null}
            {trackingUnlocked && !completedTrip ? <span className="text-ocean">Live Companion available</span> : null}
          </div>
              {itineraryLocked ? <NoticeBanner>This saved itinerary will not be regenerated in place. Use the trip controls to request supported changes.</NoticeBanner> : null}
              {checkoutNeedsAttention ? (
                <NoticeBanner tone="coral">
                  Stripe returned successfully, but Roamly could not confirm the payment yet. Refresh this page in a moment; if it stays locked, contact support with your checkout receipt.
                </NoticeBanner>
              ) : null}
              {checkoutProcessing ? (
                <NoticeBanner>
                  Stripe returned successfully. Roamly is waiting for the signed webhook to update this trip; refresh in a moment if it still looks locked.
                </NoticeBanner>
              ) : null}
              {checkoutStartFailed ? (
                <NoticeBanner tone="coral">Stripe checkout could not be opened. Your trip draft was saved, so you can try unlocking it again from this page.</NoticeBanner>
              ) : null}
              {showGenerationPanel && generationProgress ? (
                <StagedGenerationProgress
                  tripId={id}
                  initialProgress={generationProgress}
                  emailConfigured={emailConfigured}
                  maskedEmail={maskedEmail}
                  backgroundWorkerConfigured={backgroundWorkerConfigured}
                  destinationLabel={destinationLabel}
                  dateLabel={formatDateRange(trip, locale)}
                  travelerLabel={travelerLabel}
                  apiAuthToken={apiAuthToken}
                />
              ) : null}

          {!showGenerationPanel ? (
            <div className="roamly-no-print mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
              {!canShowFull ? (
                <PrimaryTripAction
                  tripId={id}
                  itineraryLocked={itineraryLocked}
                  generationInProgress={showPaymentWall ? false : generationInProgress}
                  trackingUnlocked={trackingUnlocked}
                  paidForItinerary={paidForItinerary}
                  freeAvailable={freeAvailable}
                  testerAccess={access.hasQaAccess}
                  apiAuthToken={apiAuthToken}
                />
              ) : null}
              {canShowFull ? (
                <>
                  <TripShareActions tripId={id} tripTitle={tripTitle} emailConfigured={emailConfigured} />
                  <TranslateItineraryButton tripId={id} displayedLanguage={displayedItineraryLanguage} />
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <TripContextNav
          tripId={id}
          title={tripTitle}
          destination={destinationLabel}
          dates={formatDateRange(trip, locale)}
          status={travelerStatus.badge}
          showContext={false}
          contentReady={canShowFull && !!full && !generationPanelVisible}
          focusAnchor={focusAnchor}
        />

        {!canShowFull && !showGenerationPanel ? (
          <section id="day-by-day" className="roamly-enter mt-4 scroll-mt-32 rounded-3xl border border-[#e8dfd0] bg-white/80 px-5 py-8 text-center shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-8">
            <p className="roamly-eyebrow">{completedTrip ? "Trip completed" : showPaymentWall ? "Draft" : "Itinerary"}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-ink">
              {completedTrip ? "This trip has no saved day-by-day plan" : showPaymentWall ? "Unlock this trip" : "Your itinerary isn't ready yet"}
            </h2>
            {showPaymentWall ? (
              <p id="unlock" className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-600">
                This draft is saved. Roamly is not preparing it yet. You see the price before you pay.
              </p>
            ) : (
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-600">
                {completedTrip
                  ? "This was a field-test trip and no day-by-day itinerary was generated for it. Your other trips with generated plans show the full day-by-day view here."
                  : "Once your itinerary is generated, the full day-by-day plan, budget breakdown, and bookings will appear here."}
              </p>
            )}
          </section>
        ) : null}

        {canShowFull && full && !generationPanelVisible ? (
          <>
            <div className="roamly-tabs mt-4">
              <style>{`
                .roamly-tab-nav{display:none}
                .roamly-tab-input{position:absolute;opacity:0;pointer-events:none}
                .roamly-tab-panel{display:none}
                @keyframes roamly-panel-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
                .roamly-tab-panel,.roamly-day-panel{animation:roamly-panel-in .32s cubic-bezier(0.32,0.72,0,1)}
                .roamly-tab-nav label{transition:transform .18s cubic-bezier(0.32,0.72,0,1),background-color .25s ease,border-color .25s ease,color .25s ease}
                .roamly-tab-nav label:active{transform:scale(0.95)}
                .roamly-day-nav label{transition:transform .18s cubic-bezier(0.32,0.72,0,1),background-color .25s ease,border-color .25s ease}
                .roamly-day-nav label:active{transform:scale(0.95)}
                @media (prefers-reduced-motion:reduce){.roamly-tab-panel,.roamly-day-panel{animation:none}.roamly-tab-nav label,.roamly-day-nav label{transition:none}}
                .roamly-home-panel{display:block}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-overview:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-budget:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-bookings:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-requirements:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-essentials:checked ~ .roamly-tab-panels .roamly-home-panel,
                #roamly-tab-travel-notes:checked ~ .roamly-tab-panels .roamly-home-panel{display:none}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-panels .roamly-panel-day-by-day,
                #roamly-tab-overview:checked ~ .roamly-tab-panels .roamly-panel-overview,
                #roamly-tab-budget:checked ~ .roamly-tab-panels .roamly-panel-budget,
                #roamly-tab-bookings:checked ~ .roamly-tab-panels .roamly-panel-bookings,
                #roamly-tab-requirements:checked ~ .roamly-tab-panels .roamly-panel-requirements,
                #roamly-tab-essentials:checked ~ .roamly-tab-panels .roamly-panel-essentials,
                #roamly-tab-travel-notes:checked ~ .roamly-tab-panels .roamly-panel-travel-notes{display:block}
                #roamly-tab-overview:checked ~ .roamly-tab-nav,
                #roamly-tab-requirements:checked ~ .roamly-tab-nav,
                #roamly-tab-essentials:checked ~ .roamly-tab-nav,
                #roamly-tab-travel-notes:checked ~ .roamly-tab-nav{display:block}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-nav label[for="roamly-tab-day-by-day"],
                #roamly-tab-overview:checked ~ .roamly-tab-nav label[for="roamly-tab-overview"],
                #roamly-tab-budget:checked ~ .roamly-tab-nav label[for="roamly-tab-budget"],
                #roamly-tab-bookings:checked ~ .roamly-tab-nav label[for="roamly-tab-bookings"],
                #roamly-tab-requirements:checked ~ .roamly-tab-nav label[for="roamly-tab-requirements"],
                #roamly-tab-essentials:checked ~ .roamly-tab-nav label[for="roamly-tab-essentials"],
                #roamly-tab-travel-notes:checked ~ .roamly-tab-nav label[for="roamly-tab-travel-notes"]{background:#1b9aaa;color:white;border-color:#1b9aaa}
                .roamly-day-input{position:absolute;opacity:0;pointer-events:none}
                .roamly-day-panel{display:none}
                ${dayNumbersToRender.map((dayNumber) => `
                  #roamly-day-${dayNumber}:checked ~ .roamly-day-nav label[for="roamly-day-${dayNumber}"]{background:#1b9aaa;color:white;border-color:#1b9aaa}
                  #roamly-day-${dayNumber}:checked ~ .roamly-day-nav label[for="roamly-day-${dayNumber}"] span{color:white}
                  #roamly-day-${dayNumber}:checked ~ .roamly-day-panels .roamly-day-panel-${dayNumber}{display:block}
                `).join("\n")}
                @media print{.roamly-tab-panel,.roamly-day-panel{display:block!important}.roamly-tab-nav,.roamly-day-nav{display:none!important}}
              `}</style>
              {panelTabs.map(([tabId]) => (
                <input key={tabId} className="roamly-tab-input" type="radio" name="roamly-completed-tab" id={tabId} defaultChecked={tabId === defaultPanelTab} />
              ))}

              <nav aria-label="Trip briefing sections" title="Trip sections" className="roamly-tab-nav roamly-no-print top-[4.25rem] z-20 -mx-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fffdf8]/95 px-4 py-2 backdrop-blur sm:sticky sm:top-[5.15rem] sm:mx-0 sm:rounded-full sm:border sm:px-3 sm:py-3">
                <div className="flex min-w-max gap-2">
                  {briefingTabs.map(([tabId, label]) => (
                    <label
                      key={tabId}
                      htmlFor={tabId}
                      className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[#e8dfd0] bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-ocean/30 hover:text-ocean sm:px-4 sm:text-sm"
                    >
                      {label}
                    </label>
                  ))}
                </div>
              </nav>

              <div className="roamly-tab-panels">
                <section className="roamly-home-panel mt-2 scroll-mt-28" aria-label="Trip home">
                  <div className="grid gap-3">
                    <div className="px-0.5">
                      <h2 className="text-[1.65rem] font-semibold tracking-[-0.03em] text-ink">{destinationLabel}</h2>
                      <p className="mt-1 text-[0.95rem] leading-6 text-slate-600">{formatDateRange(trip, locale)} · {formatDayCount(dayCount)} · {travelerLabel}</p>
                      <p className="mt-1 text-[0.95rem] leading-6 text-slate-600">{suppressFlightFraming ? (isDriveMode(transportPreference) ? "Drive. No flight is booked." : "Mixed travel. No flight is booked.") : transportPreference ? transportPreference : "How you’ll get there is still to confirm."}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-4 shadow-[0_8px_24px_rgba(16,32,51,0.04)]">
                      <p className="text-[0.75rem] font-medium text-slate-500">Budget</p>
                      <p className="mt-1 text-base font-semibold tracking-tight text-ink">{headerBudgetText}</p>
                      <a href="#budget" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-ocean">Review the budget</a>
                    </div>
                  </div>
                  {noteDisplay.text ? (
                    <div className="mt-3 rounded-2xl bg-white px-4 py-4 shadow-[0_8px_24px_rgba(16,32,51,0.04)]">
                      <p className="text-[0.75rem] font-medium text-slate-500">Your notes</p>
                      <ul className="mt-2 grid gap-1.5">
                        {noteDisplay.constraints.map((line) => <li key={line} className="text-sm leading-6 text-slate-700">{line}</li>)}
                      </ul>
                      {noteDisplay.hotel ? <p className="mt-3 text-sm leading-6 text-slate-700">{noteDisplay.hotel}</p> : null}
                      {noteDisplay.flight ? <p className="mt-1 text-sm leading-6 text-slate-700">{noteDisplay.flight}</p> : null}
                      {noteDisplay.activity ? <p className="mt-1 text-sm leading-6 text-slate-700">{noteDisplay.activity}</p> : null}
                      {noteDisplay.gaps.length ? <p className="mt-3 text-xs leading-5 text-slate-500">{noteDisplay.gaps.join(" ")}</p> : null}
                    </div>
                  ) : null}
                </section>
                <section id="day-by-day" className="roamly-tab-panel roamly-panel-day-by-day mt-8 scroll-mt-32">
                  <SectionHeading
                    eyebrow="Day-by-day"
                    title="Your itinerary"
                    summary="Clean daily plan with timing, travel, and key notes."
                  />
                  <div>
                    {dayNumbersToRender.map((dayNumber) => (
                      <input
                        key={`day-input-${dayNumber}`}
                        className="roamly-day-input"
                        type="radio"
                        name="roamly-day-selector"
                        id={`roamly-day-${dayNumber}`}
                        defaultChecked={dayNumber === (Number(one(search.focus)?.replace("day-", "")) || dayNumbersToRender[0])}
                      />
                    ))}
                    <nav className="roamly-day-nav roamly-no-print md:sticky md:top-[9.2rem] z-10 -mx-4 mb-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fbf8ef]/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-full sm:border">
                      <div className="flex min-w-max gap-2">
                        {dayNumbersToRender.map((dayNumber) => (
                          <label
                            key={dayNumber}
                            htmlFor={`roamly-day-${dayNumber}`}
                            className="flex min-h-14 min-w-[5.5rem] cursor-pointer flex-col justify-center rounded-xl border border-[#e8dfd0] bg-white px-3 py-2 text-left text-xs font-black text-slate-600 transition hover:border-ocean/30 hover:text-ocean sm:min-w-[7rem] sm:px-4"
                          >
                            <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Day {dayNumber}</span>
                            <span className="mt-0.5 truncate text-sm text-ink">
                              {canonicalDayByNumber.get(dayNumber)?.date ? formatTripDate(canonicalDayByNumber.get(dayNumber)?.date, locale).replace(/, \d{4}$/, "") : generationDayProgress.find((item) => item.dayNumber === dayNumber)?.date ? formatTripDate(generationDayProgress.find((item) => item.dayNumber === dayNumber)?.date, locale).replace(/, \d{4}$/, "") : "Planning"}
                            </span>
                            <span className="truncate text-[10px] font-bold text-slate-400">
                              {presentTravelerArea(canonicalDayByNumber.get(dayNumber)?.city, suppressFlightFraming) || (!canonicalDayByNumber.has(dayNumber) ? generationFailed ? "Needs attention" : "Building" : "")}
                            </span>
                          </label>
                        ))}
                      </div>
                    </nav>
                    <div className="roamly-day-panels grid gap-4 md:gap-5">
                      {dayNumbersToRender.map((dayNumber) => {
                        const day = canonicalDayByNumber.get(dayNumber);
                        const progressDay = generationDayProgress.find((item) => item.dayNumber === dayNumber);
                        return (
                          <div key={dayNumber} className={`roamly-day-panel roamly-day-panel-${dayNumber}`}>
                            {day ? (
                              <DayTimelineCard tripId={id} day={day} currency={currency} locale={locale} confirmedBookings={confirmedBookingSnapshot as Array<Record<string, unknown>>} suppressFlightFraming={suppressFlightFraming} />
                            ) : (
                              <BuildingDayCard
                                dayNumber={dayNumber}
                                date={progressDay?.date}
                                status={progressDay?.status || (generationFailed ? "failed" : null)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section id="overview" className="roamly-tab-panel roamly-panel-overview mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Snapshot" title="Trip at a glance" summary="The key context for this trip, with the next decision kept above." />
                  <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="border-l-2 border-ocean bg-ocean/5 px-4 py-4 sm:px-5">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Trip status</p>
                      <p className="mt-2 text-lg font-black leading-6 text-ink">
                        {attentionText || (confirmedBookingSnapshot.length ? "Your key travel details are coming together." : "Your trip is ready to shape around the day you want.")}
                      </p>
                    </div>
                    <div className="grid gap-3 border-y border-[#e8dfd0] py-3 text-sm">
                      <p><span className="font-black text-ink">Best for:</span> <span className="font-semibold text-slate-600">{full.best_for.slice(0, 3).join(" · ") || travelStyle}</span></p>
                      <p><span className="font-black text-ink">Budget:</span> <span className="font-semibold text-slate-600">{compact(full.budget_fit_summary, "Still uncertain", 130)}</span></p>
                      <p><span className="font-black text-ink">Transport:</span> <span className="font-semibold text-slate-600">{compact(full.transport_overview, "Travel time is included in the plan.", 130)}</span></p>
                    </div>
                  </div>
                </section>

                <section id="budget" className="roamly-tab-panel roamly-panel-budget mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Budget" title="Budget" summary={readiness.primaryAction.id === "budget" ? readiness.urgentItems[0] || "Review the uncertainty in your trip costs." : "See what is committed, expected, and still uncertain."} />
                  {focusedBudget ? <p className="mb-4 border-l-2 border-ocean bg-ocean/5 px-3 py-2 text-sm font-bold text-slate-700">This is the budget context behind your current trip action.</p> : null}
                  <BudgetSummary
                    trip={trip}
                    itinerary={full}
                    currency={currency}
                    priceDiscovery={persistedPriceDiscovery}
                    confirmedBookingCount={confirmedBookingSnapshot.length}
                  />
                </section>

                <section id="bookings" className="roamly-tab-panel roamly-panel-bookings mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Bookings" title="Recommended bookings" summary={readiness.primaryAction.id === "bookings" ? readiness.urgentItems[0] || "Review the bookings that still need you." : "Only the recommended transport, stay, flights, and important activities."} />
                  {noteDisplay.text ? (
                    <div className="mb-4 rounded-2xl bg-white px-4 py-4 shadow-[0_8px_24px_rgba(16,32,51,0.04)]">
                      <p className="text-[0.75rem] font-medium text-slate-500">Your notes shape these choices</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{noteDisplay.hotel}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{noteDisplay.flight}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{noteDisplay.activity}</p>
                    </div>
                  ) : null}
                  {focusedBookingLabel ? <p className="mb-4 border-l-2 border-ocean bg-ocean/5 px-3 py-2 text-sm font-bold text-slate-700">Start with your {focusedBookingLabel} details below.</p> : null}
                  <div className="mb-4">
                    <MarketPriceRefreshButton tripId={id} />
                    {one(search.hotel_action) === "price_changed" ? <p className="mt-2 text-sm font-bold text-slate-700">Hotel price changed. Review the updated hotel price before continuing.</p> : null}
                    {one(search.hotel_action) === "unavailable" ? <p className="mt-2 text-sm font-bold text-coral">The selected hotel is no longer available for these dates.</p> : null}
                    {one(search.hotel_action) === "verification_failed" ? <p className="mt-2 text-sm font-bold text-slate-700">We could not verify the selected hotel&apos;s current price or availability. Refresh and try again.</p> : null}
                  </div>
                  <HotelProductOptions presentation={hotelProductPresentation} tripId={id} pendingChoice={pendingHotelProductChoice} />
                  <BookingPlan itinerary={full} trip={trip} tripId={id} confirmedBookings={currentImportedBookings as Array<Record<string, unknown>>} suppressFlightFraming={suppressFlightFraming} />
                  <details className="roamly-no-print mt-5 rounded-2xl border border-[#e8dfd0] bg-white px-4 py-3">
                    <summary className="cursor-pointer text-sm font-black text-ocean">Confirmed bookings and imports</summary>
                    <div className="mt-4 grid gap-4">
                      <BookingSummaryList bookings={importedBookings as Array<Record<string, unknown>>} />
                      <TripBookingsManager tripId={id} initialBookings={importedBookings} />
                    </div>
                  </details>
                </section>

                {hasRequirements ? <section id="requirements" className="roamly-tab-panel roamly-panel-requirements mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Before you go" title="Entry requirements" summary={travelerRequirementState.evaluations.length > 1 ? "Requirements can differ for each traveler. Roamly evaluates each person only from their explicit passport country." : "A conservative review based on your destination and your declared passport country."} />
                  <TripTravelerRequirements tripId={id} evaluations={travelerRequirementState.evaluations} />
                </section> : null}

                {hasEssentials ? (
                  <section id="essentials" className="roamly-tab-panel roamly-panel-essentials scroll-mt-32 scroll-mb-[calc(10rem+env(safe-area-inset-bottom))] pb-24 lg:pb-0">
                    <PreTripEssentialsSection essentials={full.pre_trip_essentials} tripId={id} />
                  </section>
                ) : null}

                {hasTravelNotes ? (
                  <section id="travel-notes" className="roamly-tab-panel roamly-panel-travel-notes mt-8 scroll-mt-32">
                    <SectionHeading eyebrow="Practical" title="Travel notes" summary="Useful reference for before and during the trip." />
                    <div className="grid gap-4 md:grid-cols-2">
                      <ChecklistGroup title="Packing" items={packingItems} />
                      <ChecklistGroup title="Local tips" items={localTipItems} />
                    </div>
                    {[safetyItems, documentItems, emergencyItems, lowCostItems].some((items) => items.length > 0) ? (
                      <details className="mt-4 rounded-2xl border border-[#e8dfd0] bg-white px-4 py-3">
                        <summary className="min-h-11 cursor-pointer text-sm font-black text-ocean">More practical notes</summary>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <ChecklistGroup title="Safety" items={safetyItems} />
                          <ChecklistGroup title="Documents" items={documentItems} />
                          <ChecklistGroup title="Emergency" items={emergencyItems} />
                          <ChecklistGroup title="Low-cost reminders" items={lowCostItems} />
                        </div>
                      </details>
                    ) : null}
                  </section>
                ) : null}
              </div>

            </div>

            <footer className="mt-10 border-t border-[#e8dfd0] py-6 text-sm font-bold text-slate-500">
              Generated by Roamly
            </footer>
          </>
        ) : null}
        </div>
        {canShowFull && full && !generationPanelVisible ? (
          <CompactPrintItinerary
            trip={trip}
            itinerary={full}
            bookings={currentImportedBookings as Array<Record<string, unknown>>}
            tripTitle={tripTitle}
            destinationLabel={destinationLabel}
            currency={currency}
            budgetDisplay={budgetDisplay}
            travelStyle={travelStyle}
            dayCount={dayCount}
            locale={locale}
            suppressFlightFraming={suppressFlightFraming}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function TripHomePage(props: TripPageProps) {
  return (
    <Suspense fallback={<TripHomeLoading />}>
      <TripPage {...props} />
    </Suspense>
  );
}
