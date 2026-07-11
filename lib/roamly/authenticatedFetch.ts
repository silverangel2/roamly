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

async function getAccessToken(refresh = false) {
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
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
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
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
