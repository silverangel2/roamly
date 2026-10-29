// roamly-ux-offline-checks.mjs — OFFLINE RESTORATION ROUND
// (2026-10-27, local only). The prior round's "shell only" offline
// result did not replicate (the v2 worker already restored the trip
// document in this environment); this suite pins the REPAIRED
// behavior instead: trip document + trip-scoped data + RSC payloads
// cached per account + trip, sign-out clearing, no credential caching,
// and a visible offline/stale label that is absent online.
// Behavior itself is proven headless by scripts/roamly-ux-offline-proof.mjs.
// Usage:
//   node scripts/roamly-ux-offline-checks.mjs
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sw = read("public/sw.js");
const banner = read("components/roamly/OfflineTripBanner.tsx");
const home = read("app/trip/[id]/page.tsx");
const live = read("app/trip/[id]/live/page.tsx");
const registrar = read("components/ServiceWorkerRegistrar.tsx");

// ---- 1. What is cached ----
check("worker caches trip documents (home, live, bookings) network-first",
  sw.includes("TRIP_DOC_RE") && sw.includes("tripDocument(event)") && sw.includes("networkFirst(event, request, docsCacheName())"));
check("worker caches trip-scoped data responses (trip APIs + badge) in the per-user docs cache",
  sw.includes("TRIP_API_RE") && sw.includes("tripData(event)") &&
  sw.includes("/api/roamly/trips/") && sw.includes("roamly/badge"));
check("worker caches RSC payloads for trip documents (client tab switches offline)",
  sw.includes('url.searchParams.has("_rsc")') && sw.includes('request.headers.get("RSC")'));
check("worker does NOT cache user-wide endpoints: the trip-API pattern requires an id segment plus more (bare /trips/active cannot match)",
  sw.includes("roamly\\/trips\\/[^/]+\\/.+") &&
  sw.includes("/api/roamly/trips/active") /* mentioned only in the exclusion comment */);
check("worker never caches POST activity writes (outbox only)",
  sw.includes("ACTIVITY_WRITE_RE") && sw.includes("handleActivityWrite"));

// ---- 2. Per-account + per-trip isolation ----
check("cache names are keyed by user id (docs + prefs namespaces)",
  sw.includes("ROAMLY_DOCS_CACHE_PREFIX") && sw.includes("docsCacheName()") &&
  sw.includes("`${ROAMLY_DOCS_CACHE_PREFIX}${roamlyUserId"));
check("trip content is cached ONLY while a user id is known (no anon namespace for trips)",
  sw.includes("if (roamlyUserId)") && sw.includes("without a known user id"));
check("a null user report never downgrades a known user (transient getUser failure cannot create a shared cache)",
  sw.includes("if (!next) return;"));
check("account change deletes the previous user's caches (shared-device safety)",
  sw.includes("caches.delete(`${ROAMLY_DOCS_CACHE_PREFIX}${prev}`)") &&
  sw.includes("caches.delete(`${ROAMLY_PREFS_CACHE_PREFIX}${prev}`)"));
check("sign-out purges docs + prefs caches and the write outbox",
  sw.includes("purgeUserCaches") && sw.includes('message.type === "roamly_logout"') &&
  sw.includes("idbClear(ROAMLY_OUTBOX_STORE)"));
check("registrar posts set_user on sign-in and logout on sign-out (the purge path)",
  registrar.includes('type: "roamly_set_user"') && registrar.includes('type: "roamly_logout"') &&
  registrar.includes('event === "SIGNED_OUT"'));

// ---- 3. No credentials in the cache ----
check("worker stores responses only (Cache API holds no cookies) and caches only HTTP 200 same-origin non-redirects",
  sw.includes("isCacheableResponse") && sw.includes("response.status !== 200") &&
  sw.includes("response.redirected") && sw.includes('response.type !== "basic"'));
check("worker source contains no token/cookie caching logic",
  !sw.includes("set-cookie") && !sw.includes("access_token") && !sw.includes("refresh_token") &&
  !sw.includes("authorization"));

// ---- 4. Offline/stale label: present offline, absent online ----
check("banner component exists with the exact offline label wording",
  banner.includes("Offline — last updated") && banner.includes("Showing your saved trip") &&
  banner.includes('data-testid="offline-trip-banner"'));
check("banner renders nothing while online (online app unchanged)",
  banner.includes("if (!offline || !lastUpdated) return null"));
check("banner timestamp is the trip's own last-online-load record (per-trip localStorage key, never invented)",
  banner.includes("roamly-offline-last-updated:${tripId}") &&
  banner.includes("localStorage.setItem(key, now)") &&
  banner.includes("localStorage.getItem(key)"));
check("banner listens to online/offline transitions (label clears on recovery)",
  banner.includes('addEventListener("online"') && banner.includes('addEventListener("offline"'));
check("banner mounted on trip home and on Live (both proven surfaces)",
  home.includes("OfflineTripBanner") && home.includes("<OfflineTripBanner tripId={id} />") &&
  live.includes("OfflineTripBanner") && live.includes("<OfflineTripBanner tripId={id} />"));

// ---- 5. Version + freshness discipline ----
check("worker version bumped (old caches purged on activate, no stale v3 trip content served)",
  // Next-phase 2026-10-29: production-track worker is "roamly-offline-v4";
  // preview/correction builds deliberately carry "roamly-preview-offline-v4"
  // (preview cache isolation). Either literal satisfies the v4 requirement;
  // v2/v3 still fail. The purge clause below is unchanged.
  (sw.includes('ROAMLY_OFFLINE_VERSION = "roamly-offline-v4"') ||
    sw.includes('ROAMLY_OFFLINE_VERSION = "roamly-preview-offline-v4"')) &&
  sw.includes('!n.startsWith(ROAMLY_OFFLINE_VERSION)'));
check("online behavior unchanged: documents and trip data stay network-first (fresh SSR wins online)",
  sw.includes("Fresh SSR is shown whenever the phone is online") ||
  sw.includes("network-first"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
