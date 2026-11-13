import type { CSSProperties } from "react";
import { bookingExactTiming } from "@/lib/roamly/bookingDisplayTiming";
import { BedDouble, Bus, Car, Coffee, Footprints, MapPin, MoveRight, Plane, Ship, TrainFront, UtensilsCrossed } from "lucide-react";
import { isConfirmed as bookingTruthIsConfirmed } from "@/lib/roamly/bookingTruth";
import PlanningConflictRepair from "@/components/roamly/PlanningConflictRepair";
import { HotelPartnerChoices } from "@/components/trip/HotelPartnerChoices";
import { resolveConfiguredHotelPartners, type HotelPartnerChoice } from "@/lib/roamly/affiliateResolver";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { itemCoordinates } from "@/lib/roamly/placeDetail";
import { findRepairTarget } from "@/lib/roamly/itineraryRepair";
import { isConfirmedItineraryBookingAnchor } from "@/lib/roamly/confirmedItineraryAnchor";
import { formatMoney, type RoamlyItinerary } from "@/lib/itinerary";
import { cleanTravelerTimeLabel, isDriveMode, isTravelLeg, looksLikeProviderSearchTitle, presentDayHeading, presentGroundTransportText, presentTravelerArea, presentTravelerTitle } from "@/lib/roamly/itineraryPresentation";
import { stripTitleEcho, isUnverifiableStopTitle, isNonPlaceMapLabel } from "@/lib/roamly/itineraryHome";
import { BuiAccordion } from "@/components/boardui/Accordion";
import { BuiChip } from "@/components/boardui/Badge";
import { countDayStops, daySummaryStartClock, deriveDaySummary, dayUncertaintyNotes, isGenericStopText } from "@/lib/roamly/daySummary";
import { translateExactText, type RoamlyLocale } from "@/lib/i18n";
import { displayActivityDescription, displayRestTitle } from "@/lib/roamly/activityDescription";
import {
  isGenericStayTitle,
  marketProvenanceForStoredItem,
  type MarketStopProvenance
} from "@/lib/roamly/marketStopDescription";
import { isPlanStayRow } from "@/lib/roamly/planStayRow";

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

/** The timeline connector's leg word for a stored travel mode
 *  (familiarity redesign, 2026-11-09). Only plain traveller words
 *  survive; an unrecognised stored mode yields "" and the leg
 *  renders as minutes alone. */
function legModeWord(mode: string) {
  const text = mode.toLowerCase();
  if (/walk|foot|stroll/.test(text)) return "walk";
  if (/flight|plane/.test(text)) return "flight";
  if (/train|rail|metro|subway/.test(text)) return "train";
  if (/ferry|boat/.test(text)) return "ferry";
  if (/bus|coach|shuttle/.test(text)) return "bus";
  if (/taxi|rideshare|uber|lyft/.test(text)) return "taxi";
  if (/driv|car|rental/.test(text)) return "drive";
  return "";
}

/** Compose the connector leg INTO a stop from stored numbers only:
 *  no stored minutes → no leg label at all (never invented). */
function composeTimelineLeg(leg: { minutes: number | null; mode: string } | null): { legLabel: string; legMode: string } {
  if (!leg || leg.minutes == null || leg.minutes <= 0) return { legLabel: "", legMode: "" };
  const word = legModeWord(leg.mode);
  return { legLabel: `${leg.minutes} min${word ? ` ${word}` : ""}`, legMode: word };
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
          className="inline-flex min-h-11 items-center text-[0.8125rem] font-medium text-cgray underline decoration-chair underline-offset-4 transition hover:text-chead"
        >
          {labels[link.provider] || link.label}
        </a>
      ))}
    </div>
  );
}

/** The day card's Map-details place links (BoardUI day pass,
 *  2026-11-09): the same three providers as NavigationChipList,
 *  rendered as designed pills — never raw underlined text links.
 *  NavigationChipList itself is untouched: the trip page's
 *  booking-suggestion cards still use it. */
function MapPlaceLinks({ query }: { query: string }) {
  const labels: Record<string, string> = {
    google_maps: "Google Maps",
    apple_maps: "Apple Maps",
    citymapper: "Citymapper"
  };
  const links = buildNavigationLinks({ destinationLabel: query, address: query });
  return (
    <div className="roamly-no-print mt-2.5 flex flex-wrap gap-1.5">
      {links.map((link) => (
        <a
          key={link.provider}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="bui-press bui-tap inline-flex min-h-9 items-center rounded-full border border-chair bg-white px-3 py-1 text-[13px] font-medium text-cnavy"
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
  /** Owner-10 item 5: true for an unverifiable junk-title stop; the
   *  card renders "Unverified stop" with planTitle kept. */
  unverified: boolean;
  /** The stored plan title when unverified; null otherwise. */
  planTitle: string | null;
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
  /** The stop's own stored coordinates, resolved from the plan/booking
   *  record itself (placeDetail's itemCoordinates: direct
   *  latitude/longitude, else the nested `coordinates` the engine
   *  seeds write from the item's position). Null when the record
   *  carries no position data — display-only, feeds the home view's
   *  Map tab pins; nothing is fetched or geocoded. */
  latitude: number | null;
  longitude: number | null;
  /** Coordinate provenance/precision from the stored record
   *  (map-honesty fix, 2026-11-07); null when the record is
   *  unstamped. "area" means the coordinates are an area point
   *  (the destination centre), never the place itself — and a
   *  record can carry the "area" stamp with NO coordinates (a
   *  booked stay whose property location was never saved), which
   *  is how the home view explains that stay's missing pin. */
  coordinateSource: "candidate" | "booking_record" | "destination_centre" | null;
  coordinatePrecision: "place" | "area" | null;
  /** Market provenance of the stop, derived from its own stored
   *  source + factualStatus (description-boilerplate fix,
   *  2026-11-07). INTERNAL ONLY since the familiarity redesign
   *  (2026-11-09): evidence tiers never render on a customer face —
   *  the field still drives the itinerary-level caution and the
   *  description-flattening context; null for rows that are not
   *  market bindings (engine and pack rows, discovery
   *  suggestions, bookings). */
  provenance: MarketStopProvenance | null;
  /** Travel leg INTO this stop, composed at build time from stored
   *  data only (familiarity redesign, 2026-11-09): a folded minor
   *  transfer's stored minutes/mode, else the stop record's own
   *  stored travelTimeMinutes + travel_mode. "" when no leg is
   *  stored — the timeline connector then shows no leg, and no
   *  duration is ever invented. */
  legLabel: string;
  /** The leg's mode word ("walk" / "drive" / "flight" / "train" /
   *  "bus" / "ferry" / "taxi"), "" when the leg has no stored mode
   *  or there is no leg. Drives the connector's icon only. */
  legMode: string;
  /** The place's OWN stored photo (record photo_urls[0] /
   *  photo_url; for booking-derived rows the booking's photo_urls
   *  or its provider payload's). Null when the record carries no
   *  photo — the row then renders a quiet icon tile, never a stock
   *  stand-in (photo-truth law). Most current records carry none;
   *  the slot is real, the data is thin. */
  photoUrl: string | null;
  /** The stop record's own stored estimated_cost, or null. The
   *  card formats it with the trip currency for the row's single
   *  sub-line; unknown cost renders as silence on the row. */
  estimatedCost: number | null;
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
  // Workstream A + Round 2 Lane E2: day-card consolidation derives
  // from the ONE booking-truth rule at the providerConfirmationEvidence tier
  // ONLY, not the old OR rule — a cancelled, unverified, or merely
  // traveler-confirmed booking never pins a confirmed anchor
  // (the day face's "Booked" status) onto the day.
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
    metadata:
      booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
        ? (booking.metadata as Record<string, unknown>)
        : null,
    reservation_requirements:
      booking.reservation_requirements && typeof booking.reservation_requirements === "object" && !Array.isArray(booking.reservation_requirements)
        ? (booking.reservation_requirements as Record<string, unknown>)
        : null
  });
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
  const coords = itemCoordinates(booking);
  // The booking's OWN stored photos only (its photo_urls, else the
  // provider payload's nested set the market writers store) — the
  // same photo-truth rule as plan rows.
  const payload =
    booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, unknown>).providerPayload
      : null;
  const payloadPhotos =
    payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray((payload as Record<string, unknown>).photo_urls)
      ? ((payload as Record<string, unknown>).photo_urls as unknown[])
      : [];
  const bookingPhotos = Array.isArray(booking.photo_urls) ? (booking.photo_urls as unknown[]) : [];
  const ownPhoto = [...bookingPhotos, ...payloadPhotos].find((value) => typeof value === "string" && value.trim());
  return {
    itemId: "",
    itemType: bookingType,
    time: timing.start ? `${formatClock(timing.start)}${timing.end ? `–${formatClock(timing.end)}` : ""}` : "Flexible",
    sortMinutes: timing.start ? parseClockMinutes(timing.start) : null,
    title,
    // Confirmed bookings are verified records, never unverified stops.
    unverified: false,
    planTitle: null,
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
    retimedMinutes: null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    // A booking record's own coordinates are a true place point
    // (map-honesty fix, 2026-11-07).
    coordinateSource: coords ? "booking_record" : null,
    coordinatePrecision: coords ? "place" : null,
    provenance: null,
    legLabel: "",
    legMode: "",
    photoUrl: typeof ownPhoto === "string" ? ownPhoto.trim() : null,
    estimatedCost: null
  };
}

/** Pin verified booking times onto the day and insert bookings the plan missed. Returns how many items were consolidated.
 *  Owner-10 item 4: when keepStoredOrder is set (home view only),
 *  the final time-sort is skipped — the stored plan order IS the
 *  chronological order, and sorting by clock would strand the
 *  clock-less opening rows (the "Arrival" travel leg, the
 *  "Check-in" hotel row) at the end, which is exactly the bug the
 *  home timeline showed. Matched bookings keep their plan position
 *  (their time is still pinned); unmatched bookings append. */
function applyConfirmedBookings(
  output: DisplayTimelineItem[],
  dayDate: string,
  confirmedBookings: readonly Record<string, unknown>[],
  keepStoredOrder = false
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
      // Item 4 (2026-10-28): a plan stay row (check-in, check-out,
      // return to the stay) is NEVER promoted to confirmed by a
      // title match — it stays a Planned/arrival activity. The
      // booking is consumed (matched, so it is not appended as a
      // second row) but neither the row's authority nor its time
      // is changed, and it is not counted as consolidated.
      if (isPlanStayRow(output[index])) {
        matched = true;
        break;
      }
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
  if (!keepStoredOrder) {
    output.sort((a, b) => (a.sortMinutes ?? 10_000) - (b.sortMinutes ?? 10_000));
  }
  return consolidated;
}

export function buildDisplayTimelineItems(
  day: RoamlyItinerary["daily_itinerary"][number],
  confirmedBookings: readonly Record<string, unknown>[] = [],
  options: {
    suppressFlightFraming?: boolean;
    /** Owner-10 item 4, home view only: null = no row cap (the
     *  default 6 cut Day 1's theatre, pause, second gallery and
     *  return). Detail cards keep the default. */
    maxRows?: number | null;
    /** Owner-10 item 4, home view only: intercity "travel" legs
     *  render as their own rows instead of folding into the next
     *  stop. Walk "transfer" legs still fold (the mock shows no
     *  walk rows). */
    keepTravelRows?: boolean;
    /** Owner-10 item 4, home view only: keep stored plan order
     *  (see applyConfirmedBookings). */
    keepStoredOrder?: boolean;
    /** Locale for traveler-facing labels built here ("Planned · ", warnings). Defaults to "en". */
    locale?: RoamlyLocale;
  } = {}
) {
  const locale = options.locale ?? "en";
  const suppressFlightFraming = options.suppressFlightFraming === true;
  const maxRows = options.maxRows === null ? null : (options.maxRows ?? 6);
  const keepTravelRows = options.keepTravelRows === true;
  const keepStoredOrder = options.keepStoredOrder === true;
  const output: DisplayTimelineItem[] = [];
  const seen = new Set<string>();
  const pendingTransfers: string[] = [];
  /* The folded transfer's structured leg (stored minutes + mode),
   * consumed by the next pushed stop as its timeline-connector
   * leg. The LAST folded transfer wins — it is the leg that
   * actually arrives at the stop. */
  let pendingLeg: { minutes: number | null; mode: string } | null = null;

  for (const item of day.live_timeline || []) {
    const record = item as unknown as Record<string, unknown>;
    const transferLike = isTransferLike(record);
    const recordType = timelineText(record, "item_type", "type").toLowerCase();

    if (transferLike && !isMajorTravel(record) && !(keepTravelRows && recordType === "travel")) {
      const summary = transferSummary(record, suppressFlightFraming);
      if (summary) pendingTransfers.push(summary);
      pendingLeg = {
        minutes: timelineNumber(record, "travelTimeMinutes", "travel_time_minutes", "durationMinutes", "duration_minutes"),
        mode: timelineText(record, "travel_mode", "transportMode", "transport_mode")
      };
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
    const time = start && end ? `${timingStatus === "PLANNED" ? translateExactText(locale, "Planned · ") : ""}${formatClock(start)}–${formatClock(end)}` : timeLabel;
    const sortMinutes = parseClockMinutes(start || timeLabel);
    const duration = timelineNumber(record, "durationMinutes", "duration_minutes");
    const travelMinutes = timelineNumber(record, "travelTimeMinutes", "travel_time_minutes");
    const mapQuery = presentTravelerArea(timelineText(record, "map_query", "mapQuery"), suppressFlightFraming, category) || location || title;
    const isLunch = /\blunch\b/i.test(`${title} ${description} ${category}`);
    const warning =
      isLunch && sortMinutes != null && sortMinutes > 14 * 60
        ? translateExactText(locale, "Late lunch timing. Treat this as an intentional rest or adjust earlier.")
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
    const coords = itemCoordinates(record);

    if (!title && !description) continue;
    if (!transferLike && title && isGenericStopText(title) && (!location || isGenericStopText(location))) continue;

    const key = `${time}|${title}|${location}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Owner-10 item 5: the detail card obeys the same echo + junk
    // rules as the home panel rows — a title-echo description is
    // stripped (never shown as the description), and a bare-acronym
    // stop with no real description is flagged, not presented as a
    // venue. Transfer-note endpoints keep plan-point names: they are
    // route text between plan points, and the endpoint's own card
    // directly beneath carries the "Unverified stop" mapping.
    const strippedDescription = stripTitleEcho(title, description);
    const unverified = isUnverifiableStopTitle(title, strippedDescription);
    // Market provenance from the row's own stored binding fields
    // (description-boilerplate fix, 2026-11-07): drives the
    // legacy-stamp flattening context below and the row's
    // provenance chip. Engine/pack rows resolve to null and keep
    // rendering exactly as before.
    const provenance = marketProvenanceForStoredItem(
      timelineText(record, "source"),
      timelineText(record, "factualStatus", "factual_status")
    );
    // Coordinate provenance/precision from the stored record
    // (map-honesty fix, 2026-11-07): only the known literals are
    // honoured; anything else is unstamped (null), exactly like a
    // record written before the stamp existed.
    const rawCoordinatePrecision = timelineText(record, "coordinatePrecision", "coordinate_precision");
    const rawCoordinateSource = timelineText(record, "coordinateSource", "coordinate_source");
    const coordinatePrecision =
      rawCoordinatePrecision === "place" || rawCoordinatePrecision === "area"
        ? rawCoordinatePrecision
        : null;
    const coordinateSource =
      rawCoordinateSource === "candidate" ||
      rawCoordinateSource === "booking_record" ||
      rawCoordinateSource === "destination_centre"
        ? rawCoordinateSource
        : null;
    // Familiarity redesign (2026-11-09): the connector leg INTO
    // this stop — the folded transfer's stored minutes/mode when
    // one folded in (its minutes win; a minutes-less transfer
    // falls back to this record's own stored travel time), else
    // this record's own stored travelTimeMinutes + travel_mode.
    // No stored minutes anywhere → no leg is shown.
    const ownTravelMode = timelineText(record, "travel_mode", "transportMode", "transport_mode");
    const leg = pendingLeg
      ? { minutes: pendingLeg.minutes ?? travelMinutes, mode: pendingLeg.mode || ownTravelMode }
      : travelMinutes
        ? { minutes: travelMinutes, mode: ownTravelMode }
        : null;
    pendingLeg = null;
    const { legLabel, legMode } = composeTimelineLeg(leg);
    // The place's own stored photo (photo-truth law): the record's
    // photo_urls[0], else a singular stored photo field. Records
    // written today mostly carry none — photoUrl stays null and
    // the row renders its icon tile.
    const storedPhotos = Array.isArray(record.photo_urls) ? (record.photo_urls as unknown[]) : [];
    const firstStoredPhoto = storedPhotos.find((value) => typeof value === "string" && value.trim());
    const photoUrl =
      (typeof firstStoredPhoto === "string" ? firstStoredPhoto.trim() : "") ||
      timelineText(record, "photo_url", "photoUrl") ||
      null;

    output.push({
      itemId: timelineText(record, "item_id"),
      itemType: type,
      time: time || "Flexible",
      sortMinutes,
      // DISPLAY-ONLY rest wording (2026-10-28): the shown title is
      // shortened; unverified/planTitle above still use the raw
      // title, and itemType/category (what the count derivation
      // keys on) are untouched.
      title: displayRestTitle(title) || category,
      unverified,
      planTitle: unverified ? (title || category) : null,
      // DISPLAY-ONLY shortening (2026-10-28): the stored
      // description is untouched; only the shown string is
      // flattened (generic arrival-leg filler), with walk/drive
      // times, dietary facts, opening-hour notes, and genuine
      // directions kept verbatim. See activityDescription.ts.
      // The context (2026-11-07) lets the same layer flatten a
      // legacy market stamp into the composed one-liner from the
      // row's own stored fields; non-stamp text ignores it.
      description: displayActivityDescription(title, strippedDescription, {
        category,
        itemType: type,
        city: timelineText(record, "location_name", "location", "place_name", "venue", "area"),
        origin: timelineText(record, "origin"),
        provenance,
        genericStay:
          (type.toLowerCase() === "hotel" || category.toLowerCase().includes("hotel")) &&
          isGenericStayTitle(title)
      }),
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
      retimedMinutes,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      coordinateSource,
      coordinatePrecision,
      provenance,
      legLabel,
      legMode,
      photoUrl,
      estimatedCost: timelineNumber(record, "estimated_cost")
    });

    if (maxRows != null && output.length >= maxRows) break;
  }

  const consolidatedCount = applyConfirmedBookings(output, getString(day.date), confirmedBookings, keepStoredOrder);
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

/** True when a row's location label merely repeats the day's own
 *  city ("Montreal, Canada" on a Montreal day) — zero information,
 *  so the row suppresses it. A more specific area ("Old Montreal")
 *  is NOT the city label and survives. */
function isDayCityLabel(location: string, dayCity: string) {
  if (!location || !dayCity) return false;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const loc = norm(location);
  const city = norm(dayCity);
  if (!loc || !city) return false;
  return loc === city || loc.startsWith(`${city} `) || city.startsWith(`${loc} `);
}

/** THE ROW'S ONE SUB-LINE (familiarity redesign, 2026-11-09):
 *  at most one quiet line under a stop's name, carrying the single
 *  most useful fact — an unverified stop names its plan title; an
 *  area shows only when it says more than the day's city; a known
 *  price shows when there is no area worth showing; otherwise
 *  nothing. Exported for the boardui-day-map suite. */
export function dayRowSubLine(item: DisplayTimelineItem, dayCity: string, priceLabel: string): string {
  if (item.unverified && item.planTitle) return `Plan title: ${item.planTitle}`;
  if (item.location && !isDayCityLabel(item.location, dayCity)) return item.location;
  if (priceLabel) return priceLabel;
  return "";
}

/** The quiet icon tile a stop wears when its record carries no
 *  photo of its own — brand tint, never a stock stand-in. */
function tileIconForItem(item: DisplayTimelineItem, itemIsTravel: boolean) {
  const text = `${item.itemType} ${item.category}`.toLowerCase();
  if (itemIsTravel) {
    const route = `${text} ${item.title}`.toLowerCase();
    if (/flight|plane/.test(route)) return Plane;
    if (/train|rail/.test(route)) return TrainFront;
    if (/ferry|boat/.test(route)) return Ship;
    if (/bus|coach/.test(route)) return Bus;
    if (/walk/.test(route)) return Footprints;
    return Car;
  }
  if (/\b(hotel|lodging|accommodation|hostel|stay)\b/.test(text) || /^stay\b/.test(item.title.toLowerCase())) return BedDouble;
  if (/meal|food|restaurant|dining|lunch|dinner|breakfast|cafe|café/.test(text)) return UtensilsCrossed;
  if (item.itemType === "rest" || /\brest\b/.test(text)) return Coffee;
  return MapPin;
}

/** The connector strip's icon for a leg's stored mode word. */
function legIconForMode(legMode: string) {
  if (legMode === "walk") return Footprints;
  if (legMode === "flight") return Plane;
  if (legMode === "train") return TrainFront;
  if (legMode === "bus") return Bus;
  if (legMode === "ferry") return Ship;
  if (legMode === "drive" || legMode === "taxi") return Car;
  return MoveRight;
}
export function TimelineItemCard({
  item,
  tripId,
  staySearch,
  index = 0,
  dayCity = "",
  priceLabel = "",
  isLast = false,
  locale = "en"
}: {
  item: DisplayTimelineItem;
  tripId: string;
  staySearch?: StaySearchContext | null;
  index?: number;
  /** The day's own city label — a stop location that merely
   *  repeats it is suppressed from the row's sub-line. */
  dayCity?: string;
  /** The stop's known price, pre-formatted in the trip currency;
   *  "" when the cost is unknown (silence on the row). */
  priceLabel?: string;
  /** Locale for traveler-facing labels ("Booked"). Defaults to "en". */
  locale?: RoamlyLocale;
  /** The timeline's last row: the connector line ends at its dot. */
  isLast?: boolean;
}) {
  const stayPartners = stayPartnersForItem(item, staySearch);
  /* Familiarity redesign (2026-11-09, owner rejection of the
   * batch-1 face): the ONLY status on the row is "Booked" for a
   * confirmed booking — the one state that changes what the
   * traveller does. Time provenance, sourcing provenance, and
   * price/route states never render here: a stored time simply
   * renders as a time, an unknown price is silence, and the
   * detail view carries the rest. The removal/replacement
   * controls moved into the place detail (same gate as before);
   * the row is one tap target, not a form. */
  const isConfirmed = item.authority === "confirmed";
  const itemIsTravel = isTravelLeg({ title: item.title, category: item.category || item.itemType });
  const subLine = dayRowSubLine(item, dayCity, priceLabel);
  const TileIcon = tileIconForItem(item, itemIsTravel);
  const railTime = item.time === "Flexible" ? "" : mockRowTime(item.time);
  const placeHref = item.itemId ? `/trip/${tripId}/place/${item.itemId}` : null;
  const title = item.unverified ? "Unverified stop" : item.title;
  return (
    <article className="bui-enter relative flex gap-3 px-4 py-3" style={{ "--bui-delay": `${Math.min(index * 70, 350)}ms` } as CSSProperties}>
      {/* Time rail: the start time, with the stored duration quiet
          beneath it. Label times ("Arrival", "Check-in") read as
          themselves; "Flexible" rows keep an empty rail. */}
      <div className="w-[52px] shrink-0 pt-[2px] text-right">
        {railTime ? <p className="text-[13px] font-semibold leading-[1.3] text-chead">{railTime}</p> : null}
        {item.durationLabel ? <p className="mt-0.5 text-[11px] leading-[1.3] text-cgray2">{item.durationLabel}</p> : null}
      </div>
      {/* Timeline spine: a dot on a hairline that runs down to the
          next row (through any leg strip between them) and stops
          at the last row's dot. A confirmed booking's dot is
          filled; every other stop's is a ring. */}
      <div aria-hidden="true" className="relative flex w-[11px] shrink-0 justify-center">
        {!isLast ? <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-chair" /> : null}
        <span className={`relative mt-[6px] h-[9px] w-[9px] shrink-0 rounded-full ${isConfirmed ? "bg-cblue" : "border-2 border-cblue bg-white"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="break-words text-[17px] font-semibold leading-[1.35] text-chead">
              {placeHref ? (
                <a href={placeHref} className="after:absolute after:inset-0 after:content-['']">
                  {title}
                </a>
              ) : (
                title
              )}
            </h4>
            {isConfirmed || subLine ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {isConfirmed ? <BuiChip tone="navy">{translateExactText(locale, "Booked")}</BuiChip> : null}
                {subLine ? <p className="text-[13.5px] font-normal leading-[1.4] text-cgray">{subLine}</p> : null}
              </div>
            ) : null}
          </div>
          {item.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- the stop's own stored photo URL; next/image remote hosts are not configured for arbitrary stored URLs. */
            <img src={item.photoUrl} alt="" loading="lazy" className="bui-squircle h-16 w-16 shrink-0 rounded-[18px] object-cover" />
          ) : (
            <span aria-hidden="true" className="bui-squircle flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] bg-cblue/10 text-cblue">
              <TileIcon size={22} strokeWidth={1.9} />
            </span>
          )}
        </div>
        {item.warning ? <p className="mt-2 text-xs font-semibold leading-5 text-cred">{item.warning}</p> : null}
        {stayPartners.length ? (
          <div className="relative z-10 mt-1">
            <HotelPartnerChoices
              partners={stayPartners}
              tripId={tripId}
              title={item.title}
              priceNote={item.statusText === "Price not available" ? null : "Price not available"}
            />
          </div>
        ) : null}
      </div>
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
  locale: RoamlyLocale;
  confirmedBookings: readonly Record<string, unknown>[];
  suppressFlightFraming?: boolean;
  staySearch?: StaySearchContext | null;
}) {
  const { items: timelineItems } = buildDisplayTimelineItems(day, confirmedBookings, { suppressFlightFraming, locale });
  // ONE STOP-COUNT RULE (2026-10-28): the card's rendered
  // timeline keeps its 6-row cap, but its summary is derived
  // from the day's FULL itinerary — the SAME builder options the
  // home panel uses (maxRows: null, keepTravelRows: true,
  // keepStoredOrder: true) — so a capped card can never print a
  // different total from the panel. keepTravelRows matters too:
  // without it the travel leg folds away and the card loses the
  // destination clause the panel prints. The full list is used
  // ONLY for the summary; the rendered rows below are still
  // `timelineItems` (capped).
  const fullTimelineItems = buildDisplayTimelineItems(day, confirmedBookings, { suppressFlightFraming, maxRows: null, keepTravelRows: true, keepStoredOrder: true, locale }).items;
  const places = [
    ...timelineItems.map((item) => item.mapQuery),
    ...day.map_queries
  ]
    .map((item) => getString(item))
    .filter((item) => item && !isGenericStopText(item) && !isNonPlaceMapLabel(item) && !looksLikeProviderSearchTitle(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 5);
  // DISPLAY-ONLY day summary (final local round, 2026-10-27):
  // derived at render time from this day's displayed timeline
  // items — counts, arrival, and times all come from the items
  // themselves. The stored text below is used ONLY as the
  // no-items fallback; it is never written back or modified here.
  const rawDaySummary = day.primary_plan || day.morning || day.afternoon || day.evening;
  const summaryItems = fullTimelineItems.map((item) => ({
    time: item.time,
    title: item.title,
    itemType: item.itemType,
    category: item.category,
    description: item.description,
    unverified: item.unverified,
    planTitle: item.planTitle
  }));
  const derivedDaySummary = deriveDaySummary(summaryItems, locale);
  const daySummary = compact(
    derivedDaySummary || presentTravelerArea(rawDaySummary, suppressFlightFraming),
    timelineItems.length ? translateExactText(locale, "Your selected day, in order.") : translateExactText(locale, "No fixed plan yet. Keep this day flexible until more evidence is available."),
    160
  );
  const dayCity = presentTravelerArea(day.city, suppressFlightFraming);
  // Familiarity redesign (2026-11-09): the day header is ONE quiet
  // line — the stop count under the ONE count rule plus the first
  // timed stop's clock, both from the day's FULL rows. The derived
  // summary sentence survives only as the fallback for a day with
  // no countable stops (arrival / open days), where it IS the
  // single line. The old header stack (venue headings, the
  // confirmed-bookings line, the summary paragraph, a paragraph
  // duplicating the first stop, and the rest/wrap line)
  // is gone — the owner read it as a form, not a day.
  const stopCount = countDayStops(summaryItems);
  const firstStopClock = (() => {
    for (const item of fullTimelineItems) {
      if (/\brest\b/.test(`${item.itemType} ${item.category}`.toLowerCase())) continue;
      if (isTravelLeg({ title: item.title, category: item.category || item.itemType })) continue;
      const clock = daySummaryStartClock(item.time);
      if (clock) return clock;
    }
    return null;
  })();
  const quietLine =
    stopCount > 0
      ? `${stopCount} ${stopCount === 1 ? "stop" : "stops"}${firstStopClock ? ` · first at ${firstStopClock}` : ""}`
      : daySummary;
  // Round 2 HIGH 3: same separation as CurrentDayTimeline — a merged
  // day title renders as one heading per venue, a travel leg is labeled
  // Travel, and an unconfident join renders no venue heading at all.
  // (Since the familiarity redesign the headings themselves no
  // longer render on the card; the kind still feeds the day's
  // uncertainty notes below.)
  const dayHeading = presentDayHeading({
    title: day.title,
    destination: dayCity || day.city,
    suppressFlightFraming
  });
  // Correction phase (D4, 2026-10-28): name WHAT is unconfirmed
  // (day notes, row status texts, unconfident heading join, uncertain
  // plan status) instead of the content-free "Some details still need
  // confirmation." When nothing specific is unconfirmed, no line
  // renders at all.
  const uncertaintyNotes = dayUncertaintyNotes({
    headingKind: dayHeading.kind,
    planStatus: day.plan_status,
    uncertainty: day.uncertainty,
    statusTexts: timelineItems.map((item) => item.statusText)
  });
  // Familiarity redesign (2026-11-09): uncertainty notes render
  // ONLY inside the day-level Planning notes section below — never
  // as a header line. The estimates honesty survives as ONE small
  // line at the day FOOT (below), gated on the day holding planned
  // (non-booking) clock times. The old joined paragraph of machine
  // stamps never renders — dayUncertaintyNotes filters them out at
  // the source (batch 1, kept).
  const hasPlannedRows = timelineItems.some(
    (item) => !item.unverified && !item.timeFromBooking && /^\d{1,2}:\d{2}/.test(mockRowTime(item.time))
  );
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

      <div className="bui-squircle overflow-hidden rounded-bui-card border border-chair bg-white shadow-bui-card">
        <div className="px-4 pt-3.5">
          <p className="text-[13.5px] font-normal leading-5 text-cgray">{quietLine}</p>
        </div>

        {repairCandidate ? (
          <div className="px-4 pt-3">
            <PlanningConflictRepair tripId={tripId} conflictId={repairCandidate.target.conflictId} dayId={day.day_id!} targetItemId={repairCandidate.target.itemId} targetTitle={repairCandidate.target.title} protectedTitles={timelineItems.filter((item) => item.authority === "confirmed" || item.authority === "must_do").map((item) => item.title)} />
          </div>
        ) : null}

        <div className="mt-3 border-t border-chair">
          {timelineItems.length ? (
            timelineItems.map((item, index) => {
              const LegIcon = legIconForMode(item.legMode);
              return [
                item.legLabel ? (
                  <div key={`leg-${day.day_number}-${index}`} className="flex gap-3 px-4" role="img" aria-label={`Travel to this stop: ${item.legLabel}`}>
                    <div className="w-[52px] shrink-0" />
                    <div aria-hidden="true" className="relative flex w-[11px] shrink-0 justify-center">
                      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-chair" />
                    </div>
                    <div aria-hidden="true" className="flex items-center gap-1.5 py-1 text-[12px] font-medium leading-[1.35] text-cgray2">
                      <LegIcon size={13} strokeWidth={2} />
                      {item.legLabel}
                    </div>
                  </div>
                ) : null,
                <TimelineItemCard
                  key={`${day.day_number}-${item.time}-${item.title}-${index}`}
                  item={item}
                  tripId={tripId}
                  staySearch={staySearch}
                  index={index}
                  dayCity={dayCity}
                  priceLabel={item.estimatedCost != null && item.estimatedCost > 0 ? formatMoney(item.estimatedCost, currency) : ""}
                  isLast={index === timelineItems.length - 1}
                  locale={locale}
                />
              ];
            })
          ) : (
            <div className="px-4 py-4 text-sm font-normal leading-6 text-cink">{translateExactText(locale, "This day is intentionally open. Add a confirmed plan or keep space for the moment.")}</div>
          )}
        </div>

        {day.alternatives?.length || uncertaintyNotes.length ? (
          <BuiAccordion
            className="border-t border-chair px-4 py-1.5"
            buttonClassName="text-[13px] font-semibold text-chead"
            title={translateExactText(locale, "Planning notes")}
          >
            <div className="grid gap-3 pb-2">
              {day.alternatives?.length ? (
                <div>
                  <p className="text-xs font-semibold text-cgray2">{translateExactText(locale, "Alternatives")}</p>
                  <p className="mt-1 text-sm font-normal leading-6 text-cink">{day.alternatives.slice(0, 3).join(" · ")}</p>
                </div>
              ) : null}
              {uncertaintyNotes.length ? (
                <div>
                  <p className="text-xs font-semibold text-cgray2">{translateExactText(locale, "Still to confirm")}</p>
                  <p className="mt-1 text-sm font-normal leading-6 text-cink">{uncertaintyNotes.slice(0, 3).join(" · ")}</p>
                </div>
              ) : null}
            </div>
          </BuiAccordion>
        ) : null}

        {day.food.length ? (
          <BuiAccordion
            className="border-t border-chair px-4 py-1.5"
            buttonClassName="text-[13px] font-semibold text-chead"
            title={translateExactText(locale, "Food ideas")}
          >
            <p className="pb-2 text-sm font-normal leading-6 text-cink">{day.food.slice(0, 3).join(" · ")}</p>
          </BuiAccordion>
        ) : null}

        {places.length ? (
          <BuiAccordion
            className="border-t border-chair px-4 py-1.5"
            buttonClassName="text-[13px] font-semibold text-chead"
            title={translateExactText(locale, "Map details")}
          >
            <div className="grid gap-3 pb-2 md:grid-cols-2">
              {places.map((query) => (
                <div key={query} className="bui-squircle rounded-bui-card border border-chair bg-cbg px-3.5 py-3">
                  <p className="text-sm font-semibold leading-5 text-chead">{query}</p>
                  <MapPlaceLinks query={query} />
                </div>
              ))}
            </div>
          </BuiAccordion>
        ) : null}
        {hasPlannedRows ? (
          <p className="border-t border-chair px-4 py-2.5 text-[12px] leading-5 text-cgray2">{translateExactText(locale, "Times and prices marked planned are estimates — check before you go.")}</p>
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
      <div className="bui-squircle rounded-bui-card border border-chair bg-white px-4 py-4 shadow-bui-card">
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
