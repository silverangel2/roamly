/*
 * Country Info panel — server-side model builder (Round 2, B2).
 *
 * The composite panel (owner decision: "yes i want those exactly") is
 * built as a tabbed page: header + tabs Overview / Entry & Travel /
 * Transport / Safety; photo + weather block; Key information grid;
 * "Travel notes for this trip" checklist; "See full itinerary" button.
 *
 * DATA RULES (the whole point of this file):
 * - Every value comes from the trip's own record (columns, planning
 *   metadata, or the trip's own origin/destination countries). Nothing
 *   is copied from the composite's sample values: never its 12°C /
 *   8–14°C weather, never fixed hotel/times, never its "Eastern Time
 *   (ET, UTC -4)" / "French (main) / English (widely)" / "Type A/B
 *   120V · 60Hz" cells as if live.
 * - Anything the codebase does not hold renders an honest unavailable
 *   state: Language and Power have no source anywhere in the tree;
 *   Time zone shows only when the trip's metadata actually stores an
 *   IANA zone (the live helper's UTC fallback is deliberately NOT
 *   reused — UTC is not the destination's zone); Currency shows only
 *   for the four countries the codebase already maps; Weather is
 *   unavailable (see the type doc) because no weather feed is
 *   configured and no UI shape for the adapter result exists.
 * - Travel notes come from buildCountryInfo (builder B's route rule):
 *   domestic → applicable guidance only, no passport/embassy/roaming;
 *   international → the applicable set; unknown route → generally
 *   applicable bullets + an honest "route countries not confirmed"
 *   summary. The panel never invents destination advice: the non-
 *   Overview tabs carry only route/transport facts the trip record
 *   holds, plus unavailable states for everything else.
 * - Per-trip isolation: the model carries exactly one trip's id,
 *   destination, dates, and origin, and its itinerary link points at
 *   that trip only. It takes no other trip's data as input.
 */

import { currencyForCountry, detectCrossBorderTrip, normalizeCountry } from "@/lib/roamly/crossBorder";
import { buildCountryInfo } from "@/lib/roamly/tripCompanion";
import {
  getTripBudgetCurrency,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import type {
  CountryInfoGridCell,
  CountryInfoPanelModel,
  CountryInfoPhoto
} from "@/lib/roamly/countryInfoPanelTypes";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer";

export { COUNTRY_INFO_TABS } from "@/lib/roamly/countryInfoPanelTypes";

export type CountryInfoPanelTripInput = {
  id: string;
  destination?: string | null;
  destination_name?: string | null;
  destination_city?: string | null;
  destination_country?: string | null;
  destination_region?: string | null;
  origin?: string | null;
  origin_country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  transportation_preference?: string | null;
  budget_currency?: string | null;
  metadata?: unknown;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Parse a YYYY-MM-DD calendar date without any timezone shift. */
function parseCalendarDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** "Oct 26 – Oct 30, 2026" (the composite's form); null when unusable. */
export function formatTripDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string | null {
  const start = parseCalendarDate(startDate);
  if (!start) return null;
  const end = parseCalendarDate(endDate);
  const startText = `${MONTHS[start.month - 1]} ${start.day}`;
  if (!end || (end.year === start.year && end.month === start.month && end.day === start.day)) {
    return `${startText}, ${start.year}`;
  }
  return `${startText} – ${MONTHS[end.month - 1]} ${end.day}, ${end.year}`;
}

/**
 * The trip's stored IANA zone, or null. Same candidate fields the live
 * helper reads, but WITHOUT its UTC fallback: an absent zone is an
 * unavailable cell, never a claim that the destination is on UTC.
 */
export function rawTripTimezone(metadata: unknown): string | null {
  const root = (metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const planningRaw = root.planning ?? root.tripPlanning;
  const planning =
    planningRaw && typeof planningRaw === "object" && !Array.isArray(planningRaw)
      ? (planningRaw as Record<string, unknown>)
      : {};
  const candidates = [
    planning.timezone,
    planning.destinationTimezone,
    planning.destination_timezone,
    root.timezone,
    root.destinationTimezone,
    root.destination_timezone
  ];
  for (const candidate of candidates) {
    const zone = clean(candidate);
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return zone;
    } catch {
      // Not a usable IANA zone — keep looking, never present it.
    }
  }
  return null;
}

function zoneOffsetMinutes(iana: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const mins = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

/**
 * Human zone display computed from the stored IANA zone + the trip's
 * own start date (noon UTC, so the offset is the one in force for the
 * trip, not today's). E.g. America/Toronto on 2026-10-26 →
 * "Eastern Daylight Time (UTC-04:00)". Null when the zone is absent
 * or unusable — the cell then renders its unavailable state.
 */
export function formatTripTimezone(iana: string | null, startDate: string | null | undefined): string | null {
  if (!iana) return null;
  const start = parseCalendarDate(startDate);
  const reference = start
    ? new Date(Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0))
    : new Date();
  const offset = zoneOffsetMinutes(iana, reference);
  if (offset === null) return null;
  let longName: string | null = null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: iana, timeZoneName: "long" }).formatToParts(
      reference
    );
    longName = parts.find((part) => part.type === "timeZoneName")?.value || null;
  } catch {
    longName = null;
  }
  const offsetLabel = formatOffset(offset);
  return longName ? `${longName} (${offsetLabel})` : `${iana} (${offsetLabel})`;
}

/**
 * Destination currency display, only for the four countries the
 * codebase already maps (lib/roamly/crossBorder.ts currencyForCountry).
 * Anything else → null (unavailable cell), never a guessed currency.
 */
export function currencyDisplayForCountry(country: string | null): string | null {
  const code = currencyForCountry(country);
  if (!code) return null;
  const names: Record<string, string> = {
    CAD: "Canadian Dollar",
    USD: "US Dollar",
    MXN: "Mexican Peso",
    EUR: "Euro"
  };
  const name = names[code];
  return name ? `${name} (${code})` : code;
}

export function buildCountryInfoPanelModel(
  trip: CountryInfoPanelTripInput,
  photo: CountryInfoPhoto
): CountryInfoPanelModel {
  const planning = getTripPlanningMetadata(trip.metadata);
  const destinationLabel = getTripDestinationLabel(trip) || "your trip";
  const originLabel = getTripOriginLabel(trip);
  const country = clean(trip.destination_country) || clean(planning.destinationCountry);
  // Owner-10 item 2 — narrow, data-grounded City fallback: when the
  // record carries no destination_city, the trip's own
  // destination_name may serve as the city ONLY when it is a single
  // comma-free segment different from the country ("Montreal" ≠
  // "Canada"). A country name, a "City, Region" string, or any
  // multi-segment value stays "Not available" — never invented.
  // Time zone has NO such fallback: no IANA zone is in the record,
  // and inferring one from "Canada" alone would be invention.
  const destinationName = clean(trip.destination_name);
  const city =
    clean(trip.destination_city) ||
    clean(planning.destinationCity) ||
    (destinationName &&
    !destinationName.includes(",") &&
    (!country || destinationName.toLowerCase() !== country.toLowerCase())
      ? destinationName
      : null);
  const region = clean(trip.destination_region) || clean(planning.destinationRegion);
  const cityValue = city ? (region ? `${city} (${region})` : city) : null;

  const crossInfo = detectCrossBorderTrip({
    origin: originLabel,
    originCountry: clean(trip.origin_country) || clean(planning.originCountry),
    destination: destinationLabel,
    destinationCountry: country,
    routeText: `${originLabel || ""} ${destinationLabel}`,
    originCurrency: getTripBudgetCurrency(trip),
    destinationCurrency: undefined
  });
  const info = buildCountryInfo(country, city, {
    originCountry: crossInfo.origin_country,
    crossBorder: crossInfo.cross_border
  });
  const routeType = info.routeType;

  // Timezone round (2026-10-26): the cell reads the SAME resolution
  // as every day surface — stored metadata first, then the verified
  // destination registry (Montreal → America/Toronto, so the cell now
  // shows the real zone instead of "Not available" for registry
  // destinations). Genuinely unknown stays "Not available": no zone is
  // ever inferred from the country alone.
  const countryTimezoneResolution = resolveTripTimezoneServer({
    metadata: trip.metadata,
    destination: destinationLabel,
    destination_name: trip.destination_name,
    destination_city: trip.destination_city
  });
  const timezoneValue = formatTripTimezone(countryTimezoneResolution.zone, trip.start_date);
  const currencyValue = currencyDisplayForCountry(country);

  // Picture 2 cell layout: a value's parenthesised tail ("(Québec)",
  // "(CAD)", "(UTC-04:00)") renders as its second line.
  const splitLines = (value: string | null): string[] | null => {
    if (!value) return null;
    const open = value.indexOf(" (");
    if (open === -1) return [value];
    return [value.slice(0, open), value.slice(open + 1)];
  };
  const cell = (
    key: CountryInfoGridCell["key"],
    label: string,
    value: string | null,
    unavailable: string
  ): CountryInfoGridCell => ({ key, label, value, valueLines: splitLines(value), unavailable });

  const grid: CountryInfoGridCell[] = [
    cell("country", "Country", country, "Not available"),
    cell("city", "City", cityValue, "Not available"),
    cell("timezone", "Time zone", timezoneValue, "Not available"),
    cell("currency", "Currency", currencyValue, "Not available"),
    cell("language", "Language", null, "Not available"),
    cell("power", "Power", null, "Not available")
  ];

  // The picture's "Oct 26 – 30 avg." label, from the trip's own dates
  // only: same-month ranges collapse the month on the end day.
  const avgLabel = (() => {
    const start = parseCalendarDate(trip.start_date);
    const end = parseCalendarDate(trip.end_date);
    if (!start || !end) return null;
    if (start.year === end.year && start.month === end.month) {
      return `${MONTHS[start.month - 1]} ${start.day} – ${end.day} avg.`;
    }
    return `${MONTHS[start.month - 1]} ${start.day} – ${MONTHS[end.month - 1]} ${end.day} avg.`;
  })();

  const routeLine =
    routeType === "domestic"
      ? "Domestic trip — origin and destination are in the same country."
      : routeType === "international"
        ? "International trip — origin and destination countries differ."
        : "Route countries are not confirmed for this trip.";

  const emergencyLine =
    routeType === "international"
      ? "Confirm local emergency numbers and nearest embassy or consulate."
      : normalizeCountry(country) === "canada" && routeType === "domestic"
        ? "Save local emergency number: 911."
        : "Confirm local emergency numbers before you travel.";

  const preference =
    clean(trip.transportation_preference) || clean(planning.transportationPreference);

  return {
    tripId: trip.id,
    destinationLabel,
    dateRange: formatTripDateRange(trip.start_date, trip.end_date),
    originLabel,
    routeType,
    routeLine,
    routeSummary: info.summary,
    grid,
    weather: {
      status: "unavailable",
      message: "Weather is not available for this trip yet.",
      avgLabel
    },
    photo,
    notesTitle: "Travel notes for this trip",
    notes: info.reminders,
    notesSummary: info.summary,
    entryTravel: {
      routeLine,
      lines:
        routeType === "domestic"
          ? ["Check your government-issued ID for domestic travel."]
          : routeType === "international"
            ? ["Verify entry documents and passport validity."]
            : [],
      requirementsUnavailable:
        "Country-specific entry requirements (visas, eTAs, and border rules) are not available for this trip yet. Check official government sources before travel."
    },
    transport: {
      preference,
      preferenceUnavailable: "Transportation preference is not available for this trip yet.",
      scheduleLine: "Confirm your flight or bus schedule and allow extra time for potential delays.",
      schedulesUnavailable: "Live departure times and schedules are not available on this page."
    },
    safety: {
      emergencyLine,
      lines: [
        emergencyLine,
        "Check weather, transit disruptions, and local safety updates before leaving."
      ],
      advisoryUnavailable:
        "Country-specific safety advisories are not available for this trip in Roamly yet. Check official government and destination sources before travel."
    },
    itineraryHref: `/trip/${trip.id}`
  };
}
