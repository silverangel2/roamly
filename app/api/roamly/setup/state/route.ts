import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getRoamlySetupState } from "@/lib/roamly/setupState";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const state = await getRoamlySetupState(auth.supabase, auth.user);
  return NextResponse.json(
    { ok: true, state },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
