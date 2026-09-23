export function travelpayoutsBookingUrl(link: unknown, marker: unknown) {
  const path = typeof link === "string" ? link.trim() : "";
  const partnerMarker = typeof marker === "string" ? marker.trim() : "";
  if (!path || !partnerMarker) return undefined;

  try {
    const url = new URL(path, "https://www.aviasales.com");
    if (url.protocol !== "https:" || url.hostname !== "www.aviasales.com") return undefined;
    url.searchParams.set("marker", partnerMarker);
    return url.toString();
  } catch {
    return undefined;
  }
}
