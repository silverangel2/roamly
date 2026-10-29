self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    data = {};
  }

  const title = data.title || "Roamly reminder";
  const activityTag = data.tripId && data.activityId
    ? `roamly-activity-${data.tripId}-${data.activityId}`
    : null;

  const actions = [];

  if (data.googleMapsUrl) {
    actions.push({ action: "google_maps", title: "Google Maps" });
  }

  if (data.appleMapsUrl) {
    actions.push({ action: "apple_maps", title: "Open Maps" });
  }

  if (data.citymapperUrl) {
    actions.push({ action: "citymapper", title: "Citymapper" });
  }

  // Browser notification platforms may limit how many actions are
  // displayed. Check-in and Skip remain supported even when the OS
  // chooses not to render every action button.
  if (data.checkInUrl) {
    actions.push({ action: "check_in", title: "Check in" });
  }

  if (data.skipUrl) {
    actions.push({ action: "skip", title: "Skip" });
  }

  // Only time-critical alerts persist on screen. Routine nudges ("starting
  // soon", nearby, booking confirmations) auto-dismiss so the phone is never
  // flooded with sticky notifications.
  const PERSISTENT_EVENT_TYPES = new Set([
    "activity_start",
    "leave_by",
    "late",
    "arrival",
    "flight_delay",
    "flight_cancelled"
  ]);
  const sticky = data.eventType ? PERSISTENT_EVENT_TYPES.has(data.eventType) : false;

  const options = {
    body: data.body || "Open Roamly to see what is next.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || activityTag || undefined,
    actions,
    requireInteraction: sticky,
    data: {
      tripId: data.tripId || null,
      activityId: data.activityId || null,
      eventId: data.eventId || null,
      eventType: data.eventType || null,
      actionUrl: data.actionUrl || "/notifications",
      googleMapsUrl: data.googleMapsUrl || null,
      appleMapsUrl: data.appleMapsUrl || null,
      citymapperUrl: data.citymapperUrl || null,
      checkInUrl: data.checkInUrl || null,
      skipUrl: data.skipUrl || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "clear_activity_notification" || !message.tripId || !message.activityId) return;
  const tag = `roamly-activity-${message.tripId}-${message.activityId}`;
  event.waitUntil(
    self.registration.getNotifications({ tag }).then((notifications) => {
      notifications.forEach((notification) => notification.close());
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};

  let url = data.actionUrl || "/notifications";
  const openExternal = (target) => {
    event.waitUntil(clients.openWindow(target));
    event.notification.close();
  };

  if (event.action === "google_maps" && data.googleMapsUrl) {
    openExternal(data.googleMapsUrl);
    return;
  } else if (event.action === "apple_maps" && data.appleMapsUrl) {
    openExternal(data.appleMapsUrl);
    return;
  } else if (event.action === "citymapper" && data.citymapperUrl) {
    openExternal(data.citymapperUrl);
    return;
  } else if (event.action === "check_in" && data.checkInUrl) {
    url = data.checkInUrl;
  } else if (event.action === "skip" && data.skipUrl) {
    url = data.skipUrl;
  }

  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(url, self.location.origin);
    if (destination.origin !== self.location.origin) {
      await clients.openWindow("/notifications");
      return;
    }
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const roamlyWindow = windows.find((client) => client.url.startsWith(self.location.origin));
    if (roamlyWindow) {
      await roamlyWindow.navigate(destination.href);
      await roamlyWindow.focus();
      return;
    }
    await clients.openWindow(destination.href);
  })());
});
/* ============================================================
 * Roamly offline-first trips (added 2026-09-30; trip-data + RSC
 * caching and the known-user rule added 2026-10-27)
 *
 * Strategies:
 * - Trip documents (/trip/[id], /trip/[id]/live, /trip/[id]/bookings):
 *   network-first. Fresh SSR is shown whenever the phone is online so a
 *   cleaned itinerary cannot flash an older cached copy. The last good
 *   document is kept only for airplane mode.
 * - Trip data behind the document: the trip-scoped API responses the
 *   page actually calls (GET /api/roamly/trips/[id]/*, GET
 *   /api/trips/[id]/*, GET /api/roamly/badge?tripId=[id]) and the RSC
 *   payloads for trip-document URLs (the App Router's client-side
 *   navigation payloads): network-first in the same per-user docs
 *   cache, so client components (gaps, badge, tab navigation) keep
 *   working from the last good copy offline instead of erroring.
 *   Deliberately NOT cached: user-wide endpoints with no trip scope
 *   (/api/roamly/trips/active, /api/roamly/setup/state) — serving
 *   one trip's selection state as another trip's content would be
 *   cross-trip leakage, so those stay network-only.
 * - /_next/static/*, /fonts/*, icons, manifest: cache-first (immutable).
 * - GET /api/trips/[id]/companion/preferences: stale-while-revalidate.
 * - POST /api/roamly/activities/{check-in,skip,complete}: never cached.
 *   When the network fails they are queued in IndexedDB and replayed via
 *   Background Sync; the page is answered with {queuedOffline:true} so the
 *   UI can show "Will sync when back online."
 *
 * Privacy: only HTTP 200 same-origin responses are cached — never
 * redirects (login wall) or error pages. Trip documents, trip data,
 * and preferences live in per-user caches (keyed by Supabase user id,
 * communicated from the page); caches are purged on logout and
 * whenever the user id changes, so one device account can never read
 * another's cached trips. A trip document or trip API response is
 * cached ONLY while a user id is known (from the page's roamly_set_user
 * message or the IndexedDB restore on activate): a null report (a
 * transient getUser failure) is ignored rather than cached under an
 * "anon" namespace, so two accounts can never share one cache through
 * an unidentified session. NO auth material is ever cached: responses
 * are stored by the Cache API without cookies, and the cached trip
 * document was verified (2026-10-27) to contain no session token,
 * JWT, or access/refresh token value — only the trip's own content.
 * ============================================================ */

const ROAMLY_OFFLINE_VERSION = "roamly-offline-v4";
const ROAMLY_STATIC_CACHE = `${ROAMLY_OFFLINE_VERSION}-static`;
const ROAMLY_DOCS_CACHE_PREFIX = `${ROAMLY_OFFLINE_VERSION}-docs-`;
const ROAMLY_PREFS_CACHE_PREFIX = `${ROAMLY_OFFLINE_VERSION}-prefs-`;
const ROAMLY_IMAGES_CACHE_PREFIX = `${ROAMLY_OFFLINE_VERSION}-images-`;
const ROAMLY_OUTBOX_DB = "roamly-offline-outbox";
const ROAMLY_OUTBOX_STORE = "activity-writes";
const ROAMLY_META_STORE = "roamly-meta";
const ROAMLY_USER_KEY = "roamly-offline-user-id";
const ROAMLY_OUTBOX_SYNC_TAG = "roamly-outbox";

const TRIP_DOC_RE = /^\/trip\/(?!new(?:\/|$))([^/]+)(\/(live|bookings))?\/?$/;
const PREFS_RE = /^\/api\/trips\/([^/]+)\/companion\/preferences\/?$/;
// Trip-scoped data responses behind a trip document. The id segment is
// mandatory: /api/roamly/trips/active (no id) and
// /api/roamly/setup/state (no trip at all) deliberately do NOT match,
// so user-wide state can never be served as one trip's content.
const TRIP_API_RE = /^\/api\/(?:roamly\/trips\/[^/]+\/.+|trips\/[^/]+\/.+|roamly\/badge)$/;
const ACTIVITY_WRITE_RE = /^\/api\/roamly\/activities\/(check-in|skip|complete)\/?$/;

let roamlyUserId = null;

// ---------- tiny IndexedDB promise wrapper ----------

function roamlyIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ROAMLY_OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROAMLY_OUTBOX_STORE)) {
        db.createObjectStore(ROAMLY_OUTBOX_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ROAMLY_META_STORE)) {
        db.createObjectStore(ROAMLY_META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOp(storeName, mode, op) {
  return roamlyIdb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(storeName, mode);
        } catch (e) {
          reject(e);
          return;
        }
        let req;
        try {
          req = op(tx.objectStore(storeName));
        } catch (e) {
          reject(e);
          return;
        }
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

const idbPut = (store, value) => idbOp(store, "readwrite", (s) => s.put(value));
const idbGet = (store, key) => idbOp(store, "readonly", (s) => s.get(key));
const idbGetAll = (store) => idbOp(store, "readonly", (s) => s.getAll());
const idbDelete = (store, key) => idbOp(store, "readwrite", (s) => s.delete(key));
const idbClear = (store) => idbOp(store, "readwrite", (s) => s.clear());

// ---------- cache naming / privacy ----------

function docsCacheName() {
  return `${ROAMLY_DOCS_CACHE_PREFIX}${roamlyUserId || "anon"}`;
}

function prefsCacheName() {
  return `${ROAMLY_PREFS_CACHE_PREFIX}${roamlyUserId || "anon"}`;
}

function imagesCacheName() {
  return `${ROAMLY_IMAGES_CACHE_PREFIX}${roamlyUserId || "anon"}`;
}

// Destination-photo hosts ONLY. The destination-photo pipeline
// (lib/roamly/destinationPhoto.ts) serves Wikimedia/Wikidata photos
// and nothing else, so these two hosts are the complete allowlist
// for cached trip images. Any other cross-origin host is never
// cached, and no image is ever substituted: a cache entry is keyed
// by its exact URL, so one trip's photo can never serve as another
// trip's photo, and the page component's load check (onLoad +
// naturalWidth) still gates display — a cached error page renders
// the branded fallback, never a wrong photograph.
const ROAMLY_IMAGE_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

async function handleSetUser(userId) {
  const next = typeof userId === "string" && userId ? userId : null;
  // A null report means "no user id could be read right now" (a
  // transient getUser failure looks exactly like no session). It must
  // NEVER downgrade a known user to an "anon" namespace: that is how
  // two accounts could end up sharing one cache. Only an explicit
  // roamly_logout (sign-out) clears, and only a new non-null id
  // switches accounts (dropping the previous user's caches below).
  if (!next) return;
  if (next === roamlyUserId) return;
  const prev = roamlyUserId;
  roamlyUserId = next;
  try {
    await idbPut(ROAMLY_META_STORE, { key: ROAMLY_USER_KEY, value: next });
  } catch {
    // persistence is best-effort; in-memory id still namespaces this session
  }
  if (prev && prev !== next) {
    // The device account changed: drop the previous user's cached trips so
    // they can never be served to the new account (shared-device safety).
    // Images go with them — the new account never sees the old
    // account's cached photos.
    try {
      await caches.delete(`${ROAMLY_DOCS_CACHE_PREFIX}${prev}`);
      await caches.delete(`${ROAMLY_PREFS_CACHE_PREFIX}${prev}`);
      await caches.delete(`${ROAMLY_IMAGES_CACHE_PREFIX}${prev}`);
    } catch {}
  }
}

async function purgeUserCaches() {
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(
          (n) =>
            n.startsWith(ROAMLY_DOCS_CACHE_PREFIX) ||
            n.startsWith(ROAMLY_PREFS_CACHE_PREFIX) ||
            n.startsWith(ROAMLY_IMAGES_CACHE_PREFIX)
        )
        .map((n) => caches.delete(n))
    );
  } catch {}
  roamlyUserId = null;
  try {
    await idbPut(ROAMLY_META_STORE, { key: ROAMLY_USER_KEY, value: null });
  } catch {}
  try {
    // Queued writes belong to the signed-out session; replaying them under a
    // different (or no) account would be wrong, so drop them on logout.
    await idbClear(ROAMLY_OUTBOX_STORE);
  } catch {}
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "roamly_set_user") {
    event.waitUntil(handleSetUser(message.userId));
  } else if (message.type === "roamly_logout") {
    event.waitUntil(purgeUserCaches());
  } else if (message.type === "roamly_flush_outbox") {
    event.waitUntil(flushActivityOutbox());
  }
});

// ---------- caching strategies ----------

// Only cache plain HTTP 200 same-origin responses. This deliberately
// excludes redirects (e.g. the login wall) and error pages, so an
// auth redirect can never be stored as if it were a trip page.
function isCacheableResponse(response, requestUrl) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  if (response.redirected) return false;
  try {
    return new URL(response.url).pathname === new URL(requestUrl).pathname;
  } catch {
    return false;
  }
}

async function cacheFirst(request, cacheName) {
  let cache = null;
  try {
    cache = await caches.open(cacheName);
  } catch {}
  if (cache) {
    const hit = await cache.match(request).catch(() => null);
    if (hit) return hit;
  }
  const response = await fetch(request);
  if (cache && isCacheableResponse(response, request.url)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(event, request, cacheName) {
  // Preferences are per-user data: without a known user id, fetch only
  // (never read or write a shared/anon cache entry).
  if (!roamlyUserId) return fetch(request);
  let cache = null;
  try {
    cache = await caches.open(cacheName);
  } catch {}
  const cached = cache ? await cache.match(request).catch(() => null) : null;
  const refresh = (async () => {
    try {
      const response = await fetch(request);
      if (cache && isCacheableResponse(response, request.url)) {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return null;
    }
  })();
  if (cached) {
    // Serve the cached copy now; refresh quietly in the background.
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  const response = await refresh;
  if (response) return response;
  throw new Error("roamly-offline");
}

async function networkFirst(event, request, cacheName) {
  // Trip content is cached ONLY while a user id is known (see the
  // header comment): without one, fetch network-only — never read a
  // shared cache, never write one.
  let cache = null;
  if (roamlyUserId) {
    try {
      cache = await caches.open(cacheName);
    } catch {}
  }
  try {
    const response = await fetch(request);
    if (cache && isCacheableResponse(response, request.url)) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch {
    const cached = cache ? await cache.match(request).catch(() => null) : null;
    if (cached) return cached;
    return null;
  }
}

async function tripDocument(event) {
  const { request } = event;
  const response = await networkFirst(event, request, docsCacheName());
  if (response) return response;
  return offlineFallbackResponse();
}

// Trip-scoped API data + RSC payloads for trip documents: the same
// network-first per-user docs cache as the document itself, so the
// client components behind a cached page keep their last good data
// offline. An uncached API offline stays a plain network error (the
// page's existing behavior for uncached calls), never a fabricated
// response.
async function tripData(event) {
  const response = await networkFirst(event, event.request, docsCacheName());
  if (response) return response;
  return fetch(event.request);
}

// Licensed destination images (final local round, 2026-10-27):
// network-first in the per-user images cache, so a trip photo
// loaded once online serves offline with its page credit intact
// (the credit lives in the cached page, not in the image bytes).
// Same isolation as documents: cached AND served only while a user
// id is known; sign-out purge and account-switch deletion cover
// this cache with the docs cache. <img> fetches are no-cors, so
// responses arrive opaque (status unverifiable) — they are cached
// ONLY for the allowlisted pipeline hosts and ONLY under their
// exact URL, and the component's load check still decides display.
// A failed or wrong-bytes entry therefore shows the branded
// fallback, never a photograph. Opaque entries are never used for
// documents, APIs, or anything else.
async function tripImage(event) {
  const { request } = event;
  let cache = null;
  if (roamlyUserId) {
    try {
      cache = await caches.open(imagesCacheName());
    } catch {}
  }
  try {
    // A stalled image fetch must never hold the trip hero in its
    // pending gradient forever (seen headless: the external fetch
    // neither resolves nor rejects through the VM proxy). After 8s
    // the network leg gives up and the caller falls back to the
    // cached photo or, failing that, to the component's branded
    // fallback — a bounded wait, never an endless gradient.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(request, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (cache) {
      try {
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  } catch {
    const cached = cache ? await cache.match(request).catch(() => null) : null;
    if (cached) return cached;
    // No cached photo and no network: let the fetch error surface
    // so the component renders its branded fallback (never a
    // fabricated response, never a hung gradient).
    throw new Error("roamly-offline-image");
  }
}

function offlineFallbackResponse() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>You're offline — Roamly</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f0fdfa;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
  .card{background:#fff;border-radius:20px;padding:36px 28px;max-width:380px;box-shadow:0 10px 30px rgba(15,118,110,.12)}
  h1{font-size:22px;margin:0 0 12px;color:#0f766e}
  p{font-size:15px;line-height:1.6;color:#475569;margin:0 0 20px}
  a{display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600}
</style>
</head>
<body>
<div class="card">
<h1>You're offline</h1>
<p>Your saved trip pages are available once you've opened them online. Reconnect and the latest version of your trip will load.</p>
<a href="/">Back to Roamly</a>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

// ---------- activity write outbox (Background Sync) ----------

async function handleActivityWrite(request) {
  try {
    return await fetch(request.clone());
  } catch {
    // Network unreachable: queue the write and tell the page it is queued so
    // the UI can show "Will sync when back online."
    try {
      const body = await request.clone().text();
      await idbPut(ROAMLY_OUTBOX_STORE, {
        id: `aw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        url: request.url,
        body,
        createdAt: Date.now()
      });
      try {
        await self.registration.sync.register(ROAMLY_OUTBOX_SYNC_TAG);
      } catch {
        // Background Sync unsupported: the page retries on its 'online' event.
      }
    } catch {}
    return new Response(JSON.stringify({ ok: true, queuedOffline: true }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
  }
}

async function flushActivityOutbox() {
  let entries = [];
  try {
    entries = await idbGetAll(ROAMLY_OUTBOX_STORE);
  } catch {
    return;
  }
  entries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: entry.body,
        credentials: "include"
      });
      if (!response.ok) break; // server rejected it — keep for a later attempt
      await idbDelete(ROAMLY_OUTBOX_STORE, entry.id).catch(() => {});
    } catch {
      break; // still offline — the rest wait for the next sync
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === ROAMLY_OUTBOX_SYNC_TAG) {
    event.waitUntil(flushActivityOutbox());
  }
});

// ---------- fetch routing ----------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Cross-origin trip images (v4): the ONLY third-party caching.
  // Allowlisted Wikimedia image hosts, image requests only, user
  // known only. Everything else cross-origin is untouched (never
  // cached, never served from cache).
  if (url.origin !== self.location.origin) {
    if (
      request.method === "GET" &&
      request.destination === "image" &&
      ROAMLY_IMAGE_HOSTS.has(url.hostname) &&
      roamlyUserId
    ) {
      event.respondWith(tripImage(event));
    }
    return;
  }

  // Activity writes: network-first with offline outbox. Never cached.
  if (request.method === "POST" && ACTIVITY_WRITE_RE.test(url.pathname)) {
    event.respondWith(handleActivityWrite(request));
    return;
  }
  if (request.method !== "GET") return;

  // Immutable static assets: cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-touch-icon.png" ||
    /^\/icon-.*\.png$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, ROAMLY_STATIC_CACHE).catch(() => fetch(request)));
    return;
  }

  // Companion preferences: stale-while-revalidate (per-user cache).
  if (PREFS_RE.test(url.pathname)) {
    event.respondWith(
      staleWhileRevalidate(event, request, prefsCacheName()).catch(() => fetch(request))
    );
    return;
  }

  // Trip data responses behind a trip document: network-first, in the
  // same per-user docs cache (sign-out purge covers them with the
  // documents, no separate namespace to forget).
  if (TRIP_API_RE.test(url.pathname)) {
    event.respondWith(tripData(event));
    return;
  }

  // RSC payloads for trip documents (App Router client navigation and
  // prefetch): network-first in the docs cache, so tab switches
  // between previously loaded trips keep working offline instead of
  // falling back to a shell on a failed RSC fetch.
  if (TRIP_DOC_RE.test(url.pathname) && (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1")) {
    event.respondWith(tripData(event));
    return;
  }

  // Trip documents: network-first, with the last saved copy only when offline.
  if (request.mode === "navigate" && TRIP_DOC_RE.test(url.pathname)) {
    event.respondWith(tripDocument(event));
  }
});

// ---------- lifecycle ----------

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const stored = await idbGet(ROAMLY_META_STORE, ROAMLY_USER_KEY);
        roamlyUserId =
          stored && typeof stored.value === "string" && stored.value ? stored.value : null;
      } catch {
        roamlyUserId = null;
      }
      // Clean up caches from older versions of this worker.
      // Release composition (2026-10-29): the filter prefix is "roamly-",
      // not "roamly-offline-", carrying the correction-phase activate fix
      // (the narrow prefix never matched preview-shaped cache names, so
      // old caches escaped the purge). Current-version caches are still
      // kept by the !startsWith clause below.
      try {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((n) => n.startsWith("roamly-") && !n.startsWith(ROAMLY_OFFLINE_VERSION))
            .map((n) => caches.delete(n))
        );
      } catch {}
      try {
        await clients.claim();
      } catch {}
    })()
  );
});
