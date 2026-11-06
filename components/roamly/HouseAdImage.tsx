"use client";

import { useEffect, useRef, useState } from "react";

/**
 * HouseAdImage — the load guard for house-ad creative images.
 *
 * Same pattern as SafePhotoImg: the image stays invisible until its
 * load event lands, and on error (including the SSR race where the
 * image errored before hydration attached onError, caught by the
 * mount check below) it renders NOTHING at all. A house-ad creative
 * whose image file is missing therefore degrades to a clean text-only
 * sponsored card — no broken-image box, no empty frame — while the
 * card's layout, dismiss button, and CTA are untouched.
 */
export function HouseAdImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
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
      loading="lazy"
      onError={() => setState("failed")}
      onLoad={() => setState("loaded")}
      className={`${className ?? ""}${state === "loaded" ? "" : " invisible"}`}
    />
  );
}
