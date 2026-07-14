import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const GMAIL_PROVIDER = "gmail" as const;
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_OAUTH_STATE_COOKIE = "roamly_gmail_oauth_state";

type EmailConnectionRecord = {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
  granted_scopes: string[];
  connection_status: string;
  email_address: string | null;
  last_synced_at: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function appUrl(requestOrigin?: string | null) {
  const value = clean(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL);
  if (value) return value.replace(/\/$/, "");
  if (requestOrigin?.startsWith("http")) return requestOrigin.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function encryptionKey() {
  const secret = clean(process.env.ROAMLY_TOKEN_ENCRYPTION_KEY);
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

export function tokenEncryptionReady() {
  return Boolean(encryptionKey());
}

export function encryptToken(value: string) {
  const key = encryptionKey();
  if (!key) throw new Error("ROAMLY_TOKEN_ENCRYPTION_KEY is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptToken(value: string | null | undefined) {
  if (!value) return "";
  const key = encryptionKey();
  if (!key) throw new Error("ROAMLY_TOKEN_ENCRYPTION_KEY is required.");
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function gmailOAuthConfigured() {
  return Boolean(clean(process.env.GOOGLE_GMAIL_CLIENT_ID) && clean(process.env.GOOGLE_GMAIL_CLIENT_SECRET) && tokenEncryptionReady());
}

export function gmailRedirectUri(origin?: string | null) {
  return clean(process.env.GOOGLE_GMAIL_REDIRECT_URI) || `${appUrl(origin)}/api/integrations/gmail/callback`;
}

export function createOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function gmailAuthorizationUrl(params: { state: string; origin?: string | null }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clean(process.env.GOOGLE_GMAIL_CLIENT_ID));
  url.searchParams.set("redirect_uri", gmailRedirectUri(params.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function googleTokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || "Google token exchange failed.");
  }
  return data;
}

export async function exchangeGmailCodeForTokens(params: { code: string; origin?: string | null }) {
  return googleTokenRequest(
    new URLSearchParams({
      client_id: clean(process.env.GOOGLE_GMAIL_CLIENT_ID),
      client_secret: clean(process.env.GOOGLE_GMAIL_CLIENT_SECRET),
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: gmailRedirectUri(params.origin)
    })
  );
}

async function refreshGmailAccessToken(refreshToken: string) {
  return googleTokenRequest(
    new URLSearchParams({
      client_id: clean(process.env.GOOGLE_GMAIL_CLIENT_ID),
      client_secret: clean(process.env.GOOGLE_GMAIL_CLIENT_SECRET),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  );
}

export async function getGmailProfile(accessToken: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json().catch(() => ({}))) as { emailAddress?: string; historyId?: string };
  if (!response.ok) throw new Error("Gmail profile lookup failed.");
  return data;
}

function expiryFromSeconds(seconds?: number) {
  const expiresIn = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 3600;
  return new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString();
}

export async function upsertGmailConnection(params: {
  supabase: SupabaseClient;
  userId: string;
  tokens: GoogleTokenResponse;
  emailAddress: string | null;
}) {
  if (!params.tokens.access_token) return { connection: null, error: "GMAIL_ACCESS_TOKEN_MISSING" };
  const writer = createSupabaseAdminClient() || params.supabase;
  const row = {
    user_id: params.userId,
    provider: GMAIL_PROVIDER,
    encrypted_access_token: encryptToken(params.tokens.access_token),
    encrypted_refresh_token: params.tokens.refresh_token ? encryptToken(params.tokens.refresh_token) : undefined,
    token_expiry: expiryFromSeconds(params.tokens.expires_in),
    granted_scopes: (params.tokens.scope || GMAIL_READONLY_SCOPE).split(/\s+/).filter(Boolean),
    connection_status: "connected",
    email_address: params.emailAddress,
    disconnected_at: null
  };

  const { data: existing } = await writer
    .from("email_connections")
    .select("id,encrypted_refresh_token")
    .eq("user_id", params.userId)
    .eq("provider", GMAIL_PROVIDER)
    .maybeSingle();

  const payload = {
    ...row,
    encrypted_refresh_token: row.encrypted_refresh_token || (existing as { encrypted_refresh_token?: string | null } | null)?.encrypted_refresh_token || null
  };

  const saved = existing
    ? await writer.from("email_connections").update(payload).eq("id", (existing as { id: string }).id).select("*").single()
    : await writer.from("email_connections").insert(payload).select("*").single();

  if (saved.error) return { connection: null, error: saved.error.message };
  return { connection: saved.data as EmailConnectionRecord, error: null };
}

async function accessTokenForConnection(supabase: SupabaseClient, connection: EmailConnectionRecord) {
  const expiresAt = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;
  if (connection.encrypted_access_token && expiresAt > Date.now() + 60_000) {
    return decryptToken(connection.encrypted_access_token);
  }
  const refreshToken = decryptToken(connection.encrypted_refresh_token);
  if (!refreshToken) throw new Error("Gmail needs to be reconnected.");
  const refreshed = await refreshGmailAccessToken(refreshToken);
  if (!refreshed.access_token) throw new Error("Gmail token refresh failed.");
  const encrypted = encryptToken(refreshed.access_token);
  await supabase
    .from("email_connections")
    .update({
      encrypted_access_token: encrypted,
      token_expiry: expiryFromSeconds(refreshed.expires_in),
      connection_status: "connected"
    })
    .eq("id", connection.id);
  return refreshed.access_token;
}

export async function disconnectEmailConnection(params: {
  supabase: SupabaseClient;
  userId: string;
  provider: "gmail" | "outlook";
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data: connection } = await writer
    .from("email_connections")
    .select("id,encrypted_access_token")
    .eq("user_id", params.userId)
    .eq("provider", params.provider)
    .maybeSingle();

  const accessToken = decryptToken((connection as { encrypted_access_token?: string | null } | null)?.encrypted_access_token);
  if (accessToken && params.provider === "gmail") {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" }).catch(() => null);
  }

  const { error } = await writer
    .from("email_connections")
    .update({
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      connection_status: "disconnected",
      disconnected_at: new Date().toISOString()
    })
    .eq("user_id", params.userId)
    .eq("provider", params.provider);

  return { ok: !error, error: error?.message || null };
}

export async function renewGmailWatch(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
}) {
  const topicName = clean(process.env.ROAMLY_GMAIL_PUBSUB_TOPIC);
  if (!topicName) return { ok: false as const, skipped: true as const, error: "ROAMLY_GMAIL_PUBSUB_TOPIC_MISSING" };
  const accessToken = await accessTokenForConnection(params.supabase, params.connection);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX"]
    })
  });
  const data = (await response.json().catch(() => ({}))) as { historyId?: string; expiration?: string };
  if (!response.ok) return { ok: false as const, skipped: false as const, error: "GMAIL_WATCH_FAILED" };

  const writer = createSupabaseAdminClient() || params.supabase;
  await writer.from("email_watch_subscriptions").upsert(
    {
      email_connection_id: params.connection.id,
      provider: GMAIL_PROVIDER,
      external_subscription_id: data.historyId || null,
      expiration_time: data.expiration ? new Date(Number(data.expiration)).toISOString() : null,
      status: "active",
      last_renewed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  await writer.from("email_sync_cursors").upsert(
    {
      email_connection_id: params.connection.id,
      provider: GMAIL_PROVIDER,
      history_id_or_delta_token: data.historyId || null,
      last_processed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  return { ok: true as const, skipped: false as const, historyId: data.historyId || null };
}

export async function syncGmailConnection(params: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data, error } = await writer
    .from("email_connections")
    .select("*")
    .eq("user_id", params.userId)
    .eq("provider", GMAIL_PROVIDER)
    .neq("connection_status", "disconnected")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, processed: 0 };
  if (!data) return { ok: false, error: "GMAIL_NOT_CONNECTED", processed: 0 };

  const connection = data as EmailConnectionRecord;
  const accessToken = await accessTokenForConnection(writer, connection);
  const { data: cursor } = await writer
    .from("email_sync_cursors")
    .select("history_id_or_delta_token")
    .eq("email_connection_id", connection.id)
    .eq("provider", GMAIL_PROVIDER)
    .maybeSingle();
  const historyId = clean((cursor as { history_id_or_delta_token?: string | null } | null)?.history_id_or_delta_token);
  const url = historyId
    ? new URL("https://gmail.googleapis.com/gmail/v1/users/me/history")
    : new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (historyId) {
    url.searchParams.set("startHistoryId", historyId);
    url.searchParams.set("historyTypes", "messageAdded");
  } else {
    url.searchParams.set("q", "newer_than:30d (confirmation OR reservation OR itinerary OR delayed OR cancelled OR check-in)");
    url.searchParams.set("maxResults", "10");
  }
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const result = (await response.json().catch(() => ({}))) as { historyId?: string; messages?: unknown[]; history?: unknown[] };
  if (!response.ok) return { ok: false, error: "GMAIL_SYNC_FAILED", processed: 0 };
  const nextCursor = result.historyId || historyId;
  await writer.from("email_sync_cursors").upsert(
    {
      email_connection_id: connection.id,
      provider: GMAIL_PROVIDER,
      history_id_or_delta_token: nextCursor || null,
      last_processed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  await writer
    .from("email_connections")
    .update({ last_synced_at: new Date().toISOString(), connection_status: "connected" })
    .eq("id", connection.id);

  return {
    ok: true,
    error: null,
    processed: Array.isArray(result.history) ? result.history.length : Array.isArray(result.messages) ? result.messages.length : 0
  };
}
