"use client";

/*
 * TripDayMap — Roamly's first (and only) embedded map: MapLibre GL JS
 * rendering the OpenFreeMap vector style (URL from the single config
 * constant in lib/roamly/mapConfig.ts — never hardcoded here).
 *
 * It is a picture of a day's stops, not a router: markers for the
 * stops the caller already has coordinates for, and no routing
 * lines. The external Google / Apple / Citymapper links stay on
 * every host surface and remain the working path when this
 * component renders nothing.
 *
 * Jakob's Law round (2026-11-03, A17/A18) — the map now carries the
 * controls and pin behaviour travellers already know from Google /
 * Apple Maps:
 * - MapLibre's built-in NavigationControl (zoom + / −) and
 *   GeolocateControl (My Location), both in the standard top-right
 *   placement. (An earlier version of this header called the
 *   missing zoom control "restraint" — that wording is retired;
 *   restraint is not a functional reason to drop a standard
 *   control.)
 * - Tapping a pin opens a small PLACE CARD popup (name, a photo
 *   thumbnail only when the caller supplies a verified photo URL
 *   for that stop, and a "View place" link only when the caller
 *   supplies the stop's place-detail href) — never the old
 *   text-only label, never a placeholder photo, never a guessed
 *   link.
 * - A card strip under the map lists the day's stops IN ORDER
 *   (every stop the caller passes, not only the pinned ones) and
 *   is synchronised with the pins both ways: selecting a card
 *   flies the map to its pin and highlights it; tapping a pin
 *   highlights its card and scrolls the strip to it. A stop
 *   without coordinates appears in the strip marked as having no
 *   map pin — its coordinates are never invented to give it one.
 * - Map-honesty (2026-11-07): a stop whose coordinates are only
 *   an AREA point (coordinatePrecision "area" — the destination
 *   centre standing in for an unlocated base) gets an amber pin
 *   plus an explicit "Approximate" line in its popup and strip
 *   card, so a fallback pin never renders identically to a real
 *   place pin.
 *
 * Renders nothing when:
 * - there are zero stops with valid coordinates (the caller keeps
 *   its fallback UI), or
 * - WebGL / MapLibre is unavailable or map creation fails — failure
 *   is silent by design; the caller's links are the fallback.
 *
 * MapLibre's default attribution control stays ON (compact): the
 * OpenFreeMap / OpenMapTiles / OpenStreetMap credit is required and
 * is never stripped.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import { ROAMLY_MAP_STYLE_URL, ROAMLY_MAP_WORKER_URL } from "@/lib/roamly/mapConfig";
import { GuardedImage } from "@/components/roamly/GuardedImage";
import { useI18n } from "@/components/i18n/I18nProvider";

export type TripDayMapStop = {
  /** Stored coordinates, or null/absent when the stop has none —
   *  such a stop is listed in the strip but never pinned. */
  latitude?: number | null;
  longitude?: number | null;
  label: string;
  /** Short line for the strip card (e.g. the stop's time). */
  detail?: string | null;
  /** The stop's place-detail href (the route place cards use),
   *  only when the caller can honestly supply one; null = the
   *  popup/strip show no "View place" link rather than a guess. */
  placeHref?: string | null;
  /** A VERIFIED photo URL for this stop (pipeline result only),
   *  or null — null renders no image area at all. */
  photoUrl?: string | null;
  /** Coordinate precision (map-honesty fix, 2026-11-07): "place" =
   *  the coordinates are the stop's own point; "area" = they are
   *  an area point (the destination centre) and the pin must
   *  render as approximate — a different marker colour plus an
   *  explicit "Approximate" line in the popup and the strip — so
   *  a fallback pin can never look identical to a real one.
   *  Absent/null = an unstamped legacy row: rendered as a normal
   *  pin, exactly as rows were before the stamp existed. */
  coordinatePrecision?: "place" | "area" | null;
  /** Where the coordinates came from (companion to the precision
   *  stamp): picks the approximate wording ("destination centre"
   *  vs a generic area note). */
  coordinateSource?: "candidate" | "booking_record" | "destination_centre" | null;
  /** Strip note shown INSTEAD of the default no-location line
   *  when the stop has no pin but the record knows why — e.g. a
   *  booked stay whose property location was never saved. */
  noPinNote?: string | null;
};

/** The approximate-pin wording for an "area" stop: the pin marks
 *  the destination centre (or, for any other area source, a
 *  general area) — never the place itself. */
export function approximatePinNote(stop: TripDayMapStop): string {
  return stop.coordinateSource === "destination_centre"
    ? "Approximate — destination centre, not the exact place"
    : "Approximate — general area, not the exact place";
}

/** Marker colour per precision: the brand blue for a real place
 *  pin, the palette's sun amber for an approximate area pin. */
export function markerColorForStop(stop: TripDayMapStop): string {
  return stop.coordinatePrecision === "area" ? "#FFB84D" : "#087BFF";
}

function isValidStop(stop: TripDayMapStop): boolean {
  return (
    typeof stop.latitude === "number" &&
    typeof stop.longitude === "number" &&
    Number.isFinite(stop.latitude) &&
    Number.isFinite(stop.longitude) &&
    stop.latitude >= -90 &&
    stop.latitude <= 90 &&
    stop.longitude >= -180 &&
    stop.longitude <= 180
  );
}

/**
 * The pin popup's place card. Rendered into the MapLibre popup's
 * DOM node via a React root (see the marker setup below), so the
 * photo goes through the shared GuardedImage guard like every
 * other photo surface. No photoUrl → no image area at all; no
 * placeHref → no link.
 */
function MapPlaceCard({ stop }: { stop: TripDayMapStop }) {
  const { translateText } = useI18n();
  return (
    <div className="w-[200px] p-0.5">
      {stop.photoUrl ? (
        <div className="relative mb-2 h-24 w-full overflow-hidden rounded-lg bg-cbg">
          <GuardedImage
            src={stop.photoUrl}
            alt={stop.label}
            fill
            sizes="200px"
            className="object-cover"
          />
        </div>
      ) : null}
      <p className="text-[14px] font-semibold leading-snug text-chead">{stop.label}</p>
      {stop.coordinatePrecision === "area" ? (
        <p className="mt-0.5 text-[12.5px] font-semibold leading-4 text-amber-800">
          {translateText(approximatePinNote(stop))}
        </p>
      ) : null}
      {stop.detail ? (
        <p className="mt-0.5 text-[12.5px] leading-4 text-cgray">{stop.detail}</p>
      ) : null}
      {stop.placeHref ? (
        <a
          href={stop.placeHref}
          className="mt-1.5 inline-block min-h-11 py-1 text-[13.5px] font-semibold text-cblue"
        >
          {translateText("View place")}
        </a>
      ) : null}
    </div>
  );
}

type MapHandle = {
  remove: () => void;
  flyTo: (options: { center: [number, number]; zoom?: number; essential?: boolean }) => void;
  getZoom: () => number;
};

type MarkerHandle = {
  getElement: () => HTMLElement;
};

export function TripDayMap({ stops }: { stops: TripDayMapStop[] }) {
  const { translateText } = useI18n();
  // Every stop keeps its strip position; only stops with valid
  // coordinates earn a pin. The strip index IS the selection key
  // shared by pins and cards, which is what keeps them in sync.
  const entries = useMemo(
    () => stops.map((stop, index) => ({ stop, index, mappable: isValidStop(stop) })),
    [stops]
  );
  const validEntries = useMemo(() => entries.filter((entry) => entry.mappable), [entries]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapHandle | null>(null);
  const markersRef = useRef<Map<number, MarkerHandle>>(new Map());
  const popupRootsRef = useRef<Root[]>([]);
  const cardRefs = useRef<Array<HTMLLIElement | null>>([]);
  const initRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Stops are compared by value: a day switch hands us a new array
  // with new coordinates, and the map must rebuild for that day.
  const stopsKey = JSON.stringify(stops);

  useEffect(() => {
    if (!validEntries.length) return;
    if (initRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    initRef.current = true;
    setSelectedIndex(null);
    let cancelled = false;

    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled) return;
        // Point MapLibre at the vendored worker file BEFORE the map
        // is created — under Next/Turbopack the package's default
        // worker URL resolves to "" and no tiles ever paint. See
        // ROAMLY_MAP_WORKER_URL in lib/roamly/mapConfig.ts.
        if (typeof maplibregl.setWorkerUrl === "function") {
          maplibregl.setWorkerUrl(ROAMLY_MAP_WORKER_URL);
        }
        // MapLibre v6 removed the old supported() helper; on older
        // lines it may still exist — honour it when present, and let
        // the Map constructor's own WebGL failure (caught below) be
        // the check when it does not.
        const supported = (
          maplibregl as unknown as { supported?: () => boolean }
        ).supported;
        if (typeof supported === "function" && !supported()) {
          setFailed(true);
          return;
        }

        const map = new maplibregl.Map({
          container,
          style: ROAMLY_MAP_STYLE_URL,
          center: [validEntries[0].stop.longitude as number, validEntries[0].stop.latitude as number],
          zoom: 14,
          attributionControl: { compact: true }
        });
        mapRef.current = map as unknown as MapHandle;

        // A17: the standard map controls, in MapLibre's standard
        // top-right placement — zoom +/− and My Location
        // (GeolocateControl asks for the browser's location
        // permission only when the traveller taps it).
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        map.addControl(
          new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true
          }),
          "top-right"
        );

        for (const entry of validEntries) {
          const { stop } = entry;
          // A17: the pin popup is a place CARD, rendered by React
          // into the popup node so its photo uses GuardedImage.
          const popupNode = document.createElement("div");
          const root = createRoot(popupNode);
          root.render(<MapPlaceCard stop={stop} />);
          popupRootsRef.current.push(root);
          const popup = new maplibregl.Popup({ offset: 25, maxWidth: "240px" }).setDOMContent(
            popupNode
          );
          const marker = new maplibregl.Marker({ color: markerColorForStop(stop) })
            .setLngLat([stop.longitude as number, stop.latitude as number])
            .setPopup(popup)
            .addTo(map);
          markersRef.current.set(entry.index, marker as unknown as MarkerHandle);
          // A18 (pin → card): tapping a pin selects its strip card;
          // the effects below highlight it and scroll it into view.
          // MapLibre's own popup toggle on the same tap is untouched.
          marker.getElement().addEventListener("click", () => {
            setSelectedIndex(entry.index);
          });
        }

        if (validEntries.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const entry of validEntries) {
            bounds.extend([entry.stop.longitude as number, entry.stop.latitude as number]);
          }
          map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      initRef.current = false;
      for (const root of popupRootsRef.current) {
        try {
          root.unmount();
        } catch {
          // Already unmounted — cleanup is best-effort.
        }
      }
      popupRootsRef.current = [];
      markersRef.current = new Map();
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          // Already gone — unmount cleanup is best-effort.
        }
        mapRef.current = null;
      }
    };
    // stopsKey stands in for stops (compared by value above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  // A18 (pin highlight): the selected stop's pin grows + gains a
  // ring shadow; every other pin returns to its plain state. The
  // transform is applied to the pin's inner SVG only — MapLibre
  // positions the marker element itself, and that transform is
  // never touched.
  useEffect(() => {
    for (const [index, marker] of markersRef.current) {
      const svg = marker.getElement().querySelector("svg");
      if (!svg) continue;
      if (index === selectedIndex) {
        svg.style.transform = "scale(1.3)";
        svg.style.filter = "drop-shadow(0 0 6px rgba(8, 123, 255, 0.9))";
      } else {
        svg.style.transform = "";
        svg.style.filter = "";
      }
    }
  }, [selectedIndex]);

  // A18 (pin → card scroll): whenever the selection changes — from
  // a pin tap or a card tap — the selected card is scrolled into
  // view inside the strip.
  useEffect(() => {
    if (selectedIndex == null) return;
    const card = cardRefs.current[selectedIndex];
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [selectedIndex]);

  if (!validEntries.length || failed) return null;

  // A18 (card → pin): selecting a mappable card selects the stop
  // (highlight effects above) and flies the map to its pin.
  const selectFromCard = (entry: (typeof entries)[number]) => {
    setSelectedIndex(entry.index);
    const map = mapRef.current;
    if (map && entry.mappable) {
      map.flyTo({
        center: [entry.stop.longitude as number, entry.stop.latitude as number],
        zoom: Math.max(map.getZoom(), 15),
        essential: true
      });
    }
  };

  return (
    <div>
      <div className="bui-squircle overflow-hidden rounded-bui-card border border-chair bg-cbg shadow-bui-card">
        <div ref={containerRef} className="h-[280px] w-full" aria-label={translateText("Map of this day's stops")} />
      </div>

      {/* A18: the day's stops, in order, under the map — the
          Google Maps / Airbnb card strip. Mappable stops select +
          centre their pin; stops without coordinates are listed
          honestly as having no pin. */}
      <ol aria-label={translateText("Stops on this day, in order")} className="flex snap-x gap-2 overflow-x-auto pb-1 pt-3">
        {entries.map((entry) => {
          const { stop } = entry;
          const selected = entry.index === selectedIndex;
          return (
            <li
              key={`${entry.index}-${stop.label}`}
              ref={(node) => {
                cardRefs.current[entry.index] = node;
              }}
              className={`bui-squircle w-[180px] shrink-0 snap-start rounded-bui-card border p-3 shadow-bui-card ${
                selected ? "border-cblue bg-cblue/10 ring-1 ring-cblue" : "border-chair bg-white"
              }`}
            >
              <button
                type="button"
                disabled={!entry.mappable}
                aria-current={selected ? "true" : undefined}
                onClick={() => selectFromCard(entry)}
                className="block w-full text-left disabled:cursor-default"
              >
                {stop.photoUrl ? (
                  <span className="relative mb-2 block h-16 w-full overflow-hidden rounded-lg bg-white">
                    <GuardedImage
                      src={stop.photoUrl}
                      alt=""
                      fill
                      sizes="180px"
                      className="object-cover"
                    />
                  </span>
                ) : null}
                <span className="block break-words text-[13.5px] font-semibold leading-snug text-chead">
                  {entry.index + 1}. {stop.label}
                </span>
                {stop.detail ? (
                  <span className="mt-0.5 block text-[12.5px] leading-4 text-cgray">{stop.detail}</span>
                ) : null}
                {entry.mappable ? (
                  stop.coordinatePrecision === "area" ? (
                    <span className="mt-1 block text-[12px] font-semibold leading-4 text-amber-800">
                      {translateText(approximatePinNote(stop))}
                      {selected ? <>{" · "}{translateText("shown on the map")}</> : ""}
                    </span>
                  ) : (
                    <span className="mt-1 block text-[12px] font-medium leading-4 text-cblue">
                      {selected ? translateText("Shown on the map") : translateText("Tap to see on the map")}
                    </span>
                  )
                ) : (
                  <span className="mt-1 block text-[12px] font-medium leading-4 text-cgray">
                    {stop.noPinNote || translateText("No map pin — no location saved for this stop")}
                  </span>
                )}
              </button>
              {stop.placeHref ? (
                <a
                  href={stop.placeHref}
                  className="mt-1 inline-block min-h-11 py-1 text-[13px] font-semibold text-cblue"
                >
                  {translateText("View place")}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
