import type { SupabaseClient } from "@supabase/supabase-js";
import { getRoamlyFacebookCredentialsForPosting } from "@/lib/roamly/facebookConnector";

type GraphRecord = Record<string, unknown>;

export type MetaDiagnosticStatus = "PROVEN" | "RULED_OUT" | "NOT_EXPOSED";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeMessage(value: unknown) {
  return text(value)
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/access_token\s*[=:]\s*[^&\s]+/gi, "access_token=[redacted]")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1[redacted]")
    .slice(0, 500);
}

function safeError(response: Response, body: GraphRecord) {
  const graphError = body.error;
  if (graphError && typeof graphError === "object" && !Array.isArray(graphError)) {
    const item = graphError as GraphRecord;
    return {
      status: response.status,
      code: typeof item.code === "number" ? item.code : null,
      subcode: typeof item.error_subcode === "number" ? item.error_subcode : null,
      message: safeMessage(item.message) || `Meta returned HTTP ${response.status}.`
    };
  }
  return { status: response.status, code: null, subcode: null, message: `Meta returned HTTP ${response.status}.` };
}

async function graphGet<T extends GraphRecord>(input: {
  graphVersion: string;
  path: string;
  token: string;
  params?: Record<string, string>;
}) {
  const url = new URL(`https://graph.facebook.com/${input.graphVersion}/${input.path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(input.params || {})) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set("access_token", input.token);
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || body.error) {
    return { ok: false as const, body, error: safeError(response, body) };
  }
  return { ok: true as const, body, error: null };
}

function supportedReelFields(body: GraphRecord, fallbackId: string) {
  return {
    exists: Boolean(body.id || fallbackId),
    id: text(body.id) || fallbackId || null,
    is_reel: typeof body.is_reel === "boolean" ? body.is_reel : null,
    media_type: text(body.media_type) || null,
    status: "NOT_EXPOSED_BY_META_API",
    permalink_url: text(body.permalink_url) || null,
    created_time: text(body.created_time) || null,
  };
}

async function pageVideoMembership(input: { graphVersion: string; pageId: string; token: string; objectId: string }) {
  const collection = await graphGet<GraphRecord>({
    graphVersion: input.graphVersion,
    path: `${input.pageId}/videos`,
    token: input.token,
    params: { fields: "id,permalink_url,media_type,is_reel,created_time", limit: "100" }
  });
  const rows = Array.isArray(collection.body.data) ? collection.body.data : [];
  return {
    endpoint: `/${input.pageId}/videos`,
    lookup: collection.ok ? "PROVEN" : "NOT_EXPOSED",
    contains_object: collection.ok ? rows.some((item) => text((item as GraphRecord)?.id) === input.objectId) : null,
    returned_count: collection.ok ? rows.length : null,
    error: collection.ok ? null : collection.error
  };
}

function tokenSummary(input: { pageLookup: ReturnType<typeof safeError> | null; expiresAt?: string | null }) {
  return {
    valid: input.pageLookup === null ? true : false,
    type: "NOT_EXPOSED_BY_META_API",
    expires_at: input.expiresAt || null,
    note: input.pageLookup === null ? "Page-token lookup succeeded." : input.pageLookup.message
  };
}

function appSummary(appId: string) {
  return {
    configured_id: Boolean(appId),
    id: appId || null,
    mode: "NOT_EXPOSED_BY_META_API",
    status: "NOT_EXPOSED_BY_META_API"
  };
}

function restrictionsSummary() {
  return {
    page_publication_state: "NOT_EXPOSED_BY_META_API",
    age_restrictions: "NOT_EXPOSED_BY_META_API",
    country_restrictions: "NOT_EXPOSED_BY_META_API",
    page_quality: "NOT_EXPOSED_BY_META_API",
    distribution_restrictions: "NOT_EXPOSED_BY_META_API"
  };
}

export async function runRoamlyMetaVisibilityDiagnostic(admin: SupabaseClient) {
  const credentials = await getRoamlyFacebookCredentialsForPosting();
  const graphVersion = (process.env.ROAMLY_META_GRAPH_VERSION || "v23.0").trim() || "v23.0";
  const appId = (process.env.ROAMLY_META_APP_ID || "").trim();
  const pageId = credentials.pageId.trim();

  let storedConnection: { expires_at?: string | null; scopes?: unknown } | null = null;
  if (credentials.source === "connected-facebook-oauth") {
    const stored = await admin
      .from("social_connections")
      .select("expires_at,scopes")
      .eq("provider", "facebook")
      .maybeSingle();
    storedConnection = (stored.data as { expires_at?: string | null; scopes?: unknown } | null) || null;
  }

  if (!pageId || !credentials.accessToken) {
    return {
      product: "roamly",
      graph_version: graphVersion,
      page: { configured_id: pageId || null, actual_id: null, name: null, configured_id_matches_meta: null, lookup: "NOT_EXPOSED" },
      token: { valid: false, type: "NOT_EXPOSED_BY_META_API", expires_at: storedConnection?.expires_at || null, note: "Server-side Page credentials are incomplete." },
      permissions: { configured_scopes: Array.isArray(storedConnection?.scopes) ? storedConnection?.scopes : [], actual_tasks: "NOT_EXPOSED_BY_META_API" },
      app: appSummary(appId),
      reel: null,
      restrictions: restrictionsSummary(),
      errors: [{ code: "CREDENTIALS_INCOMPLETE", message: "Server-side Page credentials are incomplete." }]
    };
  }

  const page = await graphGet<GraphRecord>({ graphVersion, path: pageId, token: credentials.accessToken, params: { fields: "id,name,link" } });
  const actualPageId = text(page.body.id);
  const pageLookupError = page.ok ? null : page.error;

  const queue = await admin
    .from("roamly_social_queue")
    .select("id,platform,facebook_reel_id,facebook_media_id,facebook_url,published_at,metadata")
    .in("platform", ["facebook", "facebook_roamly"])
    .not("facebook_reel_id", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const row = queue.data as GraphRecord | null;
  const objectId = text(row?.facebook_reel_id) || text(row?.facebook_media_id);
  const reel = objectId
    ? await graphGet<GraphRecord>({
        graphVersion,
        path: objectId,
        token: credentials.accessToken,
        params: { fields: "id,permalink_url,media_type,is_reel,created_time" }
      })
    : null;
  const pageVideos = objectId && page.ok
    ? await pageVideoMembership({ graphVersion, pageId, token: credentials.accessToken, objectId })
    : null;

  return {
    product: "roamly",
    graph_version: graphVersion,
    page: {
      configured_id: pageId,
      actual_id: actualPageId || null,
      name: text(page.body.name) || null,
      link: text(page.body.link) || null,
      configured_id_matches_meta: page.ok ? actualPageId === pageId : null,
      lookup: page.ok ? "PROVEN" : "NOT_EXPOSED"
    },
    token: tokenSummary({ pageLookup: pageLookupError, expiresAt: storedConnection?.expires_at }),
    permissions: {
      configured_scopes: Array.isArray(storedConnection?.scopes) ? storedConnection?.scopes : [],
      actual_tasks: "NOT_EXPOSED_BY_META_API",
      required_for_reels: "NOT_EXPOSED_BY_META_API"
    },
    app: appSummary(appId),
    reel: {
      internal_record_id: text(row?.id) || null,
      meta_object_id: objectId || null,
      lookup: reel ? (reel.ok ? "PROVEN" : "NOT_EXPOSED") : "NOT_EXPOSED",
      ...(reel ? supportedReelFields(reel.body, objectId) : { exists: false, id: null, is_reel: null, media_type: null, status: "NOT_EXPOSED_BY_META_API", permalink_url: null, created_time: null })
    },
    page_media: pageVideos,
    restrictions: restrictionsSummary(),
    errors: [pageLookupError, reel && !reel.ok ? reel.error : null].filter(Boolean)
  };
}
