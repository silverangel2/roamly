"use client";

/*
 * GuardedImage — the shared load guard for remote partner photos
 * (Booking bstatic, Unsplash, Klook, Amazon hosts), giving those
 * surfaces the same failure behaviour the Wikimedia-fed surfaces
 * already have (TripHeroCard / DestinationPhotoBand / SafePhotoImg):
 *
 * - The image stays invisible until its onLoad lands (the caller's own
 *   parent background shows through meanwhile — no broken-image flash).
 * - On error — including the SSR race where the image settled before
 *   hydration attached the handlers, caught by the mount check below —
 *   it swaps to a branded neutral placeholder panel occupying the SAME
 *   geometry: an absolutely-positioned panel filling the same
 *   positioned parent a `fill` image fills, in TripHeroCard's fallback
 *   language (teal brand gradient, "Roamly" wordmark, the alt text).
 *
 * It deliberately renders NO wrapper element around next/image: `fill`
 * images position against the nearest positioned ancestor, and an
 * extra static wrapper would collapse that geometry. The fallback
 * panel is likewise positioned against that same parent.
 *
 * All current call sites use `fill`; width/height are accepted for
 * completeness and, when used without `fill`, the fallback panel takes
 * those dimensions inline.
 */

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function GuardedImage({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  className,
  unoptimized,
  priority,
  loading,
}: {
  src: string;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  unoptimized?: boolean;
  priority?: boolean;
  loading?: "lazy" | "eager";
}) {
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  const imgRef = useRef<HTMLImageElement | null>(null);

  /* Reset on src change, and catch the SSR race: an image that already
   * settled (loaded or errored) before hydration never re-fires its
   * handlers, so read its settled state on mount / src change. */
  useEffect(() => {
    setState("pending");
    const img = imgRef.current;
    if (img && img.complete) {
      setState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, [src]);

  if (state === "failed") {
    return (
      <div
        role="img"
        aria-label={alt}
        data-testid="roamly-photo-fallback"
        className={
          fill
            ? "absolute inset-0 bg-gradient-to-br from-[#071E55] via-[#087BFF] to-[#223354] p-4"
            : "bg-gradient-to-br from-[#071E55] via-[#087BFF] to-[#223354] p-4"
        }
        style={fill ? undefined : { width, height }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Roamly</p>
        {alt ? <p className="mt-1 line-clamp-3 text-sm font-bold leading-snug text-white">{alt}</p> : null}
      </div>
    );
  }

  return (
    <Image
      ref={imgRef}
      src={src}
      alt={alt}
      fill={fill}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      unoptimized={unoptimized}
      priority={priority}
      loading={loading}
      onLoad={() => setState("loaded")}
      onError={() => setState("failed")}
      className={`${className ?? ""}${state === "loaded" ? " opacity-100" : " opacity-0"}`}
    />
  );
}
