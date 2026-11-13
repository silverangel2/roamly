import Image from "next/image";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cookies } from "next/headers";
import { hasSetupSkip, setupSkipCookieName } from "@/lib/roamly/setupSkip";
import { formatGateEyebrow } from "@/lib/roamly/tripIdentity";
import { TripAuthSessionCheck } from "@/components/auth/TripAuthSessionCheck";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import { SetupGateScreen } from "@/components/roamly/TripSetupGate";
import { OfflineTripBanner } from "@/components/roamly/OfflineTripBanner";
import { LimitedFeaturesNotice } from "@/components/roamly/LimitedFeaturesNotice";
import { TripStateLines } from "@/components/roamly/TripStateLines";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { hasPriorTrip, setupGateApplies, setupGateLimitedFeatures } from "@/lib/roamly/setupGate";
import { EntryGate } from "@/components/roamly/EntryGate";
import { HandoffBlock } from "@/components/roamly/HandoffBlock";
import { build2GatesEnabled } from "@/lib/roamly/build2Flags";
import { getDestinationPhoto, type DestinationPhotoSharedState } from "@/lib/roamly/destinationPhoto";
import { buildVenuePhotoMap } from "@/lib/roamly/venuePhotos";
import { HotelPartnerChoices } from "@/components/trip/HotelPartnerChoices";
import { StaySelector } from "@/components/trip/StaySelector";
import { buildStayOptions } from "@/lib/roamly/stayOptions";
import { DestinationPhotoBand } from "@/components/trip/DestinationPhotoBand";
import { GuardedImage } from "@/components/roamly/GuardedImage";
import { GuardedHotelActionButton } from "@/components/trip/GuardedHotelActionButton";
import { HotelProductOptions } from "@/components/trip/HotelProductOptions";
import { TripGapCards } from "@/components/roamly/TripGapCards";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { TripRenameControl } from "@/components/trip/TripRenameControl";
import { GenerationNavigationRefresh } from "@/components/trip/GenerationNavigationRefresh";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { MarketPriceRefreshButton } from "@/components/trip/MarketPriceRefreshButton";
import { StagedGenerationProgress } from "@/components/trip/StagedGenerationProgress";
import { TranslateItineraryButton } from "@/components/trip/TranslateItineraryButton";
import { TripShareActions } from "@/components/trip/TripShareActions";
import { ItineraryHomePanel } from "@/components/trip/ItineraryHomePanel";
import { buildHomeDayView, formatHomeDateRange } from "@/lib/roamly/itineraryHome";
import { buildDocumentChecklist } from "@/lib/roamly/tripCompanion";
import { PostTripLibraryAskCard } from "@/components/trip/PostTripLibraryAskCard";
import { TripCommentBox } from "@/components/trip/TripCommentBox";
import { TripWeatherCard, type TripWeatherRequest } from "@/components/roamly/TripWeatherCard";
import { getTripWeather } from "@/lib/roamly/tripWeather";
import {
  SectionHeading,
  NavigationChipList,
  buildDisplayTimelineItems,

  DayTimelineCard,
  BuildingDayCard  
} from "@/components/trip/ItineraryDayPlan";
import { TripBookingsManager } from "@/components/roamly/TripBookingsManager";
import { BuiBadge, BuiChip } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";
import { BuiCheckoutSuccess } from "@/components/boardui/CheckoutSuccess";
import {
  buildPreviewFromItinerary,
  formatMoney,
  getItineraryTotalEstimateAmount,
  type RoamlyItinerary
} from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { translateExactText, translateKey, type RoamlyLocale } from "@/lib/i18n";
import { TripHashSync } from "@/components/roamly/TripContextNav";
import { HouseAdSlot } from "@/components/roamly/HouseAdCard";
import { CustomizeYourTrip } from "@/components/roamly/CustomizeYourTrip";
import { confirmCheckoutSessionForTrip } from "@/lib/payments";
import { isPhilippinesTrip } from "@/lib/roamly/billing";
import { isEmailConfigured } from "@/lib/roamly/email";
import { affiliateDisclosure, enrichItineraryBookingSuggestions, klookActivityActionState } from "@/lib/roamly/affiliateLinks";
import { flightMarketFreshness } from "@/lib/roamly/selectedFlightIdentity";
import { amazonAffiliateDisclosure, type RoamlyPreTripEssential } from "@/lib/roamly/amazonAffiliate";
import { esimVerificationCopy } from "@/lib/roamly/esim";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import { buildBudgetPresentation } from "@/lib/roamly/budgetPresentation";
import { BudgetVerdictCard } from "@/components/BudgetVerdictCard";
import { readBudgetVerdictDisplay } from "@/lib/roamly/engine/budgetVerdictDisplay";
import { hasConfirmedFlightBooking, isDriveMode, isMixedMode, looksLikeProviderSearchTitle, presentDayHeading, presentGroundTransportText, presentTravelerArea, presentTravelerTitle, shouldSuppressFlightFraming } from "@/lib/roamly/itineraryPresentation";
import { rankChoicesForNotes, readTripNoteText, travelerNoteDisplay } from "@/lib/roamly/travelerNotes";
import { mapTravelerTripStatus } from "@/lib/roamly/tripStatusDisplay";
import type { TransportOption } from "@/lib/roamly/transportOptions";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordAppEvent } from "@/lib/roamly/events";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { getLocalizedItinerary, getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { isLegacyBookingUrl, isTravelerSafeStay22Url, resolveAffiliateLink, resolveConfiguredHotelPartners, type HotelPartnerChoice } from "@/lib/roamly/affiliateResolver";
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
import { isConfirmed as bookingTruthIsConfirmed } from "@/lib/roamly/bookingTruth";
import { reconcileItineraryItemsWithCurrentBookings } from "@/lib/roamly/itineraryBookingOverrides";
import { isConfirmedItineraryBookingAnchor } from "@/lib/roamly/confirmedItineraryAnchor";
import { customerTripLifecycleState, isCustomerTripTerminalState } from "@/lib/roamly/liveCompanion";
import { TripTravelerRequirements } from "@/components/trip/TripTravelerRequirements";
type TripPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Skeleton stays on the trip home page only. Live must not inherit it, or returning there flashes an empty shell while the saved trip is about to render. */
function TripHomeLoading({ locale }: { locale: RoamlyLocale }) {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      role="status"
      aria-label={translateExactText(locale, "Loading trip")}
    >
      <BuiSkeleton className="h-9 w-2/3" />
      <BuiSkeleton className="mt-3 h-5 w-1/3" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <BuiSkeleton className="h-64" />
        <BuiSkeleton className="h-64" />
      </div>
      <BuiSkeleton className="mt-4 h-40" />
      <span className="sr-only">{translateExactText(locale, "Loading your trip…")}</span>
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

function formatTripDate(value?: string | null, locale: RoamlyLocale = "en") {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatBookingTimestamp(value: unknown, locale: RoamlyLocale = "en", timeZone = "UTC") {
  const text = getString(value);
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short"
  }).format(date);
}

function isConfirmedBookingSnapshot(booking: Record<string, unknown>) {
  // Workstream A + Round 2 Lane E2: the trip page's confirmed
  // snapshot derives from the ONE booking-truth rule at the
  // providerConfirmationEvidence tier ONLY (owner ruling 2026-10-30) — the old
  // OR rule (traveler_confirmed OR an active-family status) promoted
  // email-manufactured statuses to confirmed, and the round-1 legacy
  // no-source exception promoted traveler-only rows. A
  // travelerConfirmedOnly booking falls into the unresolved/needs-
  // review snapshot on this page, never the confirmed snapshot, so
  // its counts ("N bookings confirmed", budget committed count) and
  // its itinerary anchors are provider-verified only.
  // Superseded/test/cancelled records never qualify.
  return bookingTruthIsConfirmed({
    booking_status: getString(booking.booking_status || booking.status),
    traveler_confirmed: booking.traveler_confirmed === true,
    confirmation_number: getString(booking.confirmation_number),
    provider_booking_id: getString(booking.provider_booking_id),
    provider_name: getString(booking.provider_name) || getString(booking.provider),
    title: getString(booking.title),
    source_type: getString(booking.source_type),
    source_reference: getString(booking.source_reference),
    superseded_by_booking_id: (booking.superseded_by_booking_id as string | null) ?? null,
    metadata: getRecord(booking.metadata),
    reservation_requirements: getRecord(booking.reservation_requirements)
  });
}

function bookingDetailText(booking: Record<string, unknown>, locale: RoamlyLocale = "en") {
  const metadata = getRecord(booking.metadata);
  const zone = getString(booking.timezone || metadata?.timezone) || "UTC";
  let timestamp = "";
  try { timestamp = formatBookingTimestamp(booking.start_at, locale, zone); }
  catch { timestamp = formatBookingTimestamp(booking.start_at, locale, "UTC"); }
  const legacyDate = getString(booking.start_date);
  const legacyTime = getString(booking.start_time);
  const legacyTimestamp = [legacyDate, legacyTime].filter(Boolean).join(" ");
  return [
    getString(booking.provider_name) || getString(booking.provider),
    getString(booking.flight_number),
    timestamp || legacyTimestamp
  ].filter(Boolean).join(" · ");
}

function formatDateRange(trip: RoamlyTripRecord, locale: RoamlyLocale = "en") {
  const start = formatTripDate(trip.start_date, locale);
  const end = formatTripDate(trip.end_date, locale);
  if (start && end) return start === end ? start : `${start} - ${end}`;
  return start || end || translateExactText(locale, "Dates flexible");
}

/** Eyebrow range in the mock's form: "Oct 23 – 25" inside one month,
 *  "Oct 30 – Nov 2" across months. No year — the header's quiet meta
 *  line carries the full range. */
function formatShortDateRange(trip: RoamlyTripRecord, locale: RoamlyLocale = "en") {
  const start = trip.start_date ? new Date(`${trip.start_date}T00:00:00`) : null;
  const end = trip.end_date ? new Date(`${trip.end_date}T00:00:00`) : null;
  if (!start || !Number.isFinite(start.getTime())) return translateExactText(locale, "Dates flexible");
  const monthDay = (date: Date) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  if (!end || !Number.isFinite(end.getTime()) || start.getTime() === end.getTime()) return monthDay(start);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(start);
    return `${month} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${monthDay(start)} – ${monthDay(end)}`;
}

/** "1 day" / "3 days" — never "1 days". */
function formatDayCount(dayCount: number, locale: RoamlyLocale = "en", flexibleLabel?: string) {
  if (!dayCount) return flexibleLabel ?? translateExactText(locale, "Dates flexible");
  return dayCount === 1
    ? translateKey(locale, "ui.trip.dayCountOne", "1 day")
    : translateKey(locale, "ui.trip.dayCountMany", "{count} days", { count: dayCount });
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

function SetupCard({ title, summary, locale }: { title: string; summary: string; locale: RoamlyLocale }) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <BuiCard className="p-5">
        <BuiBadge tone="warm">{translateExactText(locale, "Setup")}</BuiBadge>
        <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{summary}</p>
        <div className="mt-5">
          <BuiButtonLink href="/plan">{translateExactText(locale, "Plan trip")}</BuiButtonLink>
        </div>
      </BuiCard>
    </div>
  );
}

function NoticeBanner({ tone = "ocean", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  const toneClass =
    tone === "coral"
      ? "border-cred/40 bg-cred/10 text-cred"
      : tone === "sun"
        ? "border-corange/40 bg-[#FFF0E6] text-chead"
        : "border-chair bg-csoft text-chead";

  return <p className={`bui-enter mt-4 rounded-bui-card border px-4 py-3 text-sm font-semibold leading-6 shadow-bui-card ${toneClass}`}>{children}</p>;
}



function PrimaryTripAction({
  tripId,
  locale,
  itineraryLocked,
  generationInProgress,
  trackingUnlocked,
  paidForItinerary,
  freeAvailable,
  testerAccess,
  apiAuthToken,
  isPhilippinesTrip
}: {
  tripId: string;
  locale: RoamlyLocale;
  itineraryLocked: boolean;
  generationInProgress: boolean;
  trackingUnlocked: boolean;
  paidForItinerary: boolean;
  freeAvailable: boolean;
  testerAccess: boolean;
  apiAuthToken: string;
  isPhilippinesTrip: boolean;
}) {
  if (generationInProgress) {
    return (
      <span className="inline-flex w-full rounded-bui-card border border-chair bg-csoft px-5 py-4 text-sm font-black text-cblue shadow-bui-card sm:w-auto">
        {translateExactText(locale, "Generation in progress")}
      </span>
    );
  }

  if (itineraryLocked) {
    return trackingUnlocked ? (
      <BuiButtonLink href={`/trip/${tripId}/live`} className="w-full sm:w-auto">
        {translateExactText(locale, "Start Live Trip Companion")}
      </BuiButtonLink>
    ) : (
      <div className="w-full sm:max-w-xs">
        <ActivateTripButton
          tripId={tripId}
          itineraryLocked
          trackingUnlocked={false}
          showItineraryUnlock={false}
          testerAccess={testerAccess}
          apiAuthToken={apiAuthToken}
          isPhilippinesTrip={isPhilippinesTrip}
        />
      </div>
    );
  }

  if (paidForItinerary) {
    return (
      <div className="w-full sm:max-w-xs">
        <GenerateLockedItineraryButton
          tripId={tripId}
          label={translateExactText(locale, "Generate itinerary")}
          subtext={translateExactText(locale, "This will lock the final itinerary permanently.")}
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
          label={translateExactText(locale, "Generate my free itinerary")}
          subtext={translateExactText(locale, "You get 1 free itinerary per account.")}
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
        isPhilippinesTrip={isPhilippinesTrip}
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
  confirmedBookingCount,
  locale
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  currency: string;
  priceDiscovery: Record<string, unknown> | null;
  confirmedBookingCount: number;
  locale: RoamlyLocale;
}) {
  const estimate = itinerary.estimated_budget_breakdown;
  const budgetAmount = getTripBudgetAmount(trip);
  const totalEstimateAmount = getItineraryTotalEstimateAmount(itinerary, priceDiscovery);
  const unknownLineItemCount = itinerary.daily_itinerary.reduce((count, day) => {
    return count + (day.live_timeline || []).filter((item) => String(item.cost_status || "").toUpperCase() === "UNKNOWN").length;
  }, 0);
  const presentation = buildBudgetPresentation({ budgetAmount, currency, totalEstimateAmount, breakdown: estimate, priceDiscovery, confirmedBookingCount, unknownLineItemCount });
  const statusTone = presentation.status === "OVER_BUDGET" ? "border-coral/25 bg-coral/10 text-coral" : presentation.status === "BUDGET_UNCERTAIN" ? "border-sun/30 bg-sun/10 text-amber-900" : "border-cblue/20 bg-cblue/10 text-cblue";

  return (
    <div className="grid gap-4">
      <section className="border-y border-chair bg-white/70 py-4 sm:py-5">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-cblue">{translateExactText(locale, "How am I doing?")}</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold text-slate-500">{translateExactText(locale, "Your target")}</p>
            <p className="bui-display-number mt-1 text-3xl font-black tracking-tight text-ink sm:text-4xl">{presentation.targetLabel}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold text-slate-500">{presentation.totalCaption}</p>
            <p className="bui-display-number mt-1 text-2xl font-black tracking-tight text-ink">{presentation.totalLabel}</p>
          </div>
        </div>
        <div className={`mt-4 border-l-2 px-4 py-3 ${statusTone}`}>
          <p className="text-base font-black">{presentation.statusLabel}</p>
          <p className="mt-1 text-sm font-semibold leading-6">{presentation.statusDetail}</p>
          <p className="mt-2 text-sm font-black">{presentation.pricedCaption}: {presentation.pricedLabel}</p>
          <p className="mt-1 text-sm font-bold">{translateExactText(locale, "Unpriced:")} {presentation.unpricedLabel}</p>
          {presentation.remainingLabel ? <p className="mt-2 text-sm font-black">{presentation.remainingLabel}</p> : null}
        </div>
        {!['archived', 'cancelled', 'completed'].includes(trip.status) ? (
          <p className="roamly-no-print mt-4 text-sm font-semibold leading-6 text-slate-600">
            <a href="#customize" className="font-black text-cblue">{translateExactText(locale, "Customize your trip")}</a>{" "}{translateExactText(locale, "to change the budget, dates, destination, or who is going.")}
          </p>
        ) : null}
      </section>

      {presentation.committedCount || presentation.uncertainty.length ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {presentation.committedCount ? (
            <div className="border-b border-chair pb-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-cblue">{translateExactText(locale, "Already committed")}</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{presentation.committedCount === 1 ? translateKey(locale, "ui.trip.committedOne", "{count} confirmed booking stay protected.", { count: presentation.committedCount }) : translateKey(locale, "ui.trip.committedMany", "{count} confirmed bookings stay protected.", { count: presentation.committedCount })}</p>
            </div>
          ) : null}
          {presentation.uncertainty.length ? (
            <div className="border-b border-chair pb-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">{translateExactText(locale, "Not priced yet")}</p>
              {presentation.uncertainty.map((item) => <p key={item} className="mt-1 text-sm font-bold text-slate-700">{item}</p>)}
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="border-y border-chair py-3">
        <summary className="bui-touch flex min-h-11 cursor-pointer items-center text-base font-black text-cblue">{translateExactText(locale, "See cost drivers")}</summary>
        <div className="mt-3 divide-y divide-chair">
          {presentation.costDrivers.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-ink">{row.label}</p>
                <p className="text-xs font-bold text-slate-500">{row.status === "committed" ? translateExactText(locale, "Committed") : row.status === "unknown" ? translateExactText(locale, "Not priced yet") : translateExactText(locale, "Expected")}</p>
              </div>
              <p className="bui-display-number shrink-0 text-sm font-black text-ink">{row.value}</p>
            </div>
          ))}
          {!presentation.costDrivers.length ? <p className="py-3 text-sm font-bold text-slate-500">{translateExactText(locale, "No category-level costs are available yet.")}</p> : null}
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

function savedTripPayload(trip: RoamlyTripRecord, locale: RoamlyLocale): TripPlannerPayload {
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

function bookingProvider(suggestion: RoamlyItinerary["booking_suggestions"][number], fallback: string, locale: RoamlyLocale = "en") {
  const provider = suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || fallback;
  if (/stay22/i.test(provider)) return translateExactText(locale, "Hotel search");
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

function providerForBookingHref(href: string, fallback: string, locale: RoamlyLocale = "en") {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "aviasales.com") return "Travelpayouts";
    if (host === "stay22.com" || host.endsWith(".stay22.com")) return "Hotel search";
    if (host === "klook.com" || host.endsWith(".klook.com")) return "Klook";
    if (host === "google.com" && href.includes("/maps/")) return "Google Maps";
    if (host === "google.com") return translateExactText(locale, "Google search");
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

function resolveBookingLink(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord, locale: RoamlyLocale = "en") {
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
          provider: bookingProvider(suggestion, "Booking.com", locale),
          hasAffiliateUrl: false,
          urlType: "normal_search" as BookingUrlType
        };
      }
    }
    const stay22Fallback = buildStay22HotelFallbackUrl(suggestion, trip);
    if (affiliate && isCompleteStay22HotelContext(affiliate, suggestion, trip)) {
      return {
        href: affiliate,
        provider: providerForBookingHref(affiliate, bookingProvider(suggestion, translateExactText(locale, "Affiliate partner"), locale), locale),
        hasAffiliateUrl: true,
        urlType: "affiliate" as BookingUrlType
      };
    }

    if (stay22Fallback) {
      return {
        href: stay22Fallback,
        provider: providerForBookingHref(stay22Fallback, bookingProvider(suggestion, "Stay22", locale), locale),
        hasAffiliateUrl: true,
        urlType: "affiliate" as BookingUrlType
      };
    }
  }

  if (suggestion.market_source === "public_web" && suggestion.factual_status === "unknown") return null;

  if (affiliate) {
    return {
      href: affiliate,
      provider: providerForBookingHref(affiliate, bookingProvider(suggestion, translateExactText(locale, "Affiliate partner"), locale), locale),
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
      provider: providerForBookingHref(fallback, bookingProvider(suggestion, translateExactText(locale, "Affiliate partner"), locale), locale),
      hasAffiliateUrl: true,
      urlType: "affiliate" as BookingUrlType
    };
  }

  if (normal) {
    return {
      href: normal,
      provider: providerForBookingHref(normal, bookingProvider(suggestion, translateExactText(locale, "Normal search"), locale), locale),
      hasAffiliateUrl: false,
      urlType: "normal_search" as BookingUrlType
    };
  }

  if (fallback) {
    return {
      href: fallback,
      provider: providerForBookingHref(fallback, bookingProvider(suggestion, translateExactText(locale, "Fallback search"), locale), locale),
      hasAffiliateUrl: isAffiliateBookingHref(fallback),
      urlType: isAffiliateBookingHref(fallback) ? "affiliate" as BookingUrlType : "fallback" as BookingUrlType
    };
  }

  return null;
}

function priceConfidenceLabel(value?: string, locale: RoamlyLocale = "en") {
  if (value === "partner") return translateExactText(locale, "Live price");
  if (value === "user_uploaded") return translateExactText(locale, "Live price");
  if (value === "unknown") return translateExactText(locale, "Search only");
  return translateExactText(locale, "Estimated");
}

function isExpired(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
}

function formatMarketDateTime(value?: string | null, locale: RoamlyLocale = "en") {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function priceSourceLabel(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  if (suggestion.free_or_paid === "free") return translateExactText(locale, "Free");
  if (suggestion.price_confidence === "user_uploaded") return translateExactText(locale, "Live price");
  if (isExpired(suggestion.expires_at) && (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent")) {
    return translateExactText(locale, "Search only");
  }
  if (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent") return translateExactText(locale, "Live price");
  if (suggestion.price_type === "search_ready") return translateExactText(locale, "Search only");
  if (suggestion.price_type === "estimated_fallback") return translateExactText(locale, "Estimated");
  if (suggestion.advance_booking_recommended) return translateExactText(locale, "Booking required");
  return priceConfidenceLabel(suggestion.price_confidence, locale);
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

function transportModeLabel(mode: TransportOption["mode"], locale: RoamlyLocale = "en") {
  if (mode === "drive") return translateExactText(locale, "Drive");
  if (mode === "train") return translateExactText(locale, "Train");
  if (mode === "bus") return translateExactText(locale, "Bus");
  if (mode === "mixed") return translateExactText(locale, "Mixed route");
  return translateExactText(locale, "Flight");
}

function transportActionLabel(mode: TransportOption["mode"], locale: RoamlyLocale = "en") {
  if (mode === "flight") return translateExactText(locale, "Search flights");
  if (mode === "train") return translateExactText(locale, "Check train");
  if (mode === "bus") return translateExactText(locale, "Check bus");
  if (mode === "drive") return translateExactText(locale, "Open driving route");
  return translateExactText(locale, "Search route");
}

function transportSourceLabel(option: TransportOption, locale: RoamlyLocale = "en") {
  if (option.price_confidence === "live_partner") return translateExactText(locale, "Live partner price");
  if (option.price_confidence === "cached_recent") return translateExactText(locale, "Recently searched price");
  if (option.availability === "verified") return translateExactText(locale, "Verified route");
  if (option.availability === "search_ready") return translateExactText(locale, "Search-ready");
  if (option.availability === "not_available") return translateExactText(locale, "Not available");
  if (option.availability === "unverified") return translateExactText(locale, "Unverified");
  if (option.mode === "drive") return translateExactText(locale, "Drive estimate");
  return translateExactText(locale, "Planning estimate");
}

function transportEstimate(option: TransportOption, locale: RoamlyLocale = "en") {
  if ((option.mode === "flight" || option.mode === "mixed") && option.price_confidence !== "live_partner" && option.price_confidence !== "cached_recent") {
    return translateExactText(locale, "Search live prices");
  }
  const range = formatRange(option.estimated_cost_min, option.estimated_cost_max, option.currency || "CAD");
  return range || translateExactText(locale, "Search-ready. Verify live price.");
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

function transportMissingNote(option: TransportOption, href: string, locale: RoamlyLocale = "en") {
  if (href) return "";
  if ((option.mode === "train" || option.mode === "bus") && option.availability === "not_available") return "";
  if (option.mode === "flight" || option.mode === "mixed") return translateExactText(locale, "Live booking search is temporarily unavailable");
  return "";
}

function transportBadges(option: TransportOption, locale: RoamlyLocale = "en") {
  return [
    transportSourceLabel(option, locale),
    option.realistic ? "" : translateExactText(locale, "Not recommended"),
    option.warning?.toLowerCase().includes("too long") ? translateExactText(locale, "Too long for this trip") : "",
    option.price_confidence === "estimated" || option.price_confidence === "unknown" ? translateExactText(locale, "Needs live price check") : "",
    option.warning?.toLowerCase().includes("border") ? translateExactText(locale, "Border time buffer") : ""
  ].filter((label): label is string => Boolean(label));
}

function bookingEstimate(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  if (bookingCategory(suggestion) === "flight" && !hasLiveFlightPrice(suggestion)) {
    return translateExactText(locale, "Search live prices");
  }
  const currency = suggestion.currency || "CAD";
  const nightly = formatRange(suggestion.estimated_nightly_cost_min, suggestion.estimated_nightly_cost_max, currency);
  const total = formatRange(
    suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min,
    suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max,
    currency
  );
  if (isExpired(suggestion.expires_at) && (suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent")) {
    return total
      ? translateKey(locale, "ui.trip.previouslySearched", "Previously searched {total}. Refresh price before using it for booking.", { total })
      : translateExactText(locale, "Refresh price before using this option.");
  }
  if (suggestion.price_type === "search_ready") return translateExactText(locale, "Search-only result. Verify price and availability.");
  if (nightly && total) return translateKey(locale, "ui.trip.estimateNightlyStay", "Estimate: nightly {nightly}; stay {total}.", { nightly, total });
  if (total) return translateKey(locale, "ui.trip.estimateTotal", "Estimate: {total}.", { total });
  if (suggestion.free_or_paid === "free") return translateExactText(locale, "Free option. Verify hours and access rules.");
  return translateExactText(locale, "Verify current prices before booking.");
}

function bookingMeta(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  const source = suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || translateExactText(locale, "Search link");
  return [
    translateKey(locale, "ui.trip.bookingSource", "Source: {source}", { source: /stay22/i.test(source) ? translateExactText(locale, "Hotel search") : source }),
    translateKey(locale, "ui.trip.bookingVerification", "Verification: {label}", { label: priceSourceLabel(suggestion, locale) }),
    suggestion.market_source,
    presentTravelerArea(suggestion.location || suggestion.neighborhood || suggestion.city, false, String(bookingCategory(suggestion))),
    suggestion.date || suggestion.departure_date,
    suggestion.time_window,
    suggestion.duration,
    suggestion.room_type,
    suggestion.searched_at
      ? translateKey(locale, "ui.trip.retrievedAt", "Retrieved {date}", { date: formatMarketDateTime(suggestion.searched_at, locale) })
      : translateExactText(locale, "Retrieved: not live-verified"),
    suggestion.expires_at
      ? isExpired(suggestion.expires_at)
        ? translateExactText(locale, "Refresh price")
        : translateKey(locale, "ui.trip.expiresAt", "Expires {date}", { date: formatMarketDateTime(suggestion.expires_at, locale) })
      : ""
  ]
    .map((item) => getString(item))
    .filter(Boolean)
    .slice(0, 5);
}

function bookingActionLabel(category: string, suggestion: RoamlyItinerary["booking_suggestions"][number], link: ReturnType<typeof resolveBookingLink>, locale: RoamlyLocale = "en") {
  if (category === "flight") return link?.hasAffiliateUrl ? translateExactText(locale, "Compare flights") : translateExactText(locale, "Search flights");
  if (category === "hotel") return translateExactText(locale, "Book stay options");
  if (suggestion.market_source === "public_web") return translateExactText(locale, "Check current event details");
  if (category === "attraction" || category === "tour" || category === "activity") return link?.hasAffiliateUrl ? translateExactText(locale, "Book activity") : translateExactText(locale, "Open official search");
  if (category === "transport" || category === "car_rental") return link?.hasAffiliateUrl ? translateExactText(locale, "Book transfer") : translateExactText(locale, "Open route");
  if (category === "restaurant") return translateExactText(locale, "View on Google Maps");
  return suggestion.booking_label || translateExactText(locale, "View option");
}

function positiveHotelAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function hotelTravelerPrice(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  const live = suggestion.price_type === "live_partner" || suggestion.price_type === "cached_recent";
  const hasAmount = Boolean(
    positiveHotelAmount(suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min) ||
    positiveHotelAmount(suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max) ||
    positiveHotelAmount(suggestion.estimated_nightly_cost_min) ||
    positiveHotelAmount(suggestion.estimated_nightly_cost_max)
  );
  if (!live || suggestion.price_confidence === "unknown" || !hasAmount) return translateExactText(locale, "Price not available");
  return bookingEstimate(suggestion, locale);
}

function hotelPartnerInput(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const travelers = tripTravelerDetails(trip);
  return {
    category: "hotel" as const,
    title: bookingTitle(suggestion),
    query: bookingTitle(suggestion),
    destination: suggestion.destination || suggestion.city || getTripDestinationLabel(trip),
    startDate: suggestion.departure_date || suggestion.date || tripDate(trip, "start"),
    endDate: suggestion.return_date || tripDate(trip, "end"),
    travelers,
    adults: travelers.adults,
    children: travelers.children,
    rooms: tripRooms(trip),
    neighborhood: suggestion.neighborhood || suggestion.location,
    roomType: suggestion.room_type
  };
}

function partnersForHotelSuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord): HotelPartnerChoice[] {
  const specific = resolveConfiguredHotelPartners(hotelPartnerInput(suggestion, trip));
  if (specific.length) return specific;
  const travelers = tripTravelerDetails(trip);
  return resolveConfiguredHotelPartners({
    category: "hotel",
    destination: suggestion.destination || suggestion.city || getTripDestinationLabel(trip),
    startDate: tripDate(trip, "start"),
    endDate: tripDate(trip, "end"),
    adults: travelers.adults,
    children: travelers.children,
    rooms: tripRooms(trip),
    neighborhood: suggestion.neighborhood || suggestion.location
  });
}

function areaHotelPartners(trip: RoamlyTripRecord) {
  const travelers = tripTravelerDetails(trip);
  return resolveConfiguredHotelPartners({
    category: "hotel",
    destination: getTripDestinationLabel(trip),
    startDate: tripDate(trip, "start"),
    endDate: tripDate(trip, "end"),
    adults: travelers.adults,
    children: travelers.children,
    rooms: tripRooms(trip)
  });
}

function bookingStatusBadge(category: string, suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  if (category === "flight" && !hasLiveFlightPrice(suggestion)) return translateExactText(locale, "Estimate");
  const source = priceSourceLabel(suggestion, locale);
  if (source) return source;
  if (category === "restaurant" && suggestion.advance_booking_recommended) return translateExactText(locale, "Reservation recommended");
  if (suggestion.advance_booking_recommended) return translateExactText(locale, "Booking required");
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
  locale,
  suppressFlightFraming = false
}: {
  suggestion: RoamlyItinerary["booking_suggestions"][number];
  trip: RoamlyTripRecord;
  tripId: string;
  locale: RoamlyLocale;
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
  const link = resolveBookingLink(suggestion, trip, locale);
  if (!link?.href) return null;
  const mapQuery = category === "hotel"
    ? [title, suggestion.neighborhood || suggestion.city || getTripDestinationLabel(trip)].filter(Boolean).join(" ")
    : suggestion.location || suggestion.neighborhood || suggestion.city || title;
  const statusBadge = bookingStatusBadge(category, suggestion, locale);
  const actionLabel = bookingActionLabel(category, suggestion, link, locale);
  const guardedHotelAction = category === "hotel" && suggestion.provider_action_origin === "provider_response" && suggestion.factual_status === "verified";
  const hotelPartners = category === "hotel" ? partnersForHotelSuggestion(suggestion, trip) : [];
  const visibleHotelPartners = guardedHotelAction ? hotelPartners.filter((partner) => partner.id !== "booking") : hotelPartners;

  return (
    <article className="bui-enter rounded-bui-panel border border-chair bg-white px-4 py-4 shadow-bui-card">
      {category === "hotel" && suggestion.photo_urls?.[0] ? (
        <div className="relative mb-4 h-52 overflow-hidden rounded-bui-card border border-chair bg-cbg sm:h-64">
          <GuardedImage src={suggestion.photo_urls[0]} alt={`${title} ${translateExactText(locale, "property photo")}`} fill unoptimized sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-[0.68rem] font-extrabold text-[#31594f] shadow-sm">{translateExactText(locale, "Property photo · Booking.com")}</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {[statusBadge]
              .filter((label): label is string => Boolean(label))
              .map((label) => (
                <BuiChip key={label} tone="primary">
                  {label}
                </BuiChip>
              ))}
          </div>
          <h3 className="mt-2 text-lg font-semibold leading-6 tracking-tight text-ink">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{suppressFlightFraming ? presentGroundTransportText(bookingDescription(suggestion)) : bookingDescription(suggestion)}</p>
          <p className="bui-display-number mt-2 text-sm font-medium text-slate-600">{category === "hotel" ? hotelTravelerPrice(suggestion, locale) : bookingEstimate(suggestion, locale)}</p>
          {category === "hotel" ? (
            <>
              {guardedHotelAction ? <div className="mt-3"><GuardedHotelActionButton tripId={tripId} label={translateExactText(locale, "Book this hotel")} /></div> : null}
              {visibleHotelPartners.length ? (
                <HotelPartnerChoices
                  partners={visibleHotelPartners}
                  tripId={tripId}
                  title={title}
                  recommendationId={suggestion.candidateId || null}
                />
              ) : !guardedHotelAction ? (
                <div className="mt-3">
                  <BookingRecommendationButton
                    href={link.href}
                    label={translateExactText(locale, "Book stay options")}
                    tripId={tripId}
                    category={category}
                    title={title}
                    provider={link.provider}
                    recommendationId={suggestion.candidateId || null}
                    hasAffiliateUrl={Boolean(link.hasAffiliateUrl)}
                    urlType={link.urlType}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {suggestion.why_recommended || bookingMeta(suggestion, locale).length || category === "hotel" ? (
            <details className="mt-3 rounded-[0.9rem] bg-[#f8faf8] px-3 py-2">
              <summary className="bui-touch flex cursor-pointer items-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{translateExactText(locale, "Details")}</summary>
              {suggestion.why_recommended ? (
                <p className="mt-2 text-xs font-medium leading-5 text-slate-500">{suggestion.why_recommended}</p>
              ) : null}
              {bookingMeta(suggestion, locale).length ? (
                <p className="mt-2 text-xs font-medium leading-5 text-slate-500">{bookingMeta(suggestion, locale).join(" · ")}</p>
              ) : null}
              {category === "hotel" ? <NavigationChipList query={mapQuery} /> : null}
            </details>
          ) : null}
          {category === "transport" || category === "car_rental" ? <NavigationChipList query={mapQuery} /> : null}
        </div>
        {category === "hotel" ? (
          <p className="roamly-print-only hidden text-xs font-black text-cblue">
            {translateExactText(locale, "Book stay options")}: {visibleHotelPartners.length ? visibleHotelPartners.map((partner) => partner.label).join(", ") : actionLabel}
          </p>
        ) : (
          <div className="flex shrink-0 flex-col gap-2 lg:items-end">
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
            <p className="roamly-print-only hidden text-xs font-black text-cblue">
              {translateExactText(locale, "Search:")} {actionLabel}
            </p>
          </div>
        )}
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
  locale: RoamlyLocale;
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
      ? { title: translateExactText(params.locale, "Flights"), fallback: "flight" as const, items: rank(params.flightItems) }
      : null,
    (params.hotelItems.length > 0 || (params.trip.budget_includes_hotel !== false && !confirmedNeedSatisfied("hotel", params.confirmedBookings, params.trip.id)))
      ? { title: translateExactText(params.locale, "Hotels"), fallback: "hotel" as const, items: rank(params.hotelItems) }
      : null,
    (params.activityItems.length > 0 || tripIncludesActivities(params.trip))
      ? { title: translateExactText(params.locale, "Important activities"), fallback: "activity" as const, items: rank(params.activityItems) }
      : null,
    params.transportItems.length > 0 && !hasRecommendedTransport
      ? { title: translateExactText(params.locale, "Transport"), fallback: null, items: params.transportItems }
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
  tripId,
  locale
}: {
  category: "flight" | "hotel" | "activity";
  trip: RoamlyTripRecord;
  tripId: string;
  locale: RoamlyLocale;
}) {
  const href = safeBookingUrl(fallbackSearchHref(category, trip));
  const hotelPartners = category === "hotel" ? areaHotelPartners(trip) : [];
  if (!href && !hotelPartners.length) return null;
  const label = category === "flight" ? translateExactText(locale, "Search flights") : category === "hotel" ? translateExactText(locale, "Book stay options") : translateExactText(locale, "Search activities");
  const preference = trip.transportation_preference || "";
  if (category === "flight" && isDriveMode(preference)) return null;
  const title = category === "flight"
    ? isMixedMode(preference) ? translateExactText(locale, "Ways to get there") : translateExactText(locale, "Flights to compare")
    : category === "hotel" ? translateExactText(locale, "Stay to confirm") : translateExactText(locale, "Events to confirm");
  const hasAffiliateUrl = isAffiliateBookingHref(href);
  const provider = providerForBookingHref(href, category === "flight" ? "Travelpayouts" : translateExactText(locale, "Google search"), locale);
  return (
    <article className="bui-enter rounded-bui-panel border border-chair bg-white px-4 py-4 shadow-bui-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold leading-6 tracking-tight text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {category === "flight"
              ? translateExactText(locale, "Estimate only. Search live prices for the trip dates, baggage, seats, schedule, and currency before booking.")
              : category === "hotel"
                ? translateExactText(locale, "No stay is confirmed yet. These open a partner search for your dates.")
                : translateExactText(locale, "Search current options for the trip dates and verify price, schedule, and availability.")}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-500">{category === "flight" ? translateExactText(locale, "Estimate only") : category === "hotel" ? translateExactText(locale, "Price not available") : translateExactText(locale, "Search only")}</p>
        </div>
        {category === "hotel" && hotelPartners.length ? (
          <HotelPartnerChoices partners={hotelPartners} tripId={tripId} title={title} />
        ) : (
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
        )}
      </div>
    </article>
  );
}

function RecommendedTransportCard({ itinerary, tripId, confirmedBookings, locale, suppressFlightFraming = false }: { itinerary: RoamlyItinerary; tripId: string; confirmedBookings: Array<Record<string, unknown>>; locale: RoamlyLocale; suppressFlightFraming?: boolean }) {
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
  const provider = transportProviderForLink(recommended, href, transportSourceLabel(recommended, locale));
  const hasAffiliateUrl = transportHasAffiliateLink(recommended, href);
  const missingNote = transportMissingNote(recommended, href, locale);

  return (
    <section className="roamly-print-section">
      <h3 className="text-lg font-black text-ink">{translateExactText(locale, "Recommended transport")}</h3>
      <article className="bui-enter mt-3 rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <BuiBadge tone="primary">
                {transportModeLabel(recommended.mode, locale)}
              </BuiBadge>
              {transportBadges(recommended, locale).slice(0, 3).map((badge) => (
                <BuiBadge key={badge} tone="primary">
                  {badge}
                </BuiBadge>
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
            <p className="bui-display-number mt-1 text-sm font-black text-ink">{transportEstimate(recommended, locale)}</p>
            {recommended.duration_label ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{recommended.duration_label}</p> : null}
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{suppressFlightFraming ? presentGroundTransportText(recommended.why_recommended) : recommended.why_recommended}</p>
            {recommended.warning ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{recommended.warning}</p> : null}
          </div>
          {href ? (
            <BookingRecommendationButton
              href={href}
              label={transportActionLabel(recommended.mode, locale)}
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

function BookingPlan({ itinerary, trip, tripId, confirmedBookings, locale, suppressFlightFraming = false }: { itinerary: RoamlyItinerary; trip: RoamlyTripRecord; tripId: string; confirmedBookings: Array<Record<string, unknown>>; locale: RoamlyLocale; suppressFlightFraming?: boolean }) {
  const suggestions = bookingSuggestionsWithRecommendations(itinerary, trip);
  // The fourth argument remains the one-card flight cap: curatedBookingSuggestions(suggestions, trip, ["flight"], 1)
  const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 1, confirmedBookings);
  const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3, confirmedBookings);
  const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3, confirmedBookings);
  const transportItems = curatedBookingSuggestions(suggestions, trip, ["transport", "car_rental"], 2, confirmedBookings);
  const groups = buildRelevantBookingGroups({ itinerary, trip, flightItems, hotelItems, activityItems, transportItems, confirmedBookings, locale });

  return (
    <div className="grid gap-5">
      <p className="roamly-no-print rounded-[1rem] border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        {translateExactText(locale, "Recommended transport, stays, flights, and important activities. Live prices appear only when a connected provider returned them.")} {translateExactText(locale, affiliateDisclosure)}
      </p>
      {["flight", "mixed"].includes(bookingGroupMode(itinerary)) ? null : <RecommendedTransportCard itinerary={itinerary} tripId={tripId} confirmedBookings={confirmedBookings} locale={locale} suppressFlightFraming={suppressFlightFraming} />}
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
                    locale={locale}
                    suppressFlightFraming={suppressFlightFraming}
                  />
                ))}
              </div>
            ) : group.fallback ? (
              <div className="mt-3">
                <BookingSearchFallbackCard category={group.fallback} trip={trip} tripId={tripId} locale={locale} />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function essentialActionLabel(item: RoamlyPreTripEssential, locale: RoamlyLocale = "en") {
  if (item.action_label) return item.action_label;
  const text = `${item.title} ${item.search_query}`.toLowerCase();
  if (item.item_type === "connectivity" || /\b(e-?sim|mobile data|roaming plan)\b/.test(text)) return translateExactText(locale, "Compare travel eSIM");
  if (/\bcarry[- ]?on\b|luggage/.test(text)) return translateExactText(locale, "Find carry-on luggage");
  if (/packing cube/.test(text)) return translateExactText(locale, "Find packing cubes");
  if (/adapter/.test(text)) return translateExactText(locale, "Find travel adapter");
  return translateExactText(locale, "Shop on Amazon");
}

function priorityLabel(priority: RoamlyPreTripEssential["priority"], locale: RoamlyLocale = "en") {
  if (priority === "high") return translateExactText(locale, "High priority");
  if (priority === "low") return translateExactText(locale, "Low priority");
  return translateExactText(locale, "Medium priority");
}

function PreTripEssentialCard({
  item,
  tripId,
  locale
}: {
  item: RoamlyPreTripEssential;
  tripId: string;
  locale: RoamlyLocale;
}) {
  const href = safeBookingUrl(item.action_url) || safeBookingUrl(item.amazon_url);
  const label = essentialActionLabel(item, locale);
  const isConnectivity = item.item_type === "connectivity" || item.category === "Connectivity";
  const provider = item.provider || (isConnectivity ? translateExactText(locale, "Connectivity options") : "Amazon Associates");
  const verificationNote = item.verification_note || (isConnectivity ? translateExactText(locale, esimVerificationCopy) : "");
  const urlType: BookingUrlType = item.action_url_type || (href && href.includes("tag=") ? "affiliate" : "normal_search");
  const hasAffiliateUrl = Boolean(item.has_affiliate_url || (href && href.includes("tag=")));

  return (
    <article className="bui-enter roamly-print-section rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
      <div className="flex h-full flex-col gap-4">
        <div className="flex grow gap-3">
          <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border border-cblue/30 bg-cblue/5" />
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <BuiBadge tone="primary">
                {item.category}
              </BuiBadge>
              <BuiBadge tone="warm">
                {priorityLabel(item.priority, locale)}
              </BuiBadge>
            </div>
            <h3 className="mt-2 text-lg font-black leading-6 text-ink">{item.title}</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{item.reason}</p>
            {verificationNote ? <p className="mt-2 text-xs font-black leading-5 text-amber-800">{verificationNote}</p> : null}
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{translateExactText(locale, "Search:")} {item.search_query}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="roamly-no-print text-xs font-bold leading-5 text-slate-500">
            {isConnectivity
              ? translateExactText(locale, "Connectivity options are not guaranteed. Verify coverage, compatibility, price, and terms before buying.")
              : translateExactText(locale, "Amazon prices are not shown in Roamly. Verify price and availability on Amazon.")}
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
        {href ? <p className="roamly-print-only hidden text-xs font-black text-cblue">{provider} {translateExactText(locale, "search:")} {label}</p> : null}
      </div>
    </article>
  );
}

function PreTripEssentialsSection({
  essentials,
  tripId,
  locale
}: {
  essentials: RoamlyPreTripEssential[];
  tripId: string;
  locale: RoamlyLocale;
}) {
  if (!essentials.length) return null;
  const hasConnectivity = essentials.some((item) => item.item_type === "connectivity" || item.category === "Connectivity");

  return (
    <section id="pre-trip-essentials" className="mt-8 scroll-mt-32">
      <SectionHeading
        eyebrow={translateExactText(locale, "Pre-trip essentials")}
        title={translateExactText(locale, "Essentials checklist")}
        summary={translateExactText(locale, "Travel item recommendations are based on the destination, dates, activities, season, trip length, and travel style.")}
      />
      <p className="mb-4 rounded-2xl border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        {translateExactText(locale, amazonAffiliateDisclosure)}
        {hasConnectivity ? <> {" "}{translateExactText(locale, "Connectivity recommendations are for mobile data planning only, not flights, hotels, tours, or tickets.")}</> : ""}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {essentials.map((item, index) => (
          <PreTripEssentialCard key={`${item.title}-${index}`} item={item} tripId={tripId} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function PackageStays({
  suggestions,
  trip,
  tripId,
  currency,
  staySelectionId,
  totals,
  locale
}: {
  suggestions: RoamlyItinerary["booking_suggestions"];
  trip: RoamlyTripRecord;
  tripId: string;
  currency: string;
  /** The trip's stored stay pick (its option id) from the latest
   *  price discovery, or null — the selector opens on the
   *  traveller's own stay after a reload. */
  staySelectionId: string | null;
  /** The trip's current totals from its own budget breakdown
   *  (dollars there, cents here), or null when the saved trip
   *  carries none — the selector then records the pick without
   *  inventing a total to re-tabulate. */
  totals: { stayEstimateCents: number; bufferEstimateCents: number; totalEstimateCents: number } | null;
  locale: RoamlyLocale;
}) {
  const areaPartners = areaHotelPartners(trip);
  if (!suggestions.length && !areaPartners.length) return null;

  // Stay selector (owner order, 2026-11-08): the stored suggestions
  // ARE the stay options. buildStayOptions applies the surface's own
  // price-display rule (a price shows only when a partner returned
  // one — the old subline's promise, now structural: an unpriced
  // stay is a quiet line, never a card with an invented figure).
  // Titles pass through the same traveler-title presentation the
  // list used. Nights follow the engine's rule (days − 1).
  const nights = Math.max(1, (getTripDaysCount(trip) || 1) - 1);
  const titledSuggestions = suggestions.map((suggestion) => ({
    ...suggestion,
    title: presentTravelerTitle({
      title: bookingTitle(suggestion),
      category: "hotel",
      destination: suggestion.destination || suggestion.city || getTripDestinationLabel(trip)
    }).title
  }));
  const options = buildStayOptions(titledSuggestions, nights);
  const partnersByOptionId: Record<string, HotelPartnerChoice[]> = {};
  options.forEach((option, index) => {
    const suggestion = suggestions[index];
    if (suggestion) partnersByOptionId[option.id] = partnersForHotelSuggestion(suggestion, trip);
  });

  return (
    <section aria-label={translateExactText(locale, "Your stay")} className="bui-enter rounded-bui-panel border border-chair bg-white px-4 py-6 shadow-bui-card sm:px-6 sm:py-7">
      <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em] text-ink">{translateExactText(locale, "Stay options in this package")}</h2>
      <div className="mt-5">
        <StaySelector
          tripId={tripId}
          options={options}
          currency={currency}
          initialSelectionId={staySelectionId}
          totals={totals}
          partnersByOptionId={partnersByOptionId}
          areaPartners={areaPartners}
          destinationLabel={getTripDestinationLabel(trip)}
        />
      </div>
    </section>
  );
}

function BookingSummaryList({ bookings, locale }: { bookings: Array<Record<string, unknown>>; locale: RoamlyLocale }) {
  if (!bookings.length) {
    return <p className="rounded-bui-card border border-dashed border-chair bg-white px-4 py-3 text-sm font-black text-slate-500">{translateExactText(locale, "No bookings saved yet.")}</p>;
  }

  return (
    <div className="grid gap-2">
      {bookings.slice(0, 6).map((booking, index) => {
        const title = getString(booking.title) || translateExactText(locale, "Saved booking");
        const details = bookingDetailText(booking, locale);
        return (
          <div key={`${title}-${index}`} className="rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card">
            <p className="text-sm font-black text-ink">{title}</p>
            {details ? <p className="mt-1 text-xs font-bold text-slate-500">{details}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function travelerSummary(trip: RoamlyTripRecord, locale: RoamlyLocale = "en") {
  const travelers = tripTravelerDetails(trip);
  const rooms = tripRooms(trip);
  return [
    travelers.adults === 1
      ? translateKey(locale, "ui.trip.adultOne", "1 adult")
      : translateKey(locale, "ui.trip.adultMany", "{count} adults", { count: travelers.adults }),
    travelers.children
      ? travelers.children === 1
        ? translateKey(locale, "ui.trip.childOne", "1 child")
        : translateKey(locale, "ui.trip.childMany", "{count} children", { count: travelers.children })
      : "",
    travelers.infants
      ? travelers.infants === 1
        ? translateKey(locale, "ui.trip.infantOne", "1 infant")
        : translateKey(locale, "ui.trip.infantMany", "{count} infants", { count: travelers.infants })
      : "",
    rooms === 1
      ? translateKey(locale, "ui.trip.roomOne", "1 room")
      : translateKey(locale, "ui.trip.roomMany", "{count} rooms", { count: rooms })
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

function CompactPrintDay({ day, currency, confirmedBookings, locale, suppressFlightFraming = false }: { day: RoamlyItinerary["daily_itinerary"][number]; currency: string; confirmedBookings: readonly Record<string, unknown>[]; locale: RoamlyLocale; suppressFlightFraming?: boolean }) {
  const items = buildDisplayTimelineItems(day, confirmedBookings, { suppressFlightFraming, locale }).items.slice(0, 6);
  const dayCity = presentTravelerArea(day.city, suppressFlightFraming);

  return (
    <section className="roamly-pdf-day">
      <div className="roamly-pdf-day-heading">
        <p>
          {translateKey(locale, "ui.trip.printDay", "Day {number}", { number: day.day_number })}
          {dayCity ? ` · ${dayCity}` : ""}
          {day.date ? ` · ${formatTripDate(day.date, locale)}` : ""}
        </p>
        <span>{translateKey(locale, "ui.trip.printEstimated", "Est. {amount}", { amount: formatMoney(day.estimated_cost, currency) })}</span>
      </div>
      {presentDayHeading({ title: day.title, destination: dayCity || day.city, suppressFlightFraming }).headings.map((heading) => (
        <h3 key={heading}>{heading}</h3>
      ))}
      {items.length ? (
        <div className="roamly-pdf-timeline">
          {items.map((item, index) => (
            <div key={`${day.day_number}-print-${item.time}-${item.title}-${index}`} className="roamly-pdf-timeline-row">
              <p className="roamly-pdf-time">{item.time}</p>
              <div>
                <strong>{item.title}</strong>
                <p>{[item.location, item.durationLabel, item.travelLabel].filter(Boolean).join(" · ")}</p>
                {item.transferNote ? <p>{translateExactText(locale, "Transfer:")} {item.transferNote}</p> : null}
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
      {day.food.length ? <p className="roamly-pdf-food">{translateExactText(locale, "Food:")} {day.food.slice(0, 3).join(" · ")}</p> : null}
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
  locale: RoamlyLocale;
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
          <span>{translateExactText(locale, "Offline itinerary")}</span>
        </div>
        <h1>{tripTitle}</h1>
        <p className="roamly-pdf-summary">{compact(itinerary.destination_summary, translateExactText(locale, "Trip plan"), 240)}</p>
        <div className="roamly-pdf-info-grid">
          <PrintInfoCell label={translateExactText(locale, "Destination")} value={destinationLabel} />
          <PrintInfoCell label={translateExactText(locale, "Dates")} value={formatDateRange(trip, locale)} />
          <PrintInfoCell label={translateExactText(locale, "Travellers")} value={travelerSummary(trip, locale)} />
          <PrintInfoCell label={translateExactText(locale, "Days")} value={formatDayCount(dayCount, locale, translateExactText(locale, "Flexible"))} />
          <PrintInfoCell label={translateExactText(locale, "Budget")} value={budgetDisplay} />
          <PrintInfoCell label={translateExactText(locale, "Style")} value={travelStyle} />
        </div>
        <div className="roamly-pdf-two-col">
          <section>
            <h2>{translateExactText(locale, "Transport")}</h2>
            <p>{recommendedTransport ? `${recommendedTransport.title}. ${transportEstimate(recommendedTransport, locale)}` : compact(itinerary.transport_overview, translateExactText(locale, "Verify transport before travel."), 180)}</p>
          </section>
          <section>
            <h2>{translateExactText(locale, "Stay")}</h2>
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
              <p>{translateExactText(locale, "Hotel options should be verified for the trip dates before departure.")}</p>
            )}
          </section>
        </div>
        <div className="roamly-pdf-two-col">
          <section>
            <h2>{translateExactText(locale, "Flight/Search References")}</h2>
            {flightItems.length ? (
              <ul>{flightItems.map((item) => <li key={`print-flight-${bookingTitle(item)}`}>{bookingTitle(item)}</li>)}</ul>
            ) : (
              <p>{translateExactText(locale, "Use the flight search action on the trip page to verify schedules and fares.")}</p>
            )}
          </section>
          <section>
            <h2>{translateExactText(locale, "Important Activities")}</h2>
            {activityItems.length ? (
              <ul>{activityItems.map((item) => <li key={`print-activity-${bookingTitle(item)}`}>{bookingTitle(item)}</li>)}</ul>
            ) : (
              <p>{translateExactText(locale, "No paid activity bookings are required by default.")}</p>
            )}
          </section>
        </div>
      </section>

      <section className="roamly-pdf-days">
        {itinerary.daily_itinerary.map((day) => (
          <CompactPrintDay key={`print-day-${day.day_number}`} day={day} currency={currency} confirmedBookings={confirmedBookings} locale={locale} suppressFlightFraming={suppressFlightFraming} />
        ))}
      </section>

      <section className="roamly-pdf-page roamly-pdf-final">
        <h2>{translateExactText(locale, "Bookings And Essentials")}</h2>
        <div className="roamly-pdf-two-col">
          <section>
            <h3>{translateExactText(locale, "Bookings")}</h3>
            {bookings.length ? (
              <ul>
                {bookings.slice(0, 8).map((booking, index) => (
                  <li key={`print-booking-${index}`}>
                    <strong>{getString(booking.title) || translateExactText(locale, "Saved booking")}</strong>
                    <span>{bookingDetailText(booking, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{translateExactText(locale, "No bookings saved in Roamly yet.")}</p>
            )}
          </section>
          <section>
            <h3>{translateExactText(locale, "Essentials")}</h3>
            <ul>{essentials.map((item) => <li key={`print-essential-${item}`}>{item}</li>)}</ul>
          </section>
        </div>
        <section>
          <h3>{translateExactText(locale, "Important notes")}</h3>
          <ul>{notes.map((item) => <li key={`print-note-${item}`}>{item}</li>)}</ul>
        </section>
      </section>
    </article>
  );
}

function ChecklistGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <article className="bui-enter roamly-print-section rounded-bui-card border border-chair bg-white p-4 shadow-bui-card">
      <h3 className="text-lg font-black text-ink">{title}</h3>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <p key={item} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border border-cblue/30 bg-cblue/5" />
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

// Composition batch (2026-11-09): the trip page's bookings read
// names its columns instead of select("*"). The list is the full
// roamly_bookings column set (base schema + the companion-fields,
// reconciliation, and supersession migrations + the columns the
// notifications/briefing reads exercise) MINUS raw_extracted_text:
// the extracted email/screenshot transcript is write-only data —
// no code in app/, components/, or lib/ reads it — and as an
// unbounded private transcript it has no business riding every
// trip-page render (and the client-bound bookings manager props)
// when nothing renders it. Every other column has a traced reader
// among this page's consumers (booking truth/supersession checks,
// reconciliation, display timeline matching, summary list, print).
const TRIP_PAGE_BOOKING_COLUMNS =
  "id,user_id,trip_id,booking_type,category,provider_name,title,confirmation_number,provider_booking_id,booking_status,amount_cents,currency,start_date,end_date,start_time,end_time,start_at,end_at,origin,destination,flight_number,terminal,gate,seat,room_type,check_in_at,check_out_at,reservation_requirements,total_price,taxes_and_fees,cancellation_deadline,cancellation_terms,address,city,region,country,latitude,longitude,extraction_confidence,screenshot_url,source_type,source_reference,source_connection_id,source_message_id,source_event_at,referral_id,reconciliation_status,reconciliation_version,last_authoritative_update_at,last_authoritative_source_message_id,superseded_by_booking_id,traveler_confirmed,last_synced_at,metadata,created_at,updated_at";

async function TripPage({ params, searchParams }: TripPageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (!current.configured) {
    return (
      <SetupCard
        locale={locale}
        title={translateExactText(locale, "Connect Supabase to open trips.")}
        summary={translateExactText(locale, "Roamly trips need the roamly_ tables and Supabase auth.")}
      />
    );
  }

  if (!current.user) {
    return <TripAuthSessionCheck tripId={id} nextPath={`/trip/${id}`} />;
  }

  const sessionId = one(search.session_id);
  let checkoutSyncError = "";
  let checkoutAwaitingWebhook = false;
  let confirmedPurchase: import("@/lib/payments").ConfirmedCheckoutPurchase | null = null;
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
      confirmedPurchase = confirmation.purchase;
    }
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <SetupCard locale={locale} title={translateExactText(locale, "Supabase is unavailable.")} summary={translateExactText(locale, "Check Roamly environment variables.")} />;
  }

  if (one(search.checkout) === "cancelled") {
    // Refresh diet (2026-11-09): telemetry never gates the paint.
    // The event records via after() — the house pattern for
    // post-response work (gmail webhook, generation background) —
    // so its INSERT round trip no longer blocks this render, and a
    // failed write can never fail the page.
    const eventUserId = current.user.id;
    after(async () => {
      try {
        await recordAppEvent(supabase, {
          userId: eventUserId,
          eventType: "checkout_cancelled",
          metadata: { tripId: id }
        });
      } catch {
        // Telemetry only: a lost event never surfaces to the traveller.
      }
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
          locale={locale}
          title={translateExactText(locale, "Trip tables are not ready.")}
          summary={translateExactText(locale, "Run the Roamly schema, tracking, itinerary locking, and budget/booking/companion migrations, then generate the trip again.")}
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
  const checkoutCancelled = one(search.checkout) === "cancelled";
  const shouldCleanCheckoutUrl = Boolean((one(search.checkout) || sessionId) && !checkoutNeedsAttention && !checkoutProcessing);
  // Fresh itinerary purchase return: show the Live Companion install step once.
  const justPurchased = one(search.checkout) === "success" && paidForItinerary && trackingUnlocked;
  const freeAvailable = !freeResult.used;
  const generationRequiresPayment = !itineraryLocked && !paidForItinerary && !freeAvailable;
  const canonicalDayByNumber = new Map(canonicalDays.map((day) => [day.day_number, day]));
  const generationDayProgress = generationProgress?.days || [];
  const dayNumbersToRender = generationDayProgress.length
    ? generationDayProgress.map((day) => day.dayNumber)
    : canonicalDays.map((day) => day.day_number);
  const tripLifecycle = customerTripLifecycleState({
    status: trip.status,
    itineraryStatus: trip.itinerary_status,
    startDate: trip.start_date,
    endDate: trip.end_date,
    metadata: trip.metadata
  });
  const completedTrip = isCustomerTripTerminalState(tripLifecycle);
  // Composition batch (2026-11-09): the loads from here to the setup
  // gate are independent of each other — every one consumes only
  // the bundle, the trip id, or the signed-in user — so they start
  // together and are awaited at their existing points of use below.
  // The serial chain they replace paid these round trips one after
  // another behind every render (and behind every kept
  // router.refresh()). Same queries, same results, same error
  // shapes; only the overlap changed. hasPriorTrip stays downstream
  // (it consumes the setup state), and the photo/weather/venue
  // loads stay behind the setup-gate return, exactly as before.
  const bookingsPromise = Promise.resolve(
    supabase
      .from("roamly_bookings")
      .select(TRIP_PAGE_BOOKING_COLUMNS)
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .order("start_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
  );
  const priceDiscoveryPromise = trip.latest_price_discovery_id
    ? Promise.resolve(
        supabase
          .from("roamly_price_discoveries")
          .select("metadata")
          .eq("id", trip.latest_price_discovery_id)
          .eq("trip_id", id)
          .eq("user_id", current.user.id)
          .maybeSingle()
      )
    : Promise.resolve({ data: null });
  const pendingHotelProductChoicePromise = getPendingHotelProductChoice(supabase, id);
  const tripTravelersPromise = listTripTravelers(supabase, id);
  const setupStatePromise = getRoamlySetupState(supabase, current.user).catch(() => null);
  const postTripFeedbackPromise = completedTrip
    ? Promise.resolve(
        supabase.from("trip_feedback").select("id").eq("trip_id", id).eq("user_id", current.user.id).eq("feedback_type", "post_trip").limit(1)
      )
    : Promise.resolve({ data: [] as Array<{ id: string }>, error: null });
  const bookingsResult = await bookingsPromise;
  const importedBookings = bookingsResult.error && isMissingTableError(bookingsResult.error.message) ? [] : bookingsResult.data || [];
  const currentImportedBookings = importedBookings.filter(isOperationalCurrentBooking);
  const priceDiscoveryResult = await priceDiscoveryPromise;
  const persistedPriceDiscovery = priceDiscoveryResult.data?.metadata && typeof priceDiscoveryResult.data.metadata === "object"
    ? priceDiscoveryResult.data.metadata as Record<string, unknown>
    : null;
  const enrichedFull = localizedItinerary?.itinerary
    ? enrichItineraryBookingSuggestions(localizedItinerary.itinerary, {
        ...savedTripPayload(trip, locale),
        priceDiscovery: persistedPriceDiscovery || undefined
      })
    : null;
  // X1 READ path (Workstream A): stored itinerary items carry stamps
  // baked in at apply time ("Confirmed: …"). Their displayed state is
  // re-derived here from each linked booking's CURRENT truth, so a
  // booking cancelled after stamping never renders as Confirmed on
  // this page — no data rewrite, render-time only.
  const full = enrichedFull
    ? reconcileItineraryItemsWithCurrentBookings(
        enrichedFull,
        importedBookings as Array<Record<string, unknown>>
      )
    : null;
  const hotelProductDecision = resolveSelectedHotelProductDecision({
    priceDiscovery: persistedPriceDiscovery,
    confirmedBookings: currentImportedBookings as Array<{ booking_type?: string | null; booking_status?: string | null }>
  });
  const hotelProductPresentation = buildHotelProductPresentation({ selectedHotelDecision: hotelProductDecision, comparisonCurrency: currency });
  const pendingHotelProductChoiceResult = await pendingHotelProductChoicePromise;
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
    : full?.estimated_budget_breakdown.total_estimate || translateExactText(locale, "Flexible");
  const travelStyle = getTravelStyle(trip);
  const travelerDetails = tripTravelerDetails(trip);
  const travelerCount = travelerDetails.adults + travelerDetails.children + travelerDetails.infants;
  const travelerLabel = travelerCount === 1
    ? translateKey(locale, "ui.trip.travelerOne", "1 traveler")
    : translateKey(locale, "ui.trip.travelerMany", "{count} travelers", { count: travelerCount });
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
  const postTripFeedbackResult = await postTripFeedbackPromise;
  const hasPostTripFeedback = postTripFeedbackResult.error ? null : Boolean(postTripFeedbackResult.data?.length);
  const focusDay = full?.daily_itinerary.find((day) => day.date === new Date().toISOString().slice(0, 10)) || full?.daily_itinerary[0] || null;
  const focusDayItems = focusDay ? buildDisplayTimelineItems(focusDay, confirmedBookingSnapshot as Array<Record<string, unknown>>, { suppressFlightFraming, locale }).items : [];
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
  // Ship defect #2: engine-generated itineraries carry the all-in
  // budget verdict stamped at finalization; when present it is the
  // budget story on this page (the legacy presentation is built
  // from the composer breakdown, whose "comfortable" can contradict
  // the judged verdict). Incumbent itineraries never carry it.
  const budgetVerdictDisplay = full ? readBudgetVerdictDisplay(full) : null;
  const readinessBookingGroups = full
    ? (() => {
        const suggestions = bookingSuggestionsWithRecommendations(full, trip);
        const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 1, confirmedBookingSnapshot);
        const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3, confirmedBookingSnapshot);
        const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3, confirmedBookingSnapshot);
        const transportItems = curatedBookingSuggestions(suggestions, trip, ["transport", "car_rental"], 2, confirmedBookingSnapshot);
        return buildRelevantBookingGroups({ itinerary: full, trip, flightItems, hotelItems, activityItems, transportItems, confirmedBookings: confirmedBookingSnapshot, locale });
      })()
    : [];
  const packageHotelItems = readinessBookingGroups.find((group) => group.title === "Hotels")?.items || [];
  const staySearch = {
    destination: destinationLabel,
    startDate: trip.start_date,
    endDate: trip.end_date,
    adults: tripTravelerDetails(trip).adults,
    children: tripTravelerDetails(trip).children,
    rooms: tripRooms(trip)
  };
  const customizeNotes = readTripNoteText(trip);
  const customizePlanning = getTripPlanningMetadata(trip.metadata);
  const customizeTravelers = tripTravelerDetails(trip);
  const bookingsToArrange = readinessBookingGroups.filter((group) => Boolean(group.fallback) && group.items.length === 0).length;
  const bookingFocus = getString(unresolvedBookingSnapshot[0]?.booking_type).toLowerCase();
  const missingBookingFocus = readinessBookingGroups.find((group) => Boolean(group.fallback) && group.items.length === 0)?.fallback || null;
  const resolvedBookingFocus = ["flight", "hotel", "activity"].includes(bookingFocus)
    ? bookingFocus as "flight" | "hotel" | "activity"
    : missingBookingFocus;
  const conflictCount = full?.daily_itinerary.filter((day) => day.plan_status === "conflict").length || 0;
  const conflictDay = full?.daily_itinerary.find((day) => day.plan_status === "conflict")?.day_number || null;
  const tripTravelersResult = await tripTravelersPromise;
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
  const commandNextTitle = completedTrip ? null : attentionText || readiness.upcomingActions[0] || (timedNextAction && focusNextItem && !looksLikeProviderSearchTitle(focusNextItem.title) ? focusNextItem.title : "") || translateExactText(locale, "Your trip is ready to review.");
  const commandNextMeta = completedTrip || !timedNextAction ? "" : focusNextItem && !looksLikeProviderSearchTitle(focusNextItem.title) ? focusNextItem.time : "";
  const packingItems = full ? packingChecklistItems(checklist, full).slice(0, 8) : [];
  const localTipItems = full?.local_tips.slice(0, 6) || [];
  const safetyItems = full?.safety_notes.slice(0, 6) || [];
  const documentItems = getStringList(trip.document_checklist, [], 6);
  // Documents tab only: trips.document_checklist has no writer anywhere
  // in the app (it defaults to [] at insert), so on its own the tab was
  // a dead end for every trip. When no grounded list is saved, fall back
  // to the designed destination-aware checklist — the same builder the
  // Live Companion stores in metadata and shows on its surfaces. The
  // briefing above keeps using documentItems (grounded items only).
  const panelDocumentItems = documentItems.length ? documentItems : buildDocumentChecklist(trip).slice(0, 6);
  const emergencyItems = full?.emergency_notes.slice(0, 6) || [];
  const lowCostItems = full?.free_or_low_cost_notes.slice(0, 5) || [];
  const hasEssentials = Boolean(full?.pre_trip_essentials.length);
  const hasTravelNotes = [packingItems, localTipItems, safetyItems, documentItems, emergencyItems, lowCostItems].some((items) => items.length > 0);
  const hasRequirements = countMaterialTravelRequirements(travelRequirements) > 0;
  const briefingTabs = [
    ["roamly-tab-overview", translateExactText(locale, "Snapshot")],
    ...(hasRequirements ? [["roamly-tab-requirements", translateExactText(locale, "Entry requirements")]] : []),
    ...(hasEssentials ? [["roamly-tab-essentials", translateExactText(locale, "Before you go")]] : []),
    ...(hasTravelNotes ? [["roamly-tab-travel-notes", translateExactText(locale, "Practical")]] : [])
  ];
  const panelTabs = [
    ["roamly-tab-day-by-day", translateExactText(locale, "Itinerary")],
    ["roamly-tab-budget", translateExactText(locale, "Budget")],
    ["roamly-tab-bookings", translateExactText(locale, "Bookings")],
    ...briefingTabs
  ];
  // G1: the Bookings panel had a radio input but no visible tab label, so a
  // traveler with no confirmed booking had no on-page route to it. The tab
  // nav below renders the briefing tabs plus this Bookings label, using the
  // same label pattern and styling as the existing tabs.
  const briefingNavTabs = [
    ...briefingTabs,
    ["roamly-tab-bookings", translateExactText(locale, "Bookings")]
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
  const companionStartLabel = trip.start_date
    ? new Date(`${trip.start_date}T12:00:00`).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })
    : "soon";
  const companionStartShort = trip.start_date
    ? new Date(`${trip.start_date}T12:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" })
    : "soon";
  const showGenerationPanel = generationPanelVisible && (generationRunning || (!generationRequiresPayment && generationBusy));
  const showPaymentWall = Boolean(draftCommand);
  const headerBudgetText = budgetVerdictDisplay
    ? `${budgetVerdictDisplay.headline} · ${budgetVerdictDisplay.totalLabel || budgetVerdictDisplay.coverageLabel}`
    : budgetPresentation?.status === "BUDGET_UNCERTAIN"
      ? budgetPresentation.targetLabel === "Budget target not set"
        ? translateKey(locale, "ui.trip.budgetUncertainNoTarget", "Budget not set. Some item prices are not available, and those are not $0.")
        : translateKey(locale, "ui.trip.budgetUncertainWithTarget", "Your budget {label}. Some item prices are not available, and those are not $0.", { label: budgetPresentation.targetLabel })
      : budgetPresentation?.status === "OVER_BUDGET"
        ? translateKey(locale, "ui.trip.overBudgetDetail", "{label} · priced and estimated amounts", { label: budgetPresentation.remainingLabel || translateExactText(locale, "Over budget") })
        : headerBudgetBalance?.text || (tripBudgetAmount ? formatBudgetMoney(tripBudgetAmount, currency) : translateExactText(locale, "Still uncertain"));

  if (checkoutNeedsAttention) {
    // Refresh diet (2026-11-09): same rule as the checkout_cancelled
    // event above — recorded via after(), never awaited in render.
    const eventUserId = current.user.id;
    after(async () => {
      try {
        await recordAppEvent(supabase, {
          userId: eventUserId,
          eventType: "checkout_sync_failed",
          metadata: { tripId: id, error: checkoutSyncError }
        });
      } catch {
        // Telemetry only: a lost event never surfaces to the traveller.
      }
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

  // The setup gate (owner design, 2026-10-23; second-time law, 2026-10-24):
  // a traveler whose three setup steps were never completed meets the
  // cascade here — the "Your trip is ready" moment — instead of the
  // itinerary, but ONLY when this is not the account's first trip (see
  // lib/roamly/setupGate.ts for the exact trigger). The gate keys on
  // the account's persisted state, never on this trip; completed once,
  // it never renders again. It is never a wall: skipSetupGate=1 reveals
  // the itinerary with limited features — and round 2 remembers that
  // choice per trip (lib/roamly/setupSkip.ts cookie), so a return
  // visit reveals without re-skipping. Remembered skip still never
  // completes a step and never touches billing or entitlements.
  const setupState = await setupStatePromise;
  const skipCookieName = setupSkipCookieName(id);
  const skippedBefore = skipCookieName ? hasSetupSkip((await cookies()).get(skipCookieName)?.value, id) : false;
  const skipSetupGate = one(search.skipSetupGate) === "1" || skippedBefore;
  const priorTrip = setupState && !setupState.complete && !access.hasQaAccess
    ? await (supabase ? hasPriorTrip(supabase, current.user.id, id) : Promise.resolve(false))
    : false;
  const gateApplies = setupState
    ? setupGateApplies({ setupComplete: setupState.complete, hasQaAccess: access.hasQaAccess, hasPriorTrip: priorTrip })
    : false;
  const limitedFeatures = setupState ? setupGateLimitedFeatures(setupState) : [];
  if (gateApplies && !skipSetupGate && setupState) {
    return (
      <SetupGateScreen
        initialState={setupState}
        eyebrow={formatGateEyebrow(destinationLabel, trip.start_date, trip.end_date) || destinationLabel}
        dayCount={dayCount}
        skipHref={`/trip/${id}?skipSetupGate=1`}
        limitedFeatures={limitedFeatures}
        tripId={id}
      />
    );
  }

  // Destination photo (owner design, 2026-10-23): a real photo of the
  // destination from Wikimedia/Wikidata, cached per destination so later
  // trips reuse it. When none resolves, the header stays bare by design.
  // Near-misses already live on the Bookings page (unmatched +
  // needs_confirmation extractions with attach/discard). The trip page
  // only points at them, with a count, and only when at least one waits.
  // Same filters as the email-imports route; a query failure means no
  // line, never a wrong count.
  // Composition batch (2026-11-09): the four loads below are
  // mutually independent — they start together and are awaited at
  // their points of use. They stay behind the setup-gate return
  // above, so a gated render pays none of them, exactly as before.
  // The two photo lookups share one per-render state, so the
  // registry scan inside them is paid once across the destination
  // and every venue (see lib/roamly/destinationPhoto.ts).
  const photoShared: DestinationPhotoSharedState = {};
  const currentUserId = current.user.id;
  const pendingImportsPromise = (async (): Promise<number | null> => {
    if (!supabase) return null;
    try {
      const pendingResult = await supabase
        .from("booking_extraction_results")
        .select("id", { count: "exact", head: true })
        .eq("user_id", currentUserId)
        .in("match_status", ["unmatched", "needs_confirmation"])
        .or(`trip_id.eq.${trip.id},trip_id.is.null`);
      return pendingResult.error ? null : pendingResult.count;
    } catch {
      return null;
    }
  })();
  const photoPlanning = getTripPlanningMetadata(trip.metadata);
  const destinationPhotoPromise = getDestinationPhoto({
    label: destinationLabel,
    country: getString(photoPlanning.destinationCountry) || trip.destination_country || null,
    latitude: typeof photoPlanning.destinationLatitude === "number" ? photoPlanning.destinationLatitude : null,
    longitude: typeof photoPlanning.destinationLongitude === "number" ? photoPlanning.destinationLongitude : null
  }, photoShared).catch(() => null);
  const venuePhotosPromise = buildVenuePhotoMap(
    canonicalDays,
    getString(photoPlanning.destinationCountry) || trip.destination_country || null,
    photoShared
  ).catch(() => ({}));
  // Trip weather (Fix Round Item 4, 2026-11-06): the itinerary's
  // weather summary, fetched server-side from the trip's own
  // planning-metadata coordinates + dates through the one weather
  // module (Open-Meteo, fetch-cached 6h). No stored coordinates →
  // no request and no card; the card itself renders nothing for a
  // finished trip.
  const tripWeatherRequest: TripWeatherRequest | null =
    typeof photoPlanning.destinationLatitude === "number" &&
    Number.isFinite(photoPlanning.destinationLatitude) &&
    typeof photoPlanning.destinationLongitude === "number" &&
    Number.isFinite(photoPlanning.destinationLongitude) &&
    trip.start_date &&
    trip.end_date
      ? {
          latitude: photoPlanning.destinationLatitude,
          longitude: photoPlanning.destinationLongitude,
          startDate: trip.start_date,
          endDate: trip.end_date
        }
      : null;
  const tripWeatherPromise = tripWeatherRequest ? getTripWeather(tripWeatherRequest) : Promise.resolve(null);
  const pendingImports = await pendingImportsPromise;
  const destinationPhoto = await destinationPhotoPromise;
  const tripWeather = await tripWeatherPromise;

  // Itinerary Home panel (panel 5): one compact day view per stored day,
  // built from the SAME plan the day cards render
  // (buildDisplayTimelineItems), so the panel and the cards never
  // disagree. Only this trip's days, bookings, essentials, and
  // documents are passed in — nothing from any other trip.
  // Owner-10 item 4: the home view shapes the day WITHOUT the day
  // cards' 6-row cap and WITHOUT folding the intercity travel leg
  // away, in stored (chronological) order — travel, arrival,
  // activities, return, nothing dropped. Walk transfers still fold
  // (the mock shows no walk rows); the day cards keep their own
  // defaults, and Live keeps its engine (see the report's live-view
  // difference note).
  const itineraryHomeDays = canonicalDays.map((day) =>
    buildHomeDayView(
      {
        day_number: day.day_number,
        date: day.date,
        primary_plan: day.primary_plan,
        morning: day.morning,
        afternoon: day.afternoon,
        evening: day.evening,
        rows: buildDisplayTimelineItems(day, confirmedBookingSnapshot as Array<Record<string, unknown>>, { suppressFlightFraming, maxRows: null, keepTravelRows: true, keepStoredOrder: true, locale }).items
      },
      locale,
      (dayNumber: number) => translateKey(locale, "ui.trip.printDay", "Day {number}", { number: dayNumber })
    )
  );
  // Venue-row thumbnails (originals pass): one parallel pipeline round
  // over the plan's venue stops; misses stay icon-only downstream.
  const venuePhotos = await venuePhotosPromise;
  const itineraryHomeEssentials = full
    ? full.pre_trip_essentials.map((item) => ({ title: item.title, reason: item.reason }))
    : [];
  const itineraryHomeEditHref = ["archived", "cancelled", "completed"].includes(trip.status)
    ? null
    : `/trip/${id}#customize`;

  return (
    <div className="roamly-print-document w-full bg-cbg px-4 pb-8 pt-5 text-cink sm:px-6 sm:py-8">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <GenerationNavigationRefresh active={one(search.generating) === "1" && !generationPanelVisible && !canShowFull} />
      <div className="roamly-print-paper mx-auto max-w-6xl">
        <div className="roamly-screen-document">
        {/* Offline round (2026-10-27): cached-trip label. Renders
            nothing while online; offline it shows the real
            last-online-load time for this trip. */}
        <OfflineTripBanner tripId={id} />
        {/* Final local round (2026-10-27): the long limited-features
            paragraph is now the compact expandable notice — one short
            collapsed line, full details on tap, same feature strings
            and same Settings route, no claim changed. */}
        {skipSetupGate && setupState && !setupState.complete ? (
          <LimitedFeaturesNotice features={limitedFeatures} />
        ) : null}
        {/* Picture 5 (2026-10-26): transient checkout notices stay
            visible above the home panel — they are time-sensitive
            payment states, not standing content blocks, so they are
            deliberately NOT detail-only. */}
        {checkoutNeedsAttention ? (
          <NoticeBanner tone="coral">
            {translateExactText(locale, "Stripe returned successfully, but Roamly could not confirm the payment yet. Refresh this page in a moment; if it stays locked, contact support with your checkout receipt.")}
          </NoticeBanner>
        ) : null}
        {checkoutProcessing ? (
          <NoticeBanner>
            {translateExactText(locale, "Stripe returned successfully. Roamly is waiting for the signed webhook to update this trip; refresh in a moment if it still looks locked.")}
          </NoticeBanner>
        ) : null}
        {checkoutStartFailed ? (
          <NoticeBanner tone="coral">{translateExactText(locale, "Stripe checkout could not be opened. Your trip draft was saved, so you can try unlocking it again from this page.")}</NoticeBanner>
        ) : null}
        {checkoutCancelled ? (
          <NoticeBanner>{translateExactText(locale, "Payment cancelled — you were not charged. Your draft is saved.")}</NoticeBanner>
        ) : null}
        {/* Checkout success (consolidation 2026-11-06, spec
            CHECKOUT-SUCCESS-FIX-SPEC): success was the only SILENT
            payment state — justPurchased was computed and never
            rendered. The panel renders ONLY from the
            server-confirmed session record (confirmedPurchase,
            set solely when confirmCheckoutSessionForTrip verified
            the paid session for this trip + user): a forged
            ?checkout=success without a confirming session shows
            nothing, and the failure banners above are untouched.
            It STAYS (no dismiss, no timer) per the success rules,
            names the product + amount + trip, links the Stripe
            receipt, and offers the open loop: Live Companion
            setup + View your trip. */}
        {justPurchased && confirmedPurchase ? (
          <BuiCheckoutSuccess
            productName={confirmedPurchase.productName}
            amountLabel={confirmedPurchase.amountLabel}
            tripTitle={destinationLabel}
            receiptHref={confirmedPurchase.receiptUrl}
            setupHref={`/trip/${id}/live`}
            tripHref={`/trip/${id}`}
          />
        ) : null}
        {/* Picture 5 (2026-10-26): this legacy header is NOT the home
            screen. It carries .roamly-detail-only, so on a full trip it
            stays hidden until a detail tab radio is checked (see the
            tabs style block); its content then renders above the active
            detail panel. Trips without tabs keep it visible as before,
            because the hiding style only renders with the tabs. */}
        <section className="roamly-detail-only bg-transparent pb-1 pt-0 sm:pb-2">
          {destinationPhoto ? (
            <DestinationPhotoBand
              imageUrl={destinationPhoto.imageUrl}
              alt={destinationLabel}
              credit={destinationPhoto.credit}
              pageUrl={destinationPhoto.pageUrl}
            />
          ) : null}
          <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">
            {formatShortDateRange(trip, locale)} · {formatDayCount(dayCount, locale)}
          </p>
          <h1 className="mt-1.5 text-[34px] font-bold leading-[1.08] tracking-[-0.022em] text-chead sm:text-4xl">{(typeof trip.title === "string" && trip.title.trim()) || destinationLabel}</h1>
          {/* D13 (consolidation 2026-11-06): the rename control —
              trips could never be named before, despite the title
              column + dashboard display existing since the base
              schema. */}
          <TripRenameControl tripId={id} currentTitle={typeof trip.title === "string" && trip.title.trim() ? trip.title.trim() : null} />
          <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-normal leading-6 text-cgray">
            <span className="calm-dot h-2 w-2 shrink-0 rounded-full bg-cblue" aria-hidden="true" />
            {travelerStatus.badge}
          </p>
          {canShowFull && full && !generationPanelVisible && setupState ? (
            <TripStateLines
              gmailConnected={setupState.gmailConnected}
              gmailLastSyncedAt={setupState.gmailLastSyncedAt}
              gmailSyncFailing={setupState.gmailSyncFailing}
              gmailSyncFailureReconnect={setupState.gmailSyncFailureReconnect}
              locationGranted={setupState.locationGranted}
              locationEnabled={setupState.locationEnabled}
              companionUnlocked={trackingUnlocked && !completedTrip}
              tripActive={tripLifecycle === "active"}
              tripId={trip.id}
              pendingImportCount={pendingImports ?? undefined}
            />
          ) : null}
          <p className="mt-1.5 text-[13.5px] font-normal leading-6 text-cgray">{formatDateRange(trip, locale)} · {travelerLabel}</p>
          {(full?.destination_summary || preview?.destination_summary) ? (
            <details className="mt-2 max-w-2xl">
              <summary className="bui-touch flex min-h-8 cursor-pointer items-center text-sm font-medium text-cgray">{translateExactText(locale, "Trip context")}</summary>
              <p className="mt-1 text-sm leading-6 text-cink">{compact(full?.destination_summary || preview?.destination_summary, "", 150)}</p>
            </details>
          ) : null}

          {/* Phase 6 (DESIGN §2.4): Build 2 entry gates — mobile-only
              pre-generation gate on the phone; the desktop handoff
              block (QR pass) on desktop. Both exist only while
              ROAMLY_BUILD2_GATES_ENABLED is on; the components
              self-limit to their own surface (EntryGate renders
              nothing on desktop, HandoffBlock nothing on mobile). */}
          {build2GatesEnabled() ? <EntryGate tripId={id} /> : null}
          {build2GatesEnabled() && canShowFull ? <HandoffBlock tripId={id} /> : null}

              
                    {completedTrip ? <PostTripLibraryAskCard tripId={id} /> : null}
          {itineraryLocked ? <NoticeBanner>{translateExactText(locale, "This saved itinerary will not be regenerated in place. Use the trip controls to request supported changes.")}</NoticeBanner> : null}
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
            <div className="roamly-no-print mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
              {!canShowFull ? (
                <PrimaryTripAction
                  tripId={id}
                  locale={locale}
                  itineraryLocked={itineraryLocked}
                  generationInProgress={showPaymentWall ? false : generationInProgress}
                  trackingUnlocked={trackingUnlocked}
                  paidForItinerary={paidForItinerary}
                  freeAvailable={freeAvailable}
                  testerAccess={access.hasQaAccess}
                  apiAuthToken={apiAuthToken}
                  isPhilippinesTrip={isPhilippinesTrip(trip)}
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

        <TripHashSync focusAnchor={focusAnchor} />

        <div className="roamly-detail-only mt-6">
          {/* Correction phase (2026-10-28): destination-match rule —
              a city-specific promo for another city (e.g. Lisbon on a
              Montreal itinerary) is suppressed from this slot. */}
          <HouseAdSlot context="trip" placement="trip" destinationCity={trip.destination_city || trip.destination_name || null} />
        </div>

        {canShowFull && full && !generationPanelVisible ? (
          <div className="mt-4">
            <CustomizeYourTrip
              tripId={id}
              status={trip.status}
              budgetAmount={tripBudgetAmount}
              currency={currency}
              startDate={trip.start_date}
              endDate={trip.end_date}
              destinationLabel={destinationLabel}
              adults={customizeTravelers.adults}
              childrenCount={customizeTravelers.children}
              infants={customizeTravelers.infants}
              travelStyle={getTravelStyle(trip)}
              interests={getStringList(trip.interests || customizePlanning.interests, [], 20)}
              accommodationPreference={trip.accommodation_preference || getString(customizePlanning.accommodationPreference || customizePlanning.accommodation_preference) || "Not sure"}
              transportationPreference={trip.transportation_preference || getString(customizePlanning.transportationPreference || customizePlanning.transportation_preference) || "Mixed"}
              pace={getString(customizePlanning.pace) || "Balanced"}
              walkingTolerance={getString(customizePlanning.walkingTolerance || customizePlanning.walking_tolerance) || "Medium"}
              specialNotes={trip.special_notes || getString(customizePlanning.specialNotes || customizePlanning.special_notes) || customizeNotes}
            />
          </div>
        ) : null}

        {!canShowFull && !showGenerationPanel ? (
          <section id="day-by-day" className="calm-enter mt-4 scroll-mt-32 rounded-bui-panel border border-chair bg-white px-4 py-8 text-center shadow-bui-card sm:px-8">
            <p className="text-[12px] font-semibold uppercase tracking-[0.09em] text-cgray">{completedTrip ? "Trip completed" : showPaymentWall ? "Draft" : "Itinerary"}</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-chead">
              {completedTrip ? translateExactText(locale, "This trip has no saved day-by-day plan") : showPaymentWall ? translateExactText(locale, "Unlock this trip") : translateExactText(locale, "Your itinerary isn't ready yet")}
            </h2>
            {showPaymentWall ? (
              <p id="unlock" className="mx-auto mt-2 max-w-md text-sm font-normal leading-6 text-cink">
                This draft is saved. Roamly is not preparing it yet. You see the price before you pay.
              </p>
            ) : (
              <p className="mx-auto mt-2 max-w-md text-sm font-normal leading-6 text-cink">
                {completedTrip
                  ? translateExactText(locale, "This was a field-test trip and no day-by-day itinerary was generated for it. Your other trips with generated plans show the full day-by-day view here.")
                  : translateExactText(locale, "Once your itinerary is generated, the full day-by-day plan, budget breakdown, and bookings will appear here.")}
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
                .roamly-tab-panel{animation:roamly-panel-in .32s cubic-bezier(0.32,0.72,0,1)}
                .roamly-tab-nav label{transition:transform .18s cubic-bezier(0.32,0.72,0,1),background-color .25s ease,border-color .25s ease,color .25s ease}
                .roamly-tab-nav label:active{transform:scale(0.95)}
                @media (prefers-reduced-motion:reduce){.roamly-tab-panel{animation:none}.roamly-tab-nav label{transition:none}}
                .roamly-home-panel{display:block}
                /* Picture 5 (2026-10-26): the home screen is the
                   Itinerary Home panel alone. Blocks marked
                   .roamly-detail-only (legacy header, house ad,
                   footer) stay hidden on the home view and appear
                   only once a detail tab radio is checked — i.e.
                   only inside a detail destination. This style block
                   renders only with the tabs, so trips without tabs
                   (no plan yet, generating) are unaffected. */
                .roamly-detail-only{display:none}
                .roamly-screen-document:has(.roamly-tab-input:checked) .roamly-detail-only{display:block}
                .roamly-gap-cards{display:none}
                .roamly-screen-document:has(.roamly-tab-input:checked) .roamly-gap-cards{display:block}
                /* Edit trip (#customize) is a detail destination too:
                   the editing section stays hidden on the home view
                   and appears only when it is the URL target (the
                   panel's Edit trip pill, or the budget panel's
                   Customize link). */
                #customize{display:none}
                #customize:target{display:block}
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
                #roamly-tab-travel-notes:checked ~ .roamly-tab-nav,
                #roamly-tab-bookings:checked ~ .roamly-tab-nav{display:block}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-nav label[for="roamly-tab-day-by-day"],
                #roamly-tab-overview:checked ~ .roamly-tab-nav label[for="roamly-tab-overview"],
                #roamly-tab-budget:checked ~ .roamly-tab-nav label[for="roamly-tab-budget"],
                #roamly-tab-bookings:checked ~ .roamly-tab-nav label[for="roamly-tab-bookings"],
                #roamly-tab-requirements:checked ~ .roamly-tab-nav label[for="roamly-tab-requirements"],
                #roamly-tab-essentials:checked ~ .roamly-tab-nav label[for="roamly-tab-essentials"],
                #roamly-tab-travel-notes:checked ~ .roamly-tab-nav label[for="roamly-tab-travel-notes"]{background:#071E55;color:white;border-color:#071E55}
                @media print{.roamly-tab-panel{display:block!important}.roamly-tab-nav{display:none!important}.roamly-detail-only{display:block!important}.roamly-gap-cards{display:block!important}#customize{display:block!important}}
              `}</style>
              {panelTabs.map(([tabId]) => (
                <input key={tabId} className="roamly-tab-input" type="radio" name="roamly-completed-tab" id={tabId} defaultChecked={tabId === defaultPanelTab} />
              ))}

              <nav aria-label={translateExactText(locale, "Trip sections")} title={translateExactText(locale, "Trip sections")} className="roamly-tab-nav roamly-no-print top-[4.25rem] z-20 -mx-4 overflow-x-auto px-4 py-1 sm:sticky sm:top-[5.15rem] sm:mx-0">
                <div className="flex min-w-max gap-2">
                  {briefingNavTabs.map(([tabId, label]) => (
                    <label
                      key={tabId}
                      htmlFor={tabId}
                      className="bui-press bui-touch inline-flex min-h-11 cursor-pointer items-center rounded-full border border-chair bg-white px-3.5 py-2 text-sm font-medium text-cgray shadow-bui-card transition hover:text-chead"
                    >
                      {label}
                    </label>
                  ))}
                </div>
              </nav>

              <div className="roamly-tab-panels">
                {/* Picture 5 (2026-10-26): the home screen IS this panel
                    and nothing else. The transport line, stays, and
                    notes that used to sit under it are removed from
                    this section — they still render in their detail
                    destinations (day-by-day panel, bookings panel,
                    travel-notes panel; see the report). */}
                <section className="roamly-home-panel mt-5 scroll-mt-28" aria-label={translateExactText(locale, "Trip home")}>
                  <ItineraryHomePanel
                    tripId={id}
                    destinationLabel={destinationLabel}
                    dateRangeLabel={formatHomeDateRange(
                      trip.start_date,
                      trip.end_date,
                      locale,
                      (n) =>
                        n === 1
                          ? translateKey(locale, "ui.trip.dayCountOne", "1 day")
                          : translateKey(locale, "ui.trip.dayCountMany", "{count} days", { count: n }),
                      translateExactText(locale, "Dates flexible")
                    )}
                    days={itineraryHomeDays}
                    photo={destinationPhoto}
                    venuePhotos={venuePhotos}
                    editHref={itineraryHomeEditHref}
                    essentials={itineraryHomeEssentials}
                    packing={packingItems}
                    documents={panelDocumentItems}
                  />
                </section>
                <section id="day-by-day" className="roamly-tab-panel roamly-panel-day-by-day mt-8 scroll-mt-32">
                  {canShowFull && full ? <TripCommentBox tripId={id} /> : null}
                  {tripWeather && tripWeather.kind !== "past" ? (
                    <TripWeatherCard weather={tripWeather} className="mb-5" />
                  ) : null}
                  <div className="grid gap-7">
                    {dayNumbersToRender.map((dayNumber) => {
                      const day = canonicalDayByNumber.get(dayNumber);
                      const progressDay = generationDayProgress.find((item) => item.dayNumber === dayNumber);
                      return day ? (
                        <DayTimelineCard key={dayNumber} tripId={id} day={day} currency={currency} locale={locale} confirmedBookings={confirmedBookingSnapshot as Array<Record<string, unknown>>} suppressFlightFraming={suppressFlightFraming} staySearch={staySearch} />
                      ) : (
                        <BuildingDayCard
                          key={dayNumber}
                          dayNumber={dayNumber}
                          date={progressDay?.date}
                          status={progressDay?.status || (generationFailed ? "failed" : null)}
                        />
                      );
                    })}
                  </div>

                  {trackingUnlocked && !completedTrip ? (
                    <a
                      href={`/trip/${id}/live`}
                      className="roamly-press bui-press bui-lift mt-7 flex min-h-12 items-center justify-between gap-3 rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card"
                    >
                      <span className="text-[17px] font-normal text-chead">{translateExactText(locale, "Live Companion")}</span>
                      <span className="flex items-center gap-1 text-[15px] text-cgray">
                        {tripLifecycle === "active" ? translateExactText(locale, "Live") : setupState?.locationGranted && setupState?.locationEnabled ? translateExactText(locale, "Ready") : translateKey(locale, "ui.trip.companionStarts", "Starts {date}", { date: companionStartShort })}
                        <span aria-hidden="true" className="text-lg leading-none text-cchev">{"\u203a"}</span>
                      </span>
                    </a>
                  ) : null}

                  <div className="mt-7">
                    <PackageStays
                      suggestions={packageHotelItems}
                      trip={trip}
                      tripId={id}
                      currency={currency}
                      staySelectionId={
                        persistedPriceDiscovery?.staySelection &&
                        typeof persistedPriceDiscovery.staySelection === "object" &&
                        typeof (persistedPriceDiscovery.staySelection as { candidateId?: unknown }).candidateId === "string"
                          ? ((persistedPriceDiscovery.staySelection as { candidateId: string }).candidateId as string)
                          : null
                      }
                      totals={
                        full &&
                        typeof full.estimated_budget_breakdown.selected_hotel_estimate_amount === "number" &&
                        typeof full.estimated_budget_breakdown.buffer_estimate_amount === "number" &&
                        typeof full.estimated_budget_breakdown.total_estimate_amount === "number"
                          ? {
                              stayEstimateCents: Math.round(full.estimated_budget_breakdown.selected_hotel_estimate_amount * 100),
                              bufferEstimateCents: Math.round(full.estimated_budget_breakdown.buffer_estimate_amount * 100),
                              totalEstimateCents: Math.round(full.estimated_budget_breakdown.total_estimate_amount * 100)
                            }
                          : null
                      }
                      locale={locale}
                    />
                  </div>

                  {!draftCommand && commandNextTitle ? (
                    <div className="bui-enter roamly-now-next mt-7 rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
                      <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{translateExactText(locale, "What matters now")}</p>
                      <p className="mt-1 text-[1.15rem] font-semibold leading-6 tracking-[-0.02em] text-chead">{commandNextTitle}</p>
                      {commandNextMeta ? <p className="mt-1 text-sm text-cgray">{commandNextMeta}</p> : null}
                      <a href={readiness.primaryAction.href} className="bui-press bui-touch mt-4 inline-flex min-h-11 items-center rounded-xl bg-cblue px-4 text-sm font-semibold text-white">{readiness.primaryAction.label}</a>
                    </div>
                  ) : null}

                  <div className="bui-enter mt-7 rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
                    <p className="text-[13px] font-semibold uppercase tracking-[0.09em] text-cgray">Budget</p>
                    <p className="mt-1.5 text-sm leading-6 text-cgray">{headerBudgetText}</p>
                    {canShowFull ? <a href="#budget" className="bui-touch mt-2 inline-flex min-h-11 items-center text-sm font-medium text-cblue">{translateExactText(locale, "Review the budget")}</a> : null}
                    {confirmedBookingSnapshot.length ? (
                      <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                        <a href="#bookings" className="font-medium text-chead">{confirmedBookingSnapshot.length} {confirmedBookingSnapshot.length === 1 ? "booking" : "bookings"} confirmed</a>
                      </p>
                    ) : null}
                  </div>
                </section>

                <section id="overview" className="roamly-tab-panel roamly-panel-overview mt-8 scroll-mt-32">
                  <SectionHeading eyebrow={translateExactText(locale, "Snapshot")} title={translateExactText(locale, "Trip at a glance")} summary={translateExactText(locale, "The key context for this trip, with the next decision kept above.")} />
                  <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="bui-enter rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
                      <p className="text-[0.8125rem] font-medium text-slate-500">{translateExactText(locale, "Trip status")}</p>
                      <p className="mt-1 text-[1.05rem] font-semibold leading-6 tracking-tight text-ink">
                        {attentionText || (confirmedBookingSnapshot.length ? translateExactText(locale, "Your key travel details are coming together.") : translateExactText(locale, "Your trip is ready to shape around the day you want."))}
                      </p>
                    </div>
                    <div className="grid content-center gap-3 text-sm">
                      <p><span className="font-medium text-ink">{translateExactText(locale, "Best for:")}</span> <span className="text-slate-600">{full.best_for.slice(0, 3).join(" · ") || travelStyle}</span></p>
                      <p><span className="font-medium text-ink">{translateExactText(locale, "Budget:")}</span> <span className="text-slate-600">{compact(full.budget_fit_summary, translateExactText(locale, "Still uncertain"), 130)}</span></p>
                      <p><span className="font-medium text-ink">{translateExactText(locale, "Transport:")}</span> <span className="text-slate-600">{compact(full.transport_overview, translateExactText(locale, "Travel time is included in the plan."), 130)}</span></p>
                    </div>
                  </div>
                </section>

                <section id="budget" className="roamly-tab-panel roamly-panel-budget mt-8 scroll-mt-32">
                  <SectionHeading eyebrow={translateExactText(locale, "Budget")} title={translateExactText(locale, "Budget")} summary={readiness.primaryAction.id === "budget" ? readiness.urgentItems[0] || translateExactText(locale, "Review the uncertainty in your trip costs.") : translateExactText(locale, "See what is committed, expected, and still uncertain.")} />
                  {focusedBudget ? <p className="mb-4 border-l-2 border-cblue bg-cblue/5 px-3 py-2 text-sm font-bold text-slate-700">{translateExactText(locale, "This is the budget context behind your current trip action.")}</p> : null}
                  {budgetVerdictDisplay ? (
                    <BudgetVerdictCard display={budgetVerdictDisplay} />
                  ) : (
                    <BudgetSummary
                      trip={trip}
                      itinerary={full}
                      currency={currency}
                      priceDiscovery={persistedPriceDiscovery}
                      confirmedBookingCount={confirmedBookingSnapshot.length}
                      locale={locale}
                    />
                  )}
                </section>

                <section id="bookings" className="roamly-tab-panel roamly-panel-bookings mt-8 scroll-mt-32">
                  <SectionHeading eyebrow={translateExactText(locale, "Bookings")} title={translateExactText(locale, "Recommended bookings")} summary={readiness.primaryAction.id === "bookings" ? readiness.urgentItems[0] || translateExactText(locale, "Review the bookings that still need you.") : translateExactText(locale, "Only the recommended transport, stay, flights, and important activities.")} />
                  {noteDisplay.text ? (
                    <div className="bui-enter mb-4 rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
                      <p className="text-[0.75rem] font-medium text-slate-500">{translateExactText(locale, "Your notes shape these choices")}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{noteDisplay.hotel}</p>
                      <p className="mt-1 text-sm leading-6 text-cink">{noteDisplay.flight}</p>
                      <p className="mt-1 text-sm leading-6 text-cink">{noteDisplay.activity}</p>
                    </div>
                  ) : null}
                  {focusedBookingLabel ? <p className="mb-4 border-l-2 border-cblue bg-cblue/5 px-3 py-2 text-sm font-bold text-slate-700">{translateKey(locale, "ui.trip.startWithBooking", "Start with your {label} details below.", { label: focusedBookingLabel })}</p> : null}
                  <div className="mb-4">
                    <MarketPriceRefreshButton tripId={id} />
                    {one(search.hotel_action) === "price_changed" ? <p className="mt-2 text-sm font-bold text-slate-700">{translateExactText(locale, "Hotel price changed. Review the updated hotel price before continuing.")}</p> : null}
                    {one(search.hotel_action) === "unavailable" ? <p className="mt-2 text-sm font-bold text-coral">{translateExactText(locale, "The selected hotel is no longer available for these dates.")}</p> : null}
                    {one(search.hotel_action) === "verification_failed" ? <p className="mt-2 text-sm font-bold text-slate-700">{translateExactText(locale, "We could not verify the selected hotel's current price or availability. Refresh and try again.")}</p> : null}
                  </div>
                  <HotelProductOptions presentation={hotelProductPresentation} tripId={id} pendingChoice={pendingHotelProductChoice} />
                  <BookingPlan itinerary={full} trip={trip} tripId={id} confirmedBookings={currentImportedBookings as Array<Record<string, unknown>>} locale={locale} suppressFlightFraming={suppressFlightFraming} />
                  <details className="roamly-no-print mt-5 rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card">
                    <summary className="bui-touch flex cursor-pointer items-center text-sm font-black text-cblue">{translateExactText(locale, "Bookings and imports")}</summary>
                    <div className="mt-4 grid gap-4">
                      <BookingSummaryList bookings={importedBookings as Array<Record<string, unknown>>} locale={locale} />
                      <TripBookingsManager tripId={id} initialBookings={importedBookings} />
                    </div>
                  </details>
                </section>

                
                {/* Exactness pass (2026-10-26): gap cards + their
                    affiliate/house-ad blocks live behind the detail
                    tabs, not on the home view — the mock home ends
                    at "View day on map". Hidden on home (no radio
                    checked), shown on any detail tab, same as
                    .roamly-detail-only. Print keeps them. */}
                {trackingUnlocked ? <div className="roamly-gap-cards"><TripGapCards tripId={id} /></div> : null}
                {hasRequirements ? <section id="requirements" className="roamly-tab-panel roamly-panel-requirements mt-8 scroll-mt-32">
                  <SectionHeading eyebrow={translateExactText(locale, "Before you go")} title={translateExactText(locale, "Entry requirements")} summary={travelerRequirementState.evaluations.length > 1 ? translateExactText(locale, "Requirements can differ for each traveler. Roamly evaluates each person only from their explicit passport country.") : translateExactText(locale, "A conservative review based on your destination and your declared passport country.")} />
                  <TripTravelerRequirements tripId={id} evaluations={travelerRequirementState.evaluations} />
                </section> : null}

                {hasEssentials ? (
                  <section id="essentials" className="roamly-tab-panel roamly-panel-essentials scroll-mt-32 scroll-mb-[calc(10rem+env(safe-area-inset-bottom))] pb-24 lg:pb-0">
                    <PreTripEssentialsSection essentials={full.pre_trip_essentials} tripId={id} locale={locale} />
                  </section>
                ) : null}

                {hasTravelNotes ? (
                  <section id="travel-notes" className="roamly-tab-panel roamly-panel-travel-notes mt-8 scroll-mt-32">
                    <SectionHeading eyebrow={translateExactText(locale, "Practical")} title={translateExactText(locale, "Travel notes")} summary={translateExactText(locale, "Useful reference for before and during the trip.")} />
                    <div className="grid gap-4 md:grid-cols-2">
                      <ChecklistGroup title={translateExactText(locale, "Packing")} items={packingItems} />
                      <ChecklistGroup title={translateExactText(locale, "Local tips")} items={localTipItems} />
                    </div>
                    {[safetyItems, documentItems, emergencyItems, lowCostItems].some((items) => items.length > 0) ? (
                      <details className="mt-4 rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card">
                        <summary className="bui-touch flex min-h-11 cursor-pointer items-center text-sm font-black text-cblue">{translateExactText(locale, "More practical notes")}</summary>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <ChecklistGroup title={translateExactText(locale, "Safety")} items={safetyItems} />
                          <ChecklistGroup title={translateExactText(locale, "Documents")} items={documentItems} />
                          <ChecklistGroup title={translateExactText(locale, "Emergency")} items={emergencyItems} />
                          <ChecklistGroup title={translateExactText(locale, "Low-cost reminders")} items={lowCostItems} />
                        </div>
                      </details>
                    ) : null}
                  </section>
                ) : null}
              </div>

            </div>

            <footer className="roamly-detail-only mt-10 border-t border-chair py-6 text-sm font-medium text-cgray">
              {translateExactText(locale, "Generated by Roamly")}
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

export default async function TripHomePage(props: TripPageProps) {
  const locale = await getServerLocale();
  return (
    <Suspense fallback={<TripHomeLoading locale={locale} />}>
      <TripPage {...props} />
    </Suspense>
  );
}
