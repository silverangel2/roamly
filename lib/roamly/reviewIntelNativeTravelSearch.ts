import { buildTravelSearchBrief } from "@/lib/roamly/travelSearchBrain";
import {
  safeConsumerTravelUrl,
  validateTravelResultForDisplay
} from "@/lib/roamly/travelResultValidation";
import type { TravelMarketCategory } from "@/lib/roamly/travelMarketSearch";

type NativeReview = {
  source: string;
  sourceUrl?: string;
  rating?: number | null;
  title?: string;
  body: string;
};

type NativeSourceLink = { label: string; url: string; domain?: string };

type NativeReviewRetrievalResult = {
  queries: string[];
  sourcesChecked: string[];
  sourceLinks: NativeSourceLink[];
  reviews: NativeReview[];
  coverageNote: string;
  diagnostics: {
    searchProviders: string[];
    attemptedSearches: number;
    attemptedPages: number;
    normalFetchSuccesses: number;
    normalFetchFailures: number;
    playwrightSuccesses: number;
    playwrightFailures: number;
  };
};

type NativeReviewRetrievalFn = (input: {
  productTitle: string;
  store?: string | null;
  sourceLinks?: Array<{ label?: string | null; url?: string | null; domain?: string | null }> | null;
  maxQueries?: number;
  maxPages?: number;
  maxSnippets?: number;
  politeDelayMs?: number;
}) => Promise<NativeReviewRetrievalResult>;

export const reviewIntelNativeSourceFiles = [
  "/Users/junel/review-insight-ai/lib/nativeReviewRetrieval.ts",
  "/Users/junel/review-insight-ai/lib/reviewCollector.ts",
  "/Users/junel/review-insight-ai/lib/productUrlRetrieval.ts",
  "/Users/junel/review-insight-ai/lib/firecrawlFallback.ts"
] as const;

let nativeReviewRetrieval: Promise<NativeReviewRetrievalFn | null> | null = null;

async function loadNativeReviewRetrieval() {
  if (!nativeReviewRetrieval) {
    nativeReviewRetrieval = (async () => {
      try {
        const modulePath = "../../../review-insight-ai/lib/nativeReviewRetrieval";
        const mod = await import(/* webpackIgnore: true */ modulePath) as {
          runNativeReviewRetrieval?: NativeReviewRetrievalFn;
        };
        return typeof mod.runNativeReviewRetrieval === "function" ? mod.runNativeReviewRetrieval : null;
      } catch {
        return null;
      }
    })();
  }

  return nativeReviewRetrieval;
}

export type ReviewIntelNativeTravelRequest = {
  category: TravelMarketCategory;
  origin?: string | null;
  destination?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  travelers?: number | null;
  rooms?: number | null;
  room_type?: string | null;
  title?: string | null;
  currency?: string | null;
  interests?: string[];
};

export type ReviewIntelNativeTravelCandidate = {
  title: string;
  url: string;
  domain?: string;
  rating?: number;
  reviewSnippet?: string;
  retrievedAt: string;
  source: "reviewintel_native";
  verificationStatus: "native_source_discovered" | "native_review_evidence";
  diagnostics: NativeReviewRetrievalResult["diagnostics"];
  queries: string[];
  sourcesChecked: string[];
  coverageNote: string;
};

const genericTitlePattern =
  /^(local bistro|museum or gallery|nightlife district|hotel room|hotel\/stay|things to do|book activities|find hotels?|flights? to book|destination|official site details)$/i;

function clean(value?: string | null) {
  return (value || "").trim();
}

function compact(parts: Array<string | number | null | undefined>) {
  return parts.map((part) => clean(part == null ? "" : String(part))).filter(Boolean).join(" ");
}

function candidateTitle(label: string, domain?: string) {
  const title = clean(label)
    .replace(/\s+-\s+(Tripadvisor|Klook|Booking\.com|Expedia|Google Travel|Hotels\.com).*$/i, "")
    .replace(/\s+\|\s+.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 120);
  if (title && !genericTitlePattern.test(title)) return title;
  return domain || "";
}

function isUsableNativeUrl(value: string) {
  const safe = safeConsumerTravelUrl(value);
  if (!safe) return "";
  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();
    if (/(\.|^)(google|bing|duckduckgo)\./i.test(host)) return "";
    if (/facebook\.com\/sharer|twitter\.com\/share/i.test(safe)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function storeHint(category: TravelMarketCategory) {
  if (category === "flight") return "Google Flights Kayak Skyscanner airline";
  if (category === "hotel") return "Booking.com Hotels.com Tripadvisor official hotel";
  if (category === "attraction" || category === "tour") return "Klook Tripadvisor official tickets";
  if (category === "restaurant") return "Google Maps Tripadvisor OpenTable official restaurant";
  return "Google Maps official transport operator";
}

function nativeTitle(request: ReviewIntelNativeTravelRequest) {
  const destination = clean(request.destination || request.city || request.country);
  const route = clean(request.origin) && destination ? `${clean(request.origin)} to ${destination}` : destination;
  if (request.category === "flight") return compact([route, "flight options", request.start_date, request.end_date, request.currency]);
  if (request.category === "hotel") return compact([request.title || request.room_type || "hotel", destination, request.start_date, request.end_date]);
  if (request.category === "restaurant") return compact([request.title || "restaurants", destination, "ratings reservations"]);
  if (request.category === "transport") return compact([request.title || route, "transport", request.start_date]);
  return compact([request.title, destination, request.category === "tour" ? "tour" : "tickets", request.start_date]);
}

function sourceLinksFromReviews(result: NativeReviewRetrievalResult) {
  return result.reviews
    .map((review) => ({
      label: review.title || review.source,
      url: review.sourceUrl || "",
      rating: typeof review.rating === "number" ? review.rating : undefined,
      snippet: review.body
    }))
    .filter((item) => Boolean(item.url));
}

export async function searchReviewIntelNativeTravelCandidates(
  request: ReviewIntelNativeTravelRequest,
  options: { limit?: number } = {}
): Promise<ReviewIntelNativeTravelCandidate[]> {
  if (request.category === "flight") return [];
  const brief = buildTravelSearchBrief(request);
  const retrievedAt = new Date().toISOString();
  const target = nativeTitle(request);
  if (!target) return [];
  const runNativeReviewRetrieval = await loadNativeReviewRetrieval();
  if (!runNativeReviewRetrieval) return [];

  const result = await runNativeReviewRetrieval({
    productTitle: target,
    store: storeHint(request.category),
    sourceLinks: brief.search_queries.slice(0, 2).map((query) => ({
      label: query,
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      domain: "bing.com"
    })),
    maxQueries: 2,
    maxPages: 3,
    maxSnippets: 12,
    politeDelayMs: 0
  });

  const enrichedByUrl = new Map(sourceLinksFromReviews(result).map((item) => [item.url, item]));
  const candidates = result.sourceLinks
    .map((link): ReviewIntelNativeTravelCandidate | null => {
      const url = isUsableNativeUrl(link.url);
      if (!url) return null;
      const review = enrichedByUrl.get(link.url);
      const title = candidateTitle(link.label || review?.label || "", link.domain);
      if (!title || genericTitlePattern.test(title)) return null;
      const validation = validateTravelResultForDisplay({
        category: request.category,
        expectedCategory: request.category,
        title,
        provider: link.domain || "ReviewIntel native retrieval",
        url,
        destination: request.destination || request.city,
        city: request.city,
        country: request.country,
        requestedDestination: request.destination || request.city,
        requestedCity: request.city,
        source: "reviewintel_native",
        allowSearchFallback: false
      });
      if (!validation.ok) return null;
      return {
        title,
        url,
        domain: link.domain,
        rating: review?.rating,
        reviewSnippet: review?.snippet ? review.snippet.slice(0, 280) : undefined,
        retrievedAt,
        source: "reviewintel_native" as const,
        verificationStatus: review?.snippet ? "native_review_evidence" as const : "native_source_discovered" as const,
        diagnostics: result.diagnostics,
        queries: result.queries,
        sourcesChecked: result.sourcesChecked,
        coverageNote: result.coverageNote
      };
    })
    .filter((item): item is ReviewIntelNativeTravelCandidate => Boolean(item));

  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(options.limit || 3, 3));
  const deduped: ReviewIntelNativeTravelCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.title.toLowerCase()}|${candidate.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
    if (deduped.length >= limit) break;
  }

  return deduped;
}
