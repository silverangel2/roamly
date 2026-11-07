/*
 * Country Info panel — model types ONLY (no runtime code).
 * The client component imports this file as a type so that no server
 * module (tripCompanion, Supabase, photo fetch) ever ships to the
 * browser. The model itself is built server-side by
 * lib/roamly/countryInfoPanel.ts from the trip's own record.
 * The one import below is type-only (erased at compile time): the
 * weather view types live with the weather card component.
 */

import type {
  TripWeatherRequest,
  TripWeatherState
} from "@/components/roamly/TripWeatherCard";

export type CountryInfoTabId = "overview" | "entry-travel" | "transport" | "safety";

export type CountryInfoTab = {
  id: CountryInfoTabId;
  label: string;
};

/**
 * The tab set lives here (not in the server builder) so the client
 * component can import it without pulling any server module along.
 */
export const COUNTRY_INFO_TABS: CountryInfoTab[] = [
  { id: "overview", label: "Overview" },
  { id: "entry-travel", label: "Entry & Travel" },
  { id: "transport", label: "Transport" },
  { id: "safety", label: "Safety" }
];

/**
 * One Key-information cell, in the composite's order and shape.
 * `value` is a real value from the trip's own record, or null — a
 * null value renders the honest `unavailable` text, never an invented
 * fact (there is no country-facts dataset in this codebase for
 * Language or Power, so those cells are unavailable by construction).
 * `valueLines` is the same value split for the picture's two-line
 * cell layout (e.g. "Montreal (Québec)" → ["Montreal", "(Québec)"]);
 * null exactly when `value` is null.
 */
export type CountryInfoGridCell = {
  key: "country" | "city" | "timezone" | "currency" | "language" | "power";
  label: string;
  value: string | null;
  valueLines: string[] | null;
  unavailable: string;
};

/**
 * Weather (Fix Round Item 4, 2026-11-06 — audit defect D1). The
 * panel's weather is REAL data from lib/roamly/tripWeather.ts
 * (Open-Meteo), in one of two model shapes:
 *
 * - "data": a caller fetched the weather server-side and handed the
 *   module's state to the builder; the panel renders it as-is.
 * - "unavailable": no fetched state was handed in. The shape still
 *   carries `request` — the trip's own destination coordinates (from
 *   its planning metadata) + dates — and the client panel resolves it
 *   once on mount through the weather module's server action, then
 *   renders the same states. `request` is null when the trip record
 *   holds no coordinates or dates; only then does the honest
 *   `message` render. (The builder is synchronous by battery-pinned
 *   contract, so the fetch cannot happen inside it; the request is
 *   the bridge.)
 *
 * `avgLabel` is the picture's "Oct 26 – 30 avg." line, derived from
 * the trip's own dates only (a date-range label, never a weather
 * value); null when the trip has no usable start/end dates.
 */
export type CountryInfoWeather =
  | {
      status: "unavailable";
      message: string;
      avgLabel: string | null;
      request: TripWeatherRequest | null;
    }
  | {
      status: "data";
      data: TripWeatherState;
      avgLabel: string | null;
      request: TripWeatherRequest | null;
    };

export type CountryInfoPhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
} | null;

export type CountryInfoPanelModel = {
  /** The trip's own id — the panel is built for one trip only. */
  tripId: string;
  destinationLabel: string;
  /** "Oct 26 – Oct 30, 2026" form, or null when dates are missing. */
  dateRange: string | null;
  /** Trip origin label from the trip's own record, or null. */
  originLabel: string | null;
  routeType: "domestic" | "international" | "unknown";
  routeLine: string;
  routeSummary: string;
  grid: CountryInfoGridCell[];
  weather: CountryInfoWeather;
  photo: CountryInfoPhoto;
  notesTitle: string;
  notes: string[];
  notesSummary: string;
  entryTravel: {
    routeLine: string;
    lines: string[];
    requirementsUnavailable: string;
  };
  transport: {
    preference: string | null;
    preferenceUnavailable: string;
    scheduleLine: string;
    schedulesUnavailable: string;
  };
  safety: {
    emergencyLine: string;
    lines: string[];
    advisoryUnavailable: string;
  };
  /** Always `/trip/<this trip's own id>` — never another trip's page. */
  itineraryHref: string;
};
