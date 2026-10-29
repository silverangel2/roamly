/*
 * Country Info panel — model types ONLY (no imports, no runtime code).
 * The client component imports this file as a type so that no server
 * module (tripCompanion, Supabase, photo fetch) ever ships to the
 * browser. The model itself is built server-side by
 * lib/roamly/countryInfoPanel.ts from the trip's own record.
 */

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
 * Weather is unavailable by construction: the tree has a
 * configured-provider adapter (lib/roamly/liveProviderAdapters.ts)
 * that requires ROAMLY_WEATHER_API_KEY + ROAMLY_WEATHER_API_URL and
 * returns "unavailable" when unconfigured, and no UI shape exists for
 * its result — so no temperature, condition, or range is ever rendered
 * from the composite's sample values (12°C / 8–14°C are mock values,
 * never live data). A future configured feed would extend this union
 * with a real, sourced reading; it must not fill it with mock data.
 */
export type CountryInfoWeather = {
  status: "unavailable";
  message: string;
  /**
   * The picture's "Oct 26 – 30 avg." line, derived from the trip's
   * own dates only (a date-range label, never a weather value).
   * Null when the trip has no usable start/end dates. The
   * temperature, condition, and range lines of the picture's card
   * have no source and are never filled.
   */
  avgLabel: string | null;
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
