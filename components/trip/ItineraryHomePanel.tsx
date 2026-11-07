"use client";

import Link from "next/link";
import { BedDouble, Bell, Building, ChevronRight, Image as ImageIcon, Map, MapPin, MoveRight, Pencil, Plane, Search, Ticket, Utensils } from "lucide-react";

/*
 * Itinerary Home panel (panel 5 — mock panel 1 of correct-4-pages-part2).
 *
 * The new trip-home surface, in the mock's exact structure:
 * Roamly header (search, bell) · photo header + "Edit trip" · tabs
 * Itinerary / Map / Essentials / Documents · day picker · one-day
 * timeline · "View day on map". The bottom tab bar (Itinerary / Live /
 * Alerts / Account) is NOT rendered here — the AppShell already renders
 * it on every app surface, Alerts badge included.
 *
 * EVERYTHING shown comes from the props, which the trip page builds
 * from THIS trip's stored plan + confirmed bookings (see
 * lib/roamly/itineraryHome.ts). No mock sample value is used anywhere:
 * no hotel, time, or duration appears unless the stored plan carries it.
 * - Photo: only the existing destination-photo pipeline's result; no
 *   photo → the approved bare header (never a generated/broken image).
 *   A pipeline photo that FAILS to load (the offline case) renders
 *   the Roamly-branded fallback panel instead (final local round,
 *   2026-10-27, Task 1): brand gradient + destination + dates, no
 *   photograph, no credit — never a stuck bare gradient, never a
 *   fake or wrong photograph. When the v4 worker has cached the
 *   photo, the real photo loads offline and the fallback never shows.
 * - Durations: plan durations carry "(est.)"; confirmed-booking rows
 *   carry none (see itineraryHome.ts).
 * - Map: the day view carries ONE Map/List pill (BoardUI branch,
 *   2026-11-04 — the re-base seam built in-branch): List is the
 *   default; Map renders the embedded TripDayMap (MapLibre +
 *   OpenFreeMap, ported with its coordinate chain: plan record →
 *   placeDetail.itemCoordinates → display builder → itineraryHome
 *   rows) for stops that carry stored coordinates, and degrades to
 *   the existing Open-in-Maps links (Google / Apple / Citymapper)
 *   for a day whose stops carry none. Coordinates are never
 *   invented; a coordinate-less day says so on its face.
 * - "Edit trip": the existing in-page editing section (#customize);
 *   when the trip is closed to editing, the pill renders disabled with
 *   an honest title — never a dead button presented as working.
 * - Picture 5 literal (2026-10-26): the hero carries NO "From {origin}"
 *   line — the picture's overlay is destination + dates only. Origin
 *   still reaches this screen through the real travel row's title
 *   ("Travel from {origin} to {destination}") when the stored plan
 *   carries a travel leg; a plan with no travel leg shows no origin
 *   here, and none is invented.
 * - Rows (Jakob's Law round, 2026-11-03, A15): a timeline stop row
 *   links to that stop's PLACE DETAIL — the same
 *   /trip/[id]/place/[placeId] route the place cards use — never
 *   to the day as a substitute for the stop tapped. Like the day
 *   cards (ItineraryDayPlan), the link is gated on the row carrying
 *   a STABLE place id: a row without one (or an unverified row,
 *   which is not presented as a place) keeps the #day-N full-day
 *   target rather than a guessed place link that could land on
 *   the wrong stop or a not-found panel. The "See day" link and
 *   the day picker remain the way to open a whole day.
 * - Local tabs (A4, local part): Itinerary / Map / Essentials /
 *   Documents render as a SEGMENTED CONTROL (one pill track,
 *   filled selected segment) — a different visual grammar from
 *   the global tab bar, so the two tab systems never look alike.
 */

import { useEffect, useRef, useState } from "react";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import type { HomeDayView } from "@/lib/roamly/itineraryHome";
import { VenueThumb } from "@/components/roamly/VenueThumb";
import { TripDayMap } from "@/components/roamly/TripDayMap";
import { TimeProvenanceLabel } from "@/components/roamly/TimeProvenanceLabel";
import { isClockTime, provenanceForHomeRow } from "@/lib/roamly/timeProvenance";
import { venuePhotoForTitle, type VenuePhotoMap } from "@/lib/roamly/venuePhotos";
import { SEARCH_RESULT_CAUTION } from "@/lib/roamly/marketStopDescription";

/** Venue-row thumbnail: renders only when the map holds a photo. */
function HomeRowThumb({ venuePhotos, title }: { venuePhotos?: VenuePhotoMap; title: string }) {
  const thumb = venuePhotoForTitle(venuePhotos, title);
  if (!thumb) return null;
  return <VenueThumb photo={thumb} title={title} />;
}

export type ItineraryHomePanelPhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
} | null;

export type ItineraryHomePanelEssential = {
  title: string;
  reason: string;
};

export type ItineraryHomePanelProps = {
  tripId: string;
  destinationLabel: string;
  dateRangeLabel: string;
  days: HomeDayView[];
  photo: ItineraryHomePanelPhoto;
  /** Pipeline thumbnails for venue rows, keyed by normalized title. */
  venuePhotos?: VenuePhotoMap;
  /** `/trip/[id]#customize`, or null when the trip is closed to editing. */
  editHref: string | null;
  essentials: ItineraryHomePanelEssential[];
  packing: string[];
  documents: string[];
};

type HomeTab = "itinerary" | "essentials" | "documents";

/* Map/List pill pass (2026-11-04): the old Itinerary and Map tabs
 * are ONE day view now, switched by the pill at the panel's bottom
 * (see the render below); Essentials and Documents stay tabs. */
const TABS: Array<{ id: HomeTab; label: string }> = [
  { id: "itinerary", label: "Itinerary" },
  { id: "essentials", label: "Essentials" },
  { id: "documents", label: "Documents" }
];

function RowIcon({ kind, category, title }: { kind: string; category?: string; title?: string }) {
  const p = { size: 20, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (kind === "travel") {
    return <MoveRight {...p} />;
  }
  if (kind === "arrival") {
    return <MapPin {...p} />;
  }
  if (kind === "return-to-stay") {
    return <BedDouble {...p} />;
  }
  // Venue icons mirror the Live timeline matcher (title + category),
  // so the home rows carry the mock's varied icons instead of one
  // building glyph for every stop. Text is accent-stripped so
  // "Théâtre" matches the theatre branch like "Theatre" does.
  const text = `${title || ""} ${category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Theatre before food: "theatre" contains "eat", so the food
  // branch would swallow every theatre stop if it ran first.
  if (/theatr|theater|show|concert|performance|evening/.test(text)) {
    return <Ticket {...p} />;
  }
  if (/restaurant|food|dining|cafe|eat|veg|bistro|meal/.test(text)) {
    return <Utensils {...p} />;
  }
  if (/galler|art|exhibit/.test(text)) {
    return <ImageIcon {...p} />;
  }
  return <Building {...p} />;
}

function rowTint(kind: string, title?: string, category?: string): string {
  if (kind === "travel") return "bg-cblue/10 text-cblue";
  if (kind === "arrival") return "bg-cgreen/10 text-cgreen";
  if (kind === "return-to-stay") return "bg-chead/10 text-chead";
  const text = `${title || ""} ${category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Theatre before food here too ("theatre" contains "eat").
  if (/theatr|theater|show|concert|performance|evening/.test(text)) return "bg-cblue/10 text-cblue";
  if (/restaurant|food|dining|cafe|eat|veg|bistro|meal/.test(text)) return "bg-corange/10 text-corange";
  if (/museum|market|historic|landmark|culture/.test(text)) return "bg-corange/10 text-corange";
  if (/galler|art|exhibit/.test(text)) return "bg-cpurple/10 text-cpurple";
  if (/hotel|hostel|lodging|stay|accommodation/.test(text)) return "bg-cgreen/10 text-cgreen";
  return "bg-amber-600/10 text-amber-700";
}

export function ItineraryHomePanel({
  tripId,
  destinationLabel,
  dateRangeLabel,
  days,
  photo,
  venuePhotos,
  editHref,
  essentials,
  packing,
  documents
}: ItineraryHomePanelProps) {
  const [tab, setTab] = useState<HomeTab>("itinerary");
  /* Map/List pill: List is the default, always (seam spec). */
  const [dayView, setDayView] = useState<"list" | "map">("list");
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(
    days.length ? days[0].dayNumber : null
  );
  const [photoState, setPhotoState] = useState<"pending" | "loaded" | "failed">("pending");
  const photoImgRef = useRef<HTMLImageElement | null>(null);

  // The photo may finish (or fail) before hydration attaches the
  // handlers; settle from the element's own state on mount — without
  // this, a pre-hydration failure leaves the pending gradient on
  // screen forever (the offline bare-gradient case).
  useEffect(() => {
    const img = photoImgRef.current;
    if (img && img.complete) {
      setPhotoState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, []);

  const selectedDay =
    days.find((day) => day.dayNumber === selectedDayNumber) || days[0] || null;
  // Map tab stops, from the day's own rows only, IN ORDER (A18):
  // every row is passed to TripDayMap — rows carrying the stop's
  // own stored coordinates get pins, rows without them are listed
  // in the map's card strip marked as having no pin (never given
  // invented coordinates). A verified pipeline photo (venue rows
  // only, the same venuePhotos map the timeline thumbnails use)
  // and the stop's place-detail href (only when the row carries a
  // stable place id — the A15 gate below) ride along for the pin
  // popup card. A day with no coordinates at all keeps the
  // fallback sentence + external links. No fetching, no geocoding,
  // nothing invented.
  const placeHrefForRow = (row: HomeDayView["rows"][number]) => {
    if (row.unverified) return null;
    const ids = row as typeof row & { itemId?: string | null; placeId?: string | null };
    const placeId = (typeof ids.itemId === "string" && ids.itemId.trim() ? ids.itemId : null) ||
      (typeof ids.placeId === "string" && ids.placeId.trim() ? ids.placeId : null);
    return placeId ? `/trip/${tripId}/place/${placeId}` : null;
  };
  const selectedDayMapStops = (selectedDay?.rows ?? []).map((row) => {
    const coords = row as typeof row & {
      latitude?: number | null;
      longitude?: number | null;
    };
    const venuePhoto =
      row.kind === "venue" && !row.unverified ? venuePhotoForTitle(venuePhotos, row.title) : null;
    return {
      latitude:
        typeof coords.latitude === "number" && Number.isFinite(coords.latitude)
          ? coords.latitude
          : null,
      longitude:
        typeof coords.longitude === "number" && Number.isFinite(coords.longitude)
          ? coords.longitude
          : null,
      label: row.unverified ? "Unverified stop" : row.title,
      detail: row.time,
      placeHref: placeHrefForRow(row),
      photoUrl: venuePhoto?.imageUrl ?? null,
      // Coordinate honesty (map-honesty fix, 2026-11-07): the
      // row's provenance/precision stamps ride to the map, so an
      // area pin renders as approximate, and an area-stamped row
      // with NO coordinates (a booked stay whose property
      // location was never saved) explains its missing pin
      // instead of borrowing the generic line.
      coordinatePrecision: row.coordinatePrecision ?? null,
      coordinateSource: row.coordinateSource ?? null,
      noPinNote:
        row.coordinatePrecision === "area" && coords.latitude == null
          ? "No property location saved — destination area only"
          : null
    };
  });
  const hasMappableStops = selectedDayMapStops.some(
    (stop) => stop.latitude != null && stop.longitude != null
  );
  // Description-boilerplate fix (2026-11-07): the full search
  // caution renders ONCE for the whole itinerary — when any day
  // carries a live-search stop — instead of as every stop's
  // description. Each search stop carries its own small chip.
  const hasSearchBackedStops = days.some((day) => day.hasSearchRows);
  const showPhoto = Boolean(photo) && photoState !== "failed";

  const editPill = editHref ? (
    <a
      href={editHref}
      className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-semibold text-chead shadow-calm"
    >
      <Pencil aria-hidden="true" size={13} strokeWidth={2} /> Edit trip
    </a>
  ) : (
    <span
      aria-disabled="true"
      title="Editing is closed for this trip"
      className="inline-flex min-h-9 cursor-not-allowed items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-[13px] font-semibold text-cgray"
    >
      <Pencil aria-hidden="true" size={13} strokeWidth={2} /> Edit trip
    </span>
  );

  return (
    <section
      aria-label={`Itinerary home for ${destinationLabel}`}
      className="overflow-hidden rounded-2xl bg-white shadow-calm"
    >
      {/* Roamly header: wordmark, search, bell (mock top row). Search has
          no dedicated route in this codebase, so it leads to the trip's
          real Explore page; the bell leads to Notifications. */}
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
        <Link href="/" aria-label="Roamly home" className="flex items-center gap-1.5 text-chead">
          <Plane aria-hidden size={20} className="shrink-0 text-cblue" />
          <span className="text-[22px] font-bold tracking-[-0.02em]">Roamly</span>
        </Link>
        <div className="flex items-center gap-1">
          <a
            href={`/trip/${tripId}/explore`}
            aria-label="Search places on this trip"
            className="grid h-11 w-11 place-items-center rounded-full text-chead"
          >
            <Search size={20} strokeWidth={1.8} aria-hidden="true" />
          </a>
          <a
            href="/notifications"
            aria-label="Notifications"
            className="grid h-11 w-11 place-items-center rounded-full text-chead"
          >
            <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
          </a>
        </div>
      </header>

      {/* Photo header + fallbacks. The image stays invisible until it
          loads and unmounts on error — the same guarantee as
          DestinationPhotoBand, with the mock's overlaid title. No
          photo at all → the approved bare header. A photo that fails
          (offline, uncached) → the branded fallback panel, never a
          stuck gradient and never a wrong photograph. */}
      {showPhoto && photo ? (
        <figure className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={photoImgRef}
            src={photo.imageUrl}
            alt={destinationLabel}
            loading="lazy"
            onLoad={() => setPhotoState("loaded")}
            onError={() => setPhotoState("failed")}
            className={`h-[210px] w-full object-cover transition-opacity duration-300 ${
              photoState === "loaded" ? "opacity-100" : "opacity-0"
            }`}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/25 to-transparent px-4 pb-4 pt-14 sm:px-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-white">
                  {destinationLabel}
                </h2>
                <p className="mt-0.5 text-[13.5px] font-medium leading-5 text-white/90">
                  {dateRangeLabel}
                </p>
              </div>
            </div>
          </div>
          <div className="absolute right-3 top-3 sm:right-4">{editPill}</div>
          {photoState === "loaded" && photo.credit ? (
            <figcaption className="bg-white px-4 py-1.5 text-right text-[11px] leading-4 text-cgray2">
              Photo:{" "}
              {photo.pageUrl ? (
                <a href={photo.pageUrl} target="_blank" rel="noreferrer" className="underline decoration-chair underline-offset-2">
                  {photo.credit}
                </a>
              ) : (
                photo.credit
              )}
            </figcaption>
          ) : null}
        </figure>
      ) : photo && photoState === "failed" ? (
        <div data-testid="roamly-photo-fallback" className="relative bg-gradient-to-br from-[#071E55] via-[#087BFF] to-[#223354] px-4 pb-4 pt-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-white/80">Roamly</p>
              <h2 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-white">
                {destinationLabel}
              </h2>
              <p className="mt-0.5 text-[13.5px] font-medium leading-5 text-white/90">
                {dateRangeLabel}
              </p>
            </div>
            {editPill}
          </div>
        </div>
      ) : (
        <div className="border-b border-chair px-4 pb-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-chead">
                {destinationLabel}
              </h2>
              <p className="mt-0.5 text-[13.5px] font-medium leading-5 text-cgray">
                {dateRangeLabel}
              </p>
            </div>
            {editPill}
          </div>
        </div>
      )}

      {/* Local tabs as a SEGMENTED CONTROL (A4, local part, as
          merged 2026-11-05): Itinerary / Essentials / Documents
          inside ONE pill track — the selected segment is a raised
          white pill on the grey track. The A4-era Map segment is
          gone by the owner's later pill order (2026-11-04): the
          day view's Map/List switch is the pill at the panel's
          bottom (see below). Same destinations, same behaviour,
          but a deliberately different visual grammar from the
          global tab bar (separate floating pills / a bottom icon
          bar), so the two tab systems on this screen never look
          alike. */}
      <nav
        aria-label="Trip sections"
        data-segmented-control="true"
        className="mx-4 mt-3 flex gap-1 overflow-x-auto rounded-full bg-cbg p-1 ring-1 ring-chair sm:mx-5"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-11 flex-1 shrink-0 rounded-full px-3 py-2 text-[14px] font-semibold transition ${
              tab === item.id ? "bg-white text-chead shadow-calm" : "bg-transparent text-cgray"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "itinerary" && selectedDay ? (
        <div className="px-4 pb-28 sm:px-5">
          {/* Itinerary-level search caution (2026-11-07): printed
              once here when the trip carries any live-search stop;
              the stops themselves show a one-line description plus
              a small "Search result" chip, never this paragraph. */}
          {hasSearchBackedStops ? (
            <p className="mt-3 rounded-xl bg-cbg px-4 py-3 text-[13px] leading-5 text-cgray">
              {SEARCH_RESULT_CAUTION}
            </p>
          ) : null}
          {/* Day picker */}
          <div role="group" aria-label="Pick a day" className="flex snap-x gap-2 overflow-x-auto py-3">
            {days.map((day) => {
              const active = day.dayNumber === selectedDay.dayNumber;
              return (
                <button
                  key={day.dayNumber}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedDayNumber(day.dayNumber)}
                  className={`flex min-h-14 w-[56px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl px-1 py-2 transition ${
                    active ? "bg-cblue text-white" : "bg-cbg text-cink"
                  }`}
                >
                  <span className="text-[12px] font-semibold leading-4">
                    {day.pickerWeekday || `Day ${day.dayNumber}`}
                  </span>
                  <span className="text-[12px] leading-4 opacity-90">{day.pickerMonthDay}</span>
                </button>
              );
            })}
          </div>

          {/* Day heading + See day (lands on the full day card; the
              page's hash sync activates the day panel for it). */}
          <div className="flex items-start justify-between gap-3 pt-1">
            <div className="min-w-0">
              <h3 className="text-[19px] font-bold leading-snug tracking-[-0.01em] text-chead">
                {selectedDay.heading}
              </h3>
              {/* DISPLAY-ONLY day summary (final local round,
                  2026-10-27): the derived sentence from this day's
                  own rows, NOT the stored plan text. The stored
                  text stays in the trip record untouched; the view
                  keeps it as `subtitle` for audit only. */}
              {selectedDay.displaySummary ? (
                <p className="mt-0.5 text-[14px] leading-5 text-cgray">{selectedDay.displaySummary}</p>
              ) : null}
            </div>
            <a
              href={`#day-${selectedDay.dayNumber}`}
              className="min-h-11 shrink-0 px-1 py-2 text-[14px] font-semibold text-cblue"
            >
              See day
            </a>
          </div>

          {dayView === "list" ? (
          <>
          {/* Compact one-day timeline — the stored plan, mock shape. */}
          {selectedDay.rows.length ? (
            <ol className="relative mt-4">
              <span aria-hidden="true" className="absolute bottom-5 left-[94px] top-5 w-px bg-chair" />
              {selectedDay.rows.map((row) => (
                <li key={row.key} className="relative">
                  <a
                    href={placeHrefForRow(row) ?? `#day-${selectedDay.dayNumber}`}
                    aria-label={`${row.unverified ? "Unverified stop" : row.title}: ${
                      placeHrefForRow(row) ? "view place details" : "see the full day plan"
                    }`}
                    className="flex items-start gap-3 py-3"
                  >
                    <span className="w-16 shrink-0 pt-2 text-right text-[13px] font-medium leading-4 text-cgray">
                      {row.time}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full ${rowTint(row.kind, row.title, row.category)}`}
                    >
                      <RowIcon kind={row.kind} category={row.category} title={row.title} />
                    </span>
                    {row.kind === "venue" && !row.unverified ? (
                      <HomeRowThumb venuePhotos={venuePhotos} title={row.title} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {/* Owner-10 item 5: an unverifiable junk-title
                            stop is never presented as a venue. It
                            renders plainly as an unplanned stop, with
                            its plan title kept in the subtitle so the
                            row stays traceable to the plan. */}
                        <span className="break-words text-[15.5px] font-semibold leading-snug text-chead">
                          {row.unverified ? "Unverified stop" : row.title}
                        </span>
                        {/* Repair round item 1: every clock time on
                            this timeline carries its provenance. A
                            verified-booking row is Confirmed (the old
                            "Booked" pill renamed to the shared label);
                            a plan-draft leg is Planned; a retimed row
                            is Estimated (its time is a recalculation);
                            every other row shows its original stored
                            plan time, unchanged, so it is Planned —
                            the old "Live-updated" default for these
                            stored times was the owner's defect.
                            "Flexible" rows carry no time and no label.
                            Unverified ("Unverified stop") rows carry no
                            pill either: their own title already says
                            Unplanned, and a Planned pill beneath it
                            would contradict it. */}
                        {isClockTime(row.time) && !row.unverified ? (
                          <TimeProvenanceLabel
                            kind={provenanceForHomeRow(row)}
                            className="rounded-md bg-cblue/10 px-2 py-0.5 text-[11px] font-bold text-cblue"
                          />
                        ) : null}
                        {/* Market provenance chip (2026-11-07): the
                            stop's sourcing as a small muted pill —
                            the demoted form of the caution paragraph
                            that used to be every stop's description. */}
                        {row.provenance === "search" ? (
                          <span className="rounded-md bg-cbg px-2 py-0.5 text-[11px] font-semibold text-cgray">
                            Search result
                          </span>
                        ) : null}
                        {row.provenance === "verified" ? (
                          <span className="rounded-md bg-cbg px-2 py-0.5 text-[11px] font-semibold text-cgray">
                            Verified source
                          </span>
                        ) : null}
                      </span>
                      {row.unverified && row.planTitle ? (
                        <span className="mt-0.5 block break-words text-[13.5px] leading-5 text-cgray">
                          Plan title: {row.planTitle}
                          {row.subtitle ? ` · ${row.subtitle}` : ""}
                        </span>
                      ) : row.subtitle ? (
                        <span className="mt-0.5 block break-words text-[13.5px] leading-5 text-cgray">
                          {row.subtitle}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight aria-hidden="true" size={18} strokeWidth={2} className="mt-1 shrink-0 text-cchev" />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl bg-cbg px-4 py-3 text-sm leading-6 text-cink">
              This day has no timed plan yet. Keep it flexible until more of
              the itinerary is confirmed.
            </p>
          )}

          <button
            type="button"
            onClick={() => setDayView("map")}
            className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cblue/10 px-4 text-[15px] font-semibold text-cblue"
          >
            <Map size={20} strokeWidth={1.8} aria-hidden="true" />
            View day on map
          </button>
          </>
          ) : (
          <div key={`map-${selectedDay.dayNumber}`} className="bui-enter mt-4">
            {/* Map state of the pill: the embedded map for stops
                that carry stored coordinates; the honest fallback
                sentence + the same Open-in-Maps links when a day
                carries none. The day picker above stays visible in
                both states (seam spec). */}
            {hasMappableStops ? (
              <TripDayMap stops={selectedDayMapStops} />
            ) : (
              <p className="rounded-xl bg-cbg px-4 py-3 text-sm leading-6 text-cink">
                No mappable locations for this day — the day&apos;s stops open in your maps app instead.
              </p>
            )}
            {selectedDay.mapStopDetails.length ? (
              <ul className="mt-4 grid gap-3">
                {selectedDay.mapStopDetails.map((stopDetail) => {
                  // Map honesty (2026-11-07): a stop with stored
                  // coordinates links to the exact point; a stop
                  // whose words are all we have keeps the text
                  // link, and a stop with no real place identity
                  // behind the words gets the search label — the
                  // provider resolves the text, so the traveller
                  // is told to check it lands on the right place.
                  const links = buildNavigationLinks({
                    destinationLabel: stopDetail.query,
                    address: stopDetail.query,
                    latitude: stopDetail.latitude,
                    longitude: stopDetail.longitude,
                    unverifiedSearch: stopDetail.searchOnly
                  });
                  return (
                    <li key={stopDetail.query} className="rounded-xl bg-cbg px-3 py-3">
                      <p className="text-sm font-semibold leading-5 text-chead">{stopDetail.query}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {links.map((link) => (
                          <a
                            key={link.provider}
                            href={link.href}
                            target="_blank"
                            rel="noreferrer"
                            className="min-h-9 py-1 text-[13px] font-medium text-cblue"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl bg-cbg px-4 py-3 text-sm leading-6 text-cink">
                This day has no mappable stops yet. When the plan names places,
                their map links appear here.
              </p>
            )}
          </div>
          )}

          {/* Map/List pill (seam spec, built in-branch 2026-11-04):
              ONE control at the day panel's bottom, in the thumb
              zone — fixed above the 64px tab bar + safe area,
              centred; white BoardUI card surface, hairline border,
              lift shadow; segments 44px+ tall and 76px+ wide; the
              selected segment is the cblue fill. Local state only —
              no URL change; List is the default. */}
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-30 flex justify-center">
            <div
              role="group"
              aria-label="Day view"
              className="bui-squircle pointer-events-auto flex gap-1 rounded-full border border-chair bg-white p-1 shadow-bui-lift"
            >
              {(
                [
                  { id: "list", label: "List" },
                  { id: "map", label: "Map" }
                ] as const
              ).map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  aria-pressed={dayView === segment.id}
                  onClick={() => setDayView(segment.id)}
                  className={`bui-tap bui-tab-press flex min-h-11 min-w-[76px] items-center justify-center rounded-full px-4 text-[14px] font-semibold transition ${
                    dayView === segment.id ? "bg-cblue text-white" : "text-cink hover:bg-csoft"
                  }`}
                >
                  {segment.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "itinerary" && !selectedDay ? (
        <p className="px-4 pb-5 text-sm leading-6 text-cink sm:px-5">
          This trip has no saved day-by-day plan yet. Once your itinerary is
          generated, the day picker and timeline appear here.
        </p>
      ) : null}

      {tab === "essentials" ? (
        <div className="px-4 pb-5 sm:px-5">
          <h3 className="pt-3 text-[17px] font-bold text-chead">Essentials</h3>
          <p className="mt-1 text-sm leading-6 text-cgray">
            What this trip&apos;s plan recommends packing and preparing. No
            shopping links here — the full essentials section on this trip
            keeps those.
          </p>
          {essentials.length || packing.length ? (
            <ul className="mt-4 grid gap-3">
              {essentials.map((item, index) => (
                <li key={`${item.title}-${index}`} className="rounded-xl bg-cbg px-3 py-3">
                  <p className="text-sm font-semibold leading-5 text-chead">{item.title}</p>
                  {item.reason ? (
                    <p className="mt-0.5 text-[13px] leading-5 text-cgray">{item.reason}</p>
                  ) : null}
                </li>
              ))}
              {packing.map((item) => (
                <li key={`packing-${item}`} className="rounded-xl bg-cbg px-3 py-3">
                  <p className="text-sm font-semibold leading-5 text-chead">{item}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-cgray">Packing checklist</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-cbg px-4 py-3 text-sm leading-6 text-cink">
              No essentials saved for this trip yet.
            </p>
          )}
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="px-4 pb-5 sm:px-5">
          <h3 className="pt-3 text-[17px] font-bold text-chead">Documents</h3>
          <p className="mt-1 text-sm leading-6 text-cgray">
            The document checklist saved for this trip — nothing else is
            claimed here.
          </p>
          {documents.length ? (
            <ul className="mt-4 grid gap-3">
              {documents.map((item) => (
                <li key={item} className="rounded-xl bg-cbg px-3 py-3">
                  <p className="text-sm font-semibold leading-5 text-chead">{item}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-cbg px-4 py-3 text-sm leading-6 text-cink">
              No document checklist saved for this trip yet.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
