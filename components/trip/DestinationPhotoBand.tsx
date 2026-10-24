"use client";

/*
 * DestinationPhotoBand — the itinerary home's photo band with the
 * load guarantee (owner incident, 2026-10-23): the band renders
 * only a photo that actually loads. The image stays invisible until
 * its load event lands; on error the whole band — image AND credit —
 * unmounts and the header falls back to the approved bare form. No
 * broken icon, no empty band, no orphan credit, under any failure.
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

  if (state === "failed") return null;

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
