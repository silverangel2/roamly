/*
 * TripWeatherCard — the trip weather surface (Fix Round Item 4,
 * 2026-11-06; audit defect D1: weather was a permanent placeholder).
 *
 * Presentational only: it renders a TripWeatherState produced
 * server-side by lib/roamly/tripWeather.ts (Open-Meteo). It never
 * fetches and never invents a value — every number on screen came
 * from the module's real provider response.
 *
 * Owner WEATHER DISPLAY RULES (2026-11-04), applied:
 * - the headline temperature is HUGE (the number the traveller came
 *   for);
 * - ONE left edge for everything;
 * - THREE gap sizes only — 4 / 8 / 12 px (gap-1 / gap-2 / gap-3,
 *   mt-2 / mt-3) between elements;
 * - ONE plain text style — no caps / italics / underlines;
 * - base text (chead / cink / cgray) + ONE accent (cblue: headline
 *   icon, day icons, range-bar fill);
 * - greys stay readable (cgray on white, never the faint cgray2 for
 *   values — the provenance line is the only cgray2 text);
 * - Lucide icons, one style, one size per role (28px headline,
 *   20px day rows);
 * - grouping: the trip's days live in THIS one card, each day a
 *   RANGE BAR (min–max on the trip's shared scale), not a number
 *   list;
 * - provenance on every data render: "Weather: Open-Meteo ·
 *   checked <time>" — a forecast is never shown without its source.
 *
 * Honest states (the module decides, the card renders):
 * - "past"      → nothing at all (a finished trip gets no card);
 * - "too-early" → the forecast-window message, ZERO numbers (the
 *   trip starts beyond Open-Meteo's ~16-day horizon, so no forecast
 *   exists to show — saying so is the honest render);
 * - "error"     → one quiet "Weather couldn't load" line.
 */

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon
} from "lucide-react";

/** Lucide icon names the weather module may return (one per WMO
 *  condition family). The module stays UI-free: it returns the name,
 *  this file owns the name → component map. */
export type TripWeatherIconName =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "cloud-fog"
  | "cloud-drizzle"
  | "cloud-rain"
  | "cloud-snow"
  | "cloud-lightning"
  | "cloud-hail";

const CONDITION_ICONS: Record<TripWeatherIconName, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  "cloud-fog": CloudFog,
  "cloud-drizzle": CloudDrizzle,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-lightning": CloudLightning,
  "cloud-hail": CloudHail
};

/** The condition icon for a weather icon name (shared with the
 *  country-info overlay, which shows the same headline). */
export function TripWeatherConditionIcon({
  name,
  size = 20,
  className
}: {
  name: TripWeatherIconName;
  size?: number;
  className?: string;
}) {
  const Icon = CONDITION_ICONS[name];
  return <Icon size={size} strokeWidth={2} className={className} aria-hidden />;
}

/** One forecast day, display-ready (labels pre-formatted server-side
 *  from the date itself, so no client timezone can shift a day). */
export type TripWeatherDay = {
  /** YYYY-MM-DD at the destination. */
  date: string;
  /** "Fri" */
  weekday: string;
  /** "Nov 20" */
  dayLabel: string;
  /** 20 */
  dayOfMonth: number;
  tMaxC: number;
  tMinC: number;
  conditionLabel: string;
  icon: TripWeatherIconName;
};

/** What the weather module needs: a place on Earth + a date range.
 *  For a trip, the coordinates come from the trip's own planning
 *  metadata (destinationLatitude / destinationLongitude) and the
 *  range from the trip's start/end dates. */
export type TripWeatherRequest = {
  latitude: number;
  longitude: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
};

export type TripWeatherState =
  | {
      kind: "ready";
      days: TripWeatherDay[];
      headline: {
        /** YYYY-MM-DD of the headline day (today when the trip is
         *  running, else the trip's first forecast day). */
        date: string;
        /** "Today" or "Fri, Nov 20" */
        label: string;
        tMaxC: number;
        tMinC: number;
        conditionLabel: string;
        icon: TripWeatherIconName;
      };
      /** IANA zone the provider reported for the destination. */
      providerTimeZone: string | null;
      /** The provenance stamp, pre-formatted: "Nov 6, 2026, 3:42 PM". */
      checkedLabel: string;
    }
  | { kind: "too-early" }
  | { kind: "past" }
  | { kind: "error" };

export function TripWeatherCard({
  weather,
  className
}: {
  weather: TripWeatherState;
  className?: string;
}) {
  if (weather.kind === "past") return null;

  if (weather.kind === "error") {
    return (
      <p data-trip-weather="error" className={`text-[13px] leading-5 text-cgray ${className || ""}`}>
        Weather couldn&rsquo;t load
      </p>
    );
  }

  if (weather.kind === "too-early") {
    return (
      <section
        data-trip-weather="too-early"
        aria-label="Trip weather"
        className={`rounded-bui-panel border border-chair bg-white p-4 shadow-bui-card ${className || ""}`}
      >
        <span className="flex items-center gap-2">
          <Cloud size={20} strokeWidth={2} className="shrink-0 text-cblue" aria-hidden />
          <span className="text-[14px] font-semibold leading-5 text-chead">
            Forecast appears about two weeks before your trip
          </span>
        </span>
        <span className="mt-2 block text-[13px] leading-5 text-cgray">
          This trip starts further out than the forecast reaches. The weather for your days will
          show here once they are close enough to call.
        </span>
      </section>
    );
  }

  const { days, headline } = weather;
  const tripMin = Math.min(...days.map((day) => day.tMinC));
  const tripMax = Math.max(...days.map((day) => day.tMaxC));
  const span = Math.max(1, tripMax - tripMin);

  return (
    <section
      data-trip-weather="ready"
      aria-label="Trip weather"
      className={`rounded-bui-panel border border-chair bg-white p-4 shadow-bui-card ${className || ""}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-[56px] font-bold leading-none tracking-[-0.02em] text-chead">
          {Math.round(headline.tMaxC)}&deg;
        </span>
        <span className="mt-1 min-w-0">
          <span className="flex items-center gap-1">
            <TripWeatherConditionIcon name={headline.icon} size={28} className="shrink-0 text-cblue" />
            <span className="text-[15px] font-semibold leading-5 text-chead">
              {headline.conditionLabel}
            </span>
          </span>
          <span className="mt-1 block text-[13px] leading-5 text-cgray">
            {headline.label} &middot; High {Math.round(headline.tMaxC)}&deg; &middot; Low{" "}
            {Math.round(headline.tMinC)}&deg;
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {days.map((day) => {
          const left = ((day.tMinC - tripMin) / span) * 100;
          const width = Math.max(3, ((day.tMaxC - day.tMinC) / span) * 100);
          return (
            <div key={day.date} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[13px] leading-5 text-cink">
                {day.weekday} {day.dayOfMonth}
              </span>
              <TripWeatherConditionIcon name={day.icon} size={20} className="shrink-0 text-cblue" />
              <span className="w-8 shrink-0 text-right text-[13px] leading-5 tabular-nums text-cgray">
                {Math.round(day.tMinC)}&deg;
              </span>
              <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-csoft">
                <span
                  className="absolute top-0 h-1.5 rounded-full bg-cblue"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[13px] font-semibold leading-5 tabular-nums text-chead">
                {Math.round(day.tMaxC)}&deg;
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-4 text-cgray2">
        Weather: Open-Meteo &middot; checked {weather.checkedLabel}
      </p>
    </section>
  );
}
