export const TRAVEL_MARKET_FAILURE_CLASSES = {
  configurationUnavailable: "CONFIGURATION_UNAVAILABLE",
  requestTimeout: "REQUEST_TIMEOUT",
  networkFailure: "NETWORK_FAILURE",
  rateLimited: "RATE_LIMITED",
  providerError: "PROVIDER_ERROR",
  invalidResponse: "INVALID_RESPONSE",
  zeroResults: "ZERO_RESULTS",
  staleOrUnusableResult: "STALE_OR_UNUSABLE_RESULT"
} as const;

export type TravelMarketFailureClass = (typeof TRAVEL_MARKET_FAILURE_CLASSES)[keyof typeof TRAVEL_MARKET_FAILURE_CLASSES];

const INCIDENT_BUCKET_MS = 15 * 60 * 1000;

function errorRecord(error: unknown) {
  return error && typeof error === "object" ? error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } : {};
}

export function classifyTravelMarketProviderError(error: unknown) {
  const value = errorRecord(error);
  const status = typeof value.status === "number" ? value.status : null;
  const name = typeof value.name === "string" ? value.name : "";
  const message = typeof value.message === "string" ? value.message : "";

  if (name === "AbortError" || name === "TimeoutError" || /timeout|timed out|aborted/i.test(message)) {
    return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.requestTimeout, retryable: true, httpStatus: null } as const;
  }
  if (status === 429) return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true, httpStatus: status } as const;
  if (status != null) return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.providerError, retryable: status >= 500, httpStatus: status } as const;
  if (name === "TypeError" || /network|fetch failed|connection|dns|socket/i.test(message)) {
    return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.networkFailure, retryable: true, httpStatus: null } as const;
  }
  return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.providerError, retryable: false, httpStatus: null } as const;
}

export function travelMarketProviderIncident(params: {
  provider: string;
  operation: string;
  category: string;
  failureClass: Exclude<TravelMarketFailureClass, "ZERO_RESULTS" | "CONFIGURATION_UNAVAILABLE" | "STALE_OR_UNUSABLE_RESULT">;
  retryable: boolean;
  httpStatus?: number | null;
  now?: number;
}) {
  const bucket = Math.floor((params.now ?? Date.now()) / INCIDENT_BUCKET_MS);
  const fingerprintParts = [params.provider, params.operation, params.category, params.failureClass];
  return {
    severity: "medium" as const,
    eventCode: "travel_market_provider_failure",
    fingerprintParts,
    eventKey: `travel-market-provider-failure:${fingerprintParts.join(":")}:${bucket}`,
    correlationId: null,
    safeMetadata: {
      provider: params.provider,
      operation: params.operation,
      failure_class: params.failureClass,
      retryable: params.retryable,
      ...(params.httpStatus == null ? {} : { http_status: params.httpStatus })
    }
  };
}

export function travelMarketFailureClassFromHotelState(state: string) {
  if (state === "TIMEOUT") return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.requestTimeout, retryable: true } as const;
  if (state === "RATE_LIMITED") return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.rateLimited, retryable: true } as const;
  if (state === "MALFORMED_PROVIDER_RESPONSE") return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.invalidResponse, retryable: false } as const;
  if (state === "AUTH_FAILURE" || state === "PROVIDER_UNAVAILABLE") return { failureClass: TRAVEL_MARKET_FAILURE_CLASSES.providerError, retryable: state === "PROVIDER_UNAVAILABLE" } as const;
  return null;
}
