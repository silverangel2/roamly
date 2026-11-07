import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { dedupeEquivalentNotifications, isStalePreTripInfoNotification, notificationActionState, notificationActionStateForInfoCard } from "@/lib/roamly/liveCompanion";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer";
import { UNKNOWN_TZ_LABEL, zoneForMath } from "@/lib/roamly/tripTimezone";
import { formatTripDateRange, tripClockState } from "@/lib/roamly/tripClock";
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";
import { TripHeroCard } from "@/components/roamly/TripHeroCard";
import { AlertsSectionCard, type AlertsSectionRow } from "@/components/roamly/AlertsSectionCard";
import { NotificationShellStateBridge } from "@/components/roamly/NotificationShellStateBridge";
import { isOpenNotificationTrip, selectNotificationTrip } from "@/lib/roamly/notificationTrip";
import { resolveRoamlySelectedTrip } from "@/lib/roamly/selectedTrip";
import { getActiveOrUpcomingTrip } from "@/lib/roamly/tripActivation";
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";
import { suppressedCancelledNotifications } from "@/lib/roamly/notificationBookingAttribution";
import { countAlertsBadgeNotifications } from "@/lib/roamly/alertsBadge";
import { looksLikeProviderSearchTitle } from "@/lib/roamly/itineraryPresentation";
import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { getTripDestinationLabel, getTripOriginLabel, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";
import { getTripWeather } from "@/lib/roamly/tripWeather";
import {
  bookingProvenanceSuffix,
  bookingTruthState,
  isConfirmed as bookingTruthIsConfirmed,
  isInactiveTruthState,
  isTravelerConfirmedOnly as bookingTruthIsTravelerConfirmedOnly,
  type BookingTruthState
} from "@/lib/roamly/bookingTruth";

/*
 * PICTURE 1 — Alerts (owner picture, top-left panel of
 * screenshots-latest/correct-4-pages.jpg, followed literally).
 * This screen is EXACTLY: header (Alerts + gear) + trip hero card +
 * three sections (Action required / Upcoming / Travel updates) + the
 * app tab bar (rendered by the shell, not here). Nothing below Travel
 * updates. Legacy blocks that used to live on this screen — the Live
 * Trip Companion ready banner, the active-trip panel, travel legs,
 * Nearby, the current-day timeline, Up next, checked activities, the
 * trip-events feed, the companion explanatory paragraphs, and the
 * no-trip fallback card — are REMOVED from this
 * screen (recorded in the Picture 1 report, not deleted from the
 * codebase: the components still serve the Live surface).
 *
 * Data rule: structure, order, and row copy match the picture; every
 * VALUE is real and dynamic (selected trip, real dates, real counts
 * from real rows, real confirmed bookings). The picture's sample
 * values (its weather numbers, its hotel, its times) are NEVER copied
 * as live values. Weather is served by the one weather module
 * (lib/roamly/tripWeather, Open-Meteo — Fix 4), and its row keeps
 * the picture's exact position and format with the module's honest
 * states (real headline / forecast-window / unavailable).
 */

/* Info reminders open the single-event sheet (same info-type set the
   timeline card uses). The set lives in
   lib/roamly/alertsNotificationTypes.ts so the tab-bar badge shares
   this exact definition (conditional-acceptance item 2). */
function normalizedFeedValue(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/* Round 2 Alerts sections: a notification item becomes a mock-style row.
   The link mirrors the timeline card exactly (info items open
   their event sheet when one exists; action items keep their deep link
   only while actionable) — no invented destinations. */
type SectionNotificationItem = {
  id: string;
  title: string;
  body?: string | null;
  type: string;
  trip_id?: string | null;
  event_id?: string | null;
  action_url?: string | null;
  action_state?: string;
};

function notificationSectionHref(item: SectionNotificationItem): string | null {
  if (item.action_state === "history" || item.action_state === "unavailable") return null;
  if (INFO_NOTIFICATION_TYPES.has(item.type) && item.trip_id && item.event_id) {
    return `/trip/${item.trip_id}/event/${item.event_id}`;
  }
  if (!INFO_NOTIFICATION_TYPES.has(item.type) && item.action_url) return item.action_url;
  return null;
}

function notificationSectionRow(
  item: SectionNotificationItem,
  icon: AlertsSectionRow["icon"]
): AlertsSectionRow {
  return {
    id: item.id,
    title: item.title,
    body: item.body || null,
    href: notificationSectionHref(item),
    icon
  };
}

/* Real booking start, formatted in the trip's timezone. Null when the
   booking carries no usable start — the row then says "Time to confirm"
   rather than inventing one. */
function bookingStartLabel(booking: Record<string, unknown>, timezone: string | null): string | null {
  const startAt = typeof booking.start_at === "string" ? booking.start_at : null;
  if (startAt) {
    const date = new Date(startAt);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: timezone || undefined
      }).format(date);
    }
  }
  const dateValue = typeof booking.start_date === "string" ? booking.start_date : null;
  if (!dateValue) return null;
  const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
  const timeValue = typeof booking.start_time === "string" ? booking.start_time : null;
  const timeMatch = timeValue ? timeValue.match(/^(\d{1,2}):(\d{2})/) : null;
  if (!timeMatch) return datePart;
  const hour = Number(timeMatch[1]);
  const minute = timeMatch[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${datePart} · ${hour12}:${minute} ${suffix}`;
}

/* Real booking date range from its stored date columns only (never the
   trip dates, never the picture's sample range). Null when no usable
   start date exists. */
function bookingDateRangeLabel(booking: Record<string, unknown>): string | null {
  const startDate = typeof booking.start_date === "string" ? booking.start_date : null;
  const endDate = typeof booking.end_date === "string" ? booking.end_date : null;
  if (!startDate) return null;
  return formatTripDateRange(startDate, endDate) || null;
}

/**
 * Workstream A + Round 2 Lane E2: Alerts booking-derived rows derive
 * from the ONE booking-truth rule (lib/roamly/bookingTruth). The old
 * local OR rule (traveler_confirmed OR an active-family status)
 * promoted email-manufactured statuses to "confirmed" on this page.
 * "Confirmed" rows are now the providerConfirmationEvidence tier
 * ONLY (owner ruling 2026-10-30) and carry their provenance (Round 3,
 * Lane T); travelerConfirmedOnly rows render with the honest
 * "confirmed by you" wording.
 */
function bookingTruthInput(booking: Record<string, unknown>) {
  return {
    booking_status: typeof booking.booking_status === "string" ? booking.booking_status : null,
    traveler_confirmed: booking.traveler_confirmed === true,
    confirmation_number: typeof booking.confirmation_number === "string" ? booking.confirmation_number : null,
    provider_booking_id: typeof booking.provider_booking_id === "string" ? booking.provider_booking_id : null,
    provider_name: typeof booking.provider_name === "string" ? booking.provider_name : null,
    title: typeof booking.title === "string" ? booking.title : null,
    source_type: typeof booking.source_type === "string" ? booking.source_type : null,
    source_reference: typeof booking.source_reference === "string" ? booking.source_reference : null,
    superseded_by_booking_id: (booking.superseded_by_booking_id as string | null) ?? null,
    metadata:
      booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
        ? (booking.metadata as Record<string, unknown>)
        : null,
    reservation_requirements:
      booking.reservation_requirements && typeof booking.reservation_requirements === "object" && !Array.isArray(booking.reservation_requirements)
        ? (booking.reservation_requirements as Record<string, unknown>)
        : null
  };
}

function isConfirmedBooking(booking: Record<string, unknown>): boolean {
  return bookingTruthIsConfirmed(bookingTruthInput(booking));
}

function isTravelerConfirmedOnlyBooking(booking: Record<string, unknown>): boolean {
  return bookingTruthIsTravelerConfirmedOnly(bookingTruthInput(booking));
}

function bookingTruthForRecord(booking: Record<string, unknown>): BookingTruthState {
  return bookingTruthState(bookingTruthInput(booking));
}

const RAW_ISO_IN_BODY = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/**
 * X1 read path for already-persisted notification rows: a stored
 * booking-reminder body can embed a raw ISO timestamp (the audit's
 * I6 leak — new bodies are formatted at creation in tripCompanion,
 * but stored rows render verbatim here). Replace any raw ISO instant
 * in a rendered body with a formatted date in the trip's timezone;
 * an unparseable token is dropped rather than leaked raw.
 */
function sanitizeStoredNotificationBody(body: unknown, timezone: string | null): string | null {
  if (typeof body !== "string" || !body) return null;
  return body.replace(RAW_ISO_IN_BODY, (token) => {
    const date = new Date(token);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || undefined
    }).format(date);
  });
}

function bookingTypeLabel(booking: Record<string, unknown>): string {
  const type = String(booking.booking_type || "").trim().toLowerCase();
  return type === "flight" ? "Flight" : type === "hotel" ? "Hotel" : "Booking";
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read ?trip= before any redirect so a signed-out tap on Alerts
  // from a trip screen returns to that same trip after sign-in.
  const resolvedSearch = searchParams ? await searchParams : {};
  const requestedTripId = typeof resolvedSearch.trip === "string" ? resolvedSearch.trip : null;
  const loginNext = requestedTripId ? `/notifications?trip=${encodeURIComponent(requestedTripId)}` : "/notifications";
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(loginNext)}`);

  if (!current.configured || !current.user) {
    return (
      <div className="calm-bleed mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Alerts</h1>
        <div className="bui-enter mt-5 rounded-bui-card border border-chair bg-white p-4 shadow-bui-card">
          <h2 className="text-[22px] font-bold tracking-[-0.018em] text-chead">Notifications need an account.</h2>
          <div className="mt-4">
            <a className="bui-press bui-touch inline-flex min-h-[50px] items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white" href={`/login?next=${encodeURIComponent(loginNext)}`}>Log in</a>
          </div>
        </div>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  // Trip first, then notifications scoped to THAT trip. The old shape
  // fetched the newest 20 rows across all trips and filtered to the
  // selected trip afterwards, which crowded the selected trip out
  // entirely whenever its rows fell outside the global newest 20
  // (proven live on the tester account: cutoff 15s newer than the
  // trip's newest row, sections rendered empty). Per-trip cap 100
  // keeps the query bounded while covering a trip's full history.
  const tripRows = await supabase.from("roamly_trips").select("*").eq("user_id", current.user.id).order("start_date", { ascending: false }).limit(40);
  // Repair round P2 — ONE selected-trip resolution, shared with the
  // shell badge: the ?trip= id wins when it names an OPEN trip of
  // this user (direct row fetch, so an open trip outside the 40-row
  // list window still wins); otherwise the established rule applies.
  // An unknown, foreign, cancelled, or archived id never renders
  // another trip's alerts — it falls back to the rule trip. The
  // shell's Alerts tab carries ?trip= from the viewed trip, so
  // tapping Alerts on a Toronto screen shows Toronto, not the
  // rule's Montreal — the old divergence, closed.
  const requestedTripRow = requestedTripId
    ? await supabase.from("roamly_trips").select("*").eq("user_id", current.user.id).eq("id", requestedTripId).maybeSingle()
    : null;
  const requestedTrip = requestedTripRow?.data as TrackingTrip | null;
  // Lane N round 2 (F4): this page now resolves through the ONE
  // shared resolver (lib/roamly/selectedTrip.ts) — the same module
  // the tab bar consumes — instead of its own inline
  // requested-else-rule branch. Priority: the ?trip= route param
  // (direct row above, so an open trip outside the 40-row window
  // still wins) > companion-active > the notification rule. The
  // companion id comes from getActiveOrUpcomingTrip — the exact
  // source behind /api/roamly/trips/active, which is what the shell
  // feeds the same resolver — so both sides mean the same trip by
  // "companion-active". The trailing selectNotificationTrip call is
  // the resolver's own rule step restated as a null-guard; it
  // cannot return a different trip.
  const companionTripResult = await getActiveOrUpcomingTrip(supabase, current.user.id);
  const trip = resolveRoamlySelectedTrip({
    trips: (tripRows.data || []) as TrackingTrip[],
    routeTripId: requestedTripId,
    routeTrip: requestedTrip && isOpenNotificationTrip(requestedTrip) ? requestedTrip : null,
    companionTripId: companionTripResult.trip?.id ?? null
  }).trip ?? selectNotificationTrip((tripRows.data || []) as TrackingTrip[]);
  const notifications = trip
    ? await supabase
        .from("roamly_notifications")
        .select("id,trip_id,event_id,title,body,type,status,action_url,created_at,scheduled_for,metadata")
        .eq("user_id", current.user.id)
        .eq("trip_id", trip.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };

  const notificationTripIds = [...new Set((notifications.data || []).map((item) => item.trip_id).filter((id): id is string => Boolean(id)))];
  const tripRowsResult = notificationTripIds.length
    ? await supabase
        .from("roamly_trips")
        .select("id,status,itinerary_status,start_date,end_date,metadata,destination,destination_name,destination_city")
        .eq("user_id", current.user.id)
        .in("id", notificationTripIds)
    : { data: [], error: null };
  const tripById = new Map((tripRowsResult.data || []).map((row) => [row.id, row]));
  const notificationItems = dedupeEquivalentNotifications(notifications.data || []).filter((notification) => trip ? notification.trip_id === trip.id : false).map((notification) => {
    const relatedTrip = notification.trip_id ? tripById.get(notification.trip_id) : null;
    const lifecycleTrip = relatedTrip ? {
      status: relatedTrip.status,
      itineraryStatus: relatedTrip.itinerary_status,
      startDate: relatedTrip.start_date,
      endDate: relatedTrip.end_date,
      metadata: relatedTrip.metadata
    } : null;
    // Info cards go through the same lifecycle gate as action cards now;
    // other cards keep the existing gate.
    const actionState = INFO_NOTIFICATION_TYPES.has(notification.type)
      ? notificationActionStateForInfoCard({ actionUrl: notification.action_url, trip: lifecycleTrip })
      : notificationActionState({ actionUrl: notification.action_url, trip: lifecycleTrip });
    const isOutdated = relatedTrip ? isStalePreTripInfoNotification({
      type: notification.type,
      startDate: relatedTrip.start_date,
      endDate: relatedTrip.end_date,
      // Timezone round: the outdated gate resolves through the ONE
      // resolver (metadata + destination registry), not metadata-only.
      timezone: zoneForMath(resolveTripTimezoneServer({
        metadata: relatedTrip.metadata,
        destination: relatedTrip.destination,
        destination_name: relatedTrip.destination_name,
        destination_city: relatedTrip.destination_city
      }))
    }) : false;
    return {
      ...notification,
      action_url: actionState === "available" ? notification.action_url : null,
      action_state: actionState,
      is_outdated: isOutdated
    };
  });

  if (!trip) {
    return (
      <div className="calm-bleed mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <NotificationShellStateBridge activeTripId="" unreadCount={0} />
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Alerts</h1>
        <div className="bui-enter mt-5 rounded-bui-card border border-chair bg-white p-4 shadow-bui-card">
          <h2 className="text-[22px] font-bold tracking-[-0.018em] text-chead">No current trip to show.</h2>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Reminders and check-ins stay with the trip they belong to. Open a trip to see its own updates.
          </p>
          <div className="mt-4">
            <a className="bui-press bui-touch inline-flex min-h-[50px] items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white" href="/dashboard">Open dashboard</a>
          </div>
        </div>
      </div>
    );
  }

  // Timezone round (2026-10-26): ONE resolution for the hero clock,
  // the Upcoming past-event exclusion, and the booking labels below —
  // stored metadata first, then the verified destination registry.
  // The old metadata-only lookup silently fell back to UTC, which
  // excluded/shifted event dates after 20:00 destination-local time.
  // When the zone is genuinely unknown, dates compute in UTC only as
  // the LABELED fallback (the label renders under the hero).
  const tripTimezoneResolution = resolveTripTimezoneServer({
    metadata: trip.metadata,
    destination: getTripDestinationLabel(trip),
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  });
  const tripTimezone = zoneForMath(tripTimezoneResolution);
  const tripTimezoneUnknown = !tripTimezoneResolution.known;
  const origin = getTripOriginLabel(trip);
  const destination = getTripDestinationLabel(trip) || trip.destination_city || trip.destination_name || "";

  // Picture order for Action required: document, weather, packing.
  // Titles are the picture's row titles; bodies stay the real
  // notification bodies, falling back to the picture's generic
  // instruction only when a body is empty (never a live value).
  const documentRows = notificationItems
    .filter((item) => item.type === "document_check" && item.action_state !== "history")
    .map((item) => notificationSectionRow({
      ...item,
      title: "Review travel documents",
      body: sanitizeStoredNotificationBody(item.body, tripTimezone) || "Make sure your ID, flights and hotel confirmation are ready."
    } as SectionNotificationItem, "document"));
  const packingRows = notificationItems
    .filter((item) => item.type === "packing_check" && item.action_state !== "history")
    .map((item) => notificationSectionRow({
      ...item,
      title: "Pack for your trip",
      body: sanitizeStoredNotificationBody(item.body, tripTimezone) || "Personalized packing checklist is ready."
    } as SectionNotificationItem, "packing"));
  // Weather row (consolidation 2026-11-06, Block H): this page
  // still carried the pre-Fix-4 residue — a permanent "not
  // available" line written when weather had no provider. Since
  // Fix 4 the ONE weather module (lib/roamly/tripWeather,
  // Open-Meteo) serves display, and this row now mirrors its
  // honest states exactly: a real headline when a forecast
  // exists, the forecast-window line when the trip is too far
  // out, and the quiet unavailable line only when there is
  // genuinely nothing to show. Never an invented value.
  const alertsPlanning = getTripPlanningMetadata(trip.metadata);
  const alertsWeather =
    typeof alertsPlanning.destinationLatitude === "number" &&
    Number.isFinite(alertsPlanning.destinationLatitude) &&
    typeof alertsPlanning.destinationLongitude === "number" &&
    Number.isFinite(alertsPlanning.destinationLongitude) &&
    trip.start_date &&
    trip.end_date
      ? await getTripWeather({
          latitude: alertsPlanning.destinationLatitude,
          longitude: alertsPlanning.destinationLongitude,
          startDate: trip.start_date,
          endDate: trip.end_date
        }).catch(() => null)
      : null;
  const weatherUnavailableRow: AlertsSectionRow =
    alertsWeather?.kind === "ready"
      ? {
          id: "weather-ready",
          title: "Check weather",
          body: `${alertsWeather.headline.label}: ${alertsWeather.headline.conditionLabel}, ${alertsWeather.headline.tMinC}–${alertsWeather.headline.tMaxC}°C · Open-Meteo`,
          href: `/trip/${trip.id}`,
          icon: "weather"
        }
      : alertsWeather?.kind === "past"
        ? {
            id: "weather-past",
            title: "Check weather",
            body: "This trip has finished — there is no forecast to check.",
            href: null,
            icon: "weather"
          }
      : alertsWeather?.kind === "too-early"
        ? {
            id: "weather-too-early",
            title: "Check weather",
            body: "Forecast appears about two weeks before your trip — this trip starts further out than the forecast reaches.",
            href: null,
            icon: "weather"
          }
        : {
            id: "weather-unavailable",
            title: "Check weather",
            body: "Weather is not available for this trip yet.",
            href: null,
            icon: "weather"
          };
  const travelUpdateItems = notificationItems.filter((item) => item.action_state !== "history" && !INFO_NOTIFICATION_TYPES.has(item.type));
  const travelUpdateNotificationRows = travelUpdateItems.map((item) =>
    notificationSectionRow(
      {
        ...item,
        // X1 read path: never render a stored body verbatim — a raw
        // ISO instant embedded in an old reminder is formatted (or
        // dropped) before it reaches the traveler.
        body: sanitizeStoredNotificationBody(item.body, tripTimezone) ?? item.body
      } as SectionNotificationItem,
      item.type.includes("booking") ? "booking" : "update"
    )
  );

  // Booking rows are graded by bookingTruth: confirmation-evidence
  // rows pose as confirmed bookings; travelerConfirmedOnly rows pose only
  // as the traveler's own confirmation. Unconfirmed or suggested
  // bookings never pose as upcoming departures or confirmed bookings.
  const bookingRows = await supabase
    .from("roamly_bookings")
    .select("id,booking_type,category,booking_status,title,start_at,start_date,end_date,start_time,traveler_confirmed,provider_name,confirmation_number,provider_booking_id,source_type,source_reference,reservation_requirements,superseded_by_booking_id,metadata")
    .eq("trip_id", trip.id)
    .eq("user_id", current.user.id);
  const allTripBookings = (bookingRows.data || []) as Array<Record<string, unknown>>;
  const flightOrHotel = (booking: Record<string, unknown>) => {
    const type = String(booking.booking_type || "").trim().toLowerCase();
    return type === "flight" || type === "hotel";
  };
  // Confirmation-evidence ONLY (owner ruling 2026-10-30).
  const confirmedBookings = allTripBookings.filter(isConfirmedBooking).filter(flightOrHotel);
  // Traveler-confirmed only: still the traveler's own upcoming
  // travel (Upcoming rows carry no verification claim), but its
  // Travel-updates row is worded "confirmed by you", never
  // "booking confirmed".
  const travelerConfirmedBookings = allTripBookings.filter(isTravelerConfirmedOnlyBooking).filter(flightOrHotel);

  // X1 READ path (Workstream A): persisted notification rows are
  // never re-checked against booking status by any writer except the
  // X1 write paths, so this page suppresses at RENDER time (rows are
  // never deleted — audit history is preserved). Suppressed from the
  // travel-updates feed:
  //  - rows explicitly marked withdrawn in metadata (written by the
  //    wallet-cancel / booking-monitor paths);
  //  - rows whose companion event links them to a booking whose
  //    CURRENT truth is cancelled/refunded/superseded/test
  //    (roamly_notifications has no booking_id column; the strongest
  //    available link is event_id → roamly_trip_companion_events,
  //    whose booking_id names the booking);
  //  - booking-typed rows whose title exactly matches a currently
  //    inactive booking's title (fallback for rows with no event
  //    link);
  //  - Round 3 (Lane N, X1 residual): pre-fix rows with no link and
  //    no exact title match are additionally suppressed ONLY under
  //    the conservative multi-signal attribution in
  //    lib/roamly/notificationBookingAttribution (cancelled/refunded
  //    candidate + fuzzy title with provider/window corroboration,
  //    or provider + window together, with an active-booking
  //    ambiguity veto). A row that cannot be reliably attributed is
  //    still left rendering — precision over recall, see lane note.
  //  The attribution itself lives in that pure module so the exact
  //  rule this page renders by is fixture-tested; this page only
  //  supplies the rows it already fetched.
  const inactiveBookings = allTripBookings.filter((booking) =>
    isInactiveTruthState(bookingTruthForRecord(booking))
  );
  const inactiveBookingIds = new Set(
    inactiveBookings.map((booking) => (typeof booking.id === "string" ? booking.id : "")).filter(Boolean)
  );
  const companionEventRows = await supabase
    .from("roamly_trip_companion_events")
    .select("id,booking_id")
    .eq("trip_id", trip.id)
    .eq("user_id", current.user.id)
    .not("booking_id", "is", null);
  const eventBookingById = new Map<string, string>();
  for (const eventRow of (companionEventRows.data || []) as Array<Record<string, unknown>>) {
    if (typeof eventRow.id === "string" && typeof eventRow.booking_id === "string") {
      eventBookingById.set(eventRow.id, eventRow.booking_id);
    }
  }
  const suppressedNotificationIds = new Set(
    suppressedCancelledNotifications({
      notifications: travelUpdateItems,
      bookings: allTripBookings,
      eventBookingById
    }).keys()
  );
  const upcomingBookingRows: AlertsSectionRow[] = [...confirmedBookings, ...travelerConfirmedBookings]
    .map((booking) => {
      const type = String(booking.booking_type || "").trim().toLowerCase();
      const startSort = typeof booking.start_at === "string" && booking.start_at
        ? booking.start_at
        : typeof booking.start_date === "string" ? booking.start_date : "9999";
      const title = typeof booking.title === "string" && booking.title.trim() ? booking.title.trim() : "";
      return {
        sort: startSort,
        row: {
          id: `booking-${type}-${title}-${startSort}`,
          title: type === "flight"
            ? (origin ? `Departure from ${origin}` : "Departure")
            : `Check in · ${title || "Hotel"}`,
          body: bookingStartLabel(booking, tripTimezone) || "Time to confirm",
          href: null,
          icon: type === "flight" ? "departure" as const : "checkin" as const
        } satisfies AlertsSectionRow
      };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map((entry) => entry.row);

  // Travel updates, picture shape: a confirmation-evidence booking
  // renders as "<Type> booking confirmed · <provenance>" with its
  // real title + real date range. A travelerConfirmedOnly booking
  // renders as "<Type> booking confirmed by you" — the traveler's
  // own confirmation. A notification row carrying the
  // same confirmation title is the same event, not a second row, so
  // it is dropped by title match.
  const travelUpdateBookingRows: AlertsSectionRow[] = [
    ...confirmedBookings.map((booking) => ({ booking, travelerOnly: false })),
    ...travelerConfirmedBookings.map((booking) => ({ booking, travelerOnly: true }))
  ]
    .map(({ booking, travelerOnly }) => {
      const typeLabel = bookingTypeLabel(booking);
      const title = typeof booking.title === "string" && booking.title.trim() ? booking.title.trim() : "";
      const dateRange = bookingDateRangeLabel(booking);
      const bodyParts = [title, dateRange].filter((part): part is string => Boolean(part));
      const startSort = typeof booking.start_at === "string" && booking.start_at
        ? booking.start_at
        : typeof booking.start_date === "string" ? booking.start_date : "9999";
      return {
        sort: startSort,
        row: {
          id: `booking-${travelerOnly ? "traveler-confirmed" : "confirmed"}-${String(booking.booking_type || "").toLowerCase()}-${title}-${startSort}`,
          // Round 3 (Lane T): the confirmation-evidence tier states
          // its provenance ("… booking confirmed · from your {Provider}
          // email" / "· from your screenshot" / "· reported by …");
          // it never renders as plain "verified".
          title: travelerOnly ? `${typeLabel} booking confirmed by you` : `${typeLabel} booking confirmed · ${bookingProvenanceSuffix(bookingTruthInput(booking))}`,
          body: bodyParts.length ? bodyParts.join(" · ") : null,
          href: null,
          icon: "booking" as const
        } satisfies AlertsSectionRow
      };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map((entry) => entry.row);
  const travelUpdateBookingTitles = new Set(travelUpdateBookingRows.map((row) => normalizedFeedValue(row.title)));
  const travelUpdateRows = [
    ...travelUpdateBookingRows,
    ...travelUpdateNotificationRows.filter(
      (row) =>
        !travelUpdateBookingTitles.has(normalizedFeedValue(row.title)) &&
        !suppressedNotificationIds.has(row.id)
    )
  ];

  // Picture 1, Upcoming rebuild (exactness pass): the mock's Upcoming
  // lists TRIP EVENTS, not notification cards. Events come from the
  // stored itinerary's live_timeline — the same source the trip page
  // renders: the travel leg, the hotel check-in, and dated stops with
  // real start times. A row renders only when its event is real; a
  // clock time renders only when the item carries one (travel and
  // check-in carry a date label, never an invented clock time). Past
  // events are excluded in the trip's timezone; today's untimed
  // events (travel, check-in) stay visible for their day. Transfers
  // and rest rows are not events and never render here. Booking
  // rows (above) win on title collision so one departure never
  // renders twice. Notification info cards no longer render in
  // Upcoming — the section is events only, per the picture.
  const itineraryResult = await supabase
    .from("roamly_itineraries")
    .select("full_json")
    .eq("trip_id", trip.id)
    .eq("user_id", current.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fullJson = (itineraryResult.data as { full_json?: unknown } | null)?.full_json;
  const itineraryDays = Array.isArray((fullJson as { daily_itinerary?: unknown } | null)?.daily_itinerary)
    ? ((fullJson as { daily_itinerary: Array<Record<string, unknown>> }).daily_itinerary)
    : [];
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tripTimezone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    nowParts.find((part) => part.type === type)?.value || "";
  const todayStr = `${partValue("year")}-${partValue("month")}-${partValue("day")}`;
  const nowMinutes = Number(partValue("hour")) * 60 + Number(partValue("minute"));
  const formatClockTime = (value: string): string | null => {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = match[2];
    if (hour < 0 || hour > 23) return null;
    const suffix = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}:${minute} ${suffix}`;
  };
  const formatDayDate = (value: string): string | null => {
    const date = new Date(`${value.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
  };
  const itineraryEventRows: AlertsSectionRow[] = [];
  const sortedDays = [...itineraryDays].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  // Audit fix helpers: the trip's last day is check-out day, and an
  // identical generated activity must not repeat across days in this
  // list (confirmed bookings live in their own rows above and are
  // never deduped here).
  const lastDayDate = sortedDays.length ? String(sortedDays[sortedDays.length - 1].date || "").slice(0, 10) : "";
  const seenGeneratedActivities = new Set<string>();
  for (const day of sortedDays) {
    const dayDate = typeof day.date === "string" ? day.date.slice(0, 10) : "";
    if (!dayDate || dayDate < todayStr) continue;
    const dateLabel = formatDayDate(dayDate);
    if (!dateLabel) continue;
    const timeline = Array.isArray(day.live_timeline) ? day.live_timeline : [];
    for (const rawItem of timeline) {
      const item = (rawItem || {}) as Record<string, unknown>;
      const category = String(item.category || "").trim().toLowerCase();
      const rawType = String(item.item_type || "").trim().toLowerCase();
      const type = rawType || (category === "travel" ? "travel" : category === "hotel" ? "hotel" : category === "transfer" ? "transfer" : "activity");
      if (type === "transfer" || type === "rest" || type === "reminder" || type === "booking") continue;
      // X1 read path: a stored itinerary item (e.g. a travel leg)
      // linked by booking_id to a booking whose CURRENT truth is
      // cancelled/refunded/superseded/test never renders as an
      // upcoming trip event here — the stored stamp is stale by
      // definition once the booking leaves the active set.
      if (typeof item.booking_id === "string" && inactiveBookingIds.has(item.booking_id)) continue;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) continue;
      const startTime = typeof item.startTime === "string" ? item.startTime : "";
      const clock = startTime ? formatClockTime(startTime) : null;
      if (dayDate === todayStr && startTime && clock) {
        const startMatch = startTime.match(/^(\d{1,2}):(\d{2})/);
        if (startMatch && Number(startMatch[1]) * 60 + Number(startMatch[2]) < nowMinutes) continue;
      }
      const itemOrigin = typeof item.origin === "string" ? item.origin.trim() : "";
      // Audit fixes (2026-10-29 production-recovery):
      // - the "Estimated arrival back" leg is an ARRIVAL, not a second
      //   departure, and its origin's "arrival point" suffix is seed
      //   vocabulary, not a place name;
      // - a hotel item on the trip's last day is a check-OUT (both
      //   generators seed it that way), never a check-in;
      // - raw search-query strings must never render as activity
      //   titles (the trip page's guard is applied here too), and a
      //   "… hotel search" placeholder is labelled as a suggestion;
      // - identical generated activities are listed once, not once
      //   per day.
      const isArrivalLeg = /arrival/i.test(title) || /arrival point/i.test(itemOrigin);
      let rowTitle = title;
      if (type === "travel") {
        rowTitle = isArrivalLeg
          ? itemOrigin
            ? `Arrival in ${itemOrigin.replace(/\s*arrival point\s*$/i, "")}`
            : title
          : itemOrigin || origin
            ? `Departure from ${itemOrigin || origin}`
            : "Departure";
      } else if (type === "hotel") {
        const stayTitle = looksLikeProviderSearchTitle(title) ? "Hotel search suggestion" : title;
        rowTitle = `${dayDate === lastDayDate ? "Check out" : "Check in"} · ${stayTitle}`;
      } else if (looksLikeProviderSearchTitle(title)) {
        rowTitle = "Local events suggestion";
      }
      if (type === "activity") {
        const dedupeKey = `activity:${normalizedFeedValue(rowTitle)}`;
        if (seenGeneratedActivities.has(dedupeKey)) continue;
        seenGeneratedActivities.add(dedupeKey);
      }
      const rowBody = clock ? `${dateLabel} · ${clock}` : dateLabel;
      itineraryEventRows.push({
        id: `event-${dayDate}-${rowTitle}-${rowBody}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: rowTitle,
        body: rowBody,
        href: null,
        icon: type === "travel" ? "departure" : type === "hotel" ? "checkin" : "generic"
      });
    }
  }
  const upcomingBookingTitles = new Set(upcomingBookingRows.map((row) => normalizedFeedValue(row.title)));
  const upcomingRows = [
    ...upcomingBookingRows,
    ...itineraryEventRows.filter((row) => !upcomingBookingTitles.has(normalizedFeedValue(row.title)))
  ];

  const actionRows = [...documentRows, weatherUnavailableRow, ...packingRows];
  // Conditional-acceptance item 2: the tab-bar badge count, from the
  // ONE shared definition (lib/roamly/alertsBadge.ts) the shell uses
  // too — deduped, selected-trip notification rows rendered in a
  // section above, still unread, not outdated, not history. The
  // weather row (not a notification) never counts.
  const renderedNotificationIds = new Set([...actionRows, ...upcomingRows, ...travelUpdateRows].map((row) => row.id));
  const displayedUnreadCount = countAlertsBadgeNotifications(notificationItems, renderedNotificationIds);

  // A21 (Jakob): "Mark all read" for this trip. The write is the
  // EXISTING read model — the exact server update the single-event
  // page performs on open (app/trip/[id]/event/[eventId]/page.tsx:
  // roamly_notifications update { status: "read" } scoped to the
  // user and to status "unread") — applied here to ALL of this
  // trip's unread rows (trip scope instead of one event_id). No new
  // API route or parallel write path is created. The per-single-id
  // POST in app/api/roamly/notifications/route.ts is a different
  // shape (one id per call, also stamps read_at) and is not the
  // event page's model, so it is not reused for this bulk action.
  const tripUnreadCount = notificationItems.filter((item) => item.status === "unread").length;
  const tripIdForMarkAll = trip.id;
  async function markAllNotificationsRead() {
    "use server";
    const actionSupabase = await createSupabaseServerClient();
    if (!actionSupabase) return;
    const actionUser = await getCurrentUser();
    if (!actionUser.user) return;
    await actionSupabase
      .from("roamly_notifications")
      .update({ status: "read" })
      .eq("user_id", actionUser.user.id)
      .eq("trip_id", tripIdForMarkAll)
      .eq("status", "unread")
      .then(() => undefined, () => undefined);
    redirect(`/notifications?trip=${encodeURIComponent(tripIdForMarkAll)}`);
  }

  // Hero: the SAME destination-photo pipeline the trip page uses (real
  // Wikimedia/Wikidata photo, cached, 6s cap). Null renders the
  // approved bare header — never a generated or broken image. The
  // badge comes from the shared trip clock (trip timezone), the same
  // clock the Live hero reads, so the two panels cannot disagree.
  const heroPlanning = getTripPlanningMetadata(trip.metadata);
  const heroDestination = destination || "Your trip";
  const destinationPhoto = await getDestinationPhoto({
    label: heroDestination,
    country: typeof heroPlanning.destinationCountry === "string" ? heroPlanning.destinationCountry : null,
    latitude: typeof heroPlanning.destinationLatitude === "number" ? heroPlanning.destinationLatitude : null,
    longitude: typeof heroPlanning.destinationLongitude === "number" ? heroPlanning.destinationLongitude : null
  }).catch(() => null);
  const heroClock = tripClockState({
    startDate: trip.start_date,
    endDate: trip.end_date,
    timezone: tripTimezone
  });
  const heroDateLine = formatTripDateRange(trip.start_date, trip.end_date);

  return (
    <div className="calm-bleed mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      <NotificationShellStateBridge activeTripId={trip.id} unreadCount={displayedUnreadCount} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Alerts</h1>
        <div className="flex items-center gap-2">
          {tripUnreadCount > 0 ? (
            <form action={markAllNotificationsRead}>
              <button type="submit" className="inline-flex min-h-11 items-center rounded-full px-3 text-[15px] font-semibold text-cblue">
                Mark all read
              </button>
            </form>
          ) : null}
          <a href="/account?view=preferences" className="inline-flex min-h-11 items-center px-1 text-cgray" aria-label="Notification settings">
            <Settings size={22} strokeWidth={2} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="mt-3">
        <TripHeroCard
          destination={heroDestination}
          dateLine={heroClock.dayCount ? `${heroDateLine} · ${heroClock.dayCount} days` : heroDateLine}
          badge={heroClock.badge}
          photo={destinationPhoto ? { imageUrl: destinationPhoto.imageUrl, credit: destinationPhoto.credit, pageUrl: destinationPhoto.pageUrl } : null}
        />
      </div>
      {tripTimezoneUnknown ? (
        <p className="mt-2 px-1 text-[13px] font-medium text-cgray">{UNKNOWN_TZ_LABEL}</p>
      ) : null}
      {/* Conditional-acceptance item 2: the tab-bar badge, reconciled in
          words on this screen — the same count the badge shows, labeled
          as such, so the badge never floats without its meaning.
          Repair round P3: the line reads as the hierarchy's middle
          step (hero → this line → sections), so it carries subheading
          weight instead of the old small gray body text. */}
      <p
        className="mt-3 px-1 text-[15px] font-semibold text-chead"
        aria-label={`${displayedUnreadCount} unread alerts for this trip`}
      >
        {displayedUnreadCount === 1 ? (<><span className="bui-display-number">1</span> unread alert for this trip</>) : (<><span className="bui-display-number">{displayedUnreadCount}</span> unread alerts for this trip</>)}
      </p>

      {/* Picture 1 ends here: hero + these three sections, nothing below. */}
      <div className="mt-6 grid gap-6">
        <AlertsSectionCard
          title="Action required"
          badgeTone="red"
          rows={actionRows}
          delayMs={0}
        />
        <AlertsSectionCard
          title="Upcoming"
          badgeTone="blue"
          rows={upcomingRows}
          delayMs={60}
        />
        <AlertsSectionCard
          title="Travel updates"
          badgeTone="green"
          rows={travelUpdateRows}
          emptyText="No travel updates for this trip yet"
          delayMs={120}
        />
      </div>
    </div>
  );
}
