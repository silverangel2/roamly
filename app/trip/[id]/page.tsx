import Image from "next/image";
import { redirect } from "next/navigation";
import { TripAuthSessionCheck } from "@/components/auth/TripAuthSessionCheck";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { MarketPriceRefreshButton } from "@/components/trip/MarketPriceRefreshButton";
import { TranslateItineraryButton } from "@/components/trip/TranslateItineraryButton";
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
import { getServerLocale } from "@/lib/i18n-server";
import { confirmCheckoutSessionForTrip } from "@/lib/payments";
import { isEmailConfigured } from "@/lib/roamly/email";
import { affiliateDisclosure, enrichItineraryBookingSuggestions } from "@/lib/roamly/affiliateLinks";
import { amazonAffiliateDisclosure, type RoamlyPreTripEssential } from "@/lib/roamly/amazonAffiliate";
import { esimVerificationCopy } from "@/lib/roamly/esim";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import type { TransportOption } from "@/lib/roamly/transportOptions";
import type { BudgetCategoryConfidence } from "@/lib/roamly/priceDiscovery";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordAppEvent } from "@/lib/roamly/events";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { getLocalizedItinerary, getTripItineraryLanguage } from "@/lib/roamly/itineraryTranslations";
import { isLegacyBookingUrl, resolveAffiliateLink } from "@/lib/roamly/affiliateResolver";
import {
  buildTransportSearchUrl,
  roamlyDiscoveryUrl,
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
import type { TripPlannerPayload } from "@/lib/trip-planner";

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

type TimelineItem = RoamlyItinerary["daily_itinerary"][number]["live_timeline"][number];

function timelineKind(item: TimelineItem) {
  const value = getString(item.item_type || item.category).toLowerCase();
  if (value.includes("travel")) return "travel";
  if (value.includes("transfer")) return "transfer";
  if (value.includes("hotel")) return "hotel";
  if (value.includes("meal") || value.includes("food")) return "meal";
  if (value.includes("rest")) return "rest";
  if (value.includes("book")) return "booking";
  if (value.includes("reminder")) return "reminder";
  return "activity";
}

function timelineKindLabel(kind: string) {
  if (kind === "travel") return "Travel";
  if (kind === "transfer") return "Transfer";
  if (kind === "hotel") return "Hotel";
  if (kind === "meal") return "Meal";
  if (kind === "rest") return "Rest";
  if (kind === "booking") return "Booking";
  if (kind === "reminder") return "Reminder";
  return "Activity";
}

function timelineKindClass(kind: string) {
  if (kind === "travel") return "border-ocean/25 bg-ocean/10 text-ocean";
  if (kind === "transfer") return "border-lagoon/25 bg-lagoon/10 text-ocean";
  if (kind === "hotel") return "border-sun/35 bg-sun/15 text-amber-800";
  if (kind === "meal") return "border-coral/25 bg-coral/10 text-coral";
  if (kind === "rest") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-[#e8dfd0] bg-white text-ink";
}

function timelineMeta(item: TimelineItem) {
  return [
    item.transportMode || item.travel_mode,
    item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : "",
    item.durationMinutes ? `${item.durationMinutes} min` : item.duration,
    item.travelTimeMinutes ? `${item.travelTimeMinutes} min travel` : "",
    item.origin && item.destination ? `${item.origin} to ${item.destination}` : "",
    item.location_name
  ]
    .map((value) => getString(value))
    .filter(Boolean)
    .slice(0, 3);
}

function TimelineItemCard({ item, tripId }: { item: TimelineItem; tripId: string }) {
  const kind = timelineKind(item);
  const meta = timelineMeta(item);
  const description = compact(item.description, "", 180);
  const booking = item.booking && safeBookingUrl(item.booking.url)
    ? {
        href: safeBookingUrl(item.booking.url),
        label: item.booking.ctaLabel || item.booking_label || "View options",
        provider: item.booking.provider || "roamly_internal",
        hasAffiliateUrl: Boolean(item.booking.disclosureRequired),
        urlType: item.booking.disclosureRequired ? "affiliate" as BookingUrlType : "fallback" as BookingUrlType
      }
    : null;

  return (
    <article className={`rounded-[0.9rem] border px-3 py-3 ${timelineKindClass(kind)}`}>
      <div className="grid grid-cols-[4.5rem_1fr] gap-3">
        <div>
          <p className="text-[0.72rem] font-black uppercase tracking-[0.08em]">{item.time_label || "Flex"}</p>
          <span className="mt-2 inline-flex rounded-full border border-current/20 bg-white/50 px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.06em]">
            {timelineKindLabel(kind)}
          </span>
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-black leading-5 text-ink">{item.title}</h4>
          {meta.length ? <p className="mt-1 text-xs font-bold leading-5 text-slate-600">{meta.join(" · ")}</p> : null}
          {booking ? (
            <div className="mt-2">
              <BookingRecommendationButton
                href={booking.href}
                label={booking.label}
                tripId={tripId}
                category={item.affiliate_category || kind}
                title={item.title}
                provider={booking.provider}
                hasAffiliateUrl={booking.hasAffiliateUrl}
                urlType={booking.urlType}
              />
            </div>
          ) : item.booking_label ? (
            <span className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-400">
              Search link unavailable
            </span>
          ) : null}
        </div>
      </div>
      {description || item.map_query ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-black text-ocean">View details</summary>
          {description ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-700">{description}</p> : null}
          {item.map_query ? (
            <div className="mt-2">
              <NavigationChipList query={item.map_query} />
            </div>
          ) : null}
        </details>
      ) : null}
    </article>
  );
}

function DayTimelineCard({
  day,
  currency,
  tripId
}: {
  day: RoamlyItinerary["daily_itinerary"][number];
  currency: string;
  tripId: string;
}) {
  const places = day.map_queries.slice(0, 5);

  return (
    <details
      id={`day-${day.day_number}`}
      name="roamly-day"
      open={day.day_number === 1}
      className="roamly-day-print scroll-mt-36 rounded-[1.15rem] border border-[#e8dfd0] bg-white shadow-[0_12px_34px_rgba(16,32,51,0.06)]"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
            Day {day.day_number}
            {day.city ? ` · ${day.city}` : ""}
            {day.date ? ` · ${formatTripDate(day.date)}` : ""}
          </p>
          <h3 className="mt-1 text-lg font-black leading-6 tracking-tight text-ink sm:text-2xl">{day.title}</h3>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500 sm:hidden">
            {compact(day.morning || day.afternoon || day.evening, "Tap to view the day timeline.", 90)}
          </p>
        </div>
        <span className="w-fit rounded-full border border-ocean/20 bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
          Est. {formatMoney(day.estimated_cost, currency)}
        </span>
      </summary>

      <div className="border-t border-[#eee5d7] px-4 pb-4 pt-3">
        <div className="grid gap-2">
          {day.live_timeline.length ? (
            day.live_timeline.map((item, index) => (
              <TimelineItemCard key={`${day.day_number}-${item.time_label}-${item.title}-${index}`} item={item} tripId={tripId} />
            ))
          ) : (
            <>
              <TimelineEntry label="Morning" text={day.morning} />
              <TimelineEntry label="Afternoon" text={day.afternoon} />
              <TimelineEntry label="Evening" text={day.evening} />
            </>
          )}
        </div>

        {day.food.length ? (
          <details className="mt-3 rounded-[0.9rem] bg-[#f8faf8] px-3 py-3">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500">Food ideas</summary>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{day.food.slice(0, 3).join(" · ")}</p>
          </details>
        ) : null}

        {places.length ? (
          <details className="mt-3 rounded-[0.9rem] border border-cloud bg-white px-3 py-3">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500">Map details</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {places.map((query) => (
                <div key={query} className="rounded-[0.9rem] border border-cloud bg-white px-3 py-3">
                  <p className="text-sm font-black leading-5 text-ink">{query}</p>
                  <NavigationChipList query={query} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
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
  const confidence = (category: BudgetCategoryConfidence["category"]) =>
    estimate.budget_category_confidence?.find((item) => item.category === category);
  const withConfidence = (amount: number | null | undefined, category: BudgetCategoryConfidence["category"], fallback: string) => {
    const label = confidence(category)?.label;
    const value = typeof amount === "number" && Number.isFinite(amount) ? formatBudgetMoney(amount, currency) : fallback;
    return label ? `${value} · ${label}` : value;
  };

  return [
    {
      label: "User budget",
      value: budgetAmount == null ? "Not set" : formatBudgetMoney(budgetAmount, currency)
    },
    { label: "Selected transport", value: withConfidence(estimate.selected_transport_estimate_amount, "transport", estimate.transport) },
    { label: "Selected hotel/stay", value: trip.budget_includes_hotel === false ? "Not included in trip budget." : withConfidence(estimate.selected_hotel_estimate_amount, "hotel", estimate.lodging) },
    { label: "Tickets/tours", value: withConfidence(estimate.tickets_tours_estimate_amount, "tickets_tours", estimate.activities) },
    { label: "Food", value: withConfidence(estimate.food_estimate_amount, "food", estimate.food) },
    { label: "Local transport", value: withConfidence(estimate.local_transport_estimate_amount, "local_transport", "Confirm local transport estimate.") },
    { label: "Buffer", value: withConfidence(estimate.buffer_estimate_amount, "buffer", estimate.buffer) },
    { label: "Committed bookings", value: withConfidence(estimate.committed_bookings_amount, "committed_bookings", "None saved") },
    {
      label: "Total",
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
  const estimate = itinerary.estimated_budget_breakdown;
  const crossBorderBadges = estimate.cross_border
    ? ["Cross-border trip", "Passport check", estimate.currency_change ? "Currency change" : "", "Border time buffer", "Roaming reminder", "Customs reminder"].filter((label): label is string => Boolean(label))
    : [];

  return (
    <div className="grid gap-3">
      {crossBorderBadges.length ? (
        <div className="flex flex-wrap gap-2 rounded-[1.15rem] border border-sun/30 bg-sun/10 px-4 py-3">
          {crossBorderBadges.map((label) => (
            <span key={label} className="rounded-full border border-sun/30 bg-white/75 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-amber-800">
              {label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[1.15rem] border border-[#e8dfd0] bg-white shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
        {budgetRows({ trip, itinerary, currency }).map((row) => (
          <div key={row.label} className="grid gap-1 border-b border-[#eee5d7] px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-5">
            <p className="text-sm font-black text-ink">{row.label}</p>
            <p className="text-sm font-semibold leading-6 text-slate-700">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function fallbackSearchUrl(query: string) {
  return roamlyDiscoveryUrl("discovery", query);
}

function safeBookingUrl(value?: string | null) {
  const raw = getString(value);
  if (!raw) return "";
  if (isLegacyBookingUrl(raw)) return "";
  if (raw === "#" || /^javascript:/i.test(raw) || /placeholder|example\.com/i.test(raw)) return "";
  if (raw.startsWith("/")) return raw;
  return safeExternalUrl(raw);
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

function fallbackBookingUrl(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const category = bookingCategory(suggestion);
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
      destination,
      startDate: tripDate(trip, "start"),
      endDate: tripDate(trip, "end"),
      adults: travelers.adults,
      children: travelers.children,
      rooms: tripRooms(trip),
      neighborhood: suggestion.neighborhood || suggestion.location,
      roomType: suggestion.room_type
    }).finalUrl;
  }

  if (category === "attraction") {
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
    return fallbackSearchUrl(`${title} ${destination} reservations ${suggestion.date || ""}`);
  }

  return fallbackSearchUrl(`${title} ${destination}`);
}

function bookingProvider(suggestion: RoamlyItinerary["booking_suggestions"][number], fallback: string) {
  return suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || fallback;
}

function resolveBookingLink(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const affiliate = safeBookingUrl(suggestion.affiliate_url);
  if (affiliate) {
    return {
      href: affiliate,
      provider: bookingProvider(suggestion, "Affiliate partner"),
      hasAffiliateUrl: true,
      urlType: "affiliate" as BookingUrlType
    };
  }

  const normal = safeBookingUrl(suggestion.normal_search_url);
  if (normal) {
    return {
      href: normal,
      provider: bookingProvider(suggestion, "Normal search"),
      hasAffiliateUrl: false,
      urlType: "normal_search" as BookingUrlType
    };
  }

  const fallback = safeBookingUrl(fallbackBookingUrl(suggestion, trip));
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
  if (suggestion.price_type === "search_ready") return "Market estimate";
  if (suggestion.price_type === "estimated_fallback") return "Conservative estimate";
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
  if (option.availability === "verified") return "Verified route";
  if (option.availability === "search_ready") return "Search-ready";
  if (option.availability === "not_available") return "Not available";
  if (option.availability === "unverified") return "Unverified";
  if (option.mode === "drive") return "Conservative drive estimate";
  return "Conservative estimate";
}

function transportEstimate(option: TransportOption) {
  const range = formatRange(option.estimated_cost_min, option.estimated_cost_max, option.currency || "CAD");
  return range || "Search-ready. Verify live price.";
}

function transportHref(option: TransportOption) {
  const direct = safeBookingUrl(option.booking_url) || safeBookingUrl(option.search_url);
  if (direct) return direct;
  if (option.mode === "flight") {
    return resolveAffiliateLink({
      category: "flight",
      origin: option.origin,
      destination: option.destination,
      startDate: option.departure_date,
      endDate: option.return_date
    }).finalUrl;
  }
  if (option.mode === "drive") {
    return buildTransportSearchUrl({
      origin: option.origin,
      destination: option.destination,
      date: option.departure_date
    });
  }
  return resolveAffiliateLink({
    category: "transport",
    origin: option.origin,
    destination: option.destination,
    startDate: option.departure_date,
    title: option.title
  }).finalUrl;
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
  if (suggestion.price_type === "search_ready") return "Market estimate. Refresh live price and availability before booking.";
  if (nightly && total) return `${suggestion.price_type === "estimated_fallback" ? "Conservative estimate" : "Estimate"} nightly ${nightly}; stay ${total}.`;
  if (total) return `${suggestion.price_type === "estimated_fallback" ? "Conservative estimate" : "Estimate"} ${total}.`;
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
                    {transportBadges(option).map((badge) => (
                      <span key={badge} className="rounded-full border border-ocean/15 bg-ocean/5 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-ocean">
                        {badge}
                      </span>
                    ))}
                  </div>
                  <h4 className="mt-2 text-lg font-black leading-6 text-ink">{option.title}</h4>
                  <p className="mt-1 text-sm font-black text-ink">{transportEstimate(option)}</p>
                  {option.duration_label ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{option.duration_label}</p> : null}
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{option.why_recommended}</p>
                  {option.warning ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">{option.warning}</p> : null}
                  {option.mode === "drive" ? (
                    <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                      Driving estimate uses fuel, parking, toll, border, and overnight-stop assumptions where relevant until live maps/gas providers are connected.
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
  const provider = item.provider || (isConnectivity ? "Airalo" : "Amazon Associates");
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
            hasAffiliateUrl={hasAffiliateUrl}
            urlType={urlType}
          />
        </div>
        <p className="roamly-print-only hidden text-xs font-black text-ocean">{href ? `${provider} search: ${label}` : `${provider} search link unavailable`}</p>
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

export default async function TripPage({ params, searchParams }: TripPageProps) {
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
    } else {
      checkoutAwaitingWebhook = true;
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
  const baseFull = itinerary?.full_json || null;
  const localizedItinerary = baseFull ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: baseFull, locale }) : null;
  const full = localizedItinerary?.itinerary
    ? enrichItineraryBookingSuggestions(localizedItinerary.itinerary, savedTripPayload(trip, locale))
    : null;
  const displayedItineraryLanguage = localizedItinerary?.language || getTripItineraryLanguage(trip.metadata);
  const itineraryLocked = isTripLocked(trip);
  const trackingUnlocked = tripHasTrackingUnlock(trip) || (access.hasQaAccess && itineraryLocked);
  const paidForItinerary = isItineraryPaid(trip) || access.hasQaAccess;
  const checkoutNeedsAttention = Boolean(checkoutSyncError && !paidForItinerary && !trackingUnlocked);
  const checkoutProcessing = Boolean(checkoutAwaitingWebhook && !paidForItinerary && !trackingUnlocked);
  const checkoutStartFailed = one(search.checkout) === "failed";
  const shouldCleanCheckoutUrl = Boolean((one(search.checkout) || sessionId) && !checkoutNeedsAttention && !checkoutProcessing);
  const freeAvailable = !freeResult.used;
  const generationRequiresPayment = !itineraryLocked && !paidForItinerary && !freeAvailable;
  const preview = full ? localizedItinerary?.preview || buildPreviewFromItinerary(full) : itinerary?.preview_json || null;
  const canShowFull = Boolean(itineraryLocked && full);
  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const importedBookings = bookingsResult.error && isMissingTableError(bookingsResult.error.message) ? [] : bookingsResult.data || [];
  const tripTitle = full?.trip_title || preview?.trip_title || trip.title || destinationLabel;
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
    <main className="safe-bottom roamly-print-document w-full bg-[#fbf8ef] px-4 pb-24 pt-5 text-ink sm:px-6 sm:py-8">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <div className="roamly-print-paper mx-auto max-w-6xl">
        <section className="rounded-[1.1rem] border border-[#e8dfd0] bg-[#fffdf8] p-4 shadow-[0_16px_44px_rgba(16,32,51,0.07)] sm:rounded-[1.35rem] sm:p-7">
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
              <h1 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-5xl">{tripTitle}</h1>
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-700 sm:text-base sm:leading-7">
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
              {checkoutProcessing ? (
                <NoticeBanner>
                  Stripe returned successfully. Roamly is waiting for the signed webhook to update this trip; refresh in a moment if it still looks locked.
                </NoticeBanner>
              ) : null}
              {checkoutStartFailed ? (
                <NoticeBanner tone="coral">Stripe checkout could not be opened. Your trip draft was saved, so you can try unlocking it again from this page.</NoticeBanner>
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
            {canShowFull ? (
              <>
                <TripShareActions tripId={id} tripTitle={tripTitle} emailConfigured={emailConfigured} />
                <TranslateItineraryButton tripId={id} displayedLanguage={displayedItineraryLanguage} />
              </>
            ) : null}
          </div>
        </section>

        {canShowFull && full ? (
          <>
            <nav className="roamly-no-print sticky top-[4.25rem] z-20 -mx-4 mt-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fffdf8]/95 px-4 py-2 backdrop-blur sm:top-[5.15rem] sm:mx-0 sm:rounded-full sm:border sm:px-3 sm:py-3">
              <div className="flex min-w-max gap-2">
                {[
                  ["day-by-day", "Day-by-day"],
                  ["overview", "Overview"],
                  ["budget", "Budget"],
                  ["bookings", "Bookings"],
                  ["pre-trip-essentials", "Essentials"],
                  ["travel-notes", "Travel notes"]
                ].map(([href, label], index) => (
                  <a
                    key={href}
                    href={`#${href}`}
                    className={`rounded-full px-3 py-2 text-xs font-black transition sm:px-4 sm:text-sm ${
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
                summary="Jump by day, expand one section, and open details only when needed."
              />
              <nav className="roamly-no-print sticky top-[8.2rem] z-10 -mx-4 mb-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fbf8ef]/95 px-4 py-2 backdrop-blur sm:top-[9.2rem] sm:mx-0 sm:rounded-full sm:border">
                <div className="flex min-w-max gap-2">
                  {full.daily_itinerary.map((day) => (
                    <a
                      key={day.day_number}
                      href={`#day-${day.day_number}`}
                      className="rounded-full border border-[#e8dfd0] bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-ocean/30 hover:text-ocean"
                    >
                      Day {day.day_number}
                    </a>
                  ))}
                </div>
              </nav>
              <div className="grid gap-3 sm:gap-5">
                {full.daily_itinerary.map((day) => (
                  <DayTimelineCard key={day.day_number} day={day} currency={currency} tripId={id} />
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
              <SectionHeading eyebrow="Bookings" title="What to reserve" summary="Roamly uses configured partner links when available and internal discovery when a provider is missing." />
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

            <PreTripEssentialsSection essentials={full.pre_trip_essentials || []} tripId={id} />

            <section id="travel-notes" className="mt-8 scroll-mt-32">
              <SectionHeading eyebrow="Travel notes" title="Checklist and local notes" />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <ChecklistGroup
                  title="Packing checklist"
                  items={packingChecklistItems(checklist, full)}
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
            <div className="roamly-no-print fixed inset-x-0 bottom-0 z-30 border-t border-[#e8dfd0] bg-[#fffdf8]/95 px-3 py-3 shadow-[0_-12px_30px_rgba(16,32,51,0.08)] backdrop-blur sm:hidden">
              <div className="grid grid-cols-3 gap-2">
                <a href="#day-by-day" className="rounded-full bg-ink px-3 py-3 text-center text-xs font-black text-white">
                  Days
                </a>
                <a href="#bookings" className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-3 text-center text-xs font-black text-ocean">
                  Book
                </a>
                <a href="#budget" className="rounded-full border border-[#e8dfd0] bg-white px-3 py-3 text-center text-xs font-black text-slate-600">
                  Budget
                </a>
              </div>
            </div>
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
