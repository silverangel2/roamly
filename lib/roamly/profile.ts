import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfileSchema = "current" | "legacy" | "missing";

export type RoamlyProfile = {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ProfileResult = {
  profile: RoamlyProfile | null;
  tableAvailable: boolean;
  schema: ProfileSchema;
  error?: string;
};

export type RoamlyUserAppStatus = {
  has_roamly_profile: boolean;
  auth_email: string;
  auth_provider: string | null;
  is_roamly_tester: boolean;
  is_roamly_admin: boolean;
};

type ProfileUpdates = Partial<Pick<RoamlyProfile, "full_name">>;

type LegacyProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CurrentProfileRow = {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

function errorMessage(error: unknown) {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "";
}

function isMissingTableError(error: unknown) {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();

  return (
    code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function isMissingColumnError(error: unknown) {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();

  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("could not find the") && message.includes("column") ||
    message.includes("column") && message.includes("does not exist")
  );
}

async function resolveSupabaseClient(client?: SupabaseClient) {
  return client ?? (await createSupabaseServerClient());
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getAuthProvider(user: User) {
  const appProvider = metadataString(user.app_metadata?.provider);
  if (appProvider) return appProvider;

  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers)) {
    const provider = providers.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (provider) return provider;
  }

  const identityProvider = user.identities?.find((identity) => Boolean(metadataString(identity.provider)))?.provider;
  return identityProvider || null;
}

function profileNameFromUser(user: User) {
  return metadataString(user.user_metadata?.full_name) || metadataString(user.user_metadata?.name) || null;
}

function avatarUrlFromUser(user: User) {
  return metadataString(user.user_metadata?.avatar_url) || metadataString(user.user_metadata?.picture) || null;
}

function normalizeCurrentProfile(row: CurrentProfileRow): RoamlyProfile {
  return {
    id: row.id,
    user_id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    auth_provider: row.auth_provider,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  };
}

function normalizeLegacyProfile(row: LegacyProfileRow, userId: string): RoamlyProfile {
  return {
    id: row.id,
    user_id: userId,
    email: row.email,
    full_name: row.full_name,
    avatar_url: null,
    auth_provider: null,
    first_seen_at: row.created_at || null,
    last_seen_at: row.updated_at || row.created_at || null,
    metadata: {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function getLegacyRoamlyProfile(supabase: SupabaseClient, userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from("roamly_profiles")
    .select("id,email,full_name,created_at,updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return {
      profile: null,
      tableAvailable: !isMissingTableError(error),
      schema: isMissingTableError(error) ? "missing" : "legacy",
      error: error.message
    };
  }

  return {
    profile: data ? normalizeLegacyProfile(data as LegacyProfileRow, userId) : null,
    tableAvailable: true,
    schema: "legacy"
  };
}

export async function getRoamlyProfile(userId: string, client?: SupabaseClient): Promise<ProfileResult> {
  const supabase = await resolveSupabaseClient(client);

  if (!supabase) {
    return { profile: null, tableAvailable: false, schema: "missing", error: "Supabase is not configured." };
  }

  const { data, error } = await supabase
    .from("roamly_profiles")
    .select("id,user_id,email,full_name,avatar_url,auth_provider,first_seen_at,last_seen_at,metadata")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) return getLegacyRoamlyProfile(supabase, userId);

    return {
      profile: null,
      tableAvailable: !isMissingTableError(error),
      schema: isMissingTableError(error) ? "missing" : "current",
      error: error.message
    };
  }

  return {
    profile: data ? normalizeCurrentProfile(data as CurrentProfileRow) : null,
    tableAvailable: true,
    schema: "current"
  };
}

async function upsertCurrentProfile(
  supabase: SupabaseClient,
  user: User,
  existing: RoamlyProfile | null,
  updates: ProfileUpdates
): Promise<ProfileResult> {
  const now = new Date().toISOString();
  const hasExplicitName = Object.prototype.hasOwnProperty.call(updates, "full_name");
  const fullName = hasExplicitName ? updates.full_name ?? null : existing ? undefined : profileNameFromUser(user);
  const basePayload = {
    user_id: user.id,
    email: user.email || null,
    avatar_url: avatarUrlFromUser(user),
    auth_provider: getAuthProvider(user),
    last_seen_at: now,
    metadata: {
      app: "roamly",
      shared_supabase_auth: true
    },
    ...(fullName !== undefined ? { full_name: fullName } : {})
  };

  const query = existing
    ? supabase.from("roamly_profiles").update(basePayload).eq("user_id", user.id)
    : supabase.from("roamly_profiles").insert({ ...basePayload, first_seen_at: now });

  const { data, error } = await query
    .select("id,user_id,email,full_name,avatar_url,auth_provider,first_seen_at,last_seen_at,metadata")
    .single();

  if (error) {
    return {
      profile: existing,
      tableAvailable: !isMissingTableError(error),
      schema: isMissingTableError(error) ? "missing" : "current",
      error: error.message
    };
  }

  return {
    profile: normalizeCurrentProfile(data as CurrentProfileRow),
    tableAvailable: true,
    schema: "current"
  };
}

async function upsertLegacyProfile(supabase: SupabaseClient, user: User, updates: ProfileUpdates): Promise<ProfileResult> {
  const hasExplicitName = Object.prototype.hasOwnProperty.call(updates, "full_name");
  const payload = {
    id: user.id,
    email: user.email || "",
    updated_at: new Date().toISOString(),
    ...(hasExplicitName ? { full_name: updates.full_name ?? null } : { full_name: profileNameFromUser(user) })
  };

  const { data, error } = await supabase
    .from("roamly_profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id,email,full_name,created_at,updated_at")
    .single();

  if (error) {
    return {
      profile: null,
      tableAvailable: !isMissingTableError(error),
      schema: isMissingTableError(error) ? "missing" : "legacy",
      error: error.message
    };
  }

  return {
    profile: normalizeLegacyProfile(data as LegacyProfileRow, user.id),
    tableAvailable: true,
    schema: "legacy"
  };
}

export async function ensureRoamlyProfile(user: User, updates: ProfileUpdates = {}, client?: SupabaseClient): Promise<ProfileResult> {
  const supabase = await resolveSupabaseClient(client);

  if (!supabase) {
    return { profile: null, tableAvailable: false, schema: "missing", error: "Supabase is not configured." };
  }

  if (!user.email) {
    return { profile: null, tableAvailable: true, schema: "current", error: "Account email is missing." };
  }

  const current = await getRoamlyProfile(user.id, supabase);
  if (!current.tableAvailable) return current;

  if (current.schema === "legacy") {
    return upsertLegacyProfile(supabase, user, updates);
  }

  return upsertCurrentProfile(supabase, user, current.profile, updates);
}

function safeProfileWarning(source: string, error: unknown, details: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Profile sync failed.";
  console.warn("[Roamly profile] profile sync warning", {
    source,
    message,
    ...details
  });
}

export async function ensureRoamlyProfileBestEffort(
  user: User,
  updates: ProfileUpdates = {},
  client?: SupabaseClient,
  source = "auth"
): Promise<ProfileResult> {
  try {
    const profile = await ensureRoamlyProfile(user, updates, client);
    if (profile.error) {
      safeProfileWarning(source, profile.error, {
        schema: profile.schema,
        tableAvailable: profile.tableAvailable
      });
    }
    return profile;
  } catch (error) {
    safeProfileWarning(source, error);
    return {
      profile: null,
      tableAvailable: false,
      schema: "missing",
      error: "Profile sync failed."
    };
  }
}

export async function getRoamlyUserAppStatus(user: User, client?: SupabaseClient): Promise<RoamlyUserAppStatus> {
  const profile = await getRoamlyProfile(user.id, client);
  const access = getRoamlyAccessForUser(user.email);

  return {
    has_roamly_profile: Boolean(profile.profile),
    auth_email: user.email || "",
    auth_provider: getAuthProvider(user),
    is_roamly_tester: access.isTester,
    is_roamly_admin: access.isAdmin
  };
}

export async function getRoamlyProfileTableStatus(client?: SupabaseClient) {
  const supabase = await resolveSupabaseClient(client);

  if (!supabase) {
    return { available: false, error: "Supabase is not configured." };
  }

  const { error } = await supabase.from("roamly_profiles").select("id", { count: "exact", head: true });

  return {
    available: !error,
    error: error?.message || null
  };
}
