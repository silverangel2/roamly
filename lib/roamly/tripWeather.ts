"use server";

/*
 * Trip weather — the ONE server-side data path for displayed weather
 * (Fix Round Item 4, 2026-11-06; audit defect D1).
 *
 * WHY THIS FILE EXISTS: before this module, no weather feed reached
 * any screen. The generation engine fetches Open-Meteo for its own
 * planning (lib/roamly/engine/packs/collectors.ts fetchWeatherDays)
 * and stores snapshots in roamly_destination_weather_snapshots, but
 * that store cannot serve display:
 *   - it is keyed by destination-registry id, while a trip's
 *     destination is an arbitrary place whose coordinates live in the
 *     trip's planning metadata;
 *   - its day payload is {date, tMax, tMin, precipProb} — NO weather
 *     condition code, so no condition label or icon could ever be
 *     rendered from it;
 *   - it is an append-only generation-provenance store behind the
 *     engine PackStore (service role, registered destinations only).
 * So display fetches fresh from the SAME provider the engine uses —
 * Open-Meteo, free, no key — adding `weather_code` to the daily set.
 *
 * This file is a server-actions module ("use server") because its
 * two consumers sit on both sides of the wire: the trip page (a
 * server component) calls getTripWeather during render, and the
 * country-info panel (a client component, whose model builder is
 * synchronous by battery-pinned contract) calls it once on mount
 * with the request its model carries. Either way the fetch itself
 * always runs here, server-side.
 *
 * CACHE (egress discipline): the provider fetch carries Next's data
 * cache with a 6-hour revalidate, keyed by the request URL — which
 * contains the coordinates and the clamped date range — so repeat
 * views of a trip inside the window do not re-fetch, and nothing is
 * ever fetched per page-poll. No database writes, no migration.
 *
 * HONEST STATES (never invent weather):
 *   - trip over (end date before today)        → { kind: "past" }
 *   - trip starts beyond the ~16-day forecast  → { kind: "too-early" }
 *     horizon (no fetch is even attempted)
 *   - bad input / provider failure / no days   → { kind: "error" }
 *   - otherwise                                → { kind: "ready" }
 * For a running trip or one whose tail runs past the horizon, the
 * fetched range is clamped to the days a forecast actually exists
 * for (today … today+15) — the card shows exactly the days returned.
 */

import type {
  TripWeatherDay,
  TripWeatherIconName,
  TripWeatherRequest,
  TripWeatherState
} from "@/components/roamly/TripWeatherCard";
import { fetchWithTimeout } from "@/lib/boundedFetch";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
/** Display weather answers in well under a second when healthy;
 *  the bound exists only to convert a stall into the error state. */
const OPEN_METEO_DISPLAY_TIMEOUT_MS = 10_000;
/** Open-Meteo's forecast horizon: today plus 15 more days. */
const FORECAST_WINDOW_DAYS = 16;
const REVALIDATE_SECONDS = 60 * 60 * 6;
const USER_AGENT = "Roamly/1.0 (trip weather display; contact: support@roamlyhq.com)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CalendarDate = { year: number; month: number; day: number };

function parseCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function toIso(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}

function addDays(iso: string, days: number): string {
  const parsed = parseCalendarDate(iso);
  if (!parsed) return iso;
  const utc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * 86_400_000);
  return toIso({ year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() });
}

/** Whole days from aIso to bIso (b − a), both YYYY-MM-DD. */
function diffDays(aIso: string, bIso: string): number {
  const a = parseCalendarDate(aIso);
  const b = parseCalendarDate(bIso);
  if (!a || !b) return 0;
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Today's calendar date (UTC). Window decisions are day-granular;
 *  a ±1-day edge at the horizon only moves the too-early boundary by
 *  a day, never invents or drops a shown forecast day. */
function todayIso(): string {
  const now = new Date();
  return toIso({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() });
}

function weekdayOf(iso: string): string {
  const parsed = parseCalendarDate(iso);
  if (!parsed) return "";
  return WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()];
}

function dayLabelOf(iso: string): string {
  const parsed = parseCalendarDate(iso);
  if (!parsed) return iso;
  return `${MONTHS[parsed.month - 1]} ${parsed.day}`;
}

/** WMO weather codes (Open-Meteo `weather_code`) → the plain label
 *  and Lucide icon name the card renders. The set is closed — the
 *  provider only returns these codes; the default branch is a
 *  defensive fallback, never a presented forecast. */
function conditionForCode(code: number): { label: string; icon: TripWeatherIconName } {
  switch (code) {
    case 0:
      return { label: "Clear sky", icon: "sun" };
    case 1:
      return { label: "Mainly clear", icon: "cloud-sun" };
    case 2:
      return { label: "Partly cloudy", icon: "cloud-sun" };
    case 3:
      return { label: "Overcast", icon: "cloud" };
    case 45:
    case 48:
      return { label: "Fog", icon: "cloud-fog" };
    case 51:
      return { label: "Light drizzle", icon: "cloud-drizzle" };
    case 53:
    case 55:
      return { label: "Drizzle", icon: "cloud-drizzle" };
    case 56:
    case 57:
      return { label: "Freezing drizzle", icon: "cloud-drizzle" };
    case 61:
      return { label: "Light rain", icon: "cloud-rain" };
    case 63:
      return { label: "Rain", icon: "cloud-rain" };
    case 65:
      return { label: "Heavy rain", icon: "cloud-rain" };
    case 66:
    case 67:
      return { label: "Freezing rain", icon: "cloud-rain" };
    case 71:
      return { label: "Light snow", icon: "cloud-snow" };
    case 73:
      return { label: "Snow", icon: "cloud-snow" };
    case 75:
      return { label: "Heavy snow", icon: "cloud-snow" };
    case 77:
      return { label: "Snow grains", icon: "cloud-snow" };
    case 80:
      return { label: "Light showers", icon: "cloud-rain" };
    case 81:
      return { label: "Showers", icon: "cloud-rain" };
    case 82:
      return { label: "Heavy showers", icon: "cloud-rain" };
    case 85:
    case 86:
      return { label: "Snow showers", icon: "cloud-snow" };
    case 95:
      return { label: "Thunderstorm", icon: "cloud-lightning" };
    case 96:
    case 99:
      return { label: "Thunderstorm with hail", icon: "cloud-hail" };
    default:
      return { label: "Conditions vary", icon: "cloud" };
  }
}

/** "Nov 6, 2026, 3:42 PM" — the check instant, shown in the
 *  destination's own zone when the provider reported one. */
function formatCheckedLabel(instant: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "UTC"
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

type ForecastPayload = {
  timezone?: string;
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
};

async function fetchForecastDays(
  latitude: number,
  longitude: number,
  startIso: string,
  endIso: string
): Promise<{ days: TripWeatherDay[]; providerTimeZone: string | null } | null> {
  const url =
    `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&start_date=${startIso}&end_date=${endIso}&timezone=auto`;
  // Bounded fetch (wiring audit 2026-11-07): a stalled Open-Meteo
  // connection must surface as an error state via the caller's
  // catch, never hang the render. See lib/boundedFetch.ts.
  const res = await fetchWithTimeout(
    url,
    {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: REVALIDATE_SECONDS }
    },
    OPEN_METEO_DISPLAY_TIMEOUT_MS
  );
  if (!res.ok) return null;
  const json = (await res.json()) as ForecastPayload;
  const daily = json?.daily;
  if (!daily?.time) return null;
  const days: TripWeatherDay[] = [];
  daily.time.forEach((date, i) => {
    const tMax = daily.temperature_2m_max?.[i];
    const tMin = daily.temperature_2m_min?.[i];
    const code = daily.weather_code?.[i];
    if (typeof tMax !== "number" || typeof tMin !== "number" || typeof code !== "number") return;
    const parsed = parseCalendarDate(date);
    if (!parsed) return;
    const condition = conditionForCode(code);
    days.push({
      date,
      weekday: weekdayOf(date),
      dayLabel: dayLabelOf(date),
      dayOfMonth: parsed.day,
      tMaxC: tMax,
      tMinC: tMin,
      conditionLabel: condition.label,
      icon: condition.icon
    });
  });
  return { days, providerTimeZone: json.timezone ?? null };
}

/**
 * The trip's weather, as one honest state. Never throws: every
 * failure path lands on a state the card can render truthfully.
 */
export async function getTripWeather(request: TripWeatherRequest): Promise<TripWeatherState> {
  try {
    const latitude = request?.latitude;
    const longitude = request?.longitude;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { kind: "error" };
    }
    const start = parseCalendarDate(request.startDate);
    const end = parseCalendarDate(request.endDate);
    if (!start || !end) return { kind: "error" };
    const startIso = toIso(start);
    const endIso = toIso(end);
    if (endIso < startIso || diffDays(startIso, endIso) > 62) return { kind: "error" };

    const today = todayIso();
    if (endIso < today) return { kind: "past" };
    if (diffDays(today, startIso) >= FORECAST_WINDOW_DAYS) return { kind: "too-early" };

    const fetchStart = startIso < today ? today : startIso;
    const horizonEnd = addDays(today, FORECAST_WINDOW_DAYS - 1);
    const fetchEnd = endIso > horizonEnd ? horizonEnd : endIso;

    const result = await fetchForecastDays(latitude, longitude, fetchStart, fetchEnd);
    if (!result || result.days.length === 0) return { kind: "error" };

    const headlineDay =
      result.days.find((day) => day.date === today) || result.days[0];
    return {
      kind: "ready",
      days: result.days,
      headline: {
        date: headlineDay.date,
        label:
          headlineDay.date === today
            ? "Today"
            : `${headlineDay.weekday}, ${headlineDay.dayLabel}`,
        tMaxC: headlineDay.tMaxC,
        tMinC: headlineDay.tMinC,
        conditionLabel: headlineDay.conditionLabel,
        icon: headlineDay.icon
      },
      providerTimeZone: result.providerTimeZone,
      checkedLabel: formatCheckedLabel(new Date(), result.providerTimeZone)
    };
  } catch {
    return { kind: "error" };
  }
}
