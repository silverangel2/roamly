import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  ensureRoamlyProfile,
  getRoamlyProfile as getRoamlyProfileByUserId,
  type ProfileResult,
  type RoamlyProfile
} from "@/lib/roamly/profile";

export type { ProfileResult, RoamlyProfile };

export async function upsertRoamlyProfile(
  supabase: SupabaseClient,
  user: User,
  updates: Partial<Pick<RoamlyProfile, "full_name">> = {}
): Promise<ProfileResult> {
  return ensureRoamlyProfile(user, updates, supabase);
}

export async function getRoamlyProfile(supabase: SupabaseClient, user: User): Promise<ProfileResult> {
  const profile = await getRoamlyProfileByUserId(user.id, supabase);
  if (profile.profile || !profile.tableAvailable) return profile;
  return ensureRoamlyProfile(user, {}, supabase);
}
