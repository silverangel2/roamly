"use client";

import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthenticatedFetchInit = RequestInit & {
  retryOnUnauthorized?: boolean;
};

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

async function getBrowserSession(refresh = false) {
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

async function getAccessToken(refresh = false) {
  const session = await getBrowserSession(refresh);
  return session?.access_token || null;
}

async function getServerSyncSession(refresh = false) {
  const session = await getBrowserSession();
  const expiresAt = session?.expires_at ?? 0;
  const expiresSoon = expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 30;

  if (refresh || expiresSoon) {
    return getBrowserSession(true);
  }

  return session;
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
  const session = await getBrowserSession();
  return session?.user ?? null;
}

export async function syncSupabaseServerSession({ refresh = false }: { refresh?: boolean } = {}) {
  const session = await getServerSyncSession(refresh);

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

    return { ok: response.ok, user: response.ok ? session.user : null };
  } catch {
    return { ok: false, user: session.user ?? null };
  }
}

export async function fetchWithSupabaseAuth(input: RequestInfo | URL, init: AuthenticatedFetchInit = {}) {
  const { retryOnUnauthorized = true, ...requestInit } = init;
  const accessToken = await getAccessToken();
  const response = await fetch(input, buildRequestInit(input, requestInit, accessToken));

  if (!retryOnUnauthorized || response.status !== 401) return response;

  const refreshedToken = await getAccessToken(true);
  if (!refreshedToken) return response;

  return fetch(input, buildRequestInit(input, requestInit, refreshedToken));
}
