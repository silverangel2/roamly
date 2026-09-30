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
 * Roamly offline-first trips (added 2026-09-30)
 *
 * Strategies:
 * - Trip documents (/trip/[id], /trip/[id]/live, /trip/[id]/bookings):
 *   stale-while-revalidate. Trip pages are server-rendered HTML, so
 *   caching the document is what makes a trip readable in airplane mode.
 * - /_next/static/*, /fonts/*, icons, manifest: cache-first (immutable).
 * - GET /api/trips/[id]/companion/preferences: stale-while-revalidate.
 * - POST /api/roamly/activities/{check-in,skip,complete}: never cached.
 *   When the network fails they are queued in IndexedDB and replayed via
 *   Background Sync; the page is answered with {queuedOffline:true} so the
 *   UI can show "Will sync when back online."
 *
 * Privacy: only HTTP 200 same-origin responses are cached — never
 * redirects (login wall) or error pages. Trip documents and preferences
 * live in per-user caches (keyed by Supabase user id, communicated from
 * the page); caches are purged on logout and whenever the user id changes,
 * so one device account can never read another's cached trips.
 * ============================================================ */

const ROAMLY_OFFLINE_VERSION = "roamly-offline-v1";
const ROAMLY_STATIC_CACHE = `${ROAMLY_OFFLINE_VERSION}-static`;
const ROAMLY_DOCS_CACHE_PREFIX = `${ROAMLY_OFFLINE_VERSION}-docs-`;
const ROAMLY_PREFS_CACHE_PREFIX = `${ROAMLY_OFFLINE_VERSION}-prefs-`;
const ROAMLY_OUTBOX_DB = "roamly-offline-outbox";
const ROAMLY_OUTBOX_STORE = "activity-writes";
const ROAMLY_META_STORE = "roamly-meta";
const ROAMLY_USER_KEY = "roamly-offline-user-id";
const ROAMLY_OUTBOX_SYNC_TAG = "roamly-outbox";

const TRIP_DOC_RE = /^\/trip\/(?!new(?:\/|$))([^/]+)(\/(live|bookings))?\/?$/;
const PREFS_RE = /^\/api\/trips\/([^/]+)\/companion\/preferences\/?$/;
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

async function handleSetUser(userId) {
  const next = typeof userId === "string" && userId ? userId : null;
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
    try {
      await caches.delete(`${ROAMLY_DOCS_CACHE_PREFIX}${prev}`);
      await caches.delete(`${ROAMLY_PREFS_CACHE_PREFIX}${prev}`);
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
            n.startsWith(ROAMLY_PREFS_CACHE_PREFIX)
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

async function tripDocument(event) {
  const { request } = event;
  const response = await staleWhileRevalidate(event, request, docsCacheName()).catch(
    () => null
  );
  if (response) return response;
  return offlineFallbackResponse();
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
  if (url.origin !== self.location.origin) return; // never cache third parties

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

  // Trip documents: stale-while-revalidate with offline fallback page.
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
      try {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((n) => n.startsWith("roamly-offline-") && !n.startsWith(ROAMLY_OFFLINE_VERSION))
            .map((n) => caches.delete(n))
        );
      } catch {}
      try {
        await clients.claim();
      } catch {}
    })()
  );
});
