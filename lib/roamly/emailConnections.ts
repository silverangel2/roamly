import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractAndMatchTravelEmailBooking } from "@/lib/roamly/bookingExtraction";
import { recordTravelEmailFilterResult } from "@/lib/roamly/travelEmailFiltering";

export const GMAIL_PROVIDER = "gmail" as const;
export const OUTLOOK_PROVIDER = "outlook" as const;
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const OUTLOOK_READONLY_SCOPES = ["offline_access", "User.Read", "Mail.Read"] as const;
export const GMAIL_OAUTH_STATE_COOKIE = "roamly_gmail_oauth_state";
export const OUTLOOK_OAUTH_STATE_COOKIE = "roamly_outlook_oauth_state";

export type EmailProvider = typeof GMAIL_PROVIDER | typeof OUTLOOK_PROVIDER;

export type EmailConnectionRecord = {
  id: string;
  user_id: string;
  provider: EmailProvider;
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

type MicrosoftTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GmailHistoryResponse = {
  historyId?: string;
  messages?: Array<{ id?: string }>;
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
    messages?: Array<{ id?: string }>;
  }>;
};

type GmailMessageMetadataResponse = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
};

type OutlookDeltaResponse = {
  value?: Array<{
    id?: string;
    subject?: string | null;
    receivedDateTime?: string | null;
    from?: {
      emailAddress?: {
        name?: string | null;
        address?: string | null;
      };
    };
  }>;
  "@odata.deltaLink"?: string;
  "@odata.nextLink"?: string;
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

export function outlookOAuthConfigured() {
  return Boolean(clean(process.env.MICROSOFT_OUTLOOK_CLIENT_ID) && clean(process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET) && tokenEncryptionReady());
}

export function gmailRedirectUri(origin?: string | null) {
  return clean(process.env.GOOGLE_GMAIL_REDIRECT_URI) || `${appUrl(origin)}/api/integrations/gmail/callback`;
}

export function outlookTenantId() {
  return clean(process.env.MICROSOFT_OUTLOOK_TENANT_ID) || "common";
}

export function outlookRedirectUri(origin?: string | null) {
  return clean(process.env.MICROSOFT_OUTLOOK_REDIRECT_URI) || `${appUrl(origin)}/api/integrations/outlook/callback`;
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

export function outlookAuthorizationUrl(params: { state: string; origin?: string | null }) {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(outlookTenantId())}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clean(process.env.MICROSOFT_OUTLOOK_CLIENT_ID));
  url.searchParams.set("redirect_uri", outlookRedirectUri(params.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", OUTLOOK_READONLY_SCOPES.join(" "));
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

async function microsoftTokenRequest(body: URLSearchParams) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(outlookTenantId())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || "Microsoft token exchange failed.");
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

export async function exchangeOutlookCodeForTokens(params: { code: string; origin?: string | null }) {
  return microsoftTokenRequest(
    new URLSearchParams({
      client_id: clean(process.env.MICROSOFT_OUTLOOK_CLIENT_ID),
      client_secret: clean(process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET),
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: outlookRedirectUri(params.origin)
    })
  );
}

async function refreshOutlookAccessToken(refreshToken: string) {
  return microsoftTokenRequest(
    new URLSearchParams({
      client_id: clean(process.env.MICROSOFT_OUTLOOK_CLIENT_ID),
      client_secret: clean(process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: OUTLOOK_READONLY_SCOPES.join(" ")
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

export async function getOutlookProfile(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string };
  if (!response.ok) throw new Error("Outlook profile lookup failed.");
  return data;
}

function expiryFromSeconds(seconds?: number) {
  const expiresIn = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 3600;
  return new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString();
}

function gmailMessageIds(result: GmailHistoryResponse) {
  const ids = new Set<string>();
  for (const message of result.messages || []) {
    if (message.id) ids.add(message.id);
  }
  for (const history of result.history || []) {
    for (const added of history.messagesAdded || []) {
      if (added.message?.id) ids.add(added.message.id);
    }
    for (const message of history.messages || []) {
      if (message.id) ids.add(message.id);
    }
  }
  return [...ids].slice(0, 10);
}

function gmailHeader(message: GmailMessageMetadataResponse, name: string) {
  return clean(message.payload?.headers?.find((header) => clean(header.name).toLowerCase() === name.toLowerCase())?.value);
}

function gmailReceivedAt(message: GmailMessageMetadataResponse) {
  const dateHeader = gmailHeader(message, "Date");
  const parsed = dateHeader ? new Date(dateHeader) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const internalDate = Number(message.internalDate || 0);
  return internalDate > 0 ? new Date(internalDate).toISOString() : null;
}

async function recordGmailTravelMessage(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  accessToken: string;
  messageId: string;
}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(params.messageId)}`);
  url.searchParams.set("format", "metadata");
  ["From", "Subject", "Date"].forEach((header) => url.searchParams.append("metadataHeaders", header));
  const response = await fetch(url, { headers: { authorization: `Bearer ${params.accessToken}` } });
  const message = (await response.json().catch(() => ({}))) as GmailMessageMetadataResponse;
  if (!response.ok) return { saved: false, error: "GMAIL_MESSAGE_METADATA_FAILED" };
  const metadata = {
      provider: GMAIL_PROVIDER,
      messageId: message.id || params.messageId,
      sender: gmailHeader(message, "From"),
      subject: gmailHeader(message, "Subject"),
      receivedAt: gmailReceivedAt(message),
      snippet: message.snippet || null
  };
  const saved = await recordTravelEmailFilterResult({
    supabase: params.supabase,
    connection: params.connection,
    metadata
  });
  if (saved.saved && saved.filter.shouldProcess) {
    await extractAndMatchTravelEmailBooking({
      supabase: params.supabase,
      connection: params.connection,
      metadata,
      filter: saved.filter,
      emailMessageId: saved.messageRecordId
    }).catch(() => null);
  }
  return saved;
}

async function recordOutlookTravelMessages(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  messages: OutlookDeltaResponse["value"];
}) {
  const results = [];
  for (const message of params.messages || []) {
    if (!message.id) continue;
    const address = clean(message.from?.emailAddress?.address);
    const name = clean(message.from?.emailAddress?.name);
    const metadata = {
      provider: OUTLOOK_PROVIDER,
      messageId: message.id,
      sender: address ? `${name ? `${name} ` : ""}<${address}>` : name,
      subject: message.subject || "",
      receivedAt: message.receivedDateTime || null
    };
    const saved = await recordTravelEmailFilterResult({
      supabase: params.supabase,
      connection: params.connection,
      metadata
    });
    if (saved.saved && saved.filter.shouldProcess) {
      await extractAndMatchTravelEmailBooking({
        supabase: params.supabase,
        connection: params.connection,
        metadata,
        filter: saved.filter,
        emailMessageId: saved.messageRecordId
      }).catch(() => null);
    }
    results.push(saved);
  }
  return results;
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

export async function upsertOutlookConnection(params: {
  supabase: SupabaseClient;
  userId: string;
  tokens: MicrosoftTokenResponse;
  emailAddress: string | null;
}) {
  if (!params.tokens.access_token) return { connection: null, error: "OUTLOOK_ACCESS_TOKEN_MISSING" };
  const writer = createSupabaseAdminClient() || params.supabase;
  const row = {
    user_id: params.userId,
    provider: OUTLOOK_PROVIDER,
    encrypted_access_token: encryptToken(params.tokens.access_token),
    encrypted_refresh_token: params.tokens.refresh_token ? encryptToken(params.tokens.refresh_token) : undefined,
    token_expiry: expiryFromSeconds(params.tokens.expires_in),
    granted_scopes: (params.tokens.scope || OUTLOOK_READONLY_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    connection_status: "connected",
    email_address: params.emailAddress,
    disconnected_at: null
  };

  const { data: existing } = await writer
    .from("email_connections")
    .select("id,encrypted_refresh_token")
    .eq("user_id", params.userId)
    .eq("provider", OUTLOOK_PROVIDER)
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

async function accessTokenForOutlookConnection(supabase: SupabaseClient, connection: EmailConnectionRecord) {
  const expiresAt = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;
  if (connection.encrypted_access_token && expiresAt > Date.now() + 60_000) {
    return decryptToken(connection.encrypted_access_token);
  }
  const refreshToken = decryptToken(connection.encrypted_refresh_token);
  if (!refreshToken) throw new Error("Outlook needs to be reconnected.");
  const refreshed = await refreshOutlookAccessToken(refreshToken);
  if (!refreshed.access_token) throw new Error("Outlook token refresh failed.");
  await supabase
    .from("email_connections")
    .update({
      encrypted_access_token: encryptToken(refreshed.access_token),
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

export async function renewOutlookSubscription(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  origin?: string | null;
}) {
  const secret = clean(process.env.ROAMLY_OUTLOOK_WEBHOOK_SECRET);
  if (!secret) return { ok: false as const, skipped: true as const, error: "ROAMLY_OUTLOOK_WEBHOOK_SECRET_MISSING" };
  const notificationUrl =
    clean(process.env.MICROSOFT_OUTLOOK_WEBHOOK_URL) ||
    `${appUrl(params.origin)}/api/webhooks/outlook?token=${encodeURIComponent(secret)}`;
  if (!notificationUrl.startsWith("https://")) {
    return { ok: false as const, skipped: true as const, error: "MICROSOFT_OUTLOOK_WEBHOOK_URL_HTTPS_REQUIRED" };
  }
  const accessToken = await accessTokenForOutlookConnection(params.supabase, params.connection);
  const expirationDateTime = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl,
      resource: "me/messages",
      expirationDateTime,
      clientState: secret
    })
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; expirationDateTime?: string };
  if (!response.ok) return { ok: false as const, skipped: false as const, error: "OUTLOOK_SUBSCRIPTION_FAILED" };

  const writer = createSupabaseAdminClient() || params.supabase;
  await writer.from("email_watch_subscriptions").upsert(
    {
      email_connection_id: params.connection.id,
      provider: OUTLOOK_PROVIDER,
      external_subscription_id: data.id || null,
      expiration_time: data.expirationDateTime || expirationDateTime,
      status: "active",
      last_renewed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  return { ok: true as const, skipped: false as const, subscriptionId: data.id || null };
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
  const result = (await response.json().catch(() => ({}))) as GmailHistoryResponse;
  if (!response.ok) return { ok: false, error: "GMAIL_SYNC_FAILED", processed: 0 };
  const messageIds = gmailMessageIds(result);
  for (const messageId of messageIds) {
    await recordGmailTravelMessage({ supabase: writer, connection, accessToken, messageId }).catch(() => null);
  }
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
    processed: messageIds.length || (Array.isArray(result.history) ? result.history.length : 0)
  };
}

export async function syncOutlookConnection(params: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data, error } = await writer
    .from("email_connections")
    .select("*")
    .eq("user_id", params.userId)
    .eq("provider", OUTLOOK_PROVIDER)
    .neq("connection_status", "disconnected")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, processed: 0 };
  if (!data) return { ok: false, error: "OUTLOOK_NOT_CONNECTED", processed: 0 };

  const connection = data as EmailConnectionRecord;
  const accessToken = await accessTokenForOutlookConnection(writer, connection);
  const { data: cursor } = await writer
    .from("email_sync_cursors")
    .select("history_id_or_delta_token")
    .eq("email_connection_id", connection.id)
    .eq("provider", OUTLOOK_PROVIDER)
    .maybeSingle();
  const deltaCursor = clean((cursor as { history_id_or_delta_token?: string | null } | null)?.history_id_or_delta_token);
  const url = deltaCursor
    ? deltaCursor
    : "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime&$top=10";

  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const result = (await response.json().catch(() => ({}))) as OutlookDeltaResponse;
  if (!response.ok) return { ok: false, error: "OUTLOOK_SYNC_FAILED", processed: 0 };
  await recordOutlookTravelMessages({ supabase: writer, connection, messages: result.value }).catch(() => null);
  const nextCursor = result["@odata.deltaLink"] || result["@odata.nextLink"] || deltaCursor || null;
  await writer.from("email_sync_cursors").upsert(
    {
      email_connection_id: connection.id,
      provider: OUTLOOK_PROVIDER,
      history_id_or_delta_token: nextCursor,
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
    processed: Array.isArray(result.value) ? result.value.length : 0
  };
}
