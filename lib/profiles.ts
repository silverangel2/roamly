import type { SupabaseClient, User } from "@supabase/supabase-js";

export type RoamlyProfile = {
  id: string;
  email: string;
  full_name: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProfileResult = {
  profile: RoamlyProfile | null;
  error?: string;
};

function profileNameFromUser(user: User) {
  const metadataName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : "";

  return metadataName.trim() || null;
}

export async function upsertRoamlyProfile(
  supabase: SupabaseClient,
  user: User,
  updates: Partial<Pick<RoamlyProfile, "full_name">> = {}
): Promise<ProfileResult> {
  const email = user.email || "";

  if (!email) {
    return { profile: null, error: "Account email is missing." };
  }

  const payload = {
    id: user.id,
    email,
    full_name: updates.full_name ?? profileNameFromUser(user),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("roamly_profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id,email,full_name,created_at,updated_at")
    .single();

  if (error) return { profile: null, error: error.message };

  return { profile: data as RoamlyProfile };
}

export async function getRoamlyProfile(
  supabase: SupabaseClient,
  user: User
): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("roamly_profiles")
    .select("id,email,full_name,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { profile: null, error: error.message };
  if (data) return { profile: data as RoamlyProfile };

  return upsertRoamlyProfile(supabase, user);
}
