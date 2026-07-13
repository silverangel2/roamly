import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { getRoamlySocialEnvStatus, isSocialTableMissingError } from "@/lib/roamly/social";

function getString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("roamly_social_settings")
    .select("key,value,updated_at")
    .order("key", { ascending: true });

  if (error) {
    if (isSocialTableMissingError(error)) {
      return NextResponse.json({ ok: true, env: getRoamlySocialEnvStatus(), settings: [], tableReady: false });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, env: getRoamlySocialEnvStatus(), settings: data || [], tableReady: true });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const key = getString(body.key, 120);
  const value = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : {};

  if (!key) {
    return NextResponse.json({ ok: false, error: "Setting key is required." }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("roamly_social_settings")
    .upsert({ key, value, metadata: { updatedBy: guard.user.email || guard.user.id } }, { onConflict: "key" })
    .select("key,value,updated_at")
    .single();

  if (error) {
    if (isSocialTableMissingError(error)) {
      return NextResponse.json({ ok: false, error: "Roamly social settings table is not ready.", tableReady: false }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, setting: data, tableReady: true });
}
