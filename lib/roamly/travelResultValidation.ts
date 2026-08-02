export type TravelDisplayCategory =
  | "flight"
  | "hotel"
  | "attraction"
  | "tour"
  | "activity"
  | "restaurant"
  | "transport"
  | "car_rental"
  | "shopping";

export type TravelResultValidationInput = {
  category?: string | null;
  expectedCategory?: string | null;
  title?: string | null;
  provider?: string | null;
  url?: string | null;
  destination?: string | null;
  city?: string | null;
  country?: string | null;
  requestedDestination?: string | null;
  requestedCity?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  allowSearchFallback?: boolean;
};

export type TravelResultValidation = {
  ok: boolean;
  reason?: string;
  host?: string;
};

const blockedExactDomains = new Set([
  "w3.org",
  "schema.org",
  "schemas.live.com",
  "ogp.me",
  "json-ld.org",
  "purl.org",
  "dublincore.org",
  "sitemaps.org",
  "iana.org",
  "ietf.org",
  "rfc-editor.org",
  "whatwg.org",
  "webschemas.org",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.com",
  "facebook.net",
  "twitter.com",
  "x.com"
]);

const blockedDomainSuffixes = [
  ".w3.org",
  ".schema.org",
  ".schemas.live.com",
  ".ogp.me",
  ".json-ld.org",
  ".google-analytics.com",
  ".googletagmanager.com",
  ".doubleclick.net"
];

const metadataTextPattern =
  /\b(schema\.org|schemas\.live\.com|w3c?|json[- ]?ld|open graph protocol|ogp\.me|microdata|rdf|structured data|web standard|developer docs?|documentation|api reference|xml namespace|metadata)\b/i;

const nonBookingPathPattern =
  /\/(?:docs?|documentation|developers?|reference|schema|schemas|standards?|spec|specification|rdf|json-ld|open-graph|metadata)(?:\/|$)/i;

function clean(value?: string | null) {
  return (value || "").trim();
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

export function travelResultHost(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    return normalizeHost(new URL(raw).hostname);
  } catch {
    return normalizeHost(raw.replace(/^https?:\/\//i, "").split("/")[0] || raw);
  }
}

export function isBlockedTravelDomain(value?: string | null) {
  const host = travelResultHost(value);
  if (!host) return false;
  if (blockedExactDomains.has(host)) return true;
  return blockedDomainSuffixes.some((suffix) => host.endsWith(suffix));
}

export function safeConsumerTravelUrl(value?: string | null) {
  const raw = clean(value);
  if (!raw || raw.startsWith("/") || raw === "#" || /^javascript:/i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (isBlockedTravelDomain(url.hostname)) return "";
    if (nonBookingPathPattern.test(url.pathname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function isBareDomainName(value?: string | null) {
  const text = clean(value).toLowerCase();
  if (!text || /\s/.test(text)) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(text.replace(/^www\./, ""));
}

function sameDomainText(a?: string | null, b?: string | null) {
  return normalizeHost(clean(a)).replace(/^https?:\/\//, "") === normalizeHost(clean(b)).replace(/^https?:\/\//, "");
}

function categoryText(category?: string | null) {
  const value = clean(category).toLowerCase();
  if (value === "ticket" || value === "experience") return "activity";
  return value;
}

function normalizedTokens(value?: string | null) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !["the", "and", "for", "canada", "united", "states"].includes(token));
}

function hasTokenOverlap(a?: string | null, b?: string | null) {
  const left = new Set(normalizedTokens(a));
  if (!left.size) return true;
  const right = normalizedTokens(b);
  if (!right.length) return true;
  return right.some((token) => left.has(token));
}

function categoryMatches(input: TravelResultValidationInput, host: string) {
  const expected = categoryText(input.expectedCategory || input.category);
  const category = categoryText(input.category || input.expectedCategory);
  if (expected && category && expected !== category) return false;

  const text = `${input.title || ""} ${input.provider || ""} ${input.source || ""} ${host}`.toLowerCase();
  if (expected === "flight") {
    return (
      host.includes("aviasales.com") ||
      /\b(travelpayouts|aviasales|flight|flights|airline|airfare|airport|google flights|kayak|skyscanner)\b/.test(text)
    );
  }
  if (expected === "hotel") {
    return (
      host.includes("stay22.com") ||
      /\b(hotel|inn|suites?|resort|hostel|motel|lodging|stay|room|rooms|booking\.com|hotels\.com|expedia|tripadvisor)\b/.test(text) ||
      category === "hotel"
    );
  }
  if (expected === "activity" || expected === "attraction" || expected === "tour") {
    return (
      host.includes("klook.com") ||
      /\b(klook|tour|ticket|tickets|activity|activities|experience|museum|gallery|landmark|attraction|admission|park|zoo|aquarium|basilica|tower|garden|theatre|theater|market|official)\b/.test(text) ||
      category === expected
    );
  }
  if (expected === "restaurant") {
    return (
      host.includes("google.com") ||
      host.includes("opentable.com") ||
      host.includes("resy.com") ||
      host.includes("thefork.com") ||
      /\b(restaurant|reservation|reservations|cafe|café|bistro|bar|grill|kitchen|diner|eatery|food|opentable|resy)\b/.test(text) ||
      category === "restaurant"
    );
  }
  if (expected === "shopping") {
    return /\b(shop|shopping|store|market|souvenir|craft|artisan|mall|outlet|boutique)\b/.test(text);
  }
  if (expected === "transport" || expected === "car_rental") {
    return /\b(transport|transfer|shuttle|train|rail|bus|ferry|metro|transit|taxi|route|directions|car rental|rental car)\b/.test(text);
  }
  return true;
}

function destinationMatches(input: TravelResultValidationInput) {
  const requested = clean(input.requestedDestination || input.requestedCity);
  if (!requested) return true;
  const resultDestination = clean(input.destination || input.city || input.country);
  if (!resultDestination) return true;
  if (hasTokenOverlap(requested, resultDestination)) return true;
  return hasTokenOverlap(requested, `${input.title || ""} ${input.provider || ""} ${input.url || ""}`);
}

export function validateTravelResultForDisplay(input: TravelResultValidationInput): TravelResultValidation {
  const href = safeConsumerTravelUrl(input.url);
  if (!href) return { ok: false, reason: "missing_or_blocked_url" };

  const host = travelResultHost(href);
  const title = clean(input.title);
  const provider = clean(input.provider);
  const identity = `${title} ${provider} ${host}`;

  if (isBlockedTravelDomain(host)) return { ok: false, reason: "blocked_domain", host };
  if (metadataTextPattern.test(identity) || nonBookingPathPattern.test(new URL(href).pathname)) {
    return { ok: false, reason: "metadata_or_documentation_result", host };
  }
  if (!title || isBareDomainName(title)) return { ok: false, reason: "domain_only_title", host };
  if (provider && isBareDomainName(provider) && sameDomainText(provider, title)) {
    return { ok: false, reason: "domain_only_provider", host };
  }
  if (!categoryMatches(input, host)) return { ok: false, reason: "category_mismatch", host };
  if (!destinationMatches(input)) return { ok: false, reason: "destination_mismatch", host };

  return { ok: true, host };
}

function canonicalUrlKey(value?: string | null) {
  const href = safeConsumerTravelUrl(value);
  if (!href) return "";
  try {
    const url = new URL(href);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) =>
      url.searchParams.delete(key)
    );
    return `${url.hostname.toLowerCase()}${url.pathname.toLowerCase()}?${url.searchParams.toString()}`;
  } catch {
    return href.toLowerCase();
  }
}

export function dedupeTravelResults<T>(
  results: T[],
  keyFor: (result: T) => {
    category?: string | null;
    title?: string | null;
    url?: string | null;
  },
  limit = results.length
) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const result of results) {
    const key = keyFor(result);
    const normalizedTitle = clean(key.title).toLowerCase().replace(/\s+/g, " ");
    const dedupeKey = [categoryText(key.category), normalizedTitle, canonicalUrlKey(key.url)].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push(result);
    if (output.length >= limit) break;
  }
  return output;
}
