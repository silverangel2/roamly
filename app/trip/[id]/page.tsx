import Image from "next/image";
import { redirect } from "next/navigation";
import { TripAuthSessionCheck } from "@/components/auth/TripAuthSessionCheck";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { MarketPriceRefreshButton } from "@/components/trip/MarketPriceRefreshButton";
import { StagedGenerationProgress } from "@/components/trip/StagedGenerationProgress";
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
  type RoamlyItinerary
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

type DisplayTimelineItem = {
  time: string;
  sortMinutes: number | null;
  title: string;
  description: string;
  location: string;
  category: string;
  durationLabel: string;
  travelLabel: string;
  transferNote: string;
  mapQuery: string;
  warning: string;
};

const genericStopPatterns = [
  /^local bistro$/i,
  /^museum or gallery$/i,
  /^nightlife district$/i,
  /^hotel room$/i,
  /^planned activity$/i,
  /^activity title$/i,
  /^things to do$/i,
  /^book activities$/i,
  /^find hotels?$/i,
  /^hotel\/stay to book$/i,
  /^flights? to book$/i,
  /^neighborhood lunch and explore$/i,
  /^easy evening finish$/i,
  /^.+ first stop$/i
];

function isGenericStopText(value: string) {
  const text = value.trim();
  if (!text) return true;
  return genericStopPatterns.some((pattern) => pattern.test(text));
}

function timelineText(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function timelineNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function parseClockMinutes(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const twelve = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  const minute = Number(twelve[2] || "0");
  const period = twelve[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function formatClock(value: string) {
  const minutes = parseClockMinutes(value);
  if (minutes == null) return value;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function isTransferLike(record: Record<string, unknown>) {
  const text = [
    timelineText(record, "item_type", "type"),
    timelineText(record, "category"),
    timelineText(record, "title"),
    timelineText(record, "travel_mode", "transportMode", "transport_mode")
  ]
    .join(" ")
    .toLowerCase();
  return /\b(travel|transfer|transit|taxi|rideshare|shuttle|walk to|travel to|transfer to|drive to|get to)\b/.test(text);
}

function isMajorTravel(record: Record<string, unknown>) {
  const type = timelineText(record, "item_type", "type").toLowerCase();
  const mode = timelineText(record, "travel_mode", "transportMode", "transport_mode").toLowerCase();
  const title = timelineText(record, "title").toLowerCase();
  const minutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes", "durationMinutes", "duration_minutes");
  if (type === "travel" && /\b(flight|train|rail|bus|ferry|drive|inter[- ]?city)\b/.test(`${mode} ${title}`)) return true;
  return Boolean(minutes != null && minutes >= 60);
}

function cleanTimelineTitle(record: Record<string, unknown>) {
  const rawTitle = timelineText(record, "title", "name");
  const location = timelineText(record, "location_name", "location", "place_name", "venue", "area");
  const mapQuery = timelineText(record, "map_query", "mapQuery");
  const category = timelineText(record, "category", "item_type", "type");

  if (rawTitle && !isGenericStopText(rawTitle)) return rawTitle;
  if (location && !isGenericStopText(location)) {
    if (/meal|lunch|dinner|breakfast|food/i.test(`${rawTitle} ${category}`)) return `${rawTitle || "Meal"} at ${location}`;
    return location;
  }
  if (mapQuery && !isGenericStopText(mapQuery)) return mapQuery;
  return "";
}

function transferSummary(record: Record<string, unknown>) {
  const origin = timelineText(record, "origin");
  const destination = timelineText(record, "destination", "location_name", "location");
  const mode = timelineText(record, "travel_mode", "transportMode", "transport_mode");
  const minutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes", "durationMinutes", "duration_minutes");
  const title = cleanTimelineTitle(record) || timelineText(record, "title");
  const route = origin && destination ? `${origin} to ${destination}` : destination || title;
  return [mode || "Transfer", route, minutes ? `${minutes} min` : ""].filter(Boolean).join(" · ");
}

function buildDisplayTimelineItems(day: RoamlyItinerary["daily_itinerary"][number]) {
  const output: DisplayTimelineItem[] = [];
  const seen = new Set<string>();
  const pendingTransfers: string[] = [];

  for (const item of day.live_timeline || []) {
    const record = item as unknown as Record<string, unknown>;
    const transferLike = isTransferLike(record);

    if (transferLike && !isMajorTravel(record)) {
      const summary = transferSummary(record);
      if (summary) pendingTransfers.push(summary);
      continue;
    }

    const title = cleanTimelineTitle(record);
    const type = timelineText(record, "item_type", "type");
    const category = timelineText(record, "category") || type || "Stop";
    const location = timelineText(record, "location_name", "location", "place_name", "venue", "area");
    const description = timelineText(record, "description", "summary", "details", "notes");
    const start = timelineText(record, "startTime", "start_time");
    const end = timelineText(record, "endTime", "end_time");
    const timeLabel = timelineText(record, "time_label", "time") || (start ? formatClock(start) : "");
    const time = start && end ? `${formatClock(start)}-${formatClock(end)}` : timeLabel;
    const sortMinutes = parseClockMinutes(start || timeLabel);
    const duration = timelineNumber(record, "durationMinutes", "duration_minutes");
    const travelMinutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes");
    const mapQuery = timelineText(record, "map_query", "mapQuery") || location || title;
    const isLunch = /\blunch\b/i.test(`${title} ${description} ${category}`);
    const warning =
      isLunch && sortMinutes != null && sortMinutes > 14 * 60
        ? "Late lunch timing. Treat this as an intentional rest or adjust earlier."
        : "";

    if (!title && !description) continue;
    if (!transferLike && title && isGenericStopText(title) && (!location || isGenericStopText(location))) continue;

    const key = `${time}|${title}|${location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      time: time || "Flexible",
      sortMinutes,
      title: title || category,
      description,
      location,
      category,
      durationLabel: duration ? `${duration} min` : timelineText(record, "duration"),
      travelLabel: travelMinutes ? `${travelMinutes} min travel` : "",
      transferNote: pendingTransfers.splice(0).join(" / "),
      mapQuery,
      warning
    });

    if (output.length >= 6) break;
  }

  return output.sort((a, b) => (a.sortMinutes ?? 10_000) - (b.sortMinutes ?? 10_000));
}

function TimelineItemCard({ item }: { item: DisplayTimelineItem }) {
  const meta = [item.durationLabel, item.travelLabel, item.location].filter(Boolean);
  const secondary = [item.transferNote ? `Arrival/transfer: ${item.transferNote}` : "", item.description].filter(Boolean);

  return (
    <article className="rounded-[1rem] border border-[#e8e2d8] bg-white p-4 shadow-[0_10px_28px_rgba(16,32,51,0.05)] sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
        <div>
          <p className="text-sm font-black text-ocean">{item.time}</p>
          <p className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{item.category.replaceAll("_", " ")}</p>
        </div>

        <div className="min-w-0">
          <h4 className="text-lg font-black leading-6 text-ink sm:text-xl">{item.title}</h4>
          {meta.length ? <p className="mt-1 text-sm font-bold leading-5 text-slate-500">{meta.join(" · ")}</p> : null}
          {item.warning ? <p className="mt-2 text-xs font-black leading-5 text-amber-800">{item.warning}</p> : null}
          {secondary.length ? (
            <details className="mt-3 rounded-[0.8rem] bg-[#f8faf8] px-3 py-2">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500">Timing and notes</summary>
              <div className="mt-2 grid gap-1">
                {secondary.map((line) => (
                  <p key={line} className="text-sm font-semibold leading-6 text-slate-600">{line}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DayTimelineCard({
  day,
  currency
}: {
  day: RoamlyItinerary["daily_itinerary"][number];
  currency: string;
}) {
  const timelineItems = buildDisplayTimelineItems(day);
  const places = [
    ...timelineItems.map((item) => item.mapQuery),
    ...day.map_queries
  ]
    .map((item) => getString(item))
    .filter((item) => item && !isGenericStopText(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 5);

  return (
    <section
      id={`day-${day.day_number}`}
      className="roamly-day-print scroll-mt-40 rounded-[1.15rem] border border-[#e8dfd0] bg-[#fffdf8] p-4 shadow-[0_12px_34px_rgba(16,32,51,0.06)] sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
            Day {day.day_number}
            {day.city ? ` · ${day.city}` : ""}
            {day.date ? ` · ${formatTripDate(day.date)}` : ""}
          </p>
          <h3 className="mt-1 text-lg font-black leading-6 tracking-tight text-ink sm:text-2xl">{day.title}</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {compact(day.morning || day.afternoon || day.evening, "A paced day with the main stops grouped together.", 150)}
          </p>
        </div>
        <span className="w-fit rounded-full border border-ocean/20 bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
          Est. {formatMoney(day.estimated_cost, currency)}
        </span>
      </div>

      <div className="mt-5 border-t border-[#eee5d7] pt-4">
        <div className="grid gap-3">
          {timelineItems.length ? (
            timelineItems.map((item, index) => (
              <TimelineItemCard key={`${day.day_number}-${item.time}-${item.title}-${index}`} item={item} />
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
    </section>
  );
}

function BuildingDayCard({
  dayNumber,
  date,
  status
}: {
  dayNumber: number;
  date?: string | null;
  status?: string | null;
}) {
  return (
    <section
      id={`day-${dayNumber}`}
      className="roamly-day-print scroll-mt-36 rounded-[1.15rem] border border-dashed border-[#e8dfd0] bg-white/75 px-4 py-4"
    >
      <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
        Day {dayNumber}
        {date ? ` · ${formatTripDate(date)}` : ""}
      </p>
      <h3 className="mt-1 text-lg font-black leading-6 tracking-tight text-ink sm:text-2xl">
        {status === "failed" ? "Failed" : "Building..."}
      </h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
        {status === "failed" ? "This day needs attention. Completed days remain available." : "Roamly is still building this day."}
      </p>
    </section>
  );
}

function sourceShortLabel(label?: string) {
  if (label === "Live price") return "Live";
  if (label === "Recently searched") return "Recent";
  if (label === "User uploaded confirmation") return "Uploaded";
  if (label === "Market estimate") return "Market";
  if (label === "Conservative estimate") return "Planning";
  return "Estimate";
}

function budgetCategoryCards({
  trip,
  itinerary,
  currency
}: {
  trip: RoamlyTripRecord;
  itinerary: RoamlyItinerary;
  currency: string;
}) {
  const estimate = itinerary.estimated_budget_breakdown;
  const confidence = (category: BudgetCategoryConfidence["category"]) =>
    estimate.budget_category_confidence?.find((item) => item.category === category);
  const card = (
    label: string,
    amount: number | null | undefined,
    category: BudgetCategoryConfidence["category"],
    fallback: string,
    note?: string
  ) => {
    const info = confidence(category);
    return {
      label,
      value: typeof amount === "number" && Number.isFinite(amount) ? formatBudgetMoney(amount, currency) : fallback,
      source: sourceShortLabel(info?.label),
      note: note || info?.source || info?.note || ""
    };
  };

  return [
    card("Transport", estimate.selected_transport_estimate_amount, "transport", estimate.transport),
    card(
      "Hotel/stay",
      estimate.selected_hotel_estimate_amount,
      "hotel",
      trip.budget_includes_hotel === false ? "Not in budget" : estimate.lodging
    ),
    card("Tickets/tours", estimate.tickets_tours_estimate_amount, "tickets_tours", estimate.activities),
    card("Food", estimate.food_estimate_amount, "food", estimate.food),
    card("Local movement", estimate.local_transport_estimate_amount, "local_transport", "Verify local transport"),
    card("Buffer", estimate.buffer_estimate_amount, "buffer", estimate.buffer),
    estimate.committed_bookings_amount && estimate.committed_bookings_amount > 0
      ? card("Saved bookings", estimate.committed_bookings_amount, "committed_bookings", "Saved")
      : null
  ].filter((item): item is { label: string; value: string; source: string; note: string } => Boolean(item));
}

function BudgetSummary({
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
  const total = totalEstimateAmount == null ? estimate.total_estimate : formatBudgetMoney(totalEstimateAmount, currency);
  const crossBorderBadges = estimate.cross_border
    ? ["Cross-border trip", "Passport check", estimate.currency_change ? "Currency change" : "", "Border time buffer", "Roaming reminder", "Customs reminder"].filter((label): label is string => Boolean(label))
    : [];
  const cards = budgetCategoryCards({ trip, itinerary, currency });
  const warningTone = estimate.budget_status === "over_budget" ? "border-coral/25 bg-coral/10 text-coral" : "border-ocean/20 bg-ocean/10 text-ocean";

  return (
    <div className="grid gap-4">
      <div className="rounded-[1.15rem] border border-[#e8dfd0] bg-white p-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)] md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Trip estimate</p>
            <p className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-4xl">{total}</p>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              Estimates are separated from live or recently retrieved provider data. Refresh before booking.
            </p>
          </div>
          <div className={`rounded-[1rem] border px-4 py-3 text-sm font-black leading-6 ${warningTone}`}>
            {balance?.text || "Budget target not set. Verify prices before booking."}
          </div>
        </div>
      </div>

      {crossBorderBadges.length ? (
        <div className="flex flex-wrap gap-2 rounded-[1.15rem] border border-sun/30 bg-sun/10 px-4 py-3">
          {crossBorderBadges.filter(Boolean).filter(Boolean).map((label) => (
            <span key={label} className="rounded-full border border-sun/30 bg-white/75 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-amber-800">
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((row) => (
          <article key={row.label} className="rounded-[1rem] border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_10px_28px_rgba(16,32,51,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-black text-ink">{row.label}</p>
              <span className="rounded-full border border-ocean/15 bg-ocean/5 px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.08em] text-ocean">
                {row.source}
              </span>
            </div>
            <p className="mt-2 text-xl font-black tracking-tight text-ink">{row.value}</p>
            {row.note ? <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-500">{row.note}</p> : null}
          </article>
        ))}
      </div>
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
  if (host === "airalo.com" || host.endsWith(".airalo.com")) return true;
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
  return suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || fallback;
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
    if (host === "stay22.com" || host.endsWith(".stay22.com")) return "Stay22";
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
  const affiliate = safeBookingUrl(suggestion.affiliate_url);
  if (category === "hotel") {
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
    ["hotel", "activity", "attraction", "tour", "flight"].includes(categoryValue) &&
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
  return [
    `Source: ${suggestion.provider_or_search_source || suggestion.provider || suggestion.affiliate_provider || "Search link"}`,
    `Verification: ${priceSourceLabel(suggestion)}`,
    suggestion.market_source,
    suggestion.location || suggestion.neighborhood || suggestion.city,
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
  if (category === "attraction" || category === "tour") return link?.hasAffiliateUrl ? "Book activity" : "Search activity";
  if (category === "transport" || category === "car_rental") return link?.hasAffiliateUrl ? "Book transfer" : "Open route";
  if (category === "restaurant") return "View on Google Maps";
  return suggestion.booking_label || "View option";
}

function bookingStatusBadge(category: string, suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const source = priceSourceLabel(suggestion);
  if (source) return source;
  if (category === "restaurant" && suggestion.advance_booking_recommended) return "Reservation recommended";
  if (suggestion.advance_booking_recommended) return "Booking required";
  return "";
}

function validBookingSuggestionForTrip(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const category = bookingCategory(suggestion);
  const title = bookingTitle(suggestion);
  const provider = bookingProvider(suggestion, "");
  if (!title || isBareDomainName(title)) return false;
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
  tripId
}: {
  suggestion: RoamlyItinerary["booking_suggestions"][number];
  trip: RoamlyTripRecord;
  tripId: string;
}) {
  const category = bookingCategory(suggestion);
  const title = bookingTitle(suggestion);
  const link = resolveBookingLink(suggestion, trip);
  if (!link?.href) return null;
  const mapQuery = category === "hotel"
    ? [title, suggestion.neighborhood || suggestion.city || getTripDestinationLabel(trip)].filter(Boolean).join(" ")
    : suggestion.location || suggestion.neighborhood || suggestion.city || title;
  const statusBadge = bookingStatusBadge(category, suggestion);
  const actionLabel = bookingActionLabel(category, suggestion, link);

  return (
    <article className="rounded-2xl border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)]">
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
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{bookingDescription(suggestion)}</p>
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
          <BookingRecommendationButton
            href={link.href}
            label={actionLabel}
            tripId={tripId}
            category={category}
            title={title}
            provider={link.provider}
            hasAffiliateUrl={Boolean(link.hasAffiliateUrl)}
            urlType={link.urlType}
          />
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
  limit: number
) {
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => categories.includes(bookingCategory(suggestion)))
    .filter((suggestion) => !isGenericBookingSuggestion(suggestion))
    .filter((suggestion) => !isImpracticalBookingSuggestion(suggestion))
    .filter((suggestion) => validBookingSuggestionForTrip(suggestion, trip))
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

  const initialActivityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3);
  if (!recommendedActivities.length || initialActivityItems.length >= 2) return suggestions;

  return [
    ...suggestions,
    ...recommendedActivities.filter((activity) => {
      const activityTitle = bookingTitle(activity).toLowerCase();
      return !suggestions.some((suggestion) =>
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
}) {
  const mode = bookingGroupMode(params.itinerary);
  const needsTransport = routeNeedsTransport(params.trip);
  const showFlightFallback =
    needsTransport &&
    params.trip.budget_includes_flights !== false &&
    (!mode || mode === "flight" || mode === "mixed");
  const showFlightItems = params.flightItems.length > 0 && (!mode || mode === "flight" || mode === "mixed");
  const hasRecommendedTransport = Boolean(recommendedTransportFromItinerary(params.itinerary));
  return [
    (showFlightItems || showFlightFallback)
      ? { title: "Flights", fallback: "flight" as const, items: params.flightItems }
      : null,
    (params.hotelItems.length > 0 || params.trip.budget_includes_hotel !== false)
      ? { title: "Hotels", fallback: "hotel" as const, items: params.hotelItems }
      : null,
    (params.activityItems.length > 0 || tripIncludesActivities(params.trip))
      ? { title: "Important activities", fallback: "activity" as const, items: params.activityItems }
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
  const title = category === "flight" ? "Flight search" : category === "hotel" ? "Hotel search" : "Activity search";
  const hasAffiliateUrl = isAffiliateBookingHref(href);
  const provider = providerForBookingHref(href, category === "flight" ? "Travelpayouts" : "Google search");
  return (
    <article className="rounded-[1rem] border border-dashed border-[#e8dfd0] bg-white px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black leading-6 text-ink">{title}</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
            Search current options for the trip dates and verify price, schedule, and availability.
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500">{category === "flight" && href.includes("aviasales.com") ? "Travelpayouts / Aviasales search" : "Search only"}</p>
        </div>
        <BookingRecommendationButton
          href={href}
          label={label}
          tripId={tripId}
          category={category}
          title={title}
          provider={provider}
          hasAffiliateUrl={hasAffiliateUrl}
          urlType={hasAffiliateUrl ? "affiliate" : "normal_search"}
        />
      </div>
    </article>
  );
}

function RecommendedTransportCard({ itinerary, tripId }: { itinerary: RoamlyItinerary; tripId: string }) {
  const recommended = recommendedTransportFromItinerary(itinerary);
  if (!recommended || !recommended.realistic || recommended.availability === "not_available") return null;
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
            <h4 className="mt-2 text-lg font-black leading-6 text-ink">{recommended.title}</h4>
            <p className="mt-1 text-sm font-black text-ink">{transportEstimate(recommended)}</p>
            {recommended.duration_label ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{recommended.duration_label}</p> : null}
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{recommended.why_recommended}</p>
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

function BookingPlan({ itinerary, trip, tripId }: { itinerary: RoamlyItinerary; trip: RoamlyTripRecord; tripId: string }) {
  const suggestions = bookingSuggestionsWithRecommendations(itinerary, trip);
  const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 3);
  const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3);
  const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3);
  const transportItems = curatedBookingSuggestions(suggestions, trip, ["transport", "car_rental"], 2);
  const groups = buildRelevantBookingGroups({ itinerary, trip, flightItems, hotelItems, activityItems, transportItems });

  return (
    <div className="grid gap-5">
      <p className="roamly-no-print rounded-[1rem] border border-sun/30 bg-sun/10 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
        Recommended transport, stays, flights, and important activities. Live prices appear only when a connected provider returned them. {affiliateDisclosure}
      </p>
      <RecommendedTransportCard itinerary={itinerary} tripId={tripId} />
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

function CompactPrintDay({ day, currency }: { day: RoamlyItinerary["daily_itinerary"][number]; currency: string }) {
  const items = buildDisplayTimelineItems(day).slice(0, 6);

  return (
    <section className="roamly-pdf-day">
      <div className="roamly-pdf-day-heading">
        <p>
          Day {day.day_number}
          {day.city ? ` · ${day.city}` : ""}
          {day.date ? ` · ${formatTripDate(day.date)}` : ""}
        </p>
        <span>Est. {formatMoney(day.estimated_cost, currency)}</span>
      </div>
      <h3>{day.title}</h3>
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
  dayCount
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
}) {
  const recommendedTransport = recommendedTransportFromItinerary(itinerary);
  const suggestions = bookingSuggestionsWithRecommendations(itinerary, trip);
  const hotelItems = curatedBookingSuggestions(suggestions, trip, ["hotel"], 3);
  const flightItems = curatedBookingSuggestions(suggestions, trip, ["flight"], 2);
  const activityItems = curatedBookingSuggestions(suggestions, trip, ["attraction", "tour", "activity"], 3);
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
          <PrintInfoCell label="Dates" value={formatDateRange(trip)} />
          <PrintInfoCell label="Travellers" value={travelerSummary(trip)} />
          <PrintInfoCell label="Days" value={dayCount ? `${dayCount} days` : "Flexible"} />
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
                    <span>{[item.neighborhood || item.location, item.room_type, item.why_recommended].filter(Boolean).join(" · ")}</span>
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
          <CompactPrintDay key={`print-day-${day.day_number}`} day={day} currency={currency} />
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
                    <span>{[booking.provider_name, booking.start_date, booking.start_time].map((item) => getString(item)).filter(Boolean).join(" · ")}</span>
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

  const { trip, itinerary, days, activities, checklist } = bundleResult.data;
  const destinationLabel = getTripDestinationLabel(trip) || "your destination";
  const currency = getTripBudgetCurrency(trip);
  const baseFull = itinerary?.full_json || null;
  const localizedItinerary = baseFull ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: baseFull, locale }) : null;
  const full = localizedItinerary?.itinerary
    ? enrichItineraryBookingSuggestions(localizedItinerary.itinerary, savedTripPayload(trip, locale))
    : null;
  const displayedItineraryLanguage = localizedItinerary?.language || getTripItineraryLanguage(trip.metadata);
  const itineraryLocked = isTripLocked(trip);
  const generationProgress = publicStagedGenerationProgress(trip.metadata, id);
  const generationStatus = generationProgress?.status || "";
  const generationFailed = generationStatus === "failed" || generationStatus === "partially_failed";
  const preview = full ? localizedItinerary?.preview || buildPreviewFromItinerary(full) : itinerary?.preview_json || null;
  const canonicalDays = full?.daily_itinerary || [];
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
  const trackingUnlocked = tripHasTrackingUnlock(trip) || (access.hasQaAccess && itineraryLocked);
  const paidForItinerary = isItineraryPaid(trip) || access.hasQaAccess;
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
  const maskedEmail = maskEmailAddress(current.user.email);
  const backgroundWorkerConfigured = Boolean(process.env.ROAMLY_GENERATION_CRON_SECRET || process.env.CRON_SECRET);

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
    <main className="safe-bottom roamly-print-document w-full bg-[#fbf8ef] px-4 pb-24 pt-5 text-ink sm:px-6 sm:py-8">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <div className="roamly-print-paper mx-auto max-w-6xl">
        <div className="roamly-screen-document">
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
                  {canShowFull
                    ? "Generated itinerary"
                    : itineraryLocked
                      ? "Locked itinerary"
                    : generationFailed
                        ? "Generation failed"
                        : generationPanelVisible
                          ? "Generating itinerary"
                        : paidForItinerary
                          ? "Ready to generate"
                          : freeAvailable
                            ? "Free itinerary available"
                            : "Payment required"}
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
              {generationPanelVisible && generationProgress ? (
                <StagedGenerationProgress
                  tripId={id}
                  initialProgress={generationProgress}
                  emailConfigured={emailConfigured}
                  maskedEmail={maskedEmail}
                  backgroundWorkerConfigured={backgroundWorkerConfigured}
                  apiAuthToken={apiAuthToken}
                />
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

          {!generationPanelVisible ? (
            <div className="roamly-no-print mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
              <PrimaryTripAction
                tripId={id}
                itineraryLocked={itineraryLocked}
                generationInProgress={generationInProgress}
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
          ) : null}
        </section>

        {canShowFull && full && !generationPanelVisible ? (
          <>
            <div className="roamly-tabs mt-4">
              <style>{`
                .roamly-tab-input{position:absolute;opacity:0;pointer-events:none}
                .roamly-tab-panel{display:none}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-panels .roamly-panel-day-by-day,
                #roamly-tab-overview:checked ~ .roamly-tab-panels .roamly-panel-overview,
                #roamly-tab-budget:checked ~ .roamly-tab-panels .roamly-panel-budget,
                #roamly-tab-bookings:checked ~ .roamly-tab-panels .roamly-panel-bookings,
                #roamly-tab-essentials:checked ~ .roamly-tab-panels .roamly-panel-essentials,
                #roamly-tab-travel-notes:checked ~ .roamly-tab-panels .roamly-panel-travel-notes{display:block}
                #roamly-tab-day-by-day:checked ~ .roamly-tab-nav label[for="roamly-tab-day-by-day"],
                #roamly-tab-overview:checked ~ .roamly-tab-nav label[for="roamly-tab-overview"],
                #roamly-tab-budget:checked ~ .roamly-tab-nav label[for="roamly-tab-budget"],
                #roamly-tab-bookings:checked ~ .roamly-tab-nav label[for="roamly-tab-bookings"],
                #roamly-tab-essentials:checked ~ .roamly-tab-nav label[for="roamly-tab-essentials"],
                #roamly-tab-travel-notes:checked ~ .roamly-tab-nav label[for="roamly-tab-travel-notes"]{background:#102033;color:white;border-color:#102033}
                .roamly-day-input{position:absolute;opacity:0;pointer-events:none}
                .roamly-day-panel{display:none}
                ${dayNumbersToRender.map((dayNumber) => `
                  #roamly-day-${dayNumber}:checked ~ .roamly-day-nav label[for="roamly-day-${dayNumber}"]{background:#102033;color:white;border-color:#102033}
                  #roamly-day-${dayNumber}:checked ~ .roamly-day-panels .roamly-day-panel-${dayNumber}{display:block}
                `).join("\n")}
                @media print{.roamly-tab-panel,.roamly-day-panel{display:block!important}.roamly-tab-nav,.roamly-day-nav{display:none!important}}
              `}</style>
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-day-by-day" defaultChecked />
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-overview" />
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-budget" />
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-bookings" />
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-essentials" />
              <input className="roamly-tab-input" type="radio" name="roamly-completed-tab" id="roamly-tab-travel-notes" />

              <nav className="roamly-tab-nav roamly-no-print sticky top-[4.25rem] z-20 -mx-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fffdf8]/95 px-4 py-2 backdrop-blur sm:top-[5.15rem] sm:mx-0 sm:rounded-full sm:border sm:px-3 sm:py-3">
                <div className="flex min-w-max gap-2">
                  {[
                    ["roamly-tab-day-by-day", "Day-by-day"],
                    ["roamly-tab-overview", "Overview"],
                    ["roamly-tab-budget", "Budget"],
                    ["roamly-tab-bookings", "Bookings"],
                    ["roamly-tab-essentials", "Essentials"],
                    ["roamly-tab-travel-notes", "Travel notes"]
                  ].map(([tabId, label]) => (
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
                <section id="day-by-day" className="roamly-tab-panel roamly-panel-day-by-day mt-8 scroll-mt-32">
                  <SectionHeading
                    eyebrow="Day-by-day"
                    title="Your itinerary"
                    summary="Clean daily plan with timing, travel, and key notes."
                  />
                  <div>
                    {dayNumbersToRender.map((dayNumber, index) => (
                      <input
                        key={`day-input-${dayNumber}`}
                        className="roamly-day-input"
                        type="radio"
                        name="roamly-day-selector"
                        id={`roamly-day-${dayNumber}`}
                        defaultChecked={index === 0}
                      />
                    ))}
                    <nav className="roamly-day-nav roamly-no-print sticky top-[8.2rem] z-10 -mx-4 mb-4 overflow-x-auto border-y border-[#e8dfd0] bg-[#fbf8ef]/95 px-4 py-2 backdrop-blur sm:top-[9.2rem] sm:mx-0 sm:rounded-full sm:border">
                      <div className="flex min-w-max gap-2">
                        {dayNumbersToRender.map((dayNumber) => (
                          <label
                            key={dayNumber}
                            htmlFor={`roamly-day-${dayNumber}`}
                            className="min-h-11 cursor-pointer rounded-full border border-[#e8dfd0] bg-white px-4 py-3 text-xs font-black text-slate-600 transition hover:border-ocean/30 hover:text-ocean"
                          >
                            Day {dayNumber}
                            {!canonicalDayByNumber.has(dayNumber) ? generationFailed ? " · Failed" : " · Building" : ""}
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
                              <DayTimelineCard day={day} currency={currency} />
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
                  <SectionHeading eyebrow="Overview" title="Trip summary" summary="Only the essentials." />
                  <div className="grid gap-3 md:grid-cols-3">
                    <SummaryTile label="Best for" value={full.best_for.slice(0, 3).join(" · ") || travelStyle} />
                    <SummaryTile label="Budget" value={compact(full.budget_fit_summary, "Verify prices before booking.", 130)} />
                    <SummaryTile label="Transport" value={compact(full.transport_overview, "Travel time is included in the plan.", 130)} />
                  </div>
                </section>

                <section id="budget" className="roamly-tab-panel roamly-panel-budget mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Budget" title="Budget" summary="A concise category summary with one total." />
                  <BudgetSummary trip={trip} itinerary={full} currency={currency} />
                </section>

                <section id="bookings" className="roamly-tab-panel roamly-panel-bookings mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Bookings" title="Recommended bookings" summary="Only the recommended transport, stay, flights, and important activities." />
                  <div className="mb-4">
                    <MarketPriceRefreshButton tripId={id} />
                  </div>
                  <BookingPlan itinerary={full} trip={trip} tripId={id} />
                  <details className="roamly-no-print mt-5 rounded-2xl border border-[#e8dfd0] bg-white px-4 py-3">
                    <summary className="cursor-pointer text-sm font-black text-ocean">Confirmed bookings and imports</summary>
                    <div className="mt-4 grid gap-4">
                      <BookingSummaryList bookings={importedBookings as Array<Record<string, unknown>>} />
                      <TripBookingsManager tripId={id} initialBookings={importedBookings} />
                    </div>
                  </details>
                </section>

                <section id="essentials" className="roamly-tab-panel roamly-panel-essentials scroll-mt-32">
                  <PreTripEssentialsSection essentials={full.pre_trip_essentials || []} tripId={id} />
                </section>

                <section id="travel-notes" className="roamly-tab-panel roamly-panel-travel-notes mt-8 scroll-mt-32">
                  <SectionHeading eyebrow="Notes" title="Travel notes" />
                  <div className="grid gap-4 md:grid-cols-2">
                    <ChecklistGroup
                      title="Packing"
                      items={packingChecklistItems(checklist, full).slice(0, 8)}
                    />
                    <ChecklistGroup title="Local tips" items={full.local_tips.slice(0, 6)} />
                  </div>
                  <details className="mt-4 rounded-2xl border border-[#e8dfd0] bg-white px-4 py-3">
                    <summary className="cursor-pointer text-sm font-black text-ocean">More notes</summary>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <ChecklistGroup title="Safety" items={full.safety_notes.slice(0, 6)} />
                      <ChecklistGroup
                        title="Documents"
                        items={getStringList(trip.document_checklist, ["Passport/ID", "Booking confirmations", "Travel insurance details"], 6)}
                      />
                      <ChecklistGroup title="Emergency" items={full.emergency_notes.slice(0, 6)} />
                      <ChecklistGroup
                        title="Low-cost reminders"
                        items={full.free_or_low_cost_notes.length ? full.free_or_low_cost_notes.slice(0, 5) : ["Keep a buffer for weather, taxis, and spontaneous stops."]}
                      />
                    </div>
                  </details>
                </section>
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
            bookings={importedBookings as Array<Record<string, unknown>>}
            tripTitle={tripTitle}
            destinationLabel={destinationLabel}
            currency={currency}
            budgetDisplay={budgetDisplay}
            travelStyle={travelStyle}
            dayCount={dayCount}
          />
        ) : null}
      </div>
    </main>
  );
}
