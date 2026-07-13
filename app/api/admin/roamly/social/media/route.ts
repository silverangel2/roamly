import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

function getString(value: unknown, maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = getString(body.id);
  const action = getString(body.action);

  if (!id || !action) return NextResponse.json({ ok: false, error: "Media ID and action are required." }, { status: 400 });

  const updates =
    action === "approve"
      ? { status: "approved", approved_for_automation: true, excluded_from_automation: false, archived_at: null }
      : action === "reject"
        ? { status: "rejected", approved_for_automation: false, excluded_from_automation: true }
        : action === "archive"
          ? { status: "archived", approved_for_automation: false, excluded_from_automation: true, archived_at: new Date().toISOString() }
          : action === "exclude"
            ? { excluded_from_automation: true, approved_for_automation: false }
            : action === "include"
              ? { excluded_from_automation: false }
              : null;

  if (!updates) return NextResponse.json({ ok: false, error: "Unsupported media action." }, { status: 400 });

  const { data, error } = await guard.admin
    .from("roamly_social_media_assets")
    .update(updates)
    .eq("id", id)
    .select("id,status,approved_for_automation,excluded_from_automation")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await guard.admin.from("roamly_admin_activity_logs").insert({
    actor_email: guard.user.email || guard.user.id,
    action: `media_${action}`,
    target_type: "social_media_asset",
    target_id: id,
    status: "completed",
    metadata: {}
  });

  return NextResponse.json({ ok: true, media: data });
}
