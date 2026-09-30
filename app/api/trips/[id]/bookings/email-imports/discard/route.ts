import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Discards an email-import suggestion. The original email is untouched; only
 * the extracted suggestion is removed so it stops appearing for review.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  await context.params;

  const body = await request.json().catch(() => null);
  const extractionId =
    body && typeof body === "object" && typeof body.extractionId === "string" ? body.extractionId : "";
  if (!extractionId) {
    return NextResponse.json({ ok: false, error: "Choose an import to discard." }, { status: 400 });
  }

  const { data: row, error: lookupError } = await auth.supabase
    .from("booking_extraction_results")
    .select("id,match_status")
    .eq("id", extractionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (lookupError || !row) {
    return NextResponse.json({ ok: false, error: "That import could not be found." }, { status: 404 });
  }

  const { error: deleteError } = await auth.supabase
    .from("booking_extraction_results")
    .delete()
    .eq("id", extractionId)
    .eq("user_id", auth.user.id);

  if (deleteError) {
    return NextResponse.json({ ok: false, error: "We could not discard that import." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
