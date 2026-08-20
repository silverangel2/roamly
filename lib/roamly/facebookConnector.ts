import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const GRAPH_BASE = "https://graph.facebook.com/v23.0";

export const ROAMLY_FACEBOOK_STATE_COOKIE = "roamly_facebook_oauth_state";

export function getRoamlyFacebookScopes() {
  return [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "business_management"
  ];
}

export function getRoamlyFacebookOAuthConfig() {
  const appId = process.env.ROAMLY_META_APP_ID?.trim() || "";
  const appSecret = process.env.ROAMLY_META_APP_SECRET?.trim() || "";

  const redirectUri =
    process.env.ROAMLY_META_REDIRECT_URI?.trim() ||
    `${
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      "https://roamlyhq.com"
    }/api/auth/facebook/callback`;

  if (!appId) {
    throw new Error("ROAMLY_META_APP_ID is not configured.");
  }

  if (!appSecret) {
    throw new Error("ROAMLY_META_APP_SECRET is not configured.");
  }

  return {
    appId,
    appSecret,
    redirectUri
  };
}

export function buildRoamlyFacebookAuthorizationUrl(state: string) {
  const config = getRoamlyFacebookOAuthConfig();

  const url = new URL("https://www.facebook.com/v23.0/dialog/oauth");

  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", getRoamlyFacebookScopes().join(","));
  url.searchParams.set("response_type", "code");

  return url.toString();
}

export async function exchangeRoamlyFacebookCodeForUserToken(code: string) {
  const config = getRoamlyFacebookOAuthConfig();

  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);

  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data?.error?.message || "Facebook authorization code exchange failed."
    );
  }

  return data as {
    access_token: string;
    token_type?: string;
    expires_in?: number;
  };
}

export async function exchangeForLongLivedRoamlyFacebookToken(
  shortLivedUserToken: string
) {
  const config = getRoamlyFacebookOAuthConfig();

  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);

  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedUserToken);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data?.error?.message ||
        "Facebook long-lived user-token exchange failed."
    );
  }

  return data as {
    access_token: string;
    token_type?: string;
    expires_in?: number;
  };
}

export async function getRoamlyFacebookPages(userAccessToken: string) {
  const url = new URL(`${GRAPH_BASE}/me/accounts`);

  url.searchParams.set(
    "fields",
    "id,name,access_token,tasks"
  );

  url.searchParams.set("access_token", userAccessToken);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Could not retrieve Facebook Pages."
    );
  }

  return Array.isArray(data.data)
    ? (data.data as Array<{
        id: string;
        name?: string;
        access_token?: string;
        tasks?: string[];
      }>)
    : [];
}

export async function verifyRoamlyFacebookPageToken(
  pageId: string,
  pageAccessToken: string
) {
  const url = new URL(`${GRAPH_BASE}/${pageId}`);

  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url.toString(), {
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Facebook Page token verification failed."
    );
  }

  return data as {
    id: string;
    name?: string;
  };
}

export async function storeRoamlyFacebookConnection(input: {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data, error } = await admin
    .from("social_connections")
    .upsert(
      {
        provider: "facebook",
        account_id: input.pageId,
        account_name: input.pageName,
        access_token: input.pageAccessToken,
        token_type: "bearer",
        expires_at: null,
        scopes: input.scopes || getRoamlyFacebookScopes(),
        metadata: input.metadata || {},
        is_connected: true,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "provider"
      }
    )
    .select(
      "provider,account_id,account_name,access_token,is_connected,updated_at"
    )
    .single();

  if (error) {
    throw new Error(
      `Could not save Facebook connection: ${error.message}`
    );
  }

  if (
    !data ||
    data.provider !== "facebook" ||
    !data.is_connected ||
    data.account_id !== input.pageId ||
    !data.access_token ||
    data.access_token !== input.pageAccessToken
  ) {
    throw new Error(
      "Facebook connection save verification failed."
    );
  }

  const { data: verifiedConnection, error: verifyError } = await admin
    .from("social_connections")
    .select(
      "provider,account_id,account_name,access_token,is_connected,updated_at"
    )
    .eq("provider", "facebook")
    .maybeSingle();

  if (verifyError) {
    throw new Error(
      `Could not verify saved Facebook connection: ${verifyError.message}`
    );
  }

  if (
    !verifiedConnection ||
    !verifiedConnection.is_connected ||
    verifiedConnection.account_id !== input.pageId ||
    !verifiedConnection.access_token ||
    verifiedConnection.access_token !== input.pageAccessToken
  ) {
    throw new Error(
      "Facebook connection was not persisted after saving."
    );
  }

  return {
    pageId: verifiedConnection.account_id,
    pageName: verifiedConnection.account_name,
    connected: true
  };
}

export async function getStoredRoamlyFacebookConnection() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { data, error } = await admin
    .from("social_connections")
    .select(
      "account_id,account_name,access_token,expires_at,is_connected"
    )
    .eq("provider", "facebook")
    .eq("is_connected", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not read Facebook connection: ${error.message}`
    );
  }

  if (!data?.access_token) {
    return null;
  }

  return {
    pageId: String(data.account_id || ""),
    pageName: String(data.account_name || ""),
    accessToken: String(data.access_token),
    expiresAt: data.expires_at
      ? String(data.expires_at)
      : null
  };
}

export async function disconnectRoamlyFacebookConnection() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const { error } = await admin
    .from("social_connections")
    .update({
      is_connected: false,
      access_token: null,
      refresh_token: null,
      updated_at: new Date().toISOString()
    })
    .eq("provider", "facebook");

  if (error) {
    throw new Error(
      `Could not disconnect Facebook: ${error.message}`
    );
  }
}

export async function getRoamlyFacebookCredentialsForPosting() {
  const stored = await getStoredRoamlyFacebookConnection().catch(() => null);

  if (stored?.accessToken && stored.pageId) {
    return {
      accessToken: stored.accessToken,
      pageId: stored.pageId,
      source: "connected-facebook-oauth" as const
    };
  }

  /*
   * Temporary compatibility fallback.
   * Once Facebook is connected through OAuth, this is no longer used.
   */
  return {
    accessToken:
      process.env.ROAMLY_META_ACCESS_TOKEN?.trim() || "",
    pageId:
      process.env.ROAMLY_META_PAGE_ID?.trim() || "",
    source: "env-fallback" as const
  };
}
