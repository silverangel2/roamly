export type SelectedFlightCandidate = {
  candidateId?: unknown;
  category?: unknown;
  source?: unknown;
  sourceType?: unknown;
  deepLink?: unknown;
  providerOfferId?: unknown;
  airline?: unknown;
  flightNumbers?: unknown;
  originAirport?: unknown;
  destinationAirport?: unknown;
  departureAt?: unknown;
  arrivalAt?: unknown;
};

export type SelectedFlightIdentity = {
  candidateId: string;
  providerOfferId: string | null;
  airline: string | null;
  flightNumbers: string[];
  originAirport: string | null;
  destinationAirport: string | null;
  departureAt: string | null;
  arrivalAt: string | null;
  source: string;
  sourceType: string;
  deepLink: string | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => Boolean(text(item))).map((item) => text(item)!) : [];
}

export function resolveSelectedFlightIdentity(input: {
  selectedFlightCandidateId?: unknown;
  candidates?: unknown;
}) {
  const selectedId = text(input.selectedFlightCandidateId);
  if (!selectedId || !Array.isArray(input.candidates)) return null;
  const matches = input.candidates.filter((candidate): candidate is SelectedFlightCandidate => {
    return Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate) && text((candidate as SelectedFlightCandidate).candidateId) === selectedId && text((candidate as SelectedFlightCandidate).category) === "flight");
  });
  if (matches.length !== 1) return null;
  const candidate = matches[0];
  return {
    candidateId: selectedId,
    providerOfferId: text(candidate.providerOfferId),
    airline: text(candidate.airline),
    flightNumbers: strings(candidate.flightNumbers),
    originAirport: text(candidate.originAirport),
    destinationAirport: text(candidate.destinationAirport),
    departureAt: text(candidate.departureAt),
    arrivalAt: text(candidate.arrivalAt),
    source: text(candidate.source) || "unknown",
    sourceType: text(candidate.sourceType) || "unknown",
    deepLink: text(candidate.deepLink)
  } satisfies SelectedFlightIdentity;
}

export function marketResultIsSelectedFlight(result: Record<string, unknown> | null | undefined, identity: SelectedFlightIdentity | null) {
  return Boolean(identity && result && text(result.id) === identity.candidateId && text(result.category) === "flight");
}

export function isTrustedTravelpayoutsDeepLink(value: unknown) {
  const raw = text(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && (host === "aviasales.com" || host.endsWith(".aviasales.com"));
  } catch {
    return false;
  }
}

export function selectedFlightContinuityLevel(identity: SelectedFlightIdentity | null) {
  if (!identity) return 0 as const;
  return 1 as const;
}
