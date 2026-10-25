import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractAndMatchTravelEmailBooking } from "@/lib/roamly/bookingExtraction";
import { filterTravelEmail, recordTravelEmailFilterResult } from "@/lib/roamly/travelEmailFiltering";
import { revokeGoogleOAuthToken, stopGmailPushDelivery } from "@/lib/roamly/gmailDisconnect";
import { build2ReconciliationSilentEnabled } from "@/lib/roamly/build2Flags";
import { GMAIL_CONSENT_SCOPE } from "@/lib/roamly/gateMachine";
import {
  classifyBookingPattern,
  laneMessageFromMetadata,
  parseLaneMessage
} from "@/lib/roamly/reconciliationLane";

export const GMAIL_PROVIDER = "gmail" as const;
export const OUTLOOK_PROVIDER = "outlook" as const;
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const OUTLOOK_READONLY_SCOPES = ["offline_access", "User.Read", "Mail.Read"] as const;
export const GMAIL_OAUTH_STATE_COOKIE = "roamly_gmail_oauth_state";
export const OUTLOOK_OAUTH_STATE_COOKIE = "roamly_outlook_oauth_state";
export const EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC = 10;
export const EMAIL_LOOKBACK_FETCH_TIMEOUT_MS = 8_000;
export const EMAIL_LOOKBACK_BODY_TEXT_LIMIT = 6_000;

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
  sync_lease_token?: string | null;
  sync_lease_expires_at?: string | null;
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
  error?: { code?: number; status?: string; message?: string };
};

type GmailMessagePart = {
  mimeType?: string;
  body?: { data?: string | null; size?: number | null };
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMessagePart[];
};

type GmailMessageMetadataResponse = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
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
    bodyPreview?: string | null;
  }>;
  "@odata.deltaLink"?: string;
  "@odata.nextLink"?: string;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

const EMAIL_SYNC_LEASE_MS = 4 * 60_000;

async function claimEmailSync(params: {
  supabase: SupabaseClient;
  userId: string;
  provider: EmailProvider;
}) {
  const now = new Date();
  const leaseToken = randomBytes(18).toString("base64url");
  const result = await params.supabase
    .from("email_connections")
    .update({
      connection_status: "syncing",
      sync_lease_token: leaseToken,
      sync_lease_expires_at: new Date(now.getTime() + EMAIL_SYNC_LEASE_MS).toISOString()
    })
    .eq("user_id", params.userId)
    .eq("provider", params.provider)
    .neq("connection_status", "disconnected")
    .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
    .select("id,sync_lease_token")
    .maybeSingle();
  if (result.error || !result.data) return null;
  return { id: String(result.data.id), token: leaseToken };
}

async function releaseEmailSync(params: {
  supabase: SupabaseClient;
  connectionId: string;
  leaseToken: string;
  /** False when the sync just failed: the failure must stay visible
      instead of being reset to "connected". The booking monitor retries
      "error" rows, and the gate view treats them as connected-but-stale
      (never as a reauth demand), so a failed attempt can never push the
      traveler into a reconnect — which would reset the scan cursor. */
  ok?: boolean;
  /** Machine failure code from the attempt just released (Gmail only).
      Persisted so the traveler surfaces can name the failure in plain
      words instead of a bare code. Never a message, never a token. */
  errorCode?: string | null;
}) {
  // Autosync: record what failed and when, next to the stale sync date.
  // The failure columns come from migration
  // 20261025_roamly_email_sync_failure_columns; until the owner applies
  // it, the full update errors and the base update below runs instead,
  // so a missing migration can never leave the row stuck on "syncing".
  const failed = params.ok === false;
  const full = await params.supabase
    .from("email_connections")
    .update({
      // Status line kept verbatim: the recon-batch2 suite asserts this
      // exact expression, and the behavior is identical either way.
      connection_status: params.ok === false ? "error" : "connected",
      sync_lease_token: null,
      sync_lease_expires_at: null,
      last_sync_error_code: failed ? (params.errorCode ?? null) : null,
      last_sync_failed_at: failed ? new Date().toISOString() : null
    })
    .eq("id", params.connectionId)
    .eq("sync_lease_token", params.leaseToken)
    .neq("connection_status", "disconnected");
  if (full.error) {
    await params.supabase
      .from("email_connections")
      .update({
        connection_status: params.ok === false ? "error" : "connected",
        sync_lease_token: null,
        sync_lease_expires_at: null
      })
      .eq("id", params.connectionId)
      .eq("sync_lease_token", params.leaseToken)
      .neq("connection_status", "disconnected");
  }
}

async function providerFetchJson<T>(url: string | URL, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(EMAIL_LOOKBACK_FETCH_TIMEOUT_MS)
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { response, data };
}

function decodeGmailBodyData(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[^\S\r\n]+/g, " ").replace(/\n{3,}/g, "\n\n")
    .trim();
}

function gmailPartText(part?: GmailMessagePart | null): string[] {
  if (!part) return [];
  const mimeType = clean(part.mimeType).toLowerCase();
  const data = decodeGmailBodyData(part.body?.data);
  const current =
    data && mimeType.includes("text/plain")
      ? [data]
      : data && mimeType.includes("text/html")
        ? [stripHtml(data)]
        : [];
  return [...current, ...(part.parts || []).flatMap((child) => gmailPartText(child))];
}

function gmailMessageBodyText(message: GmailMessageMetadataResponse) {
  return gmailPartText(message.payload).join("\n").replace(/[^\S\r\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, EMAIL_LOOKBACK_BODY_TEXT_LIMIT);
}

function gmailFailureKind(response: Response, data: GmailHistoryResponse) {
  const message = clean(data.error?.message).toLowerCase();
  if (response.status === 401 || response.status === 403) return "auth" as const;
  if (response.status === 404 || (response.status === 400 && /history|start history|historyid/.test(message))) return "invalid_cursor" as const;
  if (response.status === 408 || response.status === 429 || response.status >= 500) return "transient" as const;
  return "other" as const;
}

function gmailLookbackUrl() {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", "newer_than:30d (confirmation OR reservation OR itinerary OR delayed OR cancelled OR changed OR voucher OR ticket OR Klook OR transport OR check-in)");
  url.searchParams.set("maxResults", String(EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC));
  return url;
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

/**
 * G14: a token that cannot be decrypted is a reauth case, never a
 * transient retry. Decrypt failures happen when the encryption key
 * was rotated or removed after the token was stored, so no retry
 * will ever succeed — only a fresh connect (new tokens under the
 * current key) can. The typed error below is what the sync loop
 * classifies on; the message text is unchanged so existing log
 * searches keep working.
 */
export class TokenDecryptError extends Error {
  code = "TOKEN_DECRYPT_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptError";
  }
}

export function isTokenDecryptFailure(error: unknown) {
  return (
    error instanceof TokenDecryptError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "TOKEN_DECRYPT_FAILED")
  );
}

export function decryptToken(value: string | null | undefined) {
  if (!value) return "";
  const key = encryptionKey();
  if (!key) throw new TokenDecryptError("ROAMLY_TOKEN_ENCRYPTION_KEY is required.");
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new TokenDecryptError("Invalid encrypted token.");
  // A rotated key still yields a well-formed v1 token whose GCM tag
  // no longer verifies — that failure must classify exactly like a
  // missing key, so it is wrapped into the same typed error.
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptError("Invalid encrypted token.");
  }
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

function oauthStateSigningSecret() {
  return clean(process.env.ROAMLY_TOKEN_ENCRYPTION_KEY);
}

function signOAuthStatePayload(payload: string) {
  const secret = oauthStateSigningSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createGmailOAuthState(userId: string) {
  const state = createOAuthState();
  const payload = Buffer.from(
    JSON.stringify({
      state,
      userId,
      issuedAt: Date.now()
    }),
    "utf8"
  ).toString("base64url");
  const signature = signOAuthStatePayload(payload);
  return {
    state,
    cookieValue: signature ? `${payload}.${signature}` : state
  };
}

export function verifiedGmailOAuthStateUserId(cookieValue: string, state: string, maxAgeMs = 10 * 60_000) {
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature || signature !== signOAuthStatePayload(payload)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state?: unknown;
      userId?: unknown;
      issuedAt?: unknown;
    };
    if (parsed.state !== state) return null;
    if (typeof parsed.userId !== "string" || !parsed.userId) return null;
    if (typeof parsed.issuedAt !== "number" || Date.now() - parsed.issuedAt > maxAgeMs) return null;
    return parsed.userId;
  } catch {
    return null;
  }
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
  const { response, data } = await providerFetchJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || "Google token exchange failed.");
  }
  return data;
}

async function microsoftTokenRequest(body: URLSearchParams) {
  const { response, data } = await providerFetchJson<MicrosoftTokenResponse>(`https://login.microsoftonline.com/${encodeURIComponent(outlookTenantId())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
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
  const { response, data } = await providerFetchJson<{ emailAddress?: string; historyId?: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error("Gmail profile lookup failed.");
  return data;
}

export async function getOutlookProfile(accessToken: string) {
  const { response, data } = await providerFetchJson<{ mail?: string; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
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
  return [...ids].slice(0, EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC);
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

/**
 * Build 2 consent evidence for the sync seam (Phase 8): the consent
 * scope recorded in the M1 gate states (table name owned by
 * gateService, GATE_STATES_TABLE) at gate/connect time. No row — or
 * no table yet — means no consent on record, and the lane refuses
 * closed: reconciliation reads wait for consent, always.
 */
async function build2GmailConsentRecorded(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("roamly_gate_states")
    .select("gmail_consent_scope")
    .eq("user_id", userId)
    .eq("gmail_consent_scope", GMAIL_CONSENT_SCOPE)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
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
  const { response, data: message } = await providerFetchJson<GmailMessageMetadataResponse>(url, {
    headers: { authorization: `Bearer ${params.accessToken}` }
  });
  if (!response.ok) return { saved: false, retryable: true, error: "GMAIL_MESSAGE_METADATA_FAILED" };
  const metadata = {
      provider: GMAIL_PROVIDER,
      messageId: message.id || params.messageId,
      sender: gmailHeader(message, "From"),
      subject: gmailHeader(message, "Subject"),
      receivedAt: gmailReceivedAt(message),
      snippet: message.snippet || null
  };
  const preFilter = filterTravelEmail(metadata);
  const enrichedMetadata = preFilter.shouldProcess
    ? {
        ...metadata,
        bodyText: await fetchGmailTravelBodyText({
          accessToken: params.accessToken,
          messageId: message.id || params.messageId
        }).catch(() => "")
      }
    : metadata;
  const saved = await recordTravelEmailFilterResult({
    supabase: params.supabase,
    connection: params.connection,
    metadata: enrichedMetadata
  });
  if (saved.saved && saved.filter.shouldProcess) {
    // Build 2 lane (Phase 8): the booking-pattern gate stands in
    // front of extraction — a message that is not booking-pattern
    // never reaches the extractor, and the rejection reason is
    // recorded on the result. (This seam is Gmail-only by
    // construction; the Outlook path never enters the lane.)
    if (build2ReconciliationSilentEnabled()) {
      const pattern = classifyBookingPattern(parseLaneMessage(laneMessageFromMetadata(enrichedMetadata)));
      if (!pattern.accepted) {
        return { ...saved, retryable: false, laneRejected: pattern.reason };
      }
    }
    const extraction = await extractAndMatchTravelEmailBooking({
      supabase: params.supabase,
      connection: params.connection,
      metadata: enrichedMetadata,
      filter: saved.filter,
      emailMessageId: saved.messageRecordId
    }).catch(() => ({ error: "GMAIL_BOOKING_EXTRACTION_FAILED" }));
    return { ...saved, retryable: Boolean(extraction?.error) };
  }
  return { ...saved, retryable: saved.filter.shouldProcess && !saved.saved };
}

async function fetchGmailTravelBodyText(params: {
  accessToken: string;
  messageId: string;
}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(params.messageId)}`);
  url.searchParams.set("format", "full");
  const { response, data } = await providerFetchJson<GmailMessageMetadataResponse>(url, {
    headers: { authorization: `Bearer ${params.accessToken}` }
  });
  if (!response.ok) return "";
  return gmailMessageBodyText(data);
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
      receivedAt: message.receivedDateTime || null,
      snippet: message.bodyPreview || null
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
    .select("id,encrypted_access_token,encrypted_refresh_token")
    .eq("user_id", params.userId)
    .eq("provider", params.provider)
    .maybeSingle();

  const stored = connection as { id?: string; encrypted_access_token?: string | null; encrypted_refresh_token?: string | null } | null;
  let accessToken = "";
  let refreshToken = "";
  let canReadStoredTokens = true;
  try {
    accessToken = decryptToken(stored?.encrypted_access_token);
    refreshToken = decryptToken(stored?.encrypted_refresh_token);
  } catch {
    canReadStoredTokens = false;
  }

  let pushStopped = params.provider !== "gmail";
  if (params.provider === "gmail" && accessToken) {
    pushStopped = await stopGmailPushDelivery(accessToken);
  } else if (params.provider === "gmail" && !stored && canReadStoredTokens) {
    pushStopped = true;
  } else if (params.provider === "gmail" && stored?.id) {
    const watch = await writer
      .from("email_watch_subscriptions")
      .select("status")
      .eq("email_connection_id", stored.id)
      .eq("provider", GMAIL_PROVIDER)
      .maybeSingle();
    pushStopped = !watch.data || watch.data.status === "stopped" || watch.data.status === "expired";
  }
  let revocationConfirmed = params.provider !== "gmail" || (!stored && canReadStoredTokens);
  if (params.provider === "gmail" && (refreshToken || accessToken)) {
    revocationConfirmed = await revokeGoogleOAuthToken(refreshToken || accessToken);
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

  if (params.provider === "gmail" && stored?.id) {
    const watchStopped = await writer
      .from("email_watch_subscriptions")
      .update({ status: "stopped" })
      .eq("email_connection_id", stored.id)
      .eq("provider", GMAIL_PROVIDER);
    if (watchStopped.error) pushStopped = false;
  }

  return { ok: !error, error: error?.message || null, pushStopped, revocationConfirmed };
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
  const watchSaved = await writer.from("email_watch_subscriptions").upsert(
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
  if (watchSaved.error) return { ok: false as const, skipped: false as const, error: watchSaved.error.message };
  const cursorSaved = await writer.from("email_sync_cursors").upsert(
    {
      email_connection_id: params.connection.id,
      provider: GMAIL_PROVIDER,
      history_id_or_delta_token: data.historyId || null,
      last_processed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  if (cursorSaved.error) return { ok: false as const, skipped: false as const, error: cursorSaved.error.message };
  return { ok: true as const, skipped: false as const, historyId: data.historyId || null };
}

export async function renewDueGmailWatches(params: { supabase: SupabaseClient; limit?: number }) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const watches = await writer
    .from("email_watch_subscriptions")
    .select("id,email_connection_id")
    .eq("provider", GMAIL_PROVIDER)
    .in("status", ["active", "renewal_due", "expired", "error"])
    .not("expiration_time", "is", null)
    .lte("expiration_time", horizon)
    .order("expiration_time", { ascending: true })
    .limit(params.limit || 25);
  if (watches.error) return { ok: false as const, renewed: 0, failed: 1, error: watches.error.message };

  let renewed = 0;
  let failed = 0;
  for (const watch of watches.data || []) {
    const connectionResult = await writer
      .from("email_connections")
      .select("*")
      .eq("id", watch.email_connection_id)
      .eq("provider", GMAIL_PROVIDER)
      .eq("connection_status", "connected")
      .maybeSingle();
    if (connectionResult.error || !connectionResult.data) {
      failed += 1;
      await writer.from("email_watch_subscriptions").update({ status: "error" }).eq("id", watch.id);
      continue;
    }
    try {
      const result = await renewGmailWatch({ supabase: writer, connection: connectionResult.data as EmailConnectionRecord });
      if (result.ok) renewed += 1;
      else {
        failed += 1;
        await writer.from("email_watch_subscriptions").update({ status: "error" }).eq("id", watch.id);
      }
    } catch {
      failed += 1;
      await writer.from("email_watch_subscriptions").update({ status: "error" }).eq("id", watch.id);
    }
  }
  return { ok: failed === 0, renewed, failed, error: null };
}

/**
 * G13 quarantine marker. A message that fails processing is recorded
 * in the EXISTING travel_email_messages table — no new table, no
 * migration: processing_result "error" is already in the table's
 * check constraint, and the row upserts on the existing
 * (email_connection_id, provider, provider_message_id) key, so a
 * later successful reprocess overwrites the quarantine instead of
 * duplicating it. Only the quarantine columns are sent, so a filter
 * row that already holds a sender/subject keeps them on conflict.
 * The email-imports route surfaces processing_result = "error" rows
 * as `quarantined`, so a quarantined message stays visible to its
 * owner and is retryable through a reconnect backfill (which feeds
 * the same pipeline and overwrites this row on success). It is
 * never silently dropped, and it never blocks the cursor again.
 */
export const GMAIL_SYNC_QUARANTINE_REASON = "gmail_sync_quarantined" as const;

async function quarantineGmailTravelMessage(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  messageId: string;
  errorCode: string;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const saved = await writer.from("travel_email_messages").upsert(
    {
      user_id: params.connection.user_id,
      email_connection_id: params.connection.id,
      provider: GMAIL_PROVIDER,
      provider_message_id: params.messageId,
      processing_result: "error",
      filter_reasons: [GMAIL_SYNC_QUARANTINE_REASON, params.errorCode]
    },
    { onConflict: "email_connection_id,provider,provider_message_id" }
  );
  if (saved.error) {
    console.warn("Roamly Gmail message quarantine failed", { connectionId: params.connection.id, errorCode: params.errorCode });
    return false;
  }
  console.warn("Roamly Gmail message quarantined", { connectionId: params.connection.id, errorCode: params.errorCode });
  return true;
}

async function processGmailMessageIds(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  accessToken: string;
  messageIds: string[];
}) {
  // G13: one failing message used to set retryable for the whole
  // batch, so the sync returned before the cursor upsert and the
  // same message stalled every later sync forever. Now a per-message
  // failure is quarantined (recorded + visible, see above) and the
  // batch continues; only a failure to RECORD the quarantine keeps
  // the batch retryable, because advancing past an unrecorded
  // failure would lose the message silently. Sync-level failures
  // (history list, checkpoint, token) are untouched by this and
  // still retry/reauth as before.
  let retryable = false;
  let quarantined = 0;
  for (const messageId of params.messageIds) {
    const processed = await recordGmailTravelMessage({
      supabase: params.supabase,
      connection: params.connection,
      accessToken: params.accessToken,
      messageId
    }).catch(() => ({ retryable: true as const, error: "GMAIL_MESSAGE_PROCESSING_FAILED" }));
    if (!processed.retryable) continue;
    const errorCode = (processed as { error?: string }).error || "GMAIL_MESSAGE_PROCESSING_FAILED";
    const wasQuarantined = await quarantineGmailTravelMessage({
      supabase: params.supabase,
      connection: params.connection,
      messageId,
      errorCode
    }).catch(() => false);
    if (wasQuarantined) quarantined += 1;
    else retryable = true;
  }
  return { retryable, processed: params.messageIds.length, quarantined };
}

async function markGmailReauthorizationRequired(supabase: SupabaseClient, connectionId: string) {
  await supabase
    .from("email_connections")
    .update({ connection_status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("id", connectionId);
}

async function recoverGmailHistoryCursor(params: {
  supabase: SupabaseClient;
  connection: EmailConnectionRecord;
  accessToken: string;
}) {
  console.warn("Roamly Gmail history cursor recovery started", { connectionId: params.connection.id });
  const { response, data } = await providerFetchJson<GmailHistoryResponse>(gmailLookbackUrl(), {
    headers: { authorization: `Bearer ${params.accessToken}` }
  });
  if (!response.ok) {
    const kind = gmailFailureKind(response, data);
    if (kind === "auth") await markGmailReauthorizationRequired(params.supabase, params.connection.id);
    console.warn("Roamly Gmail history cursor recovery failed", { connectionId: params.connection.id, kind });
    return { ok: false as const, error: kind === "auth" ? "GMAIL_REAUTH_REQUIRED" : "GMAIL_CURSOR_RECOVERY_FAILED", processed: 0 };
  }

  const processed = await processGmailMessageIds({
    supabase: params.supabase,
    connection: params.connection,
    accessToken: params.accessToken,
    messageIds: gmailMessageIds(data)
  });
  if (processed.retryable) {
    console.warn("Roamly Gmail history cursor recovery requires retry", { connectionId: params.connection.id, processed: processed.processed });
    return { ok: false as const, error: "GMAIL_CURSOR_RECOVERY_RETRY", processed: processed.processed };
  }
  if (processed.quarantined > 0) {
    console.warn("Roamly Gmail history cursor recovery quarantined messages", { connectionId: params.connection.id, quarantined: processed.quarantined });
  }

  const checkpoint = await providerFetchJson<{ historyId?: string; error?: { message?: string } }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${params.accessToken}` }
  });
  if (!checkpoint.response.ok || !clean(checkpoint.data.historyId)) {
    const kind = gmailFailureKind(checkpoint.response, checkpoint.data as GmailHistoryResponse);
    if (kind === "auth") await markGmailReauthorizationRequired(params.supabase, params.connection.id);
    console.warn("Roamly Gmail history cursor checkpoint failed", { connectionId: params.connection.id, kind });
    return { ok: false as const, error: kind === "auth" ? "GMAIL_REAUTH_REQUIRED" : "GMAIL_CURSOR_CHECKPOINT_FAILED", processed: processed.processed };
  }
  const cursorSaved = await params.supabase.from("email_sync_cursors").upsert({
    email_connection_id: params.connection.id,
    provider: GMAIL_PROVIDER,
    history_id_or_delta_token: checkpoint.data.historyId,
    last_processed_at: new Date().toISOString()
  }, { onConflict: "email_connection_id,provider" });
  if (cursorSaved.error) return { ok: false as const, error: "GMAIL_CURSOR_CHECKPOINT_FAILED", processed: processed.processed };
  console.warn("Roamly Gmail history cursor recovery completed", { connectionId: params.connection.id, processed: processed.processed });
  return { ok: true as const, error: null, processed: processed.processed, quarantined: processed.quarantined, recovered: true as const };
}

async function syncGmailConnectionUnlocked(params: {
  supabase: SupabaseClient;
  userId: string;
  leaseToken: string;
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
  // Build 2 lane (Phase 8): consent is recorded BEFORE any read.
  // With the lane on, a sync for a traveler with no recorded Build 2
  // Gmail consent refuses here — before the token refresh, before
  // the history listing, before a single message is fetched.
  if (build2ReconciliationSilentEnabled()) {
    const consented = await build2GmailConsentRecorded(writer, connection.user_id).catch(() => false);
    if (!consented) return { ok: false, error: "RECONCILIATION_NOT_ARMED", processed: 0 };
  }
  let accessToken: string;
  try {
    accessToken = await accessTokenForConnection(writer, connection);
  } catch (error) {
    // G14: before this fix, a decrypt failure fell through to the
    // transient-retry branch — its message ("ROAMLY_TOKEN_ENCRYPTION_KEY
    // is required." / "Invalid encrypted token.") contains none of
    // "reconnected"/"invalid_grant"/"revoked", so the sync retried
    // forever, releaseEmailSync left the row "error" with a stale
    // last_synced_at, and the gate kept reporting the traveler as
    // RECONCILIATION_ARMED ("activated") even though no sync could
    // ever succeed. A decrypt failure is not transient: the stored
    // tokens are unreadable under the current key, so it classifies
    // as REAUTH. markGmailReauthorizationRequired sets status
    // "disconnected" (+ disconnected_at) and does NOT null the
    // tokens — that behavior is preserved here — and the gate view
    // excludes disconnected rows, so the traveler then honestly sees
    // "Booking Recon: not activated — connect Gmail" (trip line) /
    // the disconnected SetupCascade line instead of "activated".
    // releaseEmailSync's .neq("disconnected") guard keeps it from
    // overwriting "disconnected" back to "error" in the finally.
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    // Autosync: the underlying refresh error used to be swallowed here —
    // the traveler surface got only the bare RETRY code and no log line
    // ever named the cause. Log the kind + provider message server-side
    // only (never a token, secret, or email content).
    const isReauth =
      isTokenDecryptFailure(error) ||
      !message ||
      message.includes("reconnected") ||
      message.includes("invalid_grant") ||
      message.includes("revoked");
    console.warn("Roamly Gmail token refresh failed", {
      connectionId: connection.id,
      kind: isReauth ? "reauth" : "retry",
      error: error instanceof Error ? error.message : "unknown refresh error"
    });
    if (isReauth) {
      await markGmailReauthorizationRequired(writer, connection.id);
      return { ok: false, error: "GMAIL_REAUTH_REQUIRED", processed: 0 };
    }
    return { ok: false, error: "GMAIL_TOKEN_REFRESH_RETRY", processed: 0 };
  }
  const { data: cursor } = await writer
    .from("email_sync_cursors")
    .select("history_id_or_delta_token")
    .eq("email_connection_id", connection.id)
    .eq("provider", GMAIL_PROVIDER)
    .maybeSingle();
  const historyId = clean((cursor as { history_id_or_delta_token?: string | null } | null)?.history_id_or_delta_token);
  const url = historyId
    ? new URL("https://gmail.googleapis.com/gmail/v1/users/me/history")
    : gmailLookbackUrl();
  if (historyId) {
    url.searchParams.set("startHistoryId", historyId);
    url.searchParams.set("historyTypes", "messageAdded");
  }
  const { response, data: result } = await providerFetchJson<GmailHistoryResponse>(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const kind = gmailFailureKind(response, result);
    if (kind === "invalid_cursor" && historyId) return recoverGmailHistoryCursor({ supabase: writer, connection, accessToken });
    if (kind === "auth") {
      await markGmailReauthorizationRequired(writer, connection.id);
      return { ok: false, error: "GMAIL_REAUTH_REQUIRED", processed: 0 };
    }
    return { ok: false, error: kind === "transient" ? "GMAIL_SYNC_RETRY" : "GMAIL_SYNC_FAILED", processed: 0 };
  }
  const messageIds = gmailMessageIds(result);
  const processed = await processGmailMessageIds({ supabase: writer, connection, accessToken, messageIds });
  const retryable = processed.retryable;
  if (retryable) {
    return { ok: false, error: "GMAIL_BOOKING_PROCESSING_RETRY", processed: messageIds.length };
  }
  if (processed.quarantined > 0) {
    console.warn("Roamly Gmail sync quarantined messages", { connectionId: connection.id, quarantined: processed.quarantined });
  }
  const nextCursor = result.historyId || historyId;
  const cursorSaved = await writer.from("email_sync_cursors").upsert(
    {
      email_connection_id: connection.id,
      provider: GMAIL_PROVIDER,
      history_id_or_delta_token: nextCursor || null,
      last_processed_at: new Date().toISOString()
    },
    { onConflict: "email_connection_id,provider" }
  );
  if (cursorSaved.error) return { ok: false, error: "GMAIL_CURSOR_CHECKPOINT_FAILED", processed: messageIds.length };
  const syncedAt = new Date().toISOString();
  const connectionSaved = await writer
    .from("email_connections")
    .update({ last_synced_at: syncedAt })
    .eq("id", connection.id)
    .eq("sync_lease_token", params.leaseToken);
  if (connectionSaved.error) return { ok: false, error: "GMAIL_SYNC_CHECKPOINT_FAILED", processed: messageIds.length };

  return {
    ok: true,
    error: null,
    processed: messageIds.length || (Array.isArray(result.history) ? result.history.length : 0),
    quarantined: processed.quarantined
  };
}

/**
 * Reconnect backfill: on reconnect, Gmail mail older than the history
 * cursor is invisible to the normal sync (history API only sees messages
 * added after the cursor), and renewing the watch then anchors "now",
 * burying it further. Before the watch cursor moves, this searches the
 * user's upcoming trip window for travel confirmations and feeds them
 * through the same message pipeline as a normal sync.
 *
 * Bounded and cursor-safe: at most EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC
 * messages, only mail in the window, and it never writes the sync
 * cursor or last_synced_at — the following sync/renew still anchors
 * "now". Re-processing a message is safe: message records upsert on
 * (email_connection_id, provider, provider_message_id).
 */
export async function backfillGmailTripWindow(params: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ ok: boolean; error: string | null; processed: number; skipped?: string; quarantined?: number }> {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { data: connectionData, error: connectionError } = await writer
    .from("email_connections")
    .select("*")
    .eq("user_id", params.userId)
    .eq("provider", GMAIL_PROVIDER)
    .neq("connection_status", "disconnected")
    .maybeSingle();
  if (connectionError || !connectionData) {
    return { ok: false, error: "GMAIL_NOT_CONNECTED", processed: 0 };
  }
  const connection = connectionData as EmailConnectionRecord;

  const today = new Date().toISOString().slice(0, 10);
  const { data: trips, error: tripsError } = await writer
    .from("roamly_trips")
    .select("start_date,end_date")
    .eq("user_id", params.userId)
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(20);
  if (tripsError) return { ok: false, error: "GMAIL_BACKFILL_TRIPS_FAILED", processed: 0 };
  const rows = (trips || []) as Array<{ start_date?: string | null; end_date?: string | null }>;
  const starts = rows.map((row) => row.start_date).filter((value): value is string => Boolean(value));
  const ends = rows.map((row) => row.end_date).filter((value): value is string => Boolean(value));
  if (!starts.length) return { ok: true, error: null, processed: 0, skipped: "no_upcoming_trips" };

  const formatGmailDate = (date: Date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  };
  const earliest = new Date(`${starts[0]}T00:00:00Z`);
  const after = new Date(earliest.getTime() - 30 * 24 * 60 * 60 * 1000);
  const latestEnd = ends.length ? ends[ends.length - 1] : starts[starts.length - 1];
  const before = new Date(`${latestEnd}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() + 1);

  let accessToken: string;
  try {
    accessToken = await accessTokenForConnection(writer, connection);
  } catch {
    // Do not mark anything here — the following sync owns reauth.
    return { ok: false, error: "GMAIL_BACKFILL_TOKEN_FAILED", processed: 0 };
  }

  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set(
    "q",
    `after:${formatGmailDate(after)} before:${formatGmailDate(before)} (confirmation OR reservation OR itinerary OR delayed OR cancelled OR changed OR voucher OR ticket OR Klook OR transport OR check-in)`
  );
  url.searchParams.set("maxResults", String(EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC));
  const { response, data } = await providerFetchJson<{ messages?: Array<{ id?: string }> }>(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return { ok: false, error: "GMAIL_BACKFILL_SEARCH_FAILED", processed: 0 };
  const messageIds = (data.messages || [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id));
  if (!messageIds.length) return { ok: true, error: null, processed: 0 };
  const processed = await processGmailMessageIds({ supabase: writer, connection, accessToken, messageIds });
  if (processed.retryable) return { ok: false, error: "GMAIL_BACKFILL_PROCESSING_RETRY", processed: processed.processed };
  return { ok: true, error: null, processed: processed.processed, quarantined: processed.quarantined };
}

export async function syncGmailConnection(params: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const lease = await claimEmailSync({ ...params, provider: GMAIL_PROVIDER });
  if (!lease) return { ok: true as const, skipped: true as const, reason: "SYNC_ALREADY_RUNNING", error: null, processed: 0 };
  let outcome: Awaited<ReturnType<typeof syncGmailConnectionUnlocked>> | null = null;
  try {
    outcome = await syncGmailConnectionUnlocked({ ...params, leaseToken: lease.token });
    return outcome;
  } finally {
    await releaseEmailSync({
      supabase: params.supabase,
      connectionId: lease.id,
      leaseToken: lease.token,
      ok: outcome?.ok ?? false,
      errorCode: outcome && !outcome.ok && typeof outcome.error === "string" ? outcome.error : null
    });
  }
}

async function syncOutlookConnectionUnlocked(params: {
  supabase: SupabaseClient;
  userId: string;
  leaseToken: string;
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
    : `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,bodyPreview&$top=${EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC}`;

  const { response, data: result } = await providerFetchJson<OutlookDeltaResponse>(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
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
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connection.id)
    .eq("sync_lease_token", params.leaseToken);

  return {
    ok: true,
    error: null,
    processed: Array.isArray(result.value) ? result.value.length : 0
  };
}

export async function syncOutlookConnection(params: {
  supabase: SupabaseClient;
  userId: string;
}) {
  const lease = await claimEmailSync({ ...params, provider: OUTLOOK_PROVIDER });
  if (!lease) return { ok: true as const, skipped: true as const, reason: "SYNC_ALREADY_RUNNING", error: null, processed: 0 };
  let outcome: Awaited<ReturnType<typeof syncOutlookConnectionUnlocked>> | null = null;
  try {
    outcome = await syncOutlookConnectionUnlocked({ ...params, leaseToken: lease.token });
    return outcome;
  } finally {
    await releaseEmailSync({ supabase: params.supabase, connectionId: lease.id, leaseToken: lease.token, ok: outcome?.ok ?? false });
  }
}
