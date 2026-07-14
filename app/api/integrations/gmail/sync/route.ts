import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { syncGmailConnection } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const result = await syncGmailConnection({ supabase: auth.supabase, userId: auth.user.id });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "We could not sync Gmail right now. Your saved trip is safe."
      },
      { status: 400 }
    );
  }
}
