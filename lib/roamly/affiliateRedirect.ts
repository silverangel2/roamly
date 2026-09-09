const exactHosts = new Set([
  "aviasales.com",
  "stay22.com",
  "klook.com",
  "booking.com",
  "hotels.com",
  "expedia.com",
  "tripadvisor.com",
  "opentable.com",
  "resy.com",
  "thefork.com",
  "viator.com",
  "getyourguide.com",
  "kayak.com",
  "skyscanner.com",
  "airalo.com"
]);

function clean(value?: string | null) {
  return (value || "").trim();
}

function allowedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (exactHosts.has(host)) return true;
  return [
    "stay22.com",
    "klook.com",
    "booking.com",
    "hotels.com",
    "expedia.com",
    "tripadvisor.com",
    "opentable.com",
    "resy.com",
    "thefork.com",
    "viator.com",
    "getyourguide.com",
    "kayak.com",
    "skyscanner.com",
    "airalo.com"
  ].some((base) => host.endsWith(`.${base}`));
}

/** Validates provider destinations used by the server-side affiliate redirect. */
export function safeAffiliateRedirectUrl(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}
