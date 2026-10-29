"use client";

/*
 * TripHeroCard — the Round 2 panel header, exactly the composite's
 * structure: a destination photo with the destination, date line, and
 * trip-state badge overlaid, and the photo credit below.
 *
 * Data honesty, same rules as DestinationPhotoBand:
 * - The photo comes ONLY from the existing destination-photo pipeline
 *   (real Wikimedia/Wikidata photo, cached) via the `photo` prop. This
 *   component never fetches, generates, or substitutes an image.
 * - The image stays invisible until its load event lands; on error the
 *   photo unmounts and the header falls back to a Roamly-branded
 *   placeholder panel (final local round, 2026-10-27, offline
 *   images: destination + dates + badge on a brand gradient, no
 *   photograph, no credit) — never a bare gradient with no content,
 *   no broken icon, no orphan credit. No photo at all renders the
 *   same branded panel directly (destination + dates + badge).
 * - The badge text is computed by the caller from the real trip dates
 *   (lib/roamly/tripClock.ts) — never hardcoded, never the composite's
 *   sample value.
 */

import { useEffect, useRef, useState } from "react";

export type TripHeroPhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
};

export function TripHeroCard({
  destination,
  dateLine,
  dayLine,
  badge,
  photo
}: {
  destination: string;
  /** e.g. "Oct 26 – Oct 30, 2026 · 5 days" */
  dateLine: string;
  /** e.g. "Day 1 of 5" (Live only; Alerts omits it). */
  dayLine?: string | null;
  /** e.g. "Trip in 3 days" — computed from the real trip dates. */
  badge: string;
  photo: TripHeroPhoto | null;
}) {
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, []);

  const showPhoto = photo && state !== "failed";
  const line = [dateLine, dayLine].filter(Boolean).join(" · ");

  return (
    <section>
      {showPhoto ? (
        <figure className="relative overflow-hidden rounded-[18px] shadow-calm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={photo.imageUrl}
            alt={destination}
            loading="lazy"
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
            className={`h-[188px] w-full object-cover transition-opacity duration-300 ${
              state === "loaded" ? "opacity-100" : "opacity-0"
            }`}
          />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="text-[22px] font-bold leading-[1.2] text-white">{destination}</p>
            {line ? <p className="mt-0.5 text-[15px] font-normal leading-[1.4] text-white/90">{line}</p> : null}
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#E8F5E9] px-3 py-1 text-[13px] font-semibold text-[#2E7D32]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {badge}
            </p>
          </div>
        </figure>
      ) : (
        <div data-testid="roamly-photo-fallback" className="rounded-[18px] bg-gradient-to-br from-teal-700 via-teal-600 to-teal-800 p-4 shadow-calm">
          <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-white/80">Roamly</p>
          <p className="mt-1 text-[22px] font-bold leading-[1.2] text-white">{destination}</p>
          {line ? <p className="mt-0.5 text-[15px] font-normal leading-[1.4] text-white/90">{line}</p> : null}
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#E8F5E9] px-3 py-1 text-[13px] font-semibold text-[#2E7D32]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {badge}
          </p>
        </div>
      )}
      {showPhoto && state === "loaded" && photo.credit ? (
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
    </section>
  );
}
