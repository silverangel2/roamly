function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function safeBookingPhotoUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (url.hostname === "bstatic.com" || url.hostname.endsWith(".bstatic.com")) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function bookingPhotoUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const photos = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const photo = item as Record<string, unknown>;
    const urls = photo.url && typeof photo.url === "object" ? photo.url as Record<string, unknown> : {};
    const url = safeBookingPhotoUrl(urls.large) || safeBookingPhotoUrl(urls.standard) || safeBookingPhotoUrl(urls.thumbnail_large);
    return url ? [{ url, main: photo.main_photo === true }] : [];
  });
  return [...new Set([...photos.filter((photo) => photo.main), ...photos.filter((photo) => !photo.main)].map((photo) => photo.url))].slice(0, 6);
}

export function safeBookingPhotoUrls(values: unknown) {
  return Array.isArray(values)
    ? bookingPhotoUrls(values.map((url) => ({ url: { large: url } })))
    : [];
}
