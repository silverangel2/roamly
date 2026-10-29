"use client";

/*
 * PlaceDetailPanel — panel 6 of the owner mock (correct-4-pages-part2.jpg,
 * 2nd panel), rendered ONLY from the PlaceDetail view-model
 * (lib/roamly/placeDetail.ts). Structure follows the mock literally,
 * top to bottom: back chevron + centered Day heading + destination
 * subtitle; photo with count (or the bare treatment when there is no
 * real photo); title (the plan's own title, never rewritten); Planned/
 * Confirmed chip + time-range chip + duration chip; description (or
 * its honest empty state); Directions / Add to calendar / Save row
 * (plain, no card); "About this place" as ONE card (title + subtitle
 * + chevron) whose per-field rows render only when expanded; Nearby
 * (max 2 cards, real sibling photo or no photo element, walk time,
 * NO heart — no saved-places store exists); "Tips for your visit"
 * plain checklist. Content ENDS at Tips: no "See the full itinerary"
 * button, no location line under the title, no date-range/origin line
 * in the header — the back chevron returns to the itinerary home.
 *
 * Design language where the mock is silent: faithful iOS structure,
 * light grouped background (cbg), deep navy-slate ink (chead #1F2D4D —
 * never black-dominant), system blue (cblue) used sparingly, only for
 * real links. No mock sample value appears here: every string comes
 * from the view-model, and every unavailable field says so.
 *
 * Honest actions: Directions links to the Picture 7 standalone
 * directions screen for this place when the host page passes its
 * URL (external Maps is one tap away on that screen via Open in
 * Maps); without that prop it is a real anchor to the view-model's
 * Google Maps dir link. Add to calendar and Save are rendered
 * DISABLED with an explanation — no calendar export and no
 * saved-places store exist in this codebase, so they must never look
 * like working buttons.
 *
 * Photo load guarantee (same rule as DestinationPhotoBand): the photo
 * block renders only a photo that actually loads; on error the whole
 * block unmounts and the header falls back to the bare form. No broken
 * image, ever.
 */

import { useEffect, useRef, useState } from "react";
import type { PlaceDetail } from "@/lib/roamly/placeDetail";
import { SafePhotoImg } from "./SafePhotoImg";
import { TimeProvenanceLabel } from "./TimeProvenanceLabel";

function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

function PlacePhoto({ detail }: { detail: PlaceDetail }) {
  const photo = detail.photo;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) setState(img.naturalWidth > 0 ? "loaded" : "failed");
  }, []);
  if (!photo || state === "failed") return null;
  return (
    <figure className="relative mb-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={photo.imageUrl}
        alt={detail.title}
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={`h-[240px] w-full rounded-2xl object-cover transition-opacity duration-300 ${
          state === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
      {state === "loaded" ? (
        <>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
            {photo.countLabel}
          </span>
          {photo.credit ? (
            <figcaption className="mt-1.5 text-right text-[11px] leading-4 text-cgray2">
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
        </>
      ) : null}
    </figure>
  );
}

function AboutRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-chair py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="shrink-0 text-[15px] font-medium text-chead">{label}</span>
      <span className={`text-right text-[15px] leading-6 ${value ? "text-cink" : "text-cgray"}`}>
        {value || "Not available"}
      </span>
    </div>
  );
}

export function PlaceDetailPanel({
  detail,
  tripId,
  directionsScreenHref
}: {
  detail: PlaceDetail;
  tripId: string;
  /** Picture 7 entry point: when the host page passes the standalone
   *  directions URL for this place, Directions links there (same
   *  icon + label + row position); the external-maps anchor below
   *  stays as the fallback when no internal href is supplied, so the
   *  round-2 external-link behavior is intact for any other host. */
  directionsScreenHref?: string | null;
}) {
  const itineraryHref = `/trip/${tripId}`;
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutPhotos = detail.photo ? "1 photo" : "No photos available";
  const aboutTips = detail.about.tipsAvailable ? "See tips below" : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5 sm:px-6">
      <div className="flex items-start gap-2">
        <a
          href={itineraryHref}
          aria-label="Back to itinerary"
          className="flex h-9 w-9 shrink-0 items-center justify-center text-[26px] leading-none text-chead"
        >
          <span aria-hidden="true">‹</span>
        </a>
        <div className="flex-1 text-center">
          <p className="text-[17px] font-bold leading-6 text-chead">{detail.dayLabel}</p>
          <p className="mt-0.5 text-[14px] font-normal leading-5 text-cgray">{detail.tripHeader.destination}</p>
        </div>
        <span aria-hidden="true" className="h-9 w-9 shrink-0" />
      </div>

      <div className="mt-4">
        <PlacePhoto detail={detail} />
      </div>

      {/* Owner-10 item 5: an unverifiable junk-title stop is never
          presented as a venue — plain "Unverified stop" title, with
          the plan title kept underneath so the stop stays traceable. */}
      <h1 className="break-words text-[28px] font-bold leading-[1.15] tracking-[-0.018em] text-chead">{detail.unverified ? "Unverified stop" : detail.title}</h1>
      {detail.unverified && detail.planTitle ? (
        <p className="mt-1 break-words text-[14px] font-normal leading-5 text-cgray">Plan title: {detail.planTitle}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-cblue/10 px-3 py-1 text-[13px] font-semibold text-cblue">
          {detail.badge}
        </span>
        {detail.evidence.timeKnown && detail.timeRangeLabel ? (
          <>
            <span className="rounded-full bg-[rgba(31,45,77,0.08)] px-3 py-1 text-[13px] font-medium text-chead">
              {detail.timeRangeLabel}
            </span>
            {/* Repair round item 1: the window's own provenance. The
                stored plan window reads Planned; a retimed window
                reads Estimated; only a FACTUAL (booking-anchored)
                record reads Confirmed. */}
            <TimeProvenanceLabel
              kind={detail.timeProvenance}
              className="rounded-full bg-cblue/10 px-3 py-1 text-[13px] font-semibold text-cblue"
            />
          </>
        ) : (
          <span className="rounded-full bg-[rgba(31,45,77,0.08)] px-3 py-1 text-[13px] font-medium text-chead">
            Flexible
          </span>
        )}
        {detail.durationLabel ? (
          <span className="rounded-full bg-[rgba(31,45,77,0.08)] px-3 py-1 text-[13px] font-medium text-chead">
            {detail.durationLabel}
          </span>
        ) : null}
      </div>

      {detail.description ? (
        <p className="mt-4 text-[16.5px] font-normal leading-[1.5] text-cink">{detail.description}</p>
      ) : (
        <p className="mt-4 text-[16.5px] font-normal leading-[1.5] text-cgray">
          No description saved for this stop yet.
        </p>
      )}

      <div className="mt-5 grid grid-cols-3 gap-2">
        {directionsScreenHref ? (
          <a
            href={directionsScreenHref}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-medium text-cblue"
          >
            <PinIcon />
            Directions
          </a>
        ) : detail.directionsUrl ? (
          <a
            href={detail.directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-medium text-cblue"
          >
            <PinIcon />
            Directions
          </a>
        ) : (
          <span className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-medium text-cgray">
            <PinIcon />
            Directions unavailable
          </span>
        )}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Calendar export is not available for this trip yet"
          className="flex min-h-16 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-medium text-cgray opacity-60"
        >
          <CalendarIcon />
          Add to calendar
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Saved places are not available for this trip yet"
          className="flex min-h-16 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[13px] font-medium text-cgray opacity-60"
        >
          <BookmarkIcon />
          Save
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-cgray">
        Add to calendar and Save are not available yet — Roamly has no calendar export or saved-places
        store for this trip today.
      </p>

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-calm">
        <button
          type="button"
          onClick={() => setAboutOpen((open) => !open)}
          aria-expanded={aboutOpen}
          className="flex w-full items-start gap-2 text-left"
        >
          <span className="flex-1">
            <span className="block text-[19px] font-bold tracking-[-0.018em] text-chead">About this place</span>
            <span className="mt-1 block text-[14.5px] font-normal leading-6 text-cgray">
              Address, photos, opening hours, ticket info, and helpful tips.
            </span>
          </span>
          <span aria-hidden="true" className={`shrink-0 text-xl leading-6 text-cchev transition-transform ${aboutOpen ? "rotate-90" : ""}`}>
            ›
          </span>
        </button>
        {aboutOpen ? (
          <div className="mt-4">
            <AboutRow label="Address" value={detail.about.address} />
            <AboutRow label="Photos" value={aboutPhotos} />
            <AboutRow label="Opening hours" value={detail.about.openingHours?.join(" · ") ?? null} />
            <AboutRow label="Ticket info" value={detail.about.ticketInfo} />
            <AboutRow label="Helpful tips" value={aboutTips} />
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Nearby</h2>
        {detail.nearby.length ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {detail.nearby.map((place) => (
              <a
                key={place.id}
                href={`/trip/${tripId}/place/${place.id}`}
                className="block overflow-hidden rounded-2xl bg-white shadow-calm"
              >
                {place.photo && !place.unverified ? (
                  <SafePhotoImg
                    src={place.photo.imageUrl}
                    alt={place.title}
                    className="h-32 w-full object-cover"
                  />
                ) : null}
                <span className="block p-4">
                  <span className="block break-words text-[15px] font-semibold leading-6 text-chead">{place.unverified ? "Unverified stop" : place.title}</span>
                  {place.unverified && place.planTitle ? (
                    <span className="mt-0.5 block break-words text-[12px] font-normal text-cgray">Plan title: {place.planTitle}</span>
                  ) : null}
                  <span className="mt-1 block text-[13.5px] font-normal text-cgray">
                    {place.walkLabel || "Walk time unavailable"}
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[15px] font-normal leading-6 text-cgray">
            No other stops planned this day.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">Tips for your visit</h2>
        {detail.tips.length ? (
          <>
            <ul className="mt-3 space-y-2.5">
              {detail.tips.map((tip) => (
                <li key={tip} className="flex gap-2.5 text-[15px] font-normal leading-6 text-cink">
                  <span aria-hidden="true" className="shrink-0 font-bold text-cgreen">
                    ✓
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
            {detail.tipsProvenance ? (
              <p className="mt-3 text-[13px] font-normal text-cgray">{detail.tipsProvenance}</p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[15px] font-normal leading-6 text-cgray">
            No visit tips saved for this trip yet.
          </p>
        )}
      </section>
    </div>
  );
}
