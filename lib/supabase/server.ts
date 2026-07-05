import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

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
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot always write cookies. Middleware and route handlers refresh them.
        }
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
