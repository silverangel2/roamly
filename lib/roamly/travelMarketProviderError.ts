export function travelMarketProviderFailureMessage(error: unknown) {
  const value = error && typeof error === "object" ? error as { name?: unknown; status?: unknown } : {};
  if (value.name === "AbortError" || value.name === "TimeoutError") {
    return "The partner search timed out. No offer was verified; please try again shortly.";
  }
  if (value.status === 429) {
    return "The partner is temporarily rate-limiting searches. No offer was verified; please try again shortly.";
  }
  if (value.status === 401 || value.status === 403) {
    return "The partner could not authorize this search. No offer was verified.";
  }
  if (typeof value.status === "number" && value.status >= 500) {
    return "The partner is temporarily unavailable. No offer was verified; please try again shortly.";
  }
  return "The partner search could not be completed. No offer was verified; please try again shortly.";
}
