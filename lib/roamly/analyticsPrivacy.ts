const ANALYTICS_ORIGIN = "https://roamly.invalid";
const UUID_PATH_SEGMENT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function sanitizeAnalyticsPath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;

  try {
    const parsed = new URL(value.trim(), ANALYTICS_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.pathname.replace(UUID_PATH_SEGMENT, ":id").slice(0, 512) || "/";
  } catch {
    return null;
  }
}

export function analyticsReferrerHost(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) return null;

  try {
    const parsed = new URL(value.trim(), ANALYTICS_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase().slice(0, 253) || null;
  } catch {
    return null;
  }
}

export function sanitizeAnalyticsVisitorKey(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}
