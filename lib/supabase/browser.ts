"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Roamly Supabase public environment variables are missing.");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
