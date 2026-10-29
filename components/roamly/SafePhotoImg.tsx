"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Load-guaranteed image: renders NOTHING visible until the photo actually
 * loads, and nothing at all when it fails. This closes the SSR race where
 * an <img> errors before hydration attaches onError, leaving a broken
 * glyph on screen (seen on the Home/Live timeline thumbnails): the mount
 * check below catches already-settled images, onError catches later
 * failures, and the pending state stays invisible (layout reserved, no
 * broken-image flash). Used for every pipeline photo that is not already
 * covered by the hero's own load guarantee.
 */
export function SafePhotoImg({
  src,
  alt,
  title,
  className,
}: {
  src: string;
  alt: string;
  title?: string;
  className?: string;
}) {
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setState(img.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, []);
  if (state === "failed") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      title={title}
      onError={() => setState("failed")}
      onLoad={() => setState("loaded")}
      className={`${className ?? ""}${state === "loaded" ? "" : " invisible"}`}
    />
  );
}
