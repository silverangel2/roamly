import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("email_connections")
    .select("provider,email_address,connection_status,last_synced_at,disconnected_at,updated_at")
    .eq("user_id", auth.user.id)
    .eq("provider", "gmail")
    .order("provider", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: "Email connection status is temporarily unavailable." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  // Autosync: failure detail for display only. Best-effort on purpose —
  // the columns arrive with migration 20261025_roamly_email_sync_failure_
  // columns, and a not-yet-applied migration must never break this route.
  const rows = (data || []) as Array<Record<string, unknown>>;
  let failureByProvider = new Map<string, { last_sync_error_code: string | null; last_sync_failed_at: string | null }>();
  try {
    const failureResult = await auth.supabase
      .from("email_connections")
      .select("provider,last_sync_error_code,last_sync_failed_at")
      .eq("user_id", auth.user.id)
      .eq("provider", "gmail");
    if (!failureResult.error) {
      failureByProvider = new Map(
        ((failureResult.data || []) as Array<{ provider?: unknown; last_sync_error_code?: string | null; last_sync_failed_at?: string | null }>).map((row) => [
          String(row.provider || ""),
          { last_sync_error_code: row.last_sync_error_code ?? null, last_sync_failed_at: row.last_sync_failed_at ?? null }
        ])
      );
    }
  } catch {
    failureByProvider = new Map();
  }
  const connections = rows.map((row) => ({
    ...row,
    ...(failureByProvider.get(String(row.provider || "")) || {})
  }));
  return NextResponse.json({ ok: true, connections }, { headers: { "Cache-Control": "private, no-store" } });
}
