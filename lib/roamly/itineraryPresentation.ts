/** Display labels for itinerary and Live rows. Does not invent venues or inventory. */

const SEARCH_TITLE =
  /(?:flight|flights|hotel|hotels|stay|stays|event|events|nightlife|activity|activities)[-_\s]?search\b|\bsearch(?:ing)?\s+(?:for\s+)?(?:flights?|hotels?|stays?|events?|nightlife|activities|things to do)\b|\bthings to do\b|[?&=]|%20|\s\+\s|\/search\b|^(?:flights?|hotels?|stays?|events?|nightlife)\b.*\b(?:from|to|in|near)\b/i;

export function looksLikeProviderSearchTitle(value: string | null | undefined) {
  const text = (value || "").trim();
  if (text.length < 8) return false;
  return SEARCH_TITLE.test(text);
}

export function isDriveMode(mode: string | null | undefined) {
  return /^(drive|driving)$/i.test((mode || "").trim());
}

export function presentTravelerTitle(input: {
  title?: string | null;
  location?: string | null;
  mode?: string | null;
  category?: string | null;
  origin?: string | null;
  destination?: string | null;
}): { title: string; needsConfirmation: boolean; modeLabel: "Drive" | null } {
  const title = (input.title || "").trim();
  const location = (input.location || "").trim();
  const origin = (input.origin || "").trim();
  const destination = (input.destination || "").trim();
  const searchTitle = looksLikeProviderSearchTitle(title);
  const searchLocation = looksLikeProviderSearchTitle(location);
  const humanLocation = location && !searchLocation ? location : "";

  if (isDriveMode(input.mode)) {
    if (title && !searchTitle && !/\bflights?\b/i.test(title)) {
      return {
        title: /\bdrive\b/i.test(title) ? title : `Drive · ${title}`,
        needsConfirmation: false,
        modeLabel: "Drive"
      };
    }
    const from = origin && !looksLikeProviderSearchTitle(origin) ? origin : "";
    const to = destination && !looksLikeProviderSearchTitle(destination) ? destination : humanLocation;
    const route = from && to ? `${from} to ${to}` : to || from;
    return {
      title: route ? `Drive · ${route}` : "Drive",
      needsConfirmation: true,
      modeLabel: "Drive"
    };
  }

  if (!searchTitle && title) return { title, needsConfirmation: false, modeLabel: null };
  if (searchTitle) {
    if (humanLocation && humanLocation.length > 2 && !/^(montreal|toronto|quebec)$/i.test(humanLocation)) {
      return { title: humanLocation, needsConfirmation: true, modeLabel: null };
    }
    const category = `${input.category || ""} ${title}`.toLowerCase();
    const fallback = /hotel|stay|lodg/.test(category)
      ? "Stay to confirm"
      : /flight|transport|train|bus|drive/.test(category)
        ? "Transport to confirm"
        : "Details to confirm";
    return { title: fallback, needsConfirmation: true, modeLabel: null };
  }

  return { title: humanLocation, needsConfirmation: Boolean(searchLocation), modeLabel: null };
}
