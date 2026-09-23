type HotelMarketRow = {
  category?: string;
  title?: string;
  price_amount?: number;
  metadata?: Record<string, unknown>;
  recommendation_label?: string;
  [key: string]: unknown;
};

type HotelRelevanceRequest = {
  maximum_nightly_price?: number | null;
  hotel_preferences?: string | null;
};

function providerPayload(row: HotelMarketRow) {
  const metadata = row.metadata;
  const payload = metadata && typeof metadata === "object" ? metadata.providerPayload : null;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "") : "";
}

function preferenceTerms(value: unknown) {
  const stopWords = new Set(["and", "the", "with", "near", "for", "that", "this", "hotel", "stay", "want", "like"]);
  return [...new Set(normalize(value).match(/[a-z0-9]+/g) || [])].filter((term) => term.length > 2 && !stopWords.has(term)).slice(0, 12);
}

export function rankHotelMarketResults<T extends HotelMarketRow>(results: T[], request: HotelRelevanceRequest): T[] {
  if (!results.length) return results;
  const maxNightly = typeof request.maximum_nightly_price === "number" && Number.isFinite(request.maximum_nightly_price) && request.maximum_nightly_price > 0
    ? request.maximum_nightly_price
    : null;
  const terms = preferenceTerms(request.hotel_preferences);

  return results
    .map((row) => {
      const payload = providerPayload(row);
      const nightlyPrice = typeof payload.price_per_night === "number" && Number.isFinite(payload.price_per_night) ? payload.price_per_night : null;
      const searchable = normalize([
        row.title,
        payload.address,
        payload.neighborhood,
        payload.room_description,
        ...(Array.isArray(payload.amenities) ? payload.amenities : [])
      ].join(" "));
      const matchedTerms = terms.filter((term) => searchable.includes(term));
      const budgetMatch = maxNightly !== null && nightlyPrice !== null && nightlyPrice <= maxNightly;
      return {
        row,
        nightlyPrice,
        matchCount: matchedTerms.length,
        label: matchedTerms.length
          ? `Matches your preferences: ${matchedTerms.slice(0, 3).join(", ")}`
          : budgetMatch ? "Within your nightly budget" : ""
      };
    })
    .filter(({ nightlyPrice }) => maxNightly === null || (nightlyPrice !== null && nightlyPrice <= maxNightly))
    .sort((a, b) => b.matchCount - a.matchCount || (a.nightlyPrice ?? Number.POSITIVE_INFINITY) - (b.nightlyPrice ?? Number.POSITIVE_INFINITY) || a.row.title?.localeCompare(b.row.title || "") || 0)
    .map(({ row, label }, index) => index === 0 && label ? { ...row, recommendation_label: label } : row);
}
