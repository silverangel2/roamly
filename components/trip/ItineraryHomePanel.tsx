"use client";

import Link from "next/link";

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
 * - Map: there is NO embedded map in this codebase, so the Map tab and
 *   "View day on map" degrade to the existing Open-in-Maps links
 *   (Google / Apple / Citymapper) for the day's real stops. The gap is
 *   named in the tab, not hidden.
 * - "Edit trip": the existing in-page editing section (#customize);
 *   when the trip is closed to editing, the pill renders disabled with
 *   an honest title — never a dead button presented as working.
 * - Picture 5 literal (2026-10-26): the hero carries NO "From {origin}"
 *   line — the picture's overlay is destination + dates only. Origin
 *   still reaches this screen through the real travel row's title
 *   ("Travel from {origin} to {destination}") when the stored plan
 *   carries a travel leg; a plan with no travel leg shows no origin
 *   here, and none is invented.
 * - Rows link to the full day card (#day-N), which TripHashSync
 *   activates — the per-stop detail sheets are the sibling panels'
 *   surface, not a link this panel can honestly promise yet.
 */

import { useEffect, useRef, useState } from "react";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import type { HomeDayView } from "@/lib/roamly/itineraryHome";
import { VenueThumb } from "@/components/roamly/VenueThumb";
import { TimeProvenanceLabel } from "@/components/roamly/TimeProvenanceLabel";
import { isClockTime, provenanceForHomeRow } from "@/lib/roamly/timeProvenance";
import { venuePhotoForTitle, type VenuePhotoMap } from "@/lib/roamly/venuePhotos";

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

type HomeTab = "itinerary" | "map" | "essentials" | "documents";

const TABS: Array<{ id: HomeTab; label: string }> = [
  { id: "itinerary", label: "Itinerary" },
  { id: "map", label: "Map" },
  { id: "essentials", label: "Essentials" },
  { id: "documents", label: "Documents" }
];

function iconProps() {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  } as const;
}

function RowIcon({ kind, category, title }: { kind: string; category?: string; title?: string }) {
  const p = iconProps();
  if (kind === "travel") {
    return (
      <svg {...p}>
        <path d="M2 12h19M14 5l7 7-7 7" />
        <path d="M2 12l3-3M2 12l3 3" />
      </svg>
    );
  }
  if (kind === "arrival") {
    return (
      <svg {...p}>
        <path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10Z" />
        <circle cx="12" cy="11" r="2.2" />
      </svg>
    );
  }
  if (kind === "return-to-stay") {
    return (
      <svg {...p}>
        <path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" />
        <path d="M3 18h18M3 21v-3M21 21v-3M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3" />
      </svg>
    );
  }
  // Venue icons mirror the Live timeline matcher (title + category),
  // so the home rows carry the mock's varied icons instead of one
  // building glyph for every stop. Text is accent-stripped so
  // "Théâtre" matches the theatre branch like "Theatre" does.
  const text = `${title || ""} ${category || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Theatre before food: "theatre" contains "eat", so the food
  // branch would swallow every theatre stop if it ran first.
  if (/theatr|theater|show|concert|performance|evening/.test(text)) {
    return (
      <svg {...p}>
        <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2.5 2.5 0 0 0 0 5v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2.5 2.5 0 0 0 0-5Z" />
        <path d="M13 5v2M13 11v2M13 17v2" />
      </svg>
    );
  }
  if (/restaurant|food|dining|cafe|eat|veg|bistro|meal/.test(text)) {
    return (
      <svg {...p}>
        <path d="M4 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M5 3v18M17 3c-2 0-3 2.5-3 5v3h3v10" />
      </svg>
    );
  }
  if (/galler|art|exhibit/.test(text)) {
    return (
      <svg {...p}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 17l5-5 4 4 3-3 6 6" />
      </svg>
    );
  }
  return (
    <svg {...p}>
      <path d="M3 21h18M5 21V8l7-5 7 5v13" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
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
  const showPhoto = Boolean(photo) && photoState !== "failed";

  const editPill = editHref ? (
    <a
      href={editHref}
      className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-semibold text-chead shadow-calm"
    >
      <span aria-hidden="true">✎</span> Edit trip
    </a>
  ) : (
    <span
      aria-disabled="true"
      title="Editing is closed for this trip"
      className="inline-flex min-h-9 cursor-not-allowed items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-[13px] font-semibold text-cgray"
    >
      <span aria-hidden="true">✎</span> Edit trip
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
          <span aria-hidden="true" className="text-[20px] leading-none text-cblue">✈</span>
          <span className="text-[22px] font-bold tracking-[-0.02em]">Roamly</span>
        </Link>
        <div className="flex items-center gap-1">
          <a
            href={`/trip/${tripId}/explore`}
            aria-label="Search places on this trip"
            className="grid h-11 w-11 place-items-center rounded-full text-chead"
          >
            <svg {...iconProps()}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </a>
          <a
            href="/notifications"
            aria-label="Notifications"
            className="grid h-11 w-11 place-items-center rounded-full text-chead"
          >
            <svg {...iconProps()}>
              <path d="M12 3.5a5.5 5.5 0 0 1 5.5 5.5c0 4 1.2 5.4 2 6.5H4.5c.8-1.1 2-2.5 2-6.5A5.5 5.5 0 0 1 12 3.5" />
              <path d="M10.3 19.5a2.3 2.3 0 0 0 4.4 0" />
            </svg>
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
        <div data-testid="roamly-photo-fallback" className="relative bg-gradient-to-br from-teal-700 via-teal-600 to-teal-800 px-4 pb-4 pt-4 sm:px-5">
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

      {/* Tabs: Itinerary / Map / Essentials / Documents */}
      <nav aria-label="Trip sections" className="flex gap-2 overflow-x-auto px-2 pb-1 pt-3 sm:px-5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-10 shrink-0 rounded-full px-2 py-2 text-[14px] font-semibold transition ${
              tab === item.id ? "bg-cblue text-white" : "bg-cbg text-cink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "itinerary" && selectedDay ? (
        <div className="px-4 pb-5 sm:px-5">
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

          {/* Compact one-day timeline — the stored plan, mock shape. */}
          {selectedDay.rows.length ? (
            <ol className="relative mt-4">
              <span aria-hidden="true" className="absolute bottom-5 left-[94px] top-5 w-px bg-chair" />
              {selectedDay.rows.map((row) => (
                <li key={row.key} className="relative">
                  <a
                    href={`#day-${selectedDay.dayNumber}`}
                    aria-label={`${row.unverified ? "Unverified stop" : row.title}: see the full day plan`}
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
                    <span aria-hidden="true" className="pt-1 text-[18px] leading-none text-cchev">›</span>
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
            onClick={() => setTab("map")}
            className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cblue/10 px-4 text-[15px] font-semibold text-cblue"
          >
            <svg {...iconProps()}>
              <path d="M3 21h18M5 21V8l7-5 7 5v13" />
              <path d="M9 21v-6h6v6" />
            </svg>
            View day on map
          </button>
        </div>
      ) : null}

      {tab === "itinerary" && !selectedDay ? (
        <p className="px-4 pb-5 text-sm leading-6 text-cink sm:px-5">
          This trip has no saved day-by-day plan yet. Once your itinerary is
          generated, the day picker and timeline appear here.
        </p>
      ) : null}

      {tab === "map" ? (
        <div className="px-4 pb-5 sm:px-5">
          <h3 className="pt-3 text-[17px] font-bold text-chead">
            {selectedDay ? `${selectedDay.heading} on the map` : "Day on the map"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-cgray">
            Roamly does not have an embedded map yet, so the day&apos;s stops
            open in your maps app instead — the same destinations as this
            day&apos;s plan, nothing added.
          </p>
          {selectedDay && selectedDay.mapStops.length ? (
            <ul className="mt-4 grid gap-3">
              {selectedDay.mapStops.map((stop) => {
                const links = buildNavigationLinks({ destinationLabel: stop, address: stop });
                return (
                  <li key={stop} className="rounded-xl bg-cbg px-3 py-3">
                    <p className="text-sm font-semibold leading-5 text-chead">{stop}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {links.map((link) => (
                        <a
                          key={link.provider}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="min-h-9 py-1 text-[13px] font-medium text-cblue"
                        >
                          Open in {link.provider === "google_maps" ? "Google Maps" : link.provider === "apple_maps" ? "Apple Maps" : "Citymapper"}
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
