"use client";

/*
 * DestinationPhotoBand — the itinerary home's photo band with the
 * load guarantee (owner incident, 2026-10-23): the band renders
 * only a photo that actually loads. The image stays invisible until
 * its load event lands.
 *
 * Final local round (2026-10-27, offline images): on error — the
 * offline case, where the external photo cannot load — the band no
 * longer vanishes to a bare header. It renders a Roamly-branded
 * placeholder (brand mark + destination name, no photograph, no
 * credit) instead: never a broken icon, never a fake or wrong
 * photograph, never an orphan credit (credit renders only with a
 * loaded real photo). The placeholder is also what an offline trip
 * shows when its licensed photo was never cached; when the worker
 * HAS cached the photo (v4 images cache), the real photo loads
 * offline and the placeholder never appears.
 */

import { useEffect, useRef, useState } from "react";

export function DestinationPhotoBand({
  imageUrl,
  alt,
  credit,
  pageUrl
}: {
  imageUrl: string;
  alt: string;
  credit: string | null;
  pageUrl: string | null;
}) {
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  const imgRef = useRef<HTMLImageElement | null>(null);

  // The photo may finish (or fail) before hydration attaches the
  // handlers; settle from the element's own state on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, []);

  if (state === "failed") {
    return (
      <figure data-testid="roamly-photo-fallback" className="mb-5">
        <div
          aria-label={`Roamly placeholder for ${alt}`}
          className="flex h-[188px] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-br from-teal-700 via-teal-600 to-teal-800 text-white"
        >
          <span className="text-[22px] font-bold tracking-tight">Roamly</span>
          <span className="max-w-[90%] truncate px-4 text-center text-[15px] font-normal text-white/90">{alt}</span>
        </div>
      </figure>
    );
  }

  return (
    <figure className="mb-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt={alt}
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={`h-[188px] w-full rounded-2xl object-cover transition-opacity duration-300 ${
          state === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
      {state === "loaded" && credit ? (
        <figcaption className="mt-1.5 text-right text-[11px] leading-4 text-cgray2">
          Photo:{" "}
          {pageUrl ? (
            <a href={pageUrl} target="_blank" rel="noreferrer" className="underline decoration-chair underline-offset-2">
              {credit}
            </a>
          ) : (
            credit
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
