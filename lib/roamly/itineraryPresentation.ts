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

/**
 * No confirmed flight means generator airport and flight placeholders are not facts.
 * A booked flight keeps airport language. Drive, mixed, flight-preference, and unset
 * modes all follow that rule.
 */
export function shouldSuppressFlightFraming(input: {
  transportationPreference?: string | null;
  hasConfirmedFlight?: boolean;
}) {
  return input.hasConfirmedFlight !== true;
}

export function hasConfirmedFlightBooking(bookings: readonly Record<string, unknown>[]) {
  return bookings.some((booking) => {
    const kind = `${booking.booking_type || ""} ${booking.category || ""} ${booking.type || ""}`.toLowerCase();
    return /\bflight\b/.test(kind);
  });
}

function tidyPlace(value: string) {
  return value
    .replace(/\b(?:hotel|hotels|flight|flights|stay|stays)\s+search\b/gi, " ")
    .replace(/^(?:hotels?|flights?|stays?|events?|activities)\s+(?:in|near|at|from)\s+/i, "")
    .replace(/\b(?:events?|festivals?|concerts?|nightlife|activities|things to do|search(?:ing)?)\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:canada|united states|usa|québec|quebec)\b/gi, " ")
    .replace(/[,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeCity(value: string) {
  return tidyPlace(value);
}

function placeHead(value: string | null | undefined) {
  const text = tidyPlace(value || "");
  return text.split(" ").slice(0, 4).join(" ").trim();
}

/** Stored placeholders such as "Trip · Montreal, Canada" are not a traveler title. */
const TRIP_LABEL_PREFIX = /^(?:trip)\s*[·•|-]\s+/i;

export function isGenericTripLabel(value: string | null | undefined) {
  return TRIP_LABEL_PREFIX.test((value || "").trim());
}

export function travelerRouteTitle(origin?: string | null, destination?: string | null) {
  const from = placeHead(origin);
  const to = placeHead(destination);
  if (from && to && from.toLowerCase() !== to.toLowerCase()) return `Getting from ${from} to ${to}`;
  return "";
}

/** Keep "Saint John to Montreal" intact. Stripping "to" used to glue the cities together. */
function splitRoute(value: string) {
  const text = (value || "")
    .replace(/\b(?:hotel|hotels|flight|flights|stay|stays|event|events|nightlife|activity|activities)[-_\s]?search\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:canada|united states|usa|québec|quebec)\b/gi, " ")
    .replace(/[,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/^(?:(?:flights?|trains?|buses|drive|driving|getting|travel)\s+)?(?:from\s+)?(.+?)\s+\bto\b\s+(.+)$/i);
  if (!match) return null;
  const from = tidyPlace(match[1]);
  const to = tidyPlace(match[2]);
  if (!from || !to || from.length < 2 || to.length < 2) return null;
  if (from.toLowerCase() === to.toLowerCase()) return null;
  return { from, to };
}

function travelerCategoryTitle(title: string, category: string, origin?: string | null, destination?: string | null) {
  const blob = `${category} ${title}`.toLowerCase();
  const route = splitRoute(title);
  const city = placeHead(destination) || placeCity(title);
  if (/hotel|stay|lodg/.test(blob)) return city ? `Stay in ${city}` : "Stay to confirm";
  if (EVENT_QUERY.test(title) || /event|festival|concert|nightlife|activity|attraction/.test(blob)) {
    return city ? `Events in ${city}` : "Events to confirm";
  }
  if (/flight|transport|train|bus|drive|getting/.test(blob)) {
    if (route) return `Getting from ${route.from} to ${route.to}`;
    const from = placeHead(origin);
    const to = placeHead(destination) || city;
    if (from && to && from.toLowerCase() !== to.toLowerCase()) return `Getting from ${from} to ${to}`;
    return to ? `Getting to ${to}` : "Transport to confirm";
  }
  return city ? city : "Details to confirm";
}

const SPECIFIC_AIRPORT_PLACE = /\b(?:lounge|viewing|observation|museum|chapel|hotel|inn|parking|rental)\b/i;

/** Rewrite generic airport/flight placeholders. Leave a named airport place alone. */
export function presentGroundTransportText(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return "";
  const buffered = text
    .replace(/\b(?:hotel|hotels|flight|flights|stay|stays)\s+search\b/gi, " ")
    .replace(/\brecommended\s+flight\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\brecommended\s+mixed(?:\s+transport)?\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\brecommended\s+\w+\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\bflight departure buffer\b/gi, "departure buffer");
  if (SPECIFIC_AIRPORT_PLACE.test(buffered) && !/\bairport\s*(?:\/\s*station|station|transfer)\b/i.test(buffered)) {
    return buffered.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
  }
  return buffered
    .replace(/\bairport\s*\/\s*station\b/gi, "arrival point")
    .replace(/\bairport\s+station\b/gi, "arrival point")
    .replace(/\bairport\s+transfer\b/gi, "local transfer")
    .replace(/\b(?:to|for)\s+the\s+airport\b/gi, "to your departure point")
    .replace(/\bat\s+the\s+airport\b/gi, "on arrival")
    .replace(/\b([A-Za-z][A-Za-z.'-]{1,40}(?:\s+[A-Za-z][A-Za-z.'-]{1,40}){0,3})\s+airport\s+and\s+(city\s+cent(?:er|re)|downtown)\b/gi, "$1 $2")
    .replace(/\b[A-Z]{3}\s+airport\b/g, "arrival point")
    .replace(/\b([A-Za-z][A-Za-z.'-]{1,40}(?:\s+[A-Za-z][A-Za-z.'-]{1,40}){0,3})\s+airport\b/g, "$1")
    .replace(/\bairport\b/gi, "")
    .replace(/\bcollect bags\b/gi, "settle in")
    .replace(/\bbaggage rules\b/gi, "what you're bringing")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s+arrivals\b/gi, "")
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
  let rawTitle = (input.title || "").trim();
  if (isGenericTripLabel(rawTitle)) {
    const stripped = rawTitle.replace(TRIP_LABEL_PREFIX, "").trim();
    const route = travelerRouteTitle(input.origin, input.destination || stripped);
    if (route && (!stripped || isHollowTravelerPlace(stripped, input.destination || stripped))) {
      return {
        title: route,
        needsConfirmation: true,
        modeLabel: isMixedMode(input.mode) ? "Mixed" : null
      };
    }
    rawTitle = stripped || rawTitle;
  }
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
  const repairedRoute = repairGarbledGettingTo(rawTitle, origin, destination);
  if (repairedRoute && !isDriveMode(input.mode)) {
    return { title: repairedRoute, needsConfirmation: true, modeLabel: mixed ? "Mixed" : null };
  }

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
      title: travelerCategoryTitle(rawTitle, input.category || "", input.origin, input.destination),
      needsConfirmation: true,
      modeLabel: null
    };
  }

  if (ground && input.suppressFlightFraming) {
    const namedAirportPlace = !searchTitle && SPECIFIC_AIRPORT_PLACE.test(rawTitle) && !/\bairport\s*(?:\/\s*station|station|transfer)\b/i.test(rawTitle);
    if (namedAirportPlace) {
      return { title: title || rawTitle, needsConfirmation: false, modeLabel: null };
    }
    if (/\bdeparture buffer\b/i.test(rawTitle) || /\bleave time before\b/i.test(title)) {
      return {
        title: "Leave time before you head out",
        needsConfirmation: true,
        modeLabel: isDriveMode(input.mode) ? "Drive" : "Mixed"
      };
    }
    const from = placeHead(origin && !looksLikeProviderSearchTitle(origin) ? origin : "");
    const to = placeHead(destination && !looksLikeProviderSearchTitle(destination) ? presentGroundTransportText(destination) : "") || placeHead(humanLocation);
    const genericTravelPlaceholder = (/\bairport\b/i.test(rawTitle) && !SPECIFIC_AIRPORT_PLACE.test(rawTitle)) || (/\bflights?\b/i.test(rawTitle) && !/\bthen fly\b/i.test(rawTitle));
    if (genericTravelPlaceholder && from && to && from.toLowerCase() !== to.toLowerCase()) {
      return { title: `Getting from ${from} to ${to}`, needsConfirmation: true, modeLabel: mixed ? "Mixed" : null };
    }
    if (title && !searchTitle && !/\bflights?\b/i.test(title) && !/\bairport\b/i.test(title)) {
      if (isDriveMode(input.mode) || /\bdrive\b/i.test(title)) {
        return {
          title: /\bdrive\b/i.test(title) ? title : `Drive · ${title}`,
          needsConfirmation: false,
          modeLabel: "Drive"
        };
      }
      return { title, needsConfirmation: false, modeLabel: mixed ? "Mixed" : "Drive" };
    }
    if (from && to && from.toLowerCase() !== to.toLowerCase()) {
      return { title: `Getting from ${from} to ${to}`, needsConfirmation: true, modeLabel: mixed ? "Mixed" : null };
    }
    return {
      title: to || from || "Getting there",
      needsConfirmation: true,
      modeLabel: mixed ? "Mixed" : null
    };
  }

  if (!searchTitle && title) {
    return { title: repairedRoute || title, needsConfirmation: Boolean(repairedRoute), modeLabel: null };
  }
  if (searchTitle) {
    return {
      title: travelerCategoryTitle(rawTitle, input.category || "", input.origin, input.destination),
      needsConfirmation: true,
      modeLabel: null
    };
  }

  const repaired = repairGarbledGettingTo(title, input.origin, input.destination);
  if (repaired) return { title: repaired, needsConfirmation: true, modeLabel: null };

  return { title: humanLocation, needsConfirmation: Boolean(searchLocation), modeLabel: null };
}

/** "Getting to Saint John Montreal" dropped the word "to" between the two places. */
export function repairGarbledGettingTo(value: string | null | undefined, origin?: string | null, destination?: string | null) {
  const text = (value || "").trim();
  const match = text.match(/^getting to\s+(.+)$/i);
  if (!match || /\bto\b/i.test(match[1])) return "";
  const from = placeHead(origin);
  const to = placeHead(destination);
  const blob = match[1].toLowerCase();
  if (from && to && blob.includes(from.toLowerCase()) && blob.includes(to.toLowerCase())) {
    return `Getting from ${from} to ${to}`;
  }
  const route = splitRoute(text);
  return route ? `Getting from ${route.from} to ${route.to}` : "";
}

/** Short place labels: search queries become traveler language; unbooked airports lose the airport claim. */
export function presentTravelerArea(value: string | null | undefined, suppressFlightFraming = false, category = "") {
  const raw = (value || "").trim();
  if (!raw) return "";
  const sentence = /[.!?]\s/.test(raw);
  if (looksLikeProviderSearchTitle(raw) && (raw.length <= 140 || !sentence)) {
    return presentTravelerTitle({
      title: raw,
      category: category || raw,
      suppressFlightFraming
    }).title;
  }
  if (isGenericTripLabel(raw)) {
    return presentTravelerTitle({
      title: raw,
      category: category || raw,
      suppressFlightFraming
    }).title;
  }
  const grounded = suppressFlightFraming ? presentGroundTransportText(raw) : raw;
  return grounded.replace(/\b(?:hotel|hotels|stay|stays)\s+search\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

export type TrackingPresentation = {
  origin?: string | null;
  destination?: string | null;
  suppressFlightFraming?: boolean;
};

/** Notification and Live rows share the itinerary title cleaner. */
export function presentTrackingActivityTitle(input: {
  title?: string | null;
  city?: string | null;
  address?: string | null;
  category?: string | null;
  origin?: string | null;
  destination?: string | null;
  suppressFlightFraming?: boolean;
}) {
  const presented = presentTravelerTitle({
    title: input.title,
    location: input.address || input.city,
    category: input.category || input.title,
    origin: input.origin,
    destination: input.destination || input.city,
    suppressFlightFraming: input.suppressFlightFraming
  }).title;
  return polishCutLabel(presented) || "Details to confirm";
}

function collapseSpaces(value: string) {
  return value.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

/** Drop a dangling preposition left when a word was removed from the end of a label. */
function polishCutLabel(value: string | null | undefined) {
  const text = collapseSpaces(value || "").replace(/\s+\b(?:to|from|in|at|near|and|for)\b$/i, "").trim();
  return text;
}

function destinationCity(destination?: string | null) {
  return (destination || "").split(",")[0]?.trim() || "";
}

/**
 * Planned-card bodies must stay full sentences. Search dumps and unbooked
 * airport wording are rewritten in place; words are not deleted mid-sentence.
 */
function rewritePlannedFlightSentence(value: string) {
  let text = value.replace(/\b(?:hotel|hotels|stay|stays|flight|flights)\s+search\b/gi, " ");
  text = text
    .replace(/\brecommended\s+(?:flight|mixed(?:\s+transport)?|\w+)\s+departure\s+buffer\b/gi, "Leave time before you head out")
    .replace(/\bflight departure buffer\b/gi, "time before you head out")
    .replace(/\bairport\s*\/\s*station\b/gi, "arrival point")
    .replace(/\bairport\s+station\b/gi, "arrival point")
    .replace(/\bairport\s+transfer\b/gi, "local transfer")
    .replace(/\bfor\s+the\s+airport\b/gi, "for your departure")
    .replace(/\bto\s+the\s+airport\b/gi, "to your departure point")
    .replace(/\bat\s+the\s+airport\b/gi, "on arrival")
    .replace(/\bfrom\s+the\s+airport\b/gi, "after you arrive")
    .replace(/\b[A-Z]{3}\s+airport\b/g, "the arrival point")
    .replace(/\b([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3})\s+airport\b/g, "$1")
    .replace(/\bairport\b/gi, "departure point")
    .replace(/\bcollect bags\b/gi, "settle in")
    .replace(/\bbaggage rules\b/gi, "what you're bringing");
  return collapseSpaces(text);
}

function plannedLabelSentence(label: string, destination?: string | null) {
  const city = destinationCity(destination);
  const text = polishCutLabel(label);
  const short = text.split(/\s+/).filter(Boolean).length <= 6;
  if (!text || /^details to confirm$/i.test(text)) return "Details for this stop still need to be confirmed.";
  if (/^stay in\b/i.test(text) && (short || city)) {
    const place = city || text.replace(/^stay in\s+/i, "");
    return place ? `Your stay in ${place} still needs to be confirmed.` : "Your stay still needs to be confirmed.";
  }
  if (/^events in\b/i.test(text) && (short || city)) {
    const place = city || text.replace(/^events in\s+/i, "");
    return place ? `Events in ${place} still need to be confirmed.` : "Events for this stop still need to be confirmed.";
  }
  if (/^getting (?:from|to)\b/i.test(text) && short) return closeTravelerSentence(text);
  if (/^leave time before you head out$/i.test(text)) return "Leave time before you head out.";
  if (short && !/\b(?:search|airport|flight)\b/i.test(text)) return closeTravelerSentence(text);
  if (city && /\bhotel|stay|lodg/i.test(text)) return `Your stay in ${city} still needs to be confirmed.`;
  if (city && /\bevent|festival|concert|nightlife|activity/i.test(text)) return `Events in ${city} still need to be confirmed.`;
  return "Details for this stop still need to be confirmed.";
}

export function presentTrackingActivityDetail(
  value: string | null | undefined,
  suppressFlightFraming = false,
  destination?: string | null
) {
  const raw = (value || "").trim();
  if (!raw) return "";
  const sentenceLike = /[.!?]\s/.test(raw) || raw.split(/\s+/).filter(Boolean).length > 14;
  if ((looksLikeProviderSearchTitle(raw) || isGenericTripLabel(raw)) && !sentenceLike) {
    const label = presentTravelerTitle({
      title: raw,
      category: raw,
      destination,
      suppressFlightFraming
    }).title;
    return plannedLabelSentence(label, destination);
  }
  if (looksLikeProviderSearchTitle(raw)) {
    const rewritten = collapseSpaces(raw
      .replace(/\bthings to do\b/gi, "places to visit")
      .replace(/\b(?:hotel|hotels|flight|flights|stay|stays)\s+search\b/gi, "")
      .replace(/\b(?:events?|festivals?|concerts?|nightlife)\s+(?:events?|festivals?|concerts?|nightlife)\b/gi, "events"));
    if (rewritten && rewritten !== raw) return presentTrackingActivityDetail(rewritten, suppressFlightFraming, destination);
  }
  const text = suppressFlightFraming
    ? rewritePlannedFlightSentence(raw)
    : raw.replace(/\b(?:hotel|hotels|stay|stays)\s+search\b/gi, " ");
  const sentence = closeTravelerSentence(collapseSpaces(text));
  if (/\b(?:hotel|flight)s?\s+search\b/i.test(sentence)) return plannedLabelSentence(sentence, destination);
  return sentence;
}

function isSearchDump(value: string) {
  if (!looksLikeProviderSearchTitle(value)) return false;
  const eventHits = value.match(/\b(?:events?|festivals?|concerts?|nightlife)\b/gi) || [];
  return /\bsearch\b|[?&=]|%20|\d{4}-\d{2}-\d{2}/i.test(value) || eventHits.length >= 2;
}

function isBareDestinationLabel(value: string | null | undefined, destination?: string | null) {
  const text = (value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return true;
  if (/^(?:details to confirm|flexible time|stop to confirm|getting there|your trip)$/i.test(text)) return true;
  const dest = (destination || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!dest) return false;
  const city = dest.split(",")[0]?.trim() || "";
  const flat = (input: string) => input.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return text === dest || text === city || flat(text) === flat(dest) || flat(text) === city;
}

function unusableStopLabel(value: string) {
  return /^(?:unresolved place|unknown place|unknown location|location unavailable|no destination selected|not available|n\/a|tbd)$/i.test(value.trim());
}

function specificStopName(value: string | null | undefined, destination?: string | null) {
  const raw = (value || "").trim();
  if (!raw || unusableStopLabel(raw)) return "";
  if (!looksLikeProviderSearchTitle(raw)) return isBareDestinationLabel(raw, destination) ? "" : raw;
  const categoryLead = /^(?:hotels?|flights?|stays?|events?|nightlife)\b/i.test(raw);
  const natural = !categoryLead && !isSearchDump(raw) && raw.split(/\s+/).length <= 8;
  if (natural && !isBareDestinationLabel(raw, destination)) return raw;
  const cleaned = raw
    .replace(/\b(?:hotel|hotels|flight|flights|stay|stays|event|events|nightlife|activity|activities)[-_\s]?search\b/gi, " ")
    .replace(/\b(?:events?|festivals?|concerts?|nightlife|activities|things to do|search(?:ing)?)\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:canada|united states|usa|québec|quebec|philippines)\b/gi, " ")
    .replace(/[?&=]|%20|\s\+\s/g, " ")
    .replace(/[,/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:hotels?|flights?|stays?|events?|activities)\s+(?:in|near|at|from|to)\s+/i, "")
    .replace(/^(?:in|near|at|from|to)\s+/i, "")
    .replace(/\s+\b(?:to|from|in|at|near|and|for)\b$/i, "")
    .trim();
  if (!cleaned || unusableStopLabel(cleaned) || isBareDestinationLabel(cleaned, destination) || isSearchDump(cleaned)) return "";
  if (/^(?:in|near|at|from|to|the|and)$/i.test(cleaned)) return "";
  return cleaned;
}

/**
 * Live timeline title. Uses a known hotel, event, or place name when the trip
 * has one. "Stay in …" / "Events in …" remain when that is the best confirmable
 * label. Empty when nothing confirmable is stored.
 */
export function confirmableStopTitle(input: {
  title?: string | null;
  placeName?: string | null;
  address?: string | null;
  category?: string | null;
  origin?: string | null;
  destination?: string | null;
  suppressFlightFraming?: boolean;
}) {
  const candidates = [input.title, input.placeName, input.address];
  for (const candidate of candidates) {
    let named = specificStopName(candidate, input.destination);
    if (input.suppressFlightFraming && named && /\bairport\b/i.test(named) && !SPECIFIC_AIRPORT_PLACE.test(named)) {
      named = collapseSpaces(named.replace(/\b(?:near|at|from|to|for)\s+(?:the\s+)?airport\b/gi, "").replace(/\bairport\b/gi, ""));
    }
    if (!named || isBareDestinationLabel(named, input.destination)) continue;
    const presented = polishCutLabel(presentTravelerTitle({
      title: named,
      origin: input.origin,
      destination: input.destination,
      suppressFlightFraming: input.suppressFlightFraming
    }).title);
    if (presented && !isBareDestinationLabel(presented, input.destination) && !isSearchDump(presented) && !/\bsearch\b/i.test(presented)) {
      return presented;
    }
    if (!isSearchDump(named) && !/\bsearch\b/i.test(named)) return named;
  }
  for (const candidate of candidates) {
    const raw = (candidate || "").trim();
    if (!raw || unusableStopLabel(raw)) continue;
    const presented = polishCutLabel(presentTravelerTitle({
      title: raw,
      category: input.category || raw,
      origin: input.origin,
      destination: input.destination,
      suppressFlightFraming: input.suppressFlightFraming
    }).title);
    if (!presented || isBareDestinationLabel(presented, input.destination) || isSearchDump(presented) || /\bsearch\b/i.test(presented)) continue;
    return presented;
  }
  return "";
}

const LIVE_PROXIMITY_CLAIM = /near your first planned area|today[’']s activities|prepared today|happening today/i;

/** Before the trip starts, do not claim the traveler is near a stop or inside today's plan. */
export function notificationProximityCopy(body: string | null | undefined, tripStarted: boolean) {
  const text = (body || "").trim();
  if (tripStarted) {
    return text || "You are near your first planned area. Roamly has prepared today’s activities from your locked itinerary.";
  }
  if (!text || LIVE_PROXIMITY_CLAIM.test(text)) {
    return "This trip has not started. A planned stop is not nearby, and these are not today’s activities.";
  }
  return text;
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

/** End a sentence without turning "10:54 p.m." into "10:54 p.m.." */
export function closeTravelerSentence(value: string | null | undefined) {
  const text = (value || "").trim().replace(/\b([ap])\.m\.\.+/gi, "$1.m.");
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
