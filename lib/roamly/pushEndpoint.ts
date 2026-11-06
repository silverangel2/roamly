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

// ---------------------------------------------------------------------------
// Test-only seam (2026-10-31, push-accepted proof): the allowlist below
// admits only real browser push hosts, so no test harness could ever get
// a push ACCEPTED without contacting a real external push service — the
// dispatcher's push-accepted terminal write was unprovable. This seam is
// the ONLY relaxation, and it is deliberately hard to trip:
//   * a single explicit env var, ROAMLY_PUSH_TEST_SEAM, read on every
//     call (never cached at module load, never implied by NODE_ENV);
//   * only the exact value "1" enables it — "true"/"yes"/"enabled" do
//     NOT (unlike the looser capture/provisioning gates elsewhere);
//   * when enabled it admits ONLY loopback endpoints — localhost,
//     127.0.0.1, ::1 — over http or https, with an explicit port allowed
//     (a local fake push service needs one). No other host is widened
//     in, and the real-host rules (https only, no port, no credentials,
//     no fragment) are untouched in both modes;
//   * enabling it logs a loud warning (once per process) so an
//     accidental production enable is visible in logs immediately.
// With the var unset or any other value, normalizePushEndpoint behaves
// byte-for-byte as it did before the seam existed.
// ---------------------------------------------------------------------------
export const ROAMLY_PUSH_TEST_SEAM_ENV = "ROAMLY_PUSH_TEST_SEAM";

const loopbackPushHosts = new Set(["localhost", "127.0.0.1", "::1"]);

let pushTestSeamWarningLogged = false;

export function isRoamlyPushTestSeamEnabled(): boolean {
  return (process.env[ROAMLY_PUSH_TEST_SEAM_ENV] || "").trim() === "1";
}

function normalizeLoopbackPushEndpoint(parsed: URL): string | null {
  // URL.hostname keeps the brackets on IPv6 literals ("[::1]").
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!loopbackPushHosts.has(hostname)) return null;
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) return null;
  if (!pushTestSeamWarningLogged) {
    pushTestSeamWarningLogged = true;
    console.error(
      `[roamly-push] WARNING: ${ROAMLY_PUSH_TEST_SEAM_ENV}=1 — TEST SEAM ACTIVE: loopback push endpoints are being admitted. This must never be set in production.`
    );
  }
  return parsed.toString();
}

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

  if (isRoamlyPushTestSeamEnabled()) {
    const loopback = normalizeLoopbackPushEndpoint(parsed);
    if (loopback) return loopback;
    // Non-loopback candidates fall through to the unchanged allowlist:
    // the seam never widens admission beyond loopback.
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
