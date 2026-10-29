/*
 * Place detail — panel 6 of the owner mock (correct-4-pages-part2.jpg,
 * 2nd panel): photo + planned time range + duration + description;
 * actions Directions / Add to calendar / Save; "About this place"
 * (Address, photos, opening hours, ticket info, helpful tips);
 * Nearby places with walk times; "Tips for your visit" checklist.
 *
 * REAL-DATA-ONLY RULES (this module is pure: no fetch, no DB, no
 * network — every claim it makes comes from its inputs, so the
 * checks script can prove each rule without a server):
 *
 * - The place shown is ALWAYS one live_timeline item of the trip's
 *   own itinerary (see resolvePlaceInItinerary). The resolver never
 *   searches another trip, a search suggestion, or a pack candidate,
 *   so per-trip isolation is structural, not a display promise.
 * - Mock sample values are never defaults here: no place name, time,
 *   description, nearby name, or walk time is hardcoded anywhere in
 *   this file. A missing field renders as null and the panel shows
 *   an honest unavailable state for it.
 * - Photos: the caller supplies at most the ONE photo the existing
 *   destination-photo pipeline returned for this place
 *   (lib/roamly/destinationPhoto.ts, Wikimedia/Wikidata, cached).
 *   The pipeline never returns six photos, so the count badge is
 *   "1/1" when a photo exists and absent entirely otherwise — the
 *   mock's "1/6" is never copied. No photo -> bare treatment.
 * - About fields: Address comes ONLY from an exactly-title-matched
 *   confirmed booking row (see findConfirmedBookingForPlace); the
 *   plan item's location_name/map_query is an area label, NOT a
 *   street address, and is never relabeled as one. Opening hours and
 *   ticket info have NO traveler-facing source for a plan item (the
 *   Places pack enrichment is keyed by pack candidates, not by
 *   itinerary item_id, and is never surfaced to traveler UI), so
 *   they are always null here — the panel says so per field.
 * - Nearby: ONLY same-day sibling stops from this trip's own plan
 *   (travel/transfer legs and generic stops excluded), CAPPED AT 2
 *   (Picture 6 shows two cards). Sibling photos come only from the
 *   real pipeline via the caller's siblingPhotos map (coords-gated);
 *   a sibling without one gets no photo element, never a broken
 *   image, and NO heart icon renders — no saved-places store exists.
 *   Walk times
 *   are NOT routed: the codebase's only routing source
 *   (lib/roamly/liveRouting.ts, Google Distance Matrix) needs a live
 *   origin and serves the live companion only. When BOTH stops carry
 *   coordinates (seed.coordinates {latitude, longitude}), the walk
 *   time is a haversine estimate at 4.8 km/h and is ALWAYS labeled
 *   "(est.)". When either side lacks coordinates, the walk time is
 *   null and the panel says "Walk time unavailable" — never a guess.
 * - Tips: there is NO per-place tips field on a plan item. The only
 *   real tip data is the trip's own itinerary.local_tips, shown with
 *   the provenance note "From this trip's plan". Empty -> null.
 * - Actions: Directions is a Google Maps dir link built from the
 *   item's own coordinates or map query (always valid while the
 *   item has a title). Add to calendar and Save have NO mechanism in
 *   this codebase (no ICS/calendar export, no saved-places store),
 *   so this module exposes them as unavailable — the panel renders
 *   them disabled with an explanation, never as working buttons.
 *
 * EVIDENCE BOUNDARIES (what each badge/claim is allowed to mean):
 * - Planned: the item is in this trip's plan. Always true for a
 *   resolved item; the badge reads "Planned" unless a confirmed
 *   booking anchors it (see Confirmed).
 * - Time-eligible: a time range is shown ONLY when the item carries
 *   a real planned window (start + end, or a parseable time_label
 *   range). Otherwise the panel shows "Flexible" and no clock times.
 * - Location-verified: a Directions link is built ONLY from the
 *   item's own coordinates / map_query / title (+ destination city),
 *   never from a guessed address; an Address row needs the confirmed
 *   booking source above.
 * - Confirmed: the badge reads "Confirmed" ONLY when a confirmed
 *   booking row exactly title-matches the item (same rule the trip
 *   page uses for booking snapshots: not superseded, and either
 *   traveler-confirmed or a confirmed/booked/ticketed/issued
 *   status). Plan data alone never earns "Confirmed".
 *
 * All clock math here is wall-clock string math (never Date), so
 * rendering is identical under every TZ. Day headings are computed
 * with timeZone "UTC" over a UTC-noon date, so the weekday never
 * shifts with the viewer's timezone.
 */

export type PlaceDetailPhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
  /** Always "1/1": the pipeline returns at most one photo per place. */
  countLabel: "1/1";
  source: "wikimedia-commons";
};

export type PlaceDetailNearby = {
  /** item_id when the sibling carries one, else the deterministic fallback id. */
  id: string;
  title: string;
  /** Owner-10 item 5: unverifiable junk-title sibling — the card
   *  renders "Unplanned stop" with the plan title kept. */
  unverified: boolean;
  planTitle: string | null;
  /** Real pipeline photo for this sibling, or null (no photo element). */
  photo: PlaceDetailPhotoInput | null;
  /** e.g. "8 min walk (est.)" — null when either side lacks coordinates. */
  walkLabel: string | null;
  /** Straight-line km, 1 decimal, when both sides carry coordinates. */
  distanceKm: number | null;
};

export type PlaceDetailAbout = {
  /** ONLY from an exactly-matched confirmed booking row; else null. */
  address: string | null;
  /** No traveler-facing source for a plan item: always null today. */
  openingHours: string[] | null;
  /** No traveler-facing source for a plan item: always null today. */
  ticketInfo: string | null;
  /** True when the trip's own local_tips are non-empty. */
  tipsAvailable: boolean;
};

export type PlaceDetailEvidence = {
  planned: true;
  /** True when a real planned time window exists. */
  timeKnown: boolean;
  /** True when the item carries coordinates or a map query. */
  locationKnown: boolean;
  /** True only when a confirmed booking exactly title-matches. */
  confirmed: boolean;
};

/**
 * Owner-10 item 5 — the same title-echo rule as
 * itineraryHome.stripTitleEcho, duplicated here because this module
 * is loaded directly by deterministic Node checks.
 */
export function stripPlaceTitleEcho(title: string, detail: string | null): string | null {
  const text = (detail || "").trim();
  if (!text) return null;
  const plain = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (plain(text) === plain(title)) return null;
  let out = text;
  const rawTitle = (title || "").trim();
  if (rawTitle && text.toLowerCase().startsWith(rawTitle.toLowerCase())) {
    out = text.slice(rawTitle.length);
  } else if (rawTitle && plain(text).startsWith(plain(rawTitle))) {
    const dash = text.search(/[—–-]/);
    if (dash !== -1) out = text.slice(dash + 1);
  } else {
    return text;
  }
  out = out.trim().replace(/^[—–-]\s*/, "").trim();
  if (/^planned for day \d+ of this trip\.?$/i.test(out)) return null;
  return out || null;
}

export type PlaceDetail = {
  placeId: string;
  dayNumber: number;
  dayLabel: string;
  title: string;
  /** Owner-10 item 5: true for an unverifiable junk-title stop; the
   *  panel renders "Unplanned stop" with planTitle kept. */
  unverified: boolean;
  /** The stored plan title when unverified; null otherwise. */
  planTitle: string | null;
  description: string | null;
  badge: "Planned" | "Confirmed";
  evidence: PlaceDetailEvidence;
  /** e.g. "1:00 PM – 3:00 PM" — null when no real window exists. */
  timeRangeLabel: string | null;
  /**
   * Repair round item 1 — the time window's provenance, mirroring
   * lib/roamly/timeProvenance.ts provenanceForPlaceTime (kept inline
   * so this module stays import-free): "confirmed" only when the
   * record's timing_status is FACTUAL; "estimated" when the record
   * carries retimed_by_event (a recalculation, not the original plan
   * window); otherwise "planned" (the original stored plan window,
   * unchanged). The badge above is a separate fact (booking status
   * for the place); it never upgrades this window on its own.
   */
  timeProvenance: "planned" | "estimated" | "confirmed";
  /** e.g. "2h" / "45m" / "1h 15m" — null when not derivable. */
  durationLabel: string | null;
  /** Area label from the plan (NOT a street address); null when it duplicates the title. */
  locationLabel: string | null;
  /** Google Maps dir link from the item's own data; null only if no query exists. */
  directionsUrl: string | null;
  photo: PlaceDetailPhoto | null;
  about: PlaceDetailAbout;
  nearby: PlaceDetailNearby[];
  /** The trip's own local_tips; empty array when the trip has none. */
  tips: string[];
  /** Provenance note for tips; null when there are no tips. */
  tipsProvenance: string | null;
  tripHeader: {
    destination: string;
    origin: string | null;
    /** e.g. "Oct 26 – Oct 30, 2026" — null when no trip dates exist. */
    dateRangeLabel: string | null;
  };
};

export type PlaceDetailPhotoInput = {
  imageUrl: string;
  credit?: string | null;
  pageUrl?: string | null;
};

type RawRecord = Record<string, unknown>;

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanFrom(record: RawRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return null;
}

function numberFrom(record: RawRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Titles the bundle itself marks as unresolved — never a place. */
const UNUSABLE_TITLE = /^(?:unresolved place|unknown place|unknown location|location unavailable|no destination selected|not available|n\/a|tbd)$/i;

export function isUsablePlaceTitle(value: unknown): value is string {
  const title = clean(value);
  if (!title || UNUSABLE_TITLE.test(title)) return false;
  return !/\bschemas\.live\.com\b/i.test(title);
}

/** Normalized title for EXACT matching only — fuzzy matching could
 *  attach another booking's address or Confirmed badge to this place. */
export function normalizePlaceTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CONFIRMED_BOOKING_STATUSES = new Set(["confirmed", "booked", "ticketed", "issued"]);

/**
 * The trip page's booking-snapshot rule, applied with an EXACT title
 * match: not superseded, and either traveler-confirmed or a confirmed
 * status. Returns the matching row (for its address) or null.
 */
export function findConfirmedBookingForPlace(
  bookings: readonly RawRecord[],
  title: string
): RawRecord | null {
  const wanted = normalizePlaceTitle(title);
  if (!wanted) return null;
  for (const booking of bookings) {
    if (booking.superseded_by_booking_id != null) continue;
    const bookingTitle = cleanFrom(booking, "title");
    if (!bookingTitle || normalizePlaceTitle(bookingTitle) !== wanted) continue;
    const status = (cleanFrom(booking, "booking_status", "status") || "").toLowerCase();
    if (booking.traveler_confirmed === true || CONFIRMED_BOOKING_STATUSES.has(status)) return booking;
  }
  return null;
}

/** "13:00" or "1:00 PM" -> minutes since midnight; null when unparseable. */
export function parseClockMinutes(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const twelve = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|AM|PM)$/i);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  const minute = Number(twelve[2] || "0");
  const period = twelve[3].replace(/\./g, "").toUpperCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** Minutes since midnight -> "1:00 PM" (the mock's clock style). */
export function formatClockMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "2 hours" / "90 min" style strings -> minutes; null when unparseable. */
export function parseDurationMinutes(value: string): number | null {
  const raw = value.trim().toLowerCase();
  const hoursOnly = raw.match(/^(\d+)\s*(?:hours?|hrs?|h)$/);
  if (hoursOnly) return Number(hoursOnly[1]) * 60;
  const minutesOnly = raw.match(/^(\d+)\s*(?:minutes?|mins?|m)$/);
  if (minutesOnly) return Number(minutesOnly[1]);
  const combined = raw.match(/^(\d+)\s*(?:hours?|hrs?|h)\s+(\d+)\s*(?:minutes?|mins?|m)$/);
  if (combined) return Number(combined[1]) * 60 + Number(combined[2]);
  return null;
}

/** Minutes -> "2h" / "45m" / "1h 15m" (the mock's duration style). */
export function formatDurationMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}m`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}m`;
}

function parseDayParts(date: string): { year: number; month: number; day: number } | null {
  const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** TZ-invariant: weekday/month/day from a YYYY-MM-DD date via UTC. */
export function formatDayLabel(date: string | null, dayNumber: number): string {
  const base = `Day ${dayNumber}`;
  if (!date) return base;
  const parts = parseDayParts(date);
  if (!parts) return base;
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  if (Number.isNaN(utc.getTime())) return base;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(utc);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc);
  return `${base} · ${weekday}, ${monthDay}`;
}

function formatMonthDayYear(date: string | null): string | null {
  if (!date) return null;
  const parts = parseDayParts(date);
  if (!parts) return null;
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  if (Number.isNaN(utc.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utc);
}

export function formatTripDateRange(start: string | null, end: string | null): string | null {
  const startLabel = formatMonthDayYear(start);
  const endLabel = formatMonthDayYear(end);
  if (startLabel && endLabel) {
    // "Oct 26 – Oct 30, 2026": drop the start year when both share it.
    const startParts = parseDayParts(start || "");
    const endParts = parseDayParts(end || "");
    if (startParts && endParts && startParts.year === endParts.year) {
      const utc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 12));
      const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc);
      return `${short} – ${endLabel}`;
    }
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel || endLabel;
}

/** Mirror of the timeline's transfer test: travel legs are not places. */
export function isTransferLikeItem(record: RawRecord): boolean {
  const text = [
    cleanFrom(record, "item_type", "type"),
    cleanFrom(record, "category"),
    cleanFrom(record, "title"),
    cleanFrom(record, "travel_mode", "transportMode", "transport_mode")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(travel|transfer|transit|taxi|rideshare|shuttle|walk to|travel to|transfer to|drive to|get to)\b/.test(text);
}

export function itemCoordinates(record: RawRecord): { latitude: number; longitude: number } | null {
  const directLat = numberFrom(record, "latitude");
  const directLon = numberFrom(record, "longitude");
  if (directLat != null && directLon != null) return { latitude: directLat, longitude: directLon };
  const coords = record.coordinates;
  if (coords && typeof coords === "object" && !Array.isArray(coords)) {
    const nested = coords as RawRecord;
    const lat = numberFrom(nested, "latitude", "lat");
    const lon = numberFrom(nested, "longitude", "lon", "lng");
    if (lat != null && lon != null) return { latitude: lat, longitude: lon };
  }
  return null;
}

/** Straight-line km between two coordinate pairs. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const WALK_KM_PER_HOUR = 4.8;

/**
 * Haversine walk estimate, ALWAYS labeled "(est.)" — this is not a
 * routed walk time. Null when either side lacks coordinates.
 */
export function estimateWalk(
  from: { latitude: number; longitude: number } | null,
  to: { latitude: number; longitude: number } | null
): { walkLabel: string; distanceKm: number } | null {
  if (!from || !to) return null;
  const km = haversineKm(from, to);
  const minutes = Math.max(1, Math.round((km / WALK_KM_PER_HOUR) * 60));
  return { walkLabel: `${minutes} min walk (est.)`, distanceKm: Math.round(km * 10) / 10 };
}

/** Google Maps dir link from the item's own data (mirrors mapsUrlForActivity's shape, walking mode). */
export function buildDirectionsUrl(
  item: RawRecord,
  destination: string | null
): string | null {
  const coords = itemCoordinates(item);
  let query: string | null = null;
  if (coords) {
    query = `${coords.latitude},${coords.longitude}`;
  } else {
    const parts = [
      cleanFrom(item, "map_query", "mapQuery"),
      cleanFrom(item, "location_name", "location", "place_name"),
      cleanFrom(item, "title")
    ].filter((part): part is string => Boolean(part));
    // The destination city is appended only when the query does not
    // already name it — a map_query like "X, Montreal" must not become
    // "X, Montreal, Montreal, Canada".
    const cityPart = destination ? destination.split(",")[0].trim() : "";
    if (destination && cityPart && !parts.join(", ").toLowerCase().includes(cityPart.toLowerCase())) parts.push(destination);
    query = parts.join(", ");
  }
  if (!query) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&travelmode=walking`;
}

/** Deterministic fallback id when a stored item carries no item_id. */
export function fallbackPlaceId(dayNumber: number, index: number): string {
  return `d${dayNumber}-${index}`;
}

export type PlaceDayInput = {
  day_number: number;
  date?: string | null;
  live_timeline: readonly RawRecord[];
};

export type PlaceDetailInput = {
  item: RawRecord;
  day: PlaceDayInput;
  /** Raw sibling items from the SAME day of the SAME trip. */
  siblings: readonly { item: RawRecord; id: string }[];
  trip: {
    destination: string | null;
    origin: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  /** The trip's own itinerary.local_tips (real plan data, or []). */
  tripTips: readonly string[];
  confirmedBookings: readonly RawRecord[];
  photo: PlaceDetailPhotoInput | null;
  /** Real pipeline photos for siblings, keyed by sibling id. */
  siblingPhotos?: Readonly<Record<string, PlaceDetailPhotoInput>>;
};

function timeWindow(item: RawRecord): { rangeLabel: string; durationFromWindow: number | null } | null {
  const startRaw = cleanFrom(item, "startTime", "start_time");
  const endRaw = cleanFrom(item, "endTime", "end_time");
  const start = startRaw ? parseClockMinutes(startRaw) : null;
  const end = endRaw ? parseClockMinutes(endRaw) : null;
  if (start != null && end != null && end > start) {
    return { rangeLabel: `${formatClockMinutes(start)} – ${formatClockMinutes(end)}`, durationFromWindow: end - start };
  }
  // A time_label range ("1:00 PM – 3:00 PM") is a real planned window too.
  const label = cleanFrom(item, "time_label", "time");
  if (label) {
    const parts = label.split(/–|-/).map((part) => part.trim());
    if (parts.length === 2) {
      const labelStart = parseClockMinutes(parts[0]);
      const labelEnd = parseClockMinutes(parts[1]);
      if (labelStart != null && labelEnd != null && labelEnd > labelStart) {
        return { rangeLabel: `${formatClockMinutes(labelStart)} – ${formatClockMinutes(labelEnd)}`, durationFromWindow: labelEnd - labelStart };
      }
    }
  }
  return null;
}

export function buildPlaceDetail(input: PlaceDetailInput): PlaceDetail | null {
  const { item, day, siblings, trip, tripTips, confirmedBookings, photo } = input;
  const title = cleanFrom(item, "title", "name");
  if (!title || !isUsablePlaceTitle(title)) return null;

  const rawDescription = cleanFrom(item, "description", "summary", "details", "notes");
  const description = stripPlaceTitleEcho(title, rawDescription);
  // Owner-10 item 5: a bare-acronym stop with no real description is
  // not a venue. It stays a reachable, plainly-labeled unplanned item.
  const unverified = /^[A-Z0-9]{2,4}$/.test(title) && description == null;
  const window = timeWindow(item);
  const explicitMinutes = numberFrom(item, "durationMinutes", "duration_minutes");
  const durationRaw = cleanFrom(item, "duration");
  const durationMinutes =
    explicitMinutes != null && explicitMinutes > 0
      ? explicitMinutes
      : window?.durationFromWindow ?? (durationRaw ? parseDurationMinutes(durationRaw) : null);
  const durationLabel = formatDurationMinutes(durationMinutes ?? NaN) ?? (durationRaw && parseDurationMinutes(durationRaw) == null ? durationRaw : null);

  const confirmedBooking = findConfirmedBookingForPlace(confirmedBookings, title);
  const confirmed = confirmedBooking != null;
  const address = confirmedBooking ? cleanFrom(confirmedBooking, "address") : null;

  const locationRaw = cleanFrom(item, "location_name", "location", "place_name", "venue");
  const locationLabel = locationRaw && normalizePlaceTitle(locationRaw) !== normalizePlaceTitle(title) ? locationRaw : null;
  const mapQuery = cleanFrom(item, "map_query", "mapQuery");
  const coords = itemCoordinates(item);
  const locationKnown = coords != null || mapQuery != null || locationLabel != null;

  const selfCoords = coords;
  const nearby: PlaceDetailNearby[] = [];
  const selfId = inputPlaceId(item, day);
  for (const sibling of siblings) {
    if (sibling.item === item) continue;
    const siblingTitle = cleanFrom(sibling.item, "title", "name");
    if (!siblingTitle || !isUsablePlaceTitle(siblingTitle)) continue;
    if (sibling.id === selfId) continue;
    if (isTransferLikeItem(sibling.item)) continue;
    const walk = estimateWalk(selfCoords, itemCoordinates(sibling.item));
    const siblingDescription = stripPlaceTitleEcho(
      siblingTitle,
      cleanFrom(sibling.item, "description", "summary", "details", "notes")
    );
    const siblingUnverified = /^[A-Z0-9]{2,4}$/.test(siblingTitle) && siblingDescription == null;
    nearby.push({
      id: sibling.id,
      title: siblingTitle,
      unverified: siblingUnverified,
      planTitle: siblingUnverified ? siblingTitle : null,
      photo: input.siblingPhotos?.[sibling.id] ?? null,
      walkLabel: walk?.walkLabel ?? null,
      distanceKm: walk?.distanceKm ?? null
    });
    if (nearby.length >= 2) break;
  }

  const tips = Array.from(
    new Set(tripTips.map((tip) => (typeof tip === "string" ? tip.trim() : "")).filter(Boolean))
  );

  return {
    placeId: inputPlaceId(item, day),
    dayNumber: day.day_number,
    dayLabel: formatDayLabel(day.date ?? null, day.day_number),
    title,
    unverified,
    planTitle: unverified ? title : null,
    description,
    badge: confirmed ? "Confirmed" : "Planned",
    evidence: { planned: true, timeKnown: window != null, locationKnown, confirmed },
    timeRangeLabel: window?.rangeLabel ?? null,
    timeProvenance:
      (cleanFrom(item, "timing_status") || "").toUpperCase() === "FACTUAL"
        ? "confirmed"
        : cleanFrom(item, "retimed_by_event")
          ? "estimated"
          : "planned",
    durationLabel,
    locationLabel,
    directionsUrl: buildDirectionsUrl(item, trip.destination),
    photo: photo && photo.imageUrl
      ? { imageUrl: photo.imageUrl, credit: photo.credit ?? null, pageUrl: photo.pageUrl ?? null, countLabel: "1/1", source: "wikimedia-commons" }
      : null,
    about: {
      address,
      openingHours: null,
      ticketInfo: null,
      tipsAvailable: tips.length > 0
    },
    nearby,
    tips,
    tipsProvenance: tips.length > 0 ? "From this trip's plan" : null,
    tripHeader: {
      destination: trip.destination || "Your trip",
      origin: trip.origin,
      dateRangeLabel: formatTripDateRange(trip.start_date, trip.end_date)
    }
  };
}

function inputPlaceId(item: RawRecord, day: PlaceDayInput): string {
  const stored = cleanFrom(item, "item_id");
  if (stored) return stored;
  const index = day.live_timeline.indexOf(item as never);
  return fallbackPlaceId(day.day_number, index >= 0 ? index : 0);
}

/**
 * Resolve one place from a trip's OWN itinerary: by stored item_id,
 * or by the deterministic fallback id (d<day>-<live_timeline index>).
 * Returns null for an unknown id or an unusable title — the page
 * renders a not-found state, never another trip's place and never a
 * guessed one. A travel leg resolves with its own real data (its
 * title/time/description); it is never relabeled as a place, and
 * nearby lists always exclude travel legs.
 */
export function resolvePlaceInItinerary(
  itinerary: { daily_itinerary: readonly PlaceDayInput[] } | null,
  placeId: string
): { day: PlaceDayInput; item: RawRecord; index: number } | null {
  if (!itinerary || !placeId) return null;
  for (const day of itinerary.daily_itinerary || []) {
    const timeline = day.live_timeline || [];
    for (let index = 0; index < timeline.length; index += 1) {
      const item = timeline[index];
      const stored = cleanFrom(item, "item_id");
      if (stored === placeId || fallbackPlaceId(day.day_number, index) === placeId) {
        const title = cleanFrom(item, "title", "name");
        if (!title || !isUsablePlaceTitle(title)) return null;
        return { day, item, index };
      }
    }
  }
  return null;
}
