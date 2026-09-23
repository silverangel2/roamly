const MAX_PUSH_ENDPOINT_LENGTH = 2048;

const exactPushHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com"
]);

const trustedPushHostSuffixes = [
  ".push.services.mozilla.com",
  ".notify.windows.com"
];

/** Accept only HTTPS endpoints owned by browser push services we support. */
export function normalizePushEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_PUSH_ENDPOINT_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const trustedHost = exactPushHosts.has(hostname) ||
    trustedPushHostSuffixes.some((suffix) => hostname.endsWith(suffix));

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    !trustedHost
  ) return null;

  return parsed.toString();
}

export function isValidPushKey(value: unknown, kind: "p256dh" | "auth"): value is string {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return false;
  return kind === "p256dh" ? key.length >= 80 && key.length <= 100 : key.length >= 16 && key.length <= 32;
}
