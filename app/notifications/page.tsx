import { redirect } from "next/navigation";
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
import { INFO_NOTIFICATION_TYPES } from "@/lib/roamly/alertsNotificationTypes";
import { countAlertsBadgeNotifications } from "@/lib/roamly/alertsBadge";
import type { TrackingTrip } from "@/lib/roamly/tripActivation";
import { getTripDestinationLabel, getTripOriginLabel, getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";

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
 * as live values. Weather has no provider in this codebase, so its row
 * keeps the picture's exact position and format with the honest
 * unavailable state — the single named gap for this picture.
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

const CONFIRMED_BOOKING_STATUSES = new Set(["confirmed", "booked", "ticketed", "issued", "paid", "reserved", "modified", "completed"]);

function isConfirmedBooking(booking: Record<string, unknown>): boolean {
  const status = String(booking.booking_status || "").trim().toLowerCase();
  return booking.traveler_confirmed === true || CONFIRMED_BOOKING_STATUSES.has(status);
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
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-calm">
          <h2 className="text-[22px] font-bold tracking-[-0.018em] text-chead">Notifications need an account.</h2>
          <div className="mt-4">
            <a className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white" href={`/login?next=${encodeURIComponent(loginNext)}`}>Log in</a>
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
  const trip = requestedTrip && isOpenNotificationTrip(requestedTrip)
    ? requestedTrip
    : selectNotificationTrip((tripRows.data || []) as TrackingTrip[]);
  const notifications = trip
    ? await supabase
        .from("roamly_notifications")
        .select("id,trip_id,event_id,title,body,type,status,action_url,created_at,scheduled_for")
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
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-calm">
          <h2 className="text-[22px] font-bold tracking-[-0.018em] text-chead">No current trip to show.</h2>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Reminders and check-ins stay with the trip they belong to. Open a trip to see its own updates.
          </p>
          <div className="mt-4">
            <a className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-cblue px-5 text-[17px] font-semibold text-white" href="/dashboard">Open dashboard</a>
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
      body: item.body || "Make sure your ID, flights and hotel confirmation are ready."
    } as SectionNotificationItem, "document"));
  const packingRows = notificationItems
    .filter((item) => item.type === "packing_check" && item.action_state !== "history")
    .map((item) => notificationSectionRow({
      ...item,
      title: "Pack for your trip",
      body: item.body || "Personalized packing checklist is ready."
    } as SectionNotificationItem, "packing"));
  const weatherUnavailableRow: AlertsSectionRow = {
    id: "weather-unavailable",
    title: "Check weather",
    body: "Weather is not available for this trip yet.",
    href: null,
    icon: "weather"
  };
  const travelUpdateItems = notificationItems.filter((item) => item.action_state !== "history" && !INFO_NOTIFICATION_TYPES.has(item.type));
  const travelUpdateNotificationRows = travelUpdateItems.map((item) =>
    notificationSectionRow(
      item as SectionNotificationItem,
      item.type.includes("booking") ? "booking" : "update"
    )
  );

  // Confirmed bookings only (status in the confirmed set or
  // traveler-confirmed). Unconfirmed or suggested bookings never pose
  // as upcoming departures or confirmed bookings.
  const bookingRows = await supabase
    .from("roamly_bookings")
    .select("booking_type,category,booking_status,title,start_at,start_date,end_date,start_time,traveler_confirmed,provider_name")
    .eq("trip_id", trip.id)
    .eq("user_id", current.user.id);
  const confirmedBookings = ((bookingRows.data || []) as Array<Record<string, unknown>>)
    .filter(isConfirmedBooking)
    .filter((booking) => {
      const type = String(booking.booking_type || "").trim().toLowerCase();
      return type === "flight" || type === "hotel";
    });
  const upcomingBookingRows: AlertsSectionRow[] = confirmedBookings
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

  // Travel updates, picture shape: a confirmed booking renders as
  // "<Type> booking confirmed" with its real title + real date range —
  // "confirmed" only ever from a verified booking record. A
  // notification row carrying the same confirmation title is the same
  // event, not a second row, so it is dropped by title match.
  const travelUpdateBookingRows: AlertsSectionRow[] = confirmedBookings
    .map((booking) => {
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
          id: `booking-confirmed-${String(booking.booking_type || "").toLowerCase()}-${title}-${startSort}`,
          title: `${typeLabel} booking confirmed`,
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
    ...travelUpdateNotificationRows.filter((row) => !travelUpdateBookingTitles.has(normalizedFeedValue(row.title)))
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
      const title = typeof item.title === "string" ? item.title.trim() : "";
      if (!title) continue;
      const startTime = typeof item.startTime === "string" ? item.startTime : "";
      const clock = startTime ? formatClockTime(startTime) : null;
      if (dayDate === todayStr && startTime && clock) {
        const startMatch = startTime.match(/^(\d{1,2}):(\d{2})/);
        if (startMatch && Number(startMatch[1]) * 60 + Number(startMatch[2]) < nowMinutes) continue;
      }
      const itemOrigin = typeof item.origin === "string" ? item.origin.trim() : "";
      const rowTitle = type === "travel"
        ? (itemOrigin || origin ? `Departure from ${itemOrigin || origin}` : "Departure")
        : type === "hotel"
          ? `Check in · ${title}`
          : title;
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
        <a href="/account" className="inline-flex min-h-11 items-center px-1 text-cgray" aria-label="Settings">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </a>
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
        {displayedUnreadCount === 1 ? "1 unread alert for this trip" : `${displayedUnreadCount} unread alerts for this trip`}
      </p>

      {/* Picture 1 ends here: hero + these three sections, nothing below. */}
      <div className="mt-6 grid gap-6">
        <AlertsSectionCard
          title="Action required"
          badgeTone="red"
          rows={actionRows}
        />
        <AlertsSectionCard
          title="Upcoming"
          badgeTone="blue"
          rows={upcomingRows}
        />
        <AlertsSectionCard
          title="Travel updates"
          badgeTone="green"
          rows={travelUpdateRows}
          emptyText="No travel updates for this trip yet"
        />
      </div>
    </div>
  );
}
