import { bookingExactTiming } from "@/lib/roamly/bookingDisplayTiming";
import PlanningConflictRepair from "@/components/roamly/PlanningConflictRepair";
import CustomerActivityRemoval from "@/components/roamly/CustomerActivityRemoval";
import CustomerActivityReplacement from "@/components/roamly/CustomerActivityReplacement";
import { HotelPartnerChoices } from "@/components/trip/HotelPartnerChoices";
import { resolveConfiguredHotelPartners, type HotelPartnerChoice } from "@/lib/roamly/affiliateResolver";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { findRepairTarget } from "@/lib/roamly/itineraryRepair";
import { isConfirmedItineraryBookingAnchor } from "@/lib/roamly/confirmedItineraryAnchor";
import { formatMoney, type RoamlyItinerary } from "@/lib/itinerary";
import { cleanTravelerTimeLabel, isDriveMode, looksLikeProviderSearchTitle, presentGroundTransportText, presentTravelerArea, presentTravelerTitle } from "@/lib/roamly/itineraryPresentation";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function formatTripWeekday(value?: string | null, locale = "en") {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
}

function isGenericStopText(value: string) {
  return /^(stop|place|location|activity|visit|explore|sightseeing|free time|leisure)\b/i.test(value.trim());
}

function timelineText(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = getString(record[key]);
    if (value) return value;
  }
  return "";
}

function timelineNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
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
  if (minutes == null) return cleanTravelerTimeLabel(value);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "p.m." : "a.m.";
  const hour12 = hour24 % 12 || 12;
  return cleanTravelerTimeLabel(`${hour12}:${String(minute).padStart(2, "0")} ${period}`);
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

function cleanTimelineTitle(record: Record<string, unknown>, suppressFlightFraming = false) {
  const rawTitle = timelineText(record, "title", "name");
  const location = timelineText(record, "location_name", "location", "place_name", "venue", "area");
  const mapQuery = timelineText(record, "map_query", "mapQuery");
  const category = timelineText(record, "category", "item_type", "type");
  const mode = timelineText(record, "travel_mode", "transportMode", "transport_mode");
  const presented = presentTravelerTitle({
    title: rawTitle,
    location,
    mode,
    category,
    origin: timelineText(record, "origin"),
    destination: timelineText(record, "destination"),
    suppressFlightFraming
  });

  const genericAirport = suppressFlightFraming && /\bairport|flight departure|departure buffer\b/i.test(`${rawTitle} ${mapQuery}`);
  if (presented.needsConfirmation || isDriveMode(mode) || looksLikeProviderSearchTitle(rawTitle) || looksLikeProviderSearchTitle(mapQuery) || genericAirport) {
    return presented.title;
  }

  if (rawTitle && !isGenericStopText(rawTitle) && !looksLikeProviderSearchTitle(rawTitle)) return rawTitle;
  if (location && !isGenericStopText(location) && !looksLikeProviderSearchTitle(location)) {
    if (/meal|lunch|dinner|breakfast|food/i.test(`${rawTitle} ${category}`)) return `${rawTitle || "Meal"} at ${location}`;
    return location;
  }
  if (mapQuery && !isGenericStopText(mapQuery) && !looksLikeProviderSearchTitle(mapQuery)) return mapQuery;
  return presented.title;
}

function transferSummary(record: Record<string, unknown>, suppressFlightFraming = false) {
  const origin = timelineText(record, "origin");
  const destination = timelineText(record, "destination", "location_name", "location");
  const rawMode = timelineText(record, "travel_mode", "transportMode", "transport_mode");
  const mode = isDriveMode(rawMode) || suppressFlightFraming ? "Drive" : rawMode;
  const minutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes", "durationMinutes", "duration_minutes");
  const title = cleanTimelineTitle(record, suppressFlightFraming);
  const safeOrigin = presentTravelerArea(origin, suppressFlightFraming);
  const safeDestination = presentTravelerArea(destination, suppressFlightFraming);
  const route = safeOrigin && safeDestination ? `${safeOrigin} to ${safeDestination}` : safeDestination || safeOrigin || title;
  return [mode || "Transfer", route, minutes ? `${minutes} min` : ""].filter(Boolean).join(" · ");
}

export function SectionHeading({
  eyebrow,
  title,
  summary
}: {
  eyebrow: string;
  title: string;
  summary?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{eyebrow}</p>
        <h2 className="mt-0.5 text-[1.65rem] font-bold tracking-[-0.03em] text-chead">{title}</h2>
      </div>
      {summary ? <p className="max-w-xl text-sm leading-6 text-cink">{summary}</p> : null}
    </div>
  );
}

export function NavigationChipList({ query }: { query: string }) {
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
          className="inline-flex min-h-9 items-center text-[0.8125rem] font-medium text-cgray underline decoration-chair underline-offset-4 transition hover:text-chead"
        >
          {labels[link.provider] || link.label}
        </a>
      ))}
    </div>
  );
}

export type StaySearchContext = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
};

function isStayTimelineItem(item: DisplayTimelineItem) {
  const type = `${item.itemType} ${item.category}`.toLowerCase();
  if (/\b(hotel|lodging|accommodation|hostel|stay)\b/.test(type)) return true;
  const title = item.title.toLowerCase();
  if (/\b(hotel|hostel|check-?in|lodging)\b/.test(title)) return true;
  return /^stay\b/.test(title);
}

function stayPartnersForItem(item: DisplayTimelineItem, staySearch?: StaySearchContext | null): HotelPartnerChoice[] {
  if (!staySearch?.destination || item.authority === "confirmed" || !isStayTimelineItem(item)) return [];
  return resolveConfiguredHotelPartners({
    category: "hotel",
    title: item.title,
    destination: staySearch.destination,
    neighborhood: item.location || null,
    startDate: staySearch.startDate,
    endDate: staySearch.endDate,
    adults: staySearch.adults,
    children: staySearch.children,
    rooms: staySearch.rooms
  });
}

export type DisplayTimelineItem = {
  itemId: string;
  itemType: string;
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
  role: string;
  why: string;
  statusText: string;
  authority: "confirmed" | "must_do" | "flexible" | "supporting";
  /** True when the displayed time comes from a verified booking, not the plan draft. */
  timeFromBooking: boolean;
  /** True when the displayed time was shifted by a provider-validated flight-delay repair. */
  timeRetimed: boolean;
  retimedMinutes: number | null;
};

/* ------------------------------------------------------------------ */
/* Smart booking consolidation                                         */
/*                                                                     */
/* When the traveler already has confirmed bookings, the itinerary     */
/* stops guessing: the booking's exact date and time are pinned onto   */
/* the matching timeline item, and bookings with no matching plan item */
/* are inserted into the day at the right chronological position.      */
/* Nothing is invented — only verified booking data is used.           */
/* ------------------------------------------------------------------ */

function normalizedBookingTitle(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bookingIsConfirmed(booking: Record<string, unknown>) {
  if (booking.superseded_by_booking_id != null) return false;
  const status = getString(booking.booking_status || booking.status).toLowerCase();
  return booking.traveler_confirmed === true || ["confirmed", "booked", "ticketed", "issued"].includes(status);
}

type BookingTiming = { date: string; start: string; end: string };


function bookingMatchesItem(booking: Record<string, unknown>, itemTitle: string) {
  const bookingTitle = normalizedBookingTitle(booking.title);
  const item = normalizedBookingTitle(itemTitle);
  if (!bookingTitle || !item) return false;
  if (bookingTitle === item) return true;
  const flight = getString(booking.flight_number).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (flight.length >= 3 && item.replace(/[^a-z0-9]/g, "").includes(flight)) return true;
  const significant = (text: string) => text.split(" ").filter((word) => word.length > 3);
  const bookingWords = significant(bookingTitle);
  const itemWords = significant(item);
  if (bookingWords.length >= 2 && bookingWords.every((word) => item.includes(word))) return true;
  if (itemWords.length >= 2 && itemWords.every((word) => bookingTitle.includes(word))) return true;
  return false;
}

function bookingCategoryLabel(bookingType: string) {
  const type = bookingType.toLowerCase();
  if (/flight/.test(type)) return "Flight";
  if (/hotel|stay|accommodation|lodging/.test(type)) return "Stay";
  if (/transfer|transport|taxi|shuttle|car|rental/.test(type)) return "Transfer";
  if (/food|restaurant|dining|meal/.test(type)) return "Food";
  if (/activ|tour|ticket|experience|attraction/.test(type)) return "Activity";
  return "Booking";
}

function bookingToTimelineItem(booking: Record<string, unknown>, timing: BookingTiming): DisplayTimelineItem {
  const bookingType = getString(booking.booking_type) || "booking";
  const category = bookingCategoryLabel(bookingType);
  const provider = getString(booking.provider_name || booking.provider);
  const flightNumber = getString(booking.flight_number);
  const title = getString(booking.title) || category;
  const city = getString(booking.city);
  const address = getString(booking.address);
  return {
    itemId: "",
    itemType: bookingType,
    time: timing.start ? `${formatClock(timing.start)}${timing.end ? `–${formatClock(timing.end)}` : ""}` : "Flexible",
    sortMinutes: timing.start ? parseClockMinutes(timing.start) : null,
    title,
    description: [provider, flightNumber ? `Flight ${flightNumber}` : ""].filter(Boolean).join(" · "),
    location: city || address,
    category,
    durationLabel: "",
    travelLabel: "",
    transferNote: "",
    mapQuery: address || city || title,
    warning: "",
    role: "",
    why: "",
    statusText: "",
    authority: "confirmed",
    timeFromBooking: Boolean(timing.start),
    timeRetimed: false,
    retimedMinutes: null
  };
}

/** Pin verified booking times onto the day and insert bookings the plan missed. Returns how many items were consolidated. */
function applyConfirmedBookings(
  output: DisplayTimelineItem[],
  dayDate: string,
  confirmedBookings: readonly Record<string, unknown>[]
) {
  let consolidated = 0;
  const matchedIndexes = new Set<number>();
  for (const booking of confirmedBookings) {
    if (!bookingIsConfirmed(booking)) continue;
    const timing = bookingExactTiming(booking);
    let matched = false;
    for (let index = 0; index < output.length; index += 1) {
      if (matchedIndexes.has(index)) continue;
      if (!bookingMatchesItem(booking, output[index].title)) continue;
      matchedIndexes.add(index);
      matched = true;
      const item = output[index];
      if (timing.start) {
        item.time = timing.end ? `${formatClock(timing.start)}–${formatClock(timing.end)}` : formatClock(timing.start);
        item.sortMinutes = parseClockMinutes(timing.start);
        item.timeFromBooking = true;
        // A verified booking time is authoritative: it supersedes the plan's
        // re-time marker rather than stacking two provenances on one time.
        item.timeRetimed = false;
        item.retimedMinutes = null;
      }
      item.authority = "confirmed";
      consolidated += 1;
      break;
    }
    if (!matched && timing.date && dayDate && timing.date === dayDate) {
      output.push(bookingToTimelineItem(booking, timing));
      consolidated += 1;
    }
  }
  output.sort((a, b) => (a.sortMinutes ?? 10_000) - (b.sortMinutes ?? 10_000));
  return consolidated;
}

export function buildDisplayTimelineItems(
  day: RoamlyItinerary["daily_itinerary"][number],
  confirmedBookings: readonly Record<string, unknown>[] = [],
  options: { suppressFlightFraming?: boolean } = {}
) {
  const suppressFlightFraming = options.suppressFlightFraming === true;
  const output: DisplayTimelineItem[] = [];
  const seen = new Set<string>();
  const pendingTransfers: string[] = [];

  for (const item of day.live_timeline || []) {
    const record = item as unknown as Record<string, unknown>;
    const transferLike = isTransferLike(record);

    if (transferLike && !isMajorTravel(record)) {
      const summary = transferSummary(record, suppressFlightFraming);
      if (summary) pendingTransfers.push(summary);
      continue;
    }

    const title = cleanTimelineTitle(record, suppressFlightFraming);
    const type = timelineText(record, "item_type", "type");
    const category = timelineText(record, "category") || type || "Stop";
    const locationLabel = presentTravelerArea(
      timelineText(record, "location_name", "location", "place_name", "venue", "area"),
      suppressFlightFraming,
      category
    );
    const location = locationLabel && locationLabel !== title ? locationLabel : "";
    const description = suppressFlightFraming
      ? presentGroundTransportText(timelineText(record, "description", "summary", "details", "notes"))
      : timelineText(record, "description", "summary", "details", "notes");
    const start = timelineText(record, "startTime", "start_time");
    const end = timelineText(record, "endTime", "end_time");
    const timeLabel = cleanTravelerTimeLabel(timelineText(record, "time_label", "time") || (start ? formatClock(start) : ""));
    const timingStatus = timelineText(record, "timing_status").toUpperCase();
    const time = start && end ? `${timingStatus === "PLANNED" ? "Planned · " : ""}${formatClock(start)}–${formatClock(end)}` : timeLabel;
    const sortMinutes = parseClockMinutes(start || timeLabel);
    const duration = timelineNumber(record, "durationMinutes", "duration_minutes");
    const travelMinutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes");
    const mapQuery = presentTravelerArea(timelineText(record, "map_query", "mapQuery"), suppressFlightFraming, category) || location || title;
    const isLunch = /\blunch\b/i.test(`${title} ${description} ${category}`);
    const warning =
      isLunch && sortMinutes != null && sortMinutes > 14 * 60
        ? "Late lunch timing. Treat this as an intentional rest or adjust earlier."
        : "";
    const role = timelineText(record, "plan_role", "role").toLowerCase();
    const routingStatus = timelineText(record, "routing_status").toUpperCase();
    const costStatus = timelineText(record, "cost_status").toUpperCase();
    const authority = isConfirmedItineraryBookingAnchor(title, confirmedBookings)
      ? "confirmed"
      : role === "must_do" || record.must_do === true
        ? "must_do"
        : role === "supporting" || role === "alternative" || type === "rest"
          ? "flexible"
          : "supporting";
    const rawTitle = timelineText(record, "title", "name");
    const searchPlaceholder = looksLikeProviderSearchTitle(rawTitle) || looksLikeProviderSearchTitle(timelineText(record, "map_query", "mapQuery"));
    const statusText = routingStatus === "UNCERTAIN"
      ? "Route details to confirm"
      : costStatus === "UNKNOWN"
        ? "Price not available"
        : searchPlaceholder
          ? "Details to confirm"
          : "";
    const why = timelineText(record, "why_recommended", "whyRecommended", "selection_reason", "selectionReason", "reason");
    const retimedBy = timelineText(record, "retimed_by_event");
    const retimedMinutes = timelineNumber(record, "retimed_minutes");

    if (!title && !description) continue;
    if (!transferLike && title && isGenericStopText(title) && (!location || isGenericStopText(location))) continue;

    const key = `${time}|${title}|${location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      itemId: timelineText(record, "item_id"),
      itemType: type,
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
      warning,
      role,
      why,
      statusText,
      authority,
      timeFromBooking: false,
      timeRetimed: Boolean(retimedBy),
      retimedMinutes
    });

    if (output.length >= 6) break;
  }

  const consolidatedCount = applyConfirmedBookings(output, getString(day.date), confirmedBookings);
  return { items: output, consolidatedCount };
}

/** Mock day-group heading: "Day 1 \u2014 Thu, Oct 23" (no year). */
function mockDayHeading(dayNumber: number, date: string | null | undefined, locale = "en") {
  if (!date) return `Day ${dayNumber}`;
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return `Day ${dayNumber}`;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(parsed);
  const monthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(parsed);
  return `Day ${dayNumber} \u2014 ${weekday}, ${monthDay}`;
}

/** The mock row shows the start of the booked window, compact
 *  ("9:00 AM"). The engine label carries the full range
 *  ("9:00 a.m.\u201311:30 a.m."); the range stays available in the
 *  row's details. */
function mockRowTime(time: string) {
  const start = time.replace(/^Planned \u00b7 /, "").split("\u2013")[0].trim();
  return start.replace(/a\.m\./gi, "AM").replace(/p\.m\./gi, "PM");
}
export function TimelineItemCard({ item, tripId, dayId, staySearch }: { item: DisplayTimelineItem; tripId: string; dayId?: string; staySearch?: StaySearchContext | null }) {
  const stayPartners = stayPartnersForItem(item, staySearch);
  const subLine = [item.location, item.statusText].filter(Boolean);
  const secondary = [
    item.durationLabel ? `Duration: ${item.durationLabel}` : "",
    item.travelLabel ? `Travel: ${item.travelLabel}` : "",
    item.transferNote ? `Arrival/transfer: ${item.transferNote}` : "",
    item.description
  ].filter(Boolean);
  const isConfirmed = item.authority === "confirmed";

  return (
    <article className="px-4 py-3">
      <div className="flex items-baseline gap-2.5">
        <h4 className={`min-w-0 flex-1 text-[17px] leading-[1.35] ${item.authority === "must_do" ? "font-semibold text-chead" : "font-normal text-cink"}`}>{item.title}</h4>
        {isConfirmed ? <span className="shrink-0 rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead">Booked</span> : null}
        <span className="shrink-0 text-[17px] font-normal leading-[1.35] text-cgray">{mockRowTime(item.time)}</span>
      </div>
      {item.timeFromBooking ? <p className="mt-0.5 text-xs font-medium text-cgray2">Booking time</p> : null}
      {subLine.length ? <p className="mt-0.5 text-[14.5px] font-normal leading-[1.45] text-cgray">{subLine.join(" \u00b7 ")}</p> : null}
      {item.timeRetimed ? (
        <p className="mt-1.5 inline-flex items-center rounded-md bg-amber-100/70 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          Re-timed{item.retimedMinutes ? ` ${item.retimedMinutes > 0 ? "+" : ""}${item.retimedMinutes} min` : ""}
        </p>
      ) : null}
      {stayPartners.length ? (
        <HotelPartnerChoices
          partners={stayPartners}
          tripId={tripId}
          title={item.title}
          priceNote={item.statusText === "Price not available" ? null : "Price not available"}
        />
      ) : null}
      {item.warning ? <p className="mt-2 text-xs font-semibold leading-5 text-cred">{item.warning}</p> : null}
      {item.authority === "flexible" && item.itemType === "activity" && dayId && item.itemId ? (
        <>
          <CustomerActivityRemoval tripId={tripId} dayId={dayId} itemId={item.itemId} title={item.title} />
          <CustomerActivityReplacement tripId={tripId} dayId={dayId} itemId={item.itemId} title={item.title} />
        </>
      ) : null}
      {item.why || secondary.length ? (
        <details className="mt-2">
          <summary className="min-h-8 cursor-pointer text-sm font-medium text-cgray">{item.why ? "Why this & details" : "Details"}</summary>
          <div className="mt-2 grid gap-1">
            {item.why ? <p className="text-sm font-normal leading-6 text-cink"><span className="font-semibold text-chead">Why this:</span> {item.why}</p> : null}
            {secondary.map((line) => (
              <p key={line} className="text-sm font-normal leading-6 text-cink">{line}</p>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}


export function DayTimelineCard({
  tripId,
  day,
  currency,
  locale,
  confirmedBookings,
  suppressFlightFraming = false,
  staySearch = null
}: {
  tripId: string;
  day: RoamlyItinerary["daily_itinerary"][number];
  currency: string;
  locale: string;
  confirmedBookings: readonly Record<string, unknown>[];
  suppressFlightFraming?: boolean;
  staySearch?: StaySearchContext | null;
}) {
  const { items: timelineItems, consolidatedCount } = buildDisplayTimelineItems(day, confirmedBookings, { suppressFlightFraming });
  const places = [
    ...timelineItems.map((item) => item.mapQuery),
    ...day.map_queries
  ]
    .map((item) => getString(item))
    .filter((item) => item && !isGenericStopText(item) && !looksLikeProviderSearchTitle(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 5);
  const firstAction = timelineItems.find((item) => item.authority !== "flexible") || timelineItems[0];
  const rawDaySummary = day.primary_plan || day.morning || day.afternoon || day.evening;
  const daySummary = compact(
    presentTravelerArea(rawDaySummary, suppressFlightFraming),
    timelineItems.length ? "Your selected day, in order." : "No fixed plan yet. Keep this day flexible until more evidence is available.",
    160
  );
  const dayCity = presentTravelerArea(day.city, suppressFlightFraming);
  const dayTitle = presentTravelerTitle({
    title: day.title,
    destination: dayCity || day.city,
    suppressFlightFraming
  }).title || "Your day";
  const hasUncertainty = Boolean(day.plan_status === "uncertain" || day.uncertainty?.length || timelineItems.some((item) => item.statusText));
  const repairCandidate = day.conflict_id ? (() => {
    for (const item of day.live_timeline || []) {
      const candidate = findRepairTarget({ ...({ daily_itinerary: [day] } as RoamlyItinerary) }, day.conflict_id, item.item_id || "");
      if (candidate.repairability === "REPAIRABLE" && candidate.target) return { target: candidate.target, item: candidate.item };
    }
    return null;
  })() : null;

  return (
    <section id={`day-${day.day_number}`} className="roamly-day-print scroll-mt-40">
      <div className="mb-2 ml-4 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">
          {mockDayHeading(day.day_number, day.date, locale)}
        </p>
        {typeof day.estimated_cost === "number" && day.estimated_cost > 0 ? (
          <span className="shrink-0 text-[13px] font-normal text-cgray2">Day estimate · {formatMoney(day.estimated_cost, currency)}</span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[14px] bg-white shadow-calm">
        <div className="px-4 pt-3.5">
          {dayTitle && dayTitle !== dayCity ? (
            <h3 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.01em] text-chead">{dayTitle}</h3>
          ) : null}
          {consolidatedCount ? (
            <p className="mt-2 text-[13px] font-medium leading-5 text-cgray">
              Schedule set from your confirmed {consolidatedCount === 1 ? "booking" : `${consolidatedCount} bookings`} — exact times below
            </p>
          ) : null}
          <p className="mt-1.5 text-[15px] font-normal leading-6 text-cink">{daySummary}</p>
          {firstAction ? (
            <p className="mt-2 text-sm leading-6 text-cgray">
              <span className="font-medium text-chead">Up next. </span>
              {firstAction.time !== "Flexible" ? `${firstAction.time} \u00b7 ` : ""}{firstAction.title}
            </p>
          ) : null}
          {hasUncertainty ? <p className="mt-1.5 text-xs font-medium text-cgray">Some details still need confirmation.</p> : null}
        </div>

        {repairCandidate ? (
          <div className="px-4 pt-3">
            <PlanningConflictRepair tripId={tripId} conflictId={repairCandidate.target.conflictId} dayId={day.day_id!} targetItemId={repairCandidate.target.itemId} targetTitle={repairCandidate.target.title} protectedTitles={timelineItems.filter((item) => item.authority === "confirmed" || item.authority === "must_do").map((item) => item.title)} />
          </div>
        ) : null}

        <div className="divide-y divide-chair">
          {timelineItems.length ? (
            timelineItems.map((item, index) => (
              <TimelineItemCard key={`${day.day_number}-${item.time}-${item.title}-${index}`} item={item} tripId={tripId} dayId={day.day_id} staySearch={staySearch} />
            ))
          ) : (
            <div className="px-4 py-4 text-sm font-normal leading-6 text-cink">This day is intentionally open. Add a confirmed plan or keep space for the moment.</div>
          )}
        </div>

        {day.alternatives?.length || day.uncertainty?.length ? (
          <details className="border-t border-chair px-4 py-3">
            <summary className="min-h-8 cursor-pointer text-xs font-medium uppercase tracking-[0.06em] text-cgray">Planning notes</summary>
            <div className="mt-2 grid gap-3">
              {day.alternatives?.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cgray2">Alternatives</p>
                  <p className="mt-1 text-sm font-normal leading-6 text-cink">{day.alternatives.slice(0, 3).join(" \u00b7 ")}</p>
                </div>
              ) : null}
              {day.uncertainty?.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-cgray2">Still to confirm</p>
                  <p className="mt-1 text-sm font-normal leading-6 text-cink">{day.uncertainty.slice(0, 3).join(" \u00b7 ")}</p>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        {day.food.length ? (
          <details className="border-t border-chair px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.06em] text-cgray">Food ideas</summary>
            <p className="mt-2 text-sm font-normal leading-6 text-cink">{day.food.slice(0, 3).join(" \u00b7 ")}</p>
          </details>
        ) : null}

        {places.length ? (
          <details className="border-t border-chair px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.06em] text-cgray">Map details</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {places.map((query) => (
                <div key={query} className="rounded-xl bg-cbg px-3 py-3">
                  <p className="text-sm font-semibold leading-5 text-chead">{query}</p>
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

export function BuildingDayCard({
  dayNumber,
  date,
  status
}: {
  dayNumber: number;
  date?: string | null;
  status?: string | null;
}) {
  return (
    <section id={`day-${dayNumber}`} className="roamly-day-print scroll-mt-36">
      <p className="mb-2 ml-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">
        {mockDayHeading(dayNumber, date)}
      </p>
      <div className="rounded-[14px] bg-white px-4 py-4 shadow-calm">
        <h3 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.01em] text-chead">
          {status === "failed" ? "Needs attention" : "Building your day..."}
        </h3>
        <p className="mt-1 text-sm font-normal leading-6 text-cink">
          {status === "failed" ? "This day needs attention. Completed days remain available." : "Roamly is still building this day."}
        </p>
      </div>
    </section>
  );
}
