/*
 * Roamly in-app map configuration — the ONLY place the map style URL
 * lives. The provider is OpenFreeMap's public instance (keyless,
 * commercial use allowed, unlimited views; see the 2026-11-03 maps
 * census): if it is ever swapped (e.g. to the CARTO fallback), this
 * one constant is the whole change — never hardcode the URL in a
 * component.
 */
export const ROAMLY_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Attribution text the OpenFreeMap style carries; MapLibre renders
 *  it automatically through its attribution control, which the map
 *  component always leaves on. Kept here so any other map surface
 *  states the same credit verbatim. */
export const ROAMLY_MAP_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

/** MapLibre GL JS worker URL. maplibre-gl@6.16.0 resolves its module
 *  worker relative to its own module URL, which Next/Turbopack
 *  bundling collapses to an empty string — the worker then never
 *  loads and tiles never paint (markers/attribution only; reproduced
 *  in a real browser render 2026-11-03). The fix is to serve the
 *  package's own worker file from public/ and point MapLibre at it
 *  via setWorkerUrl() before the map is created.
 *  public/maplibre-gl-worker.js is a BYTE COPY of
 *  node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs from
 *  maplibre-gl@6.16.0 (BSD-3-Clause). Refresh the copy whenever the
 *  maplibre-gl version changes. */
export const ROAMLY_MAP_WORKER_URL = "/maplibre-gl-worker.js";
