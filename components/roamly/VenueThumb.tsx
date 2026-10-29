"use client";

import type { VenuePhoto } from "@/lib/roamly/venuePhotos";
import { SafePhotoImg } from "./SafePhotoImg";

/**
 * Timeline-row thumbnail: a small pipeline photo beside the row icon
 * (the mock's venue-row treatment). Null photo = renders nothing (the
 * caller keeps the icon). Load-guaranteed via SafePhotoImg: nothing
 * visible until the photo loads, nothing at all on failure — never a
 * broken image, including the SSR race where an <img> errors before
 * hydration attaches onError. Credit lives in the image asset manifest
 * (rows are too small for credit lines and already link onward).
 */
export function VenueThumb({ photo, title }: { photo: VenuePhoto; title: string }) {
  return (
    <SafePhotoImg
      src={photo.imageUrl}
      alt=""
      title={title}
      className="h-11 w-11 shrink-0 rounded-[10px] object-cover"
    />
  );
}
