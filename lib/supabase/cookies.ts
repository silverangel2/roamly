import type { CookieOptions } from "@supabase/ssr";

export function normalizeSupabaseCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    path: options.path || "/",
    sameSite: options.sameSite ?? "lax",
    secure: options.secure ?? process.env.NODE_ENV === "production"
  };
}

export function applyCookieHeaders(target: Headers, headersToSet: Record<string, string> = {}) {
  Object.entries(headersToSet).forEach(([key, value]) => {
    target.set(key, value);
  });
}
