"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthenticatedFetchInit = RequestInit & {
  retryOnUnauthorized?: boolean;
};

export type BrowserAuthStatus = "loading" | "authenticated" | "unauthenticated";

type BrowserAuthSnapshot = {
  status: BrowserAuthStatus;
  session: Session | null;
  user: User | null;
};

let authSnapshot: BrowserAuthSnapshot = {
  status: "loading",
  session: null,
  user: null
};
let authInitPromise: Promise<BrowserAuthSnapshot> | null = null;
let authRefreshPromise: Promise<BrowserAuthSnapshot> | null = null;
let authSubscriptionStarted = false;
let browserClient: ReturnType<typeof createSupabaseBrowserClient> | null = null;
const authListeners = new Set<(snapshot: BrowserAuthSnapshot) => void>();

function isSameOriginRequest(input: RequestInfo | URL) {
  if (typeof window === "undefined") return false;

  try {
    const url =
      input instanceof Request
        ? new URL(input.url)
        : input instanceof URL
          ? input
          : new URL(input, window.location.origin);

    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function getBrowserClient() {
  if (!browserClient) browserClient = createSupabaseBrowserClient();
  return browserClient;
}

function clearTripSessionCheckAttempts() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith("roamly.trip.session-check.") || key?.startsWith("roamly.login.redirected.")) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Session storage is best-effort loop protection.
  }
}

export function cancelPendingLoginRedirects() {
  clearTripSessionCheckAttempts();
}

function snapshotFromSession(session: Session | null): BrowserAuthSnapshot {
  const next = {
    status: session?.user ? "authenticated" as const : "unauthenticated" as const,
    session,
    user: session?.user ?? null
  };
  if (next.status === "authenticated") cancelPendingLoginRedirects();
  return next;
}

function setAuthSnapshot(next: BrowserAuthSnapshot) {
  authSnapshot = next;
  authListeners.forEach((listener) => listener(authSnapshot));
  return authSnapshot;
}

function ensureAuthSubscription() {
  if (authSubscriptionStarted || typeof window === "undefined") return;
  authSubscriptionStarted = true;
  try {
    const supabase = getBrowserClient();
    supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSnapshot(snapshotFromSession(session));
    });
  } catch {
    setAuthSnapshot({ status: "unauthenticated", session: null, user: null });
  }
}

export function getBrowserAuthSnapshot() {
  return authSnapshot;
}

export function subscribeBrowserAuthState(listener: (snapshot: BrowserAuthSnapshot) => void) {
  authListeners.add(listener);
  listener(authSnapshot);
  return () => {
    authListeners.delete(listener);
  };
}

export async function resolveBrowserAuthState({ refresh = false }: { refresh?: boolean } = {}) {
  if (typeof window === "undefined") return authSnapshot;
  ensureAuthSubscription();

  if (refresh) return refreshBrowserAuthState();
  if (authSnapshot.status !== "loading") return authSnapshot;
  if (authInitPromise) return authInitPromise;

  authInitPromise = (async () => {
    try {
      const supabase = getBrowserClient();
      const { data } = await supabase.auth.getSession();
      return setAuthSnapshot(snapshotFromSession(data.session ?? null));
    } catch {
      return setAuthSnapshot({ status: "unauthenticated", session: null, user: null });
    }
  })().finally(() => {
    authInitPromise = null;
  });

  return authInitPromise;
}

export async function refreshBrowserAuthState() {
  if (typeof window === "undefined") return authSnapshot;
  ensureAuthSubscription();
  if (authRefreshPromise) return authRefreshPromise;

  authRefreshPromise = (async () => {
    try {
      const supabase = getBrowserClient();
      const { data } = await supabase.auth.refreshSession();
      return setAuthSnapshot(snapshotFromSession(data.session ?? null));
    } catch {
      return setAuthSnapshot({ status: "unauthenticated", session: null, user: null });
    }
  })().finally(() => {
    authRefreshPromise = null;
  });

  return authRefreshPromise;
}

function buildRequestInit(input: RequestInfo | URL, init: RequestInit, accessToken: string | null): RequestInit {
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));

  if (accessToken && isSameOriginRequest(input)) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }

  return {
    ...init,
    credentials: init.credentials ?? "include",
    headers
  };
}

export async function getSupabaseBrowserSessionUser(): Promise<User | null> {
  const auth = await resolveBrowserAuthState();
  return auth.user;
}

export async function syncSupabaseServerSession({ refresh = false }: { refresh?: boolean } = {}) {
  const auth = await resolveBrowserAuthState({ refresh });
  const session = auth.session;

  if (!session?.access_token || !session.refresh_token) {
    return { ok: false, user: session?.user ?? null };
  }

  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      })
    });

    return { ok: response.ok, user: session.user ?? null };
  } catch {
    return { ok: false, user: session.user ?? null };
  }
}

export async function fetchWithSupabaseAuth(input: RequestInfo | URL, init: AuthenticatedFetchInit = {}) {
  const { retryOnUnauthorized = true, ...requestInit } = init;
  const auth = await resolveBrowserAuthState();
  const accessToken = auth.session?.access_token || null;
  const response = await fetch(input, buildRequestInit(input, requestInit, accessToken));

  if (!retryOnUnauthorized || response.status !== 401) return response;

  const refreshedAuth = await refreshBrowserAuthState();
  const refreshedToken = refreshedAuth.session?.access_token || null;
  if (!refreshedToken || refreshedToken === accessToken) return response;

  return fetch(input, buildRequestInit(input, requestInit, refreshedToken));
}
