/** Display labels for itinerary and Live rows. Does not invent venues or inventory. */

const SEARCH_TITLE =
  /(?:flight|flights|hotel|hotels|stay|stays|event|events|nightlife|activity|activities)[-_\s]?search\b|\bsearch(?:ing)?\s+(?:for\s+)?(?:flights?|hotels?|stays?|events?|nightlife|activities|things to do)\b|\bthings to do\b|[?&=]|%20|\s\+\s|\/search\b|^(?:flights?|hotels?|stays?|events?|nightlife)\b.*\b(?:from|to|in|near)\b/i;

const EVENT_QUERY =
  /\b(?:events?|festivals?|concerts?|nightlife)\b/i;

const DATED_QUERY = /\b\d{4}-\d{2}-\d{2}\b/;

export function looksLikeProviderSearchTitle(value: string | null | undefined) {
  const text = (value || "").trim();
  if (text.length < 8) return false;
  if (SEARCH_TITLE.test(text)) return true;
  const eventHits = text.match(/\b(?:events?|festivals?|concerts?|nightlife)\b/gi) || [];
  if (eventHits.length >= 2) return true;
  if (EVENT_QUERY.test(text) && DATED_QUERY.test(text)) return true;
  return false;
}

export function isDriveMode(mode: string | null | undefined) {
  return /^(drive|driving|car)$/i.test((mode || "").trim());
}

export function isMixedMode(mode: string | null | undefined) {
  return /\bmixed\b/i.test((mode || "").trim());
}

/** Drive or mixed trips should not be framed as flights unless a flight is actually confirmed. */
export function shouldSuppressFlightFraming(input: {
  transportationPreference?: string | null;
  hasConfirmedFlight?: boolean;
}) {
  if (input.hasConfirmedFlight) return false;
  const pref = (input.transportationPreference || "").trim().toLowerCase();
  if (!pref) return false;
  return isDriveMode(pref) || isMixedMode(pref);
}

export function hasConfirmedFlightBooking(bookings: readonly Record<string, unknown>[]) {
  return bookings.some((booking) => {
    const kind = `${booking.booking_type || ""} ${booking.category || ""} ${booking.type || ""}`.toLowerCase();
    return /\bflight\b/.test(kind);
  });
}

function placeCity(value: string) {
  return value
    .replace(/\b(?:hotel|hotels|flight|flights|stay|stays)\s+search\b/gi, " ")
    .replace(/\b(?:events?|festivals?|concerts?|nightlife|activities|things to do)\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\bto\b/gi, " ")
    .replace(/\b(?:canada|united states|usa|québec|quebec)\b/gi, " ")
    .replace(/[,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function travelerCategoryTitle(title: string, category: string) {
  const blob = `${category} ${title}`.toLowerCase();
  const city = placeCity(title);
  if (/hotel|stay|lodg/.test(blob)) return city ? `Stay in ${city}` : "Stay to confirm";
  if (EVENT_QUERY.test(title) || /event|festival|concert|nightlife|activity|attraction/.test(blob)) {
    return city ? `Events in ${city}` : "Events to confirm";
  }
  if (/flight|transport|train|bus|drive/.test(blob)) return city ? `Getting to ${city}` : "Transport to confirm";
  return city ? city : "Details to confirm";
}

/** Rewrite generator placeholders that talk about airports or flights on a ground trip. */
export function presentGroundTransportText(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return "";
  return text
    .replace(/\brecommended\s+flight\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\brecommended\s+mixed(?:\s+transport)?\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\brecommended\s+\w+\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\bflight departure buffer\b/gi, "departure buffer")
    .replace(/\bairport(?:\s*\/\s*station)?(?:\s+station)?(?:\s+to)?\b/gi, " ")
    .replace(/\bterminal\b/gi, "stop")
    .replace(/\bsecurity\b/gi, "documents")
    .replace(/\bcollect bags\b/gi, "settle in")
    .replace(/\bbaggage rules\b/gi, "what you're bringing")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

export function presentTravelerTitle(input: {
  title?: string | null;
  location?: string | null;
  mode?: string | null;
  category?: string | null;
  origin?: string | null;
  destination?: string | null;
  suppressFlightFraming?: boolean;
}): { title: string; needsConfirmation: boolean; modeLabel: "Drive" | "Mixed" | null } {
  const rawTitle = (input.title || "").trim();
  const title = input.suppressFlightFraming ? presentGroundTransportText(rawTitle) : rawTitle;
  const location = (input.location || "").trim();
  const origin = (input.origin || "").trim();
  const destination = (input.destination || "").trim();
  const searchTitle = looksLikeProviderSearchTitle(rawTitle) || (input.suppressFlightFraming && /\bflights?\b/i.test(rawTitle) && !/\bthen fly\b/i.test(rawTitle));
  const searchLocation = looksLikeProviderSearchTitle(location);
  const humanLocation = location && !searchLocation ? (input.suppressFlightFraming ? presentGroundTransportText(location) : location) : "";
  const ground = input.suppressFlightFraming || isDriveMode(input.mode);
  const mixed = isMixedMode(input.mode);
  const flightPlaceholder = /\bflight|airport|departure buffer\b/i.test(rawTitle);

  if (isDriveMode(input.mode)) {
    if (title && !searchTitle && !/\bflights?\b/i.test(title)) {
      return {
        title: /\bdrive\b/i.test(title) ? title : `Drive · ${title}`,
        needsConfirmation: false,
        modeLabel: "Drive"
      };
    }
    const from = origin && !looksLikeProviderSearchTitle(origin) ? origin : "";
    const to = destination && !looksLikeProviderSearchTitle(destination) ? destination : humanLocation;
    const route = from && to ? `${from} to ${to}` : to || from;
    return {
      title: route ? `Drive · ${route}` : "Drive",
      needsConfirmation: true,
      modeLabel: "Drive"
    };
  }

  if (searchTitle && !(input.suppressFlightFraming && flightPlaceholder)) {
    return {
      title: travelerCategoryTitle(rawTitle, input.category || ""),
      needsConfirmation: true,
      modeLabel: null
    };
  }

  if (ground && input.suppressFlightFraming) {
    if (title && !searchTitle && !/\bflights?\b/i.test(title) && !/\bairport\b/i.test(rawTitle)) {
      if (isDriveMode(input.mode) || /\bdrive\b/i.test(title)) {
        return {
          title: /\bdrive\b/i.test(title) ? title : `Drive · ${title}`,
          needsConfirmation: false,
          modeLabel: "Drive"
        };
      }
      return { title, needsConfirmation: false, modeLabel: mixed ? "Mixed" : "Drive" };
    }
    const from = origin && !looksLikeProviderSearchTitle(origin) ? origin : "";
    const to = destination && !looksLikeProviderSearchTitle(destination) ? destination : humanLocation;
    const route = from && to ? `${from} to ${to}` : to || from;
    if (/\bdeparture buffer\b/i.test(rawTitle) || /\bleave time before\b/i.test(title)) {
      return {
        title: "Leave time before you head out",
        needsConfirmation: true,
        modeLabel: isDriveMode(input.mode) ? "Drive" : "Mixed"
      };
    }
    return {
      title: route ? `${isDriveMode(input.mode) ? "Drive" : "Trip"} · ${route}` : isDriveMode(input.mode) ? "Drive" : "Getting there",
      needsConfirmation: true,
      modeLabel: isDriveMode(input.mode) ? "Drive" : "Mixed"
    };
  }

  if (!searchTitle && title) return { title, needsConfirmation: false, modeLabel: null };
  if (searchTitle) {
    return {
      title: travelerCategoryTitle(rawTitle, input.category || ""),
      needsConfirmation: true,
      modeLabel: null
    };
  }

  return { title: humanLocation, needsConfirmation: Boolean(searchLocation), modeLabel: null };
}

export function isHollowTravelerPlace(value: string | null | undefined, destination?: string | null) {
  const text = (value || "").trim();
  if (!text) return true;
  if (looksLikeProviderSearchTitle(text)) return true;
  if (/^(details to confirm|flexible time|montreal|toronto|quebec|your trip)$/i.test(text)) return true;
  const dest = (destination || "").trim().toLowerCase();
  const city = dest.split(",")[0]?.trim();
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (!city) return false;
  return normalized === city || normalized === dest || normalized === `${city}, canada` || normalized === `${city} canada`;
}

export function preTripPrepTitle(destination?: string | null, startLabel?: string | null) {
  const city = (destination || "").split(",")[0]?.trim() || "your trip";
  return startLabel ? `Get ready for ${city} · ${startLabel}` : `Get ready for ${city}`;
}

export function preTripAddressCopy(permissionOff: boolean) {
  return permissionOff
    ? "No street address yet. Location is off, so this is not based on where you are."
    : "No street address yet. Confirm where you will stay before you travel.";
}

/** Clock labels stay readable and never pick up a second period after p.m. / a.m. */
export function cleanTravelerTimeLabel(value: string | null | undefined) {
  const raw = (value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const doubled = raw.replace(/\b([ap])\.m\.\.+/gi, "$1.m.");
  const meridiem = doubled.match(/^(?:planned\s·\s)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i);
  if (!meridiem) {
    const simple = doubled.match(/^(?:planned\s·\s)?(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!simple) return doubled.replace(/\b([ap])\.m\.\.+/gi, "$1.m.");
    const hour = Number(simple[1]);
    const minute = simple[2];
    const suffix = simple[3].toLowerCase() === "pm" ? "p.m." : "a.m.";
    const prefix = /^planned/i.test(doubled) ? "Planned · " : "";
    return `${prefix}${hour}:${minute} ${suffix}`;
  }
  const hour = Number(meridiem[1]);
  const minute = meridiem[2] || "00";
  const suffix = meridiem[3].toLowerCase() === "p" ? "p.m." : "a.m.";
  const prefix = /^planned/i.test(doubled) ? "Planned · " : "";
  return `${prefix}${hour}:${minute.padStart(2, "0")} ${suffix}`;
}

export function punctuateTravelerTime(value: string | null | undefined) {
  const label = cleanTravelerTimeLabel(value);
  if (!label) return "";
  return /[.!?]$/.test(label) ? `${label} ` : `${label}. `;
}
