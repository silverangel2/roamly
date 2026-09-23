import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getStoredRoamlyFacebookConnection,
  getRoamlyFacebookCredentialsForPosting
} from "@/lib/roamly/facebookConnector";

export const dynamic = "force-dynamic";

function fingerprint(value: string) {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : "NONE";
}

export async function GET() {
  const guard = await requireRoamlyAdmin();

  if (!guard.ok) {
    return guard.response;
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({
      ok: false,
      error: "SUPABASE_ADMIN_NOT_CONFIGURED"
    }, { status: 500 });
  }

  const debugProvider = `facebook_debug_${randomUUID()}`;

  const { data: inserted, error: insertError } = await admin
    .from("social_connections")
    .insert({
      provider: debugProvider,
      account_id: "debug",
      account_name: "Facebook persistence test",
      access_token: "debug-token",
      token_type: "bearer",
      expires_at: null,
      scopes: [],
      metadata: { diagnostic: true },
      is_connected: true,
      updated_at: new Date().toISOString()
    })
    .select("id,provider,is_connected")
    .single();

  let readBack = null;
  let readError = null;

  if (!insertError) {
    const result = await admin
      .from("social_connections")
      .select("id,provider,is_connected")
      .eq("provider", debugProvider)
      .maybeSingle();

    readBack = result.data;
    readError = result.error;
  }

  await admin
    .from("social_connections")
    .delete()
    .eq("provider", debugProvider);

  const stored = await getStoredRoamlyFacebookConnection().catch(() => null);
  const posting = await getRoamlyFacebookCredentialsForPosting();

  return NextResponse.json({
    ok: true,

    persistenceTest: {
      insertSucceeded: !insertError && Boolean(inserted),
      insertError: insertError?.message || null,
      insertCode: insertError?.code || null,
      readBackSucceeded: !readError && Boolean(readBack),
      readBackError: readError?.message || null
    },

    facebook: {
      storedConnectionExists: Boolean(stored),
      storedPageId: stored?.pageId || null,
      storedPageName: stored?.pageName || null,
      storedFingerprint: fingerprint(stored?.accessToken || ""),
      postingSource: posting.source,
      postingPageId: posting.pageId || null,
      postingFingerprint: fingerprint(posting.accessToken || ""),
      envFingerprint: fingerprint(
        process.env.ROAMLY_META_ACCESS_TOKEN?.trim() || ""
      )
    }
  }, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
