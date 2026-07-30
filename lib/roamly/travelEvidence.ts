export type TravelEvidenceSubject = "hotel" | "activity" | "restaurant" | "destination" | "transport";
export type TravelEvidenceConfidence = "none" | "low" | "medium" | "high";
export type TravelEvidenceVerdict = "recommended" | "acceptable" | "mixed" | "risky" | "insufficient";
export type TravelComplaintSeverity = "minor" | "moderate" | "severe" | "critical";

export type TravelReviewSnippet = {
  text: string;
  source_title?: string | null;
  source_url?: string | null;
  rating?: number | null;
  review_count?: number | null;
  retrieved_at?: string | null;
};

export type TravelEvidenceTheme = {
  theme: string;
  evidence_count: number;
  severity?: TravelComplaintSeverity;
};

export type TravelEvidenceResult = {
  subject: TravelEvidenceSubject;
  title: string;
  destination: string | null;
  score: number | null;
  score_100: number | null;
  confidence: TravelEvidenceConfidence;
  verdict: TravelEvidenceVerdict;
  marketplace_rating: number | null;
  marketplace_review_count: number | null;
  written_evidence_count: number;
  repeated_praises: TravelEvidenceTheme[];
  repeated_complaints: TravelEvidenceTheme[];
  recent_complaints: string[];
  search_queries: string[];
  sources: Array<{ title: string; url: string | null }>;
  warnings: string[];
};

export type TravelEvidenceScoreInput = {
  subject: TravelEvidenceSubject;
  title: string;
  destination?: string | null;
  marketplaceRating?: unknown;
  marketplaceReviewCount?: unknown;
  snippets?: TravelReviewSnippet[];
  repeatedPraises?: unknown[];
  repeatedComplaints?: unknown[];
  metadata?: Record<string, unknown> | null;
  warnings?: string[];
};

const POSITIVE_THEME_GROUPS: Array<{ theme: string; terms: string[]; weight: number }> = [
  { theme: "clean and well maintained", terms: ["clean", "spotless", "well maintained", "immaculate", "tidy"], weight: 1.45 },
  { theme: "safe and comfortable", terms: ["safe", "secure", "comfortable", "quiet", "good sleep", "family friendly"], weight: 1.4 },
  { theme: "convenient location", terms: ["central", "walkable", "convenient", "close to", "near transit", "great location"], weight: 1.35 },
  { theme: "helpful service", terms: ["friendly staff", "helpful staff", "responsive", "welcoming", "attentive"], weight: 1.25 },
  { theme: "good value", terms: ["worth it", "great value", "good value", "fair price", "reasonable price"], weight: 1.2 },
  { theme: "reliable experience", terms: ["reliable", "on time", "smooth", "easy check in", "well organized"], weight: 1.25 }
];

const COMPLAINT_THEME_GROUPS: Array<{ theme: string; terms: string[]; severity: TravelComplaintSeverity }> = [
  {
    theme: "safety or security concern",
    terms: ["unsafe", "dangerous", "theft", "stolen", "assault", "harassment", "security issue", "break in"],
    severity: "critical"
  },
  {
    theme: "scam, fraud, or bait and switch",
    terms: ["scam", "fraud", "bait and switch", "fake listing", "charged twice", "unauthorized charge"],
    severity: "critical"
  },
  {
    theme: "bed bugs or pests",
    terms: ["bed bug", "bed bugs", "bedbug", "bedbugs", "roaches", "cockroach", "pests"],
    severity: "critical"
  },
  {
    theme: "filthy or unsanitary conditions",
    terms: ["filthy", "dirty", "unsanitary", "mold", "mould", "biohazard", "smelled bad"],
    severity: "severe"
  },
  {
    theme: "booking or cancellation failure",
    terms: ["overbooked", "cancelled without notice", "canceled without notice", "stranded", "reservation not found", "closed when we arrived"],
    severity: "severe"
  },
  {
    theme: "broken essentials",
    terms: ["no hot water", "broken air conditioning", "broken ac", "no heat", "elevator broken", "power outage"],
    severity: "severe"
  },
  {
    theme: "hidden fees or poor value",
    terms: ["hidden fee", "resort fee", "unexpected fee", "overpriced", "not worth it", "poor value"],
    severity: "moderate"
  },
  {
    theme: "noise or crowding",
    terms: ["noisy", "loud", "thin walls", "crowded", "long line", "long queue"],
    severity: "moderate"
  },
  {
    theme: "service or accessibility friction",
    terms: ["rude", "unhelpful", "slow service", "confusing", "not accessible", "accessibility problem"],
    severity: "moderate"
  },
  {
    theme: "minor quality issue",
    terms: ["dated", "basic", "small room", "limited amenities", "average breakfast"],
    severity: "minor"
  }
];

const REVIEWISH_TERMS = [
  "review",
  "rated",
  "rating",
  "guest",
  "traveler",
  "customer",
  "clean",
  "safe",
  "staff",
  "location",
  "complaint",
  "dirty",
  "scam",
  "refund",
  "overbooked",
  "cancelled",
  "canceled",
  "bed bug",
  "worth it",
  "recommended"
];

const RATING_KEYS = [
  "rating",
  "average_rating",
  "averageRating",
  "review_score",
  "reviewScore",
  "guest_rating",
  "guestRating",
  "stars",
  "score"
];

const REVIEW_COUNT_KEYS = [
  "review_count",
  "reviewCount",
  "reviews_count",
  "reviewsCount",
  "rating_count",
  "ratingCount",
  "ratings_count",
  "ratingsCount",
  "reviewNumber",
  "reviews"
];

function clean(value?: string | null) {
  return (value || "").trim();
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function safeHttpUrl(value: unknown) {
  const raw = text(value);
  if (!raw || raw.startsWith("/")) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  if (!normalized) return null;
  const multiplier = normalized.endsWith("k") ? 1_000 : normalized.endsWith("m") ? 1_000_000 : 1;
  const parsed = Number(normalized.replace(/[^\d.]+/g, ""));
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed != null && parsed > 0 ? Math.round(parsed) : null;
}

function normalizeMarketplaceRating(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed == null || parsed <= 0) return null;
  if (parsed <= 5) return Math.round(parsed * 20) / 10;
  if (parsed <= 10) return Math.round(parsed * 10) / 10;
  if (parsed <= 100) return Math.round(parsed) / 10;
  return null;
}

function metadataCandidates(metadata?: Record<string, unknown> | null) {
  const base = record(metadata);
  return [
    base,
    record(base.providerPayload),
    record(base.provider_payload),
    record(base.raw_result),
    record(base.normalized_result),
    record(base.result)
  ].filter((item) => Object.keys(item).length > 0);
}

function firstMetadataNumber(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const candidate of metadataCandidates(metadata)) {
    for (const key of keys) {
      const parsed = parseNumber(candidate[key]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function snippetFromUnknown(value: unknown): TravelReviewSnippet | null {
  if (typeof value === "string") {
    const snippet = compactWhitespace(value);
    return snippet ? { text: snippet } : null;
  }
  const item = record(value);
  const snippet = compactWhitespace(
    text(item.text) ||
      text(item.snippet) ||
      text(item.review) ||
      text(item.description) ||
      text(item.content)
  );
  if (!snippet) return null;
  return {
    text: snippet,
    source_title: text(item.source_title) || text(item.sourceTitle) || text(item.title) || null,
    source_url: safeHttpUrl(item.source_url) || safeHttpUrl(item.sourceUrl) || safeHttpUrl(item.url) || null,
    rating: parseNumber(item.rating),
    review_count: parsePositiveInteger(item.review_count ?? item.reviewCount)
  };
}

function snippetsFromMetadata(metadata?: Record<string, unknown> | null) {
  const snippets: TravelReviewSnippet[] = [];
  for (const candidate of metadataCandidates(metadata)) {
    for (const key of ["review_snippets", "reviewSnippets", "reviews", "snippets", "comments"]) {
      const values = Array.isArray(candidate[key]) ? candidate[key] : [];
      for (const item of values) {
        const snippet = snippetFromUnknown(item);
        if (snippet) snippets.push(snippet);
      }
    }
    const descriptionSnippet = snippetFromUnknown(candidate.description ?? candidate.summary);
    if (descriptionSnippet) snippets.push(descriptionSnippet);
  }
  return dedupeSnippets(snippets);
}

function termMatch(haystack: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function containsAny(value: string, terms: string[]) {
  const haystack = value.toLowerCase();
  return terms.some((term) => termMatch(haystack, term.toLowerCase()));
}

function themeCount(snippets: TravelReviewSnippet[], terms: string[]) {
  return snippets.filter((snippet) => containsAny(snippet.text, terms)).length;
}

function normalizeThemeText(value: string) {
  return compactWhitespace(value.toLowerCase().replace(/[^a-z0-9 ]+/g, " "));
}

function severityWeight(severity: TravelComplaintSeverity) {
  if (severity === "critical") return 3.9;
  if (severity === "severe") return 2.8;
  if (severity === "moderate") return 1.45;
  return 0.55;
}

function complaintSeverityForText(value: string): TravelComplaintSeverity {
  const normalized = value.toLowerCase();
  for (const group of COMPLAINT_THEME_GROUPS) {
    if (containsAny(normalized, group.terms)) return group.severity;
  }
  return "moderate";
}

function repetitionWeight(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 0.38;
  if (count === 2) return 0.9;
  if (count === 3) return 1.28;
  if (count === 4) return 1.55;
  return Math.min(2.15, 1.55 + (count - 4) * 0.15);
}

function explicitThemes(values: unknown[] | undefined, complaint: boolean) {
  const themes = new Map<string, TravelEvidenceTheme>();
  for (const value of values || []) {
    const item = record(value);
    const themeText =
      typeof value === "string"
        ? value
        : text(item.theme) || text(item.label) || text(item.text) || text(item.complaint) || text(item.praise);
    const normalized = normalizeThemeText(themeText);
    if (!normalized) continue;
    const evidenceCount = parsePositiveInteger(item.evidence_count ?? item.evidenceCount ?? item.count) || 2;
    const current = themes.get(normalized);
    const next: TravelEvidenceTheme = {
      theme: compactWhitespace(themeText),
      evidence_count: (current?.evidence_count || 0) + evidenceCount,
      ...(complaint ? { severity: complaintSeverityForText(themeText) } : {})
    };
    themes.set(normalized, next);
  }
  return Array.from(themes.values());
}

function detectedPositiveThemes(snippets: TravelReviewSnippet[], explicit: TravelEvidenceTheme[]) {
  const byTheme = new Map<string, TravelEvidenceTheme>();
  for (const theme of explicit) {
    byTheme.set(normalizeThemeText(theme.theme), theme);
  }
  for (const group of POSITIVE_THEME_GROUPS) {
    const count = themeCount(snippets, group.terms);
    if (count <= 0) continue;
    const key = normalizeThemeText(group.theme);
    const current = byTheme.get(key);
    byTheme.set(key, {
      theme: group.theme,
      evidence_count: Math.max(count, current?.evidence_count || 0)
    });
  }
  return Array.from(byTheme.values()).sort((a, b) => b.evidence_count - a.evidence_count);
}

function detectedComplaintThemes(snippets: TravelReviewSnippet[], explicit: TravelEvidenceTheme[]) {
  const byTheme = new Map<string, TravelEvidenceTheme>();
  for (const theme of explicit) {
    byTheme.set(normalizeThemeText(theme.theme), {
      ...theme,
      severity: theme.severity || complaintSeverityForText(theme.theme)
    });
  }
  for (const group of COMPLAINT_THEME_GROUPS) {
    const count = themeCount(snippets, group.terms);
    if (count <= 0) continue;
    const key = normalizeThemeText(group.theme);
    const current = byTheme.get(key);
    byTheme.set(key, {
      theme: group.theme,
      evidence_count: Math.max(count, current?.evidence_count || 0),
      severity: group.severity
    });
  }
  return Array.from(byTheme.values()).sort((a, b) => {
    const severityDelta = severityWeight(b.severity || "moderate") - severityWeight(a.severity || "moderate");
    return severityDelta || b.evidence_count - a.evidence_count;
  });
}

function evidenceConfidence(writtenCount: number, marketplaceReviewCount: number | null) {
  if (writtenCount >= 8 || (writtenCount >= 4 && (marketplaceReviewCount || 0) >= 250)) return "high";
  if (writtenCount >= 3 || (writtenCount >= 1 && (marketplaceReviewCount || 0) >= 75)) return "medium";
  if (writtenCount >= 1 || (marketplaceReviewCount || 0) >= 25) return "low";
  return "none";
}

function marketplaceWeight(reviewCount: number | null) {
  if (!reviewCount || reviewCount <= 0) return 0;
  if (reviewCount >= 1000) return 0.36;
  if (reviewCount >= 250) return 0.3;
  if (reviewCount >= 75) return 0.23;
  if (reviewCount >= 20) return 0.14;
  return 0.06;
}

function clampScore(value: number) {
  return Math.max(1, Math.min(10, value));
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

function evidenceVerdict(score: number | null, confidence: TravelEvidenceConfidence, repeatedComplaints: TravelEvidenceTheme[]): TravelEvidenceVerdict {
  if (score == null || confidence === "none") return "insufficient";
  const repeatedSevere = repeatedComplaints.some(
    (complaint) => complaint.evidence_count >= 2 && (complaint.severity === "critical" || complaint.severity === "severe")
  );
  const conflictingModerateEvidence =
    repeatedComplaints.filter((complaint) => complaint.severity === "moderate" && complaint.evidence_count >= 1).length >= 2 ||
    repeatedComplaints.some((complaint) => complaint.severity === "moderate" && complaint.evidence_count >= 2);
  if (score <= 3.5 || repeatedSevere) return "risky";
  if (conflictingModerateEvidence && score < 7.2) return "mixed";
  if (score >= 7.2) return "recommended";
  if (score >= 6.2) return "acceptable";
  return "mixed";
}

function sourceList(snippets: TravelReviewSnippet[]) {
  const bySource = new Map<string, { title: string; url: string | null }>();
  for (const snippet of snippets) {
    const title = clean(snippet.source_title) || "Review source";
    const url = safeHttpUrl(snippet.source_url) || null;
    const key = `${title}|${url || ""}`;
    if (!bySource.has(key)) bySource.set(key, { title, url });
  }
  return Array.from(bySource.values()).slice(0, 8);
}

function dedupeSnippets(snippets: TravelReviewSnippet[]) {
  const seen = new Set<string>();
  const deduped: TravelReviewSnippet[] = [];
  for (const snippet of snippets) {
    const normalized = normalizeThemeText(snippet.text).slice(0, 220);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push({
      ...snippet,
      text: compactWhitespace(snippet.text).slice(0, 600),
      source_url: safeHttpUrl(snippet.source_url) || null
    });
  }
  return deduped;
}

export function buildTravelEvidenceQueries(params: {
  subject: TravelEvidenceSubject;
  title: string;
  destination?: string | null;
}) {
  const title = clean(params.title);
  const destination = clean(params.destination);
  const subject = params.subject === "activity" ? "tour attraction" : params.subject;
  const focus = [title, destination].filter(Boolean).join(" ");
  const quoted = title ? `"${title}"` : focus;
  return Array.from(
    new Set(
      [
        `${quoted} ${destination} reviews`,
        `${quoted} ${destination} complaints`,
        `${focus} ${subject} guest reviews`,
        `${focus} Tripadvisor reviews`,
        `${focus} Google reviews`
      ]
        .map(compactWhitespace)
        .filter(Boolean)
    )
  ).slice(0, 5);
}

export function extractTravelReviewSnippets(
  markdown: string,
  source: { title?: string | null; url?: string | null } = {}
) {
  const chunks = markdown
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=\.)\s+(?=[A-Z0-9])/)
    .map(compactWhitespace)
    .filter((line) => line.length >= 35 && line.length <= 700)
    .filter((line) => containsAny(line, REVIEWISH_TERMS))
    .slice(0, 24);

  return dedupeSnippets(
    chunks.map((line) => ({
      text: line,
      source_title: clean(source.title) || null,
      source_url: safeHttpUrl(source.url) || null,
      rating: parseRatingFromText(line),
      review_count: parseReviewCountFromText(line)
    }))
  );
}

function parseRatingFromText(value: string) {
  const slashMatch = value.match(/(\d+(?:\.\d+)?)\s*\/\s*(5|10|100)\b/);
  if (slashMatch) {
    const rating = Number(slashMatch[1]);
    const scale = Number(slashMatch[2]);
    return scale === 5 ? rating : scale === 10 ? rating / 2 : rating / 20;
  }
  const starMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:stars?|star rating)\b/i);
  return starMatch ? Number(starMatch[1]) : null;
}

function parseReviewCountFromText(value: string) {
  const match = value.match(/([\d,.]+[km]?)\s+(?:reviews?|ratings?)/i);
  return match ? parsePositiveInteger(match[1]) : null;
}

export function scoreTravelEvidence(input: TravelEvidenceScoreInput): TravelEvidenceResult {
  const metadata = input.metadata || null;
  const metadataRating = firstMetadataNumber(metadata, RATING_KEYS);
  const metadataReviewCount = firstMetadataNumber(metadata, REVIEW_COUNT_KEYS);
  const snippets = dedupeSnippets([...(input.snippets || []), ...snippetsFromMetadata(metadata)]);
  const snippetRating = snippets.map((snippet) => normalizeMarketplaceRating(snippet.rating)).find((value): value is number => value != null) || null;
  const snippetReviewCount = snippets.map((snippet) => parsePositiveInteger(snippet.review_count)).find((value): value is number => value != null) || null;
  const marketplaceRating = normalizeMarketplaceRating(input.marketplaceRating ?? metadataRating ?? snippetRating);
  const marketplaceReviewCount =
    parsePositiveInteger(input.marketplaceReviewCount ?? metadataReviewCount ?? snippetReviewCount) || null;
  const explicitPraises = explicitThemes(input.repeatedPraises, false);
  const explicitComplaints = explicitThemes(input.repeatedComplaints, true);
  const repeatedPraises = detectedPositiveThemes(snippets, explicitPraises);
  const repeatedComplaints = detectedComplaintThemes(snippets, explicitComplaints);
  const explicitEvidenceCount = [...explicitPraises, ...explicitComplaints].reduce((sum, theme) => sum + Math.min(3, theme.evidence_count), 0);
  const writtenEvidenceCount = snippets.length + explicitEvidenceCount;
  const confidence = evidenceConfidence(writtenEvidenceCount, marketplaceReviewCount);
  const searchQueries = buildTravelEvidenceQueries({
    subject: input.subject,
    title: input.title,
    destination: input.destination
  });

  if (confidence === "none" && marketplaceRating == null) {
    return {
      subject: input.subject,
      title: clean(input.title),
      destination: clean(input.destination) || null,
      score: null,
      score_100: null,
      confidence,
      verdict: "insufficient",
      marketplace_rating: null,
      marketplace_review_count: null,
      written_evidence_count: writtenEvidenceCount,
      repeated_praises: [],
      repeated_complaints: [],
      recent_complaints: [],
      search_queries: searchQueries,
      sources: [],
      warnings: [
        ...(input.warnings || []),
        "No written review evidence or substantial marketplace rating was available. Roamly will not infer review quality."
      ]
    };
  }

  const positiveStrength = repeatedPraises.reduce((sum, theme) => {
    const group = POSITIVE_THEME_GROUPS.find((item) => item.theme === theme.theme);
    return sum + (group?.weight || 1) * repetitionWeight(theme.evidence_count);
  }, 0);
  const complaintPressure = repeatedComplaints.reduce(
    (sum, theme) => sum + severityWeight(theme.severity || "moderate") * repetitionWeight(theme.evidence_count),
    0
  );
  const marketplaceDelta = marketplaceRating == null ? 0 : (marketplaceRating - 5.5) * marketplaceWeight(marketplaceReviewCount);
  let score = 5.4 + marketplaceDelta + Math.min(2.8, positiveStrength * 0.48) - Math.min(5.8, complaintPressure * 0.56);

  if (marketplaceRating != null && writtenEvidenceCount === 0) {
    score = 5.2 + marketplaceDelta;
  }
  if (repeatedPraises.some((theme) => theme.evidence_count >= 3) && complaintPressure < 1.3) {
    score = Math.max(score, 7.2);
  }
  if ((marketplaceRating || 0) >= 8.8 && (marketplaceReviewCount || 0) >= 100 && positiveStrength >= 1.7 && complaintPressure < 1.4) {
    score = Math.max(score, 8);
  }

  const repeatedCritical = repeatedComplaints.some((theme) => theme.evidence_count >= 2 && theme.severity === "critical");
  const repeatedSevere = repeatedComplaints.some((theme) => theme.evidence_count >= 2 && theme.severity === "severe");
  if (repeatedCritical) score = Math.min(score, 2.8);
  else if (repeatedSevere) score = Math.min(score, 3.2);

  const finalScore = roundScore(clampScore(score));
  const verdict = evidenceVerdict(finalScore, confidence, repeatedComplaints);
  return {
    subject: input.subject,
    title: clean(input.title),
    destination: clean(input.destination) || null,
    score: finalScore,
    score_100: Math.round(finalScore * 10),
    confidence,
    verdict,
    marketplace_rating: marketplaceRating,
    marketplace_review_count: marketplaceReviewCount,
    written_evidence_count: writtenEvidenceCount,
    repeated_praises: repeatedPraises.slice(0, 6),
    repeated_complaints: repeatedComplaints.slice(0, 6),
    recent_complaints: repeatedComplaints.map((theme) => theme.theme).slice(0, 4),
    search_queries: searchQueries,
    sources: sourceList(snippets),
    warnings: input.warnings || []
  };
}

export function buildSearchReadyTravelEvidence(params: {
  subject: TravelEvidenceSubject;
  title: string;
  destination?: string | null;
  warning?: string;
}): TravelEvidenceResult {
  return {
    subject: params.subject,
    title: clean(params.title),
    destination: clean(params.destination) || null,
    score: null,
    score_100: null,
    confidence: "none",
    verdict: "insufficient",
    marketplace_rating: null,
    marketplace_review_count: null,
    written_evidence_count: 0,
    repeated_praises: [],
    repeated_complaints: [],
    recent_complaints: [],
    search_queries: buildTravelEvidenceQueries(params),
    sources: [],
    warnings: [
      params.warning || "Search-ready result only. Review quality requires live review evidence before Roamly treats it as reliable."
    ]
  };
}

export function buildTravelEvidenceFromMarketMetadata(input: TravelEvidenceScoreInput) {
  return scoreTravelEvidence({
    ...input,
    marketplaceRating: input.marketplaceRating ?? firstMetadataNumber(input.metadata, RATING_KEYS),
    marketplaceReviewCount: input.marketplaceReviewCount ?? firstMetadataNumber(input.metadata, REVIEW_COUNT_KEYS),
    snippets: input.snippets || snippetsFromMetadata(input.metadata)
  });
}

function evidenceProviderSetting() {
  return clean(process.env.ROAMLY_TRAVEL_EVIDENCE_PROVIDER || "").toLowerCase();
}

export function travelEvidenceScraperConfigured() {
  const provider = evidenceProviderSetting();
  if (provider === "false" || provider === "0" || provider === "disabled" || provider === "none") return false;
  return Boolean(clean(process.env.FIRECRAWL_API_KEY) && (!provider || provider === "firecrawl" || provider === "fallback"));
}

export async function runTravelEvidenceSearchFallback(input: {
  subject: TravelEvidenceSubject;
  title: string;
  destination?: string | null;
  marketplaceRating?: unknown;
  marketplaceReviewCount?: unknown;
  snippets?: TravelReviewSnippet[];
  metadata?: Record<string, unknown> | null;
  maxQueries?: number;
  limitPerQuery?: number;
}): Promise<{ attempted: boolean; provider: "firecrawl"; evidence: TravelEvidenceResult; error?: string }> {
  const baseEvidence = scoreTravelEvidence(input);
  if (!travelEvidenceScraperConfigured()) {
    return { attempted: false, provider: "firecrawl", evidence: baseEvidence };
  }

  const apiKey = clean(process.env.FIRECRAWL_API_KEY);
  const queries = buildTravelEvidenceQueries(input).slice(0, Math.max(1, Math.min(3, input.maxQueries || 2)));
  const scrapedSnippets: TravelReviewSnippet[] = [];
  try {
    for (const query of queries) {
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          query,
          limit: Math.max(1, Math.min(5, input.limitPerQuery || 2)),
          scrapeOptions: { formats: ["markdown"] }
        }),
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) throw new Error(`Firecrawl returned ${response.status}`);
      const payload = (await response.json()) as Record<string, unknown>;
      const rows = arrayRecords(payload.data || payload.results);
      for (const row of rows) {
        const source = {
          title: text(row.title) || text(row.name) || "Travel review source",
          url: safeHttpUrl(row.url) || safeHttpUrl(row.source_url) || null
        };
        const markdown = text(row.markdown) || text(row.content) || text(row.description) || text(row.snippet);
        if (markdown) scrapedSnippets.push(...extractTravelReviewSnippets(markdown, source));
      }
    }
    return {
      attempted: true,
      provider: "firecrawl",
      evidence: scoreTravelEvidence({
        ...input,
        snippets: dedupeSnippets([...(input.snippets || []), ...scrapedSnippets])
      })
    };
  } catch (error) {
    return {
      attempted: true,
      provider: "firecrawl",
      evidence: {
        ...baseEvidence,
        warnings: [...baseEvidence.warnings, "Live review scrape failed. Roamly used only already supplied review evidence."]
      },
      error: error instanceof Error ? error.message : "Unknown travel evidence scrape error"
    };
  }
}
