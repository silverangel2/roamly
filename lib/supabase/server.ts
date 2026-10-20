import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";
import { normalizeSupabaseCookieOptions } from "@/lib/supabase/cookies";

export type CurrentUserResult = {
  configured: boolean;
  user: User | null;
  error?: string;
};

export async function createSupabaseServerClient() {
  if (!hasSupabaseConfig()) return null;

  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, normalizeSupabaseCookieOptions(options));
          });
        } catch {
          // Server components cannot always write cookies. Middleware and route handlers refresh them.
        }
      }
    }
  });
}

// Client for callers who authenticated with an Authorization: Bearer
// access token instead of cookies (API clients, the daily-test runner).
// The cookie server client above has no session for those callers, so
// its PostgREST calls would go out under the anon key with
// auth.uid() = NULL and fail authenticated-only RLS policies. This
// client carries the already-validated token on every request, so the
// database sees the caller as that authenticated user.
export function createSupabaseBearerClient(accessToken: string) {
  if (!hasSupabaseConfig()) return null;

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

export async function getCurrentUser(): Promise<CurrentUserResult> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      configured: false,
      user: null,
      error: "Supabase is not configured yet."
    };
  }

  const { data, error } = await supabase.auth.getUser();

  return {
    configured: true,
    user: data.user ?? null,
    error: error?.message
  };
}
