import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

type RouteContext = {
  params: Promise<{
    id: string;
    repairId: string;
  }>;
};

export async function POST(
  _request: Request,
  context: RouteContext
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id, repairId } = await context.params;

  const existing = await auth.supabase
    .from("companion_repair_proposals")
    .select("id,status")
    .eq("id", repairId)
    .eq("trip_id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json(
      {
        ok: false,
        error: existing.error.message
      },
      { status: 500 }
    );
  }

  if (!existing.data) {
    return NextResponse.json(
      {
        ok: false,
        error: "REPAIR_PROPOSAL_NOT_FOUND"
      },
      { status: 404 }
    );
  }

  if (
    ["applied", "approved", "completed"].includes(
      existing.data.status
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "APPLIED_REPAIR_CANNOT_BE_REJECTED"
      },
      { status: 409 }
    );
  }

  const result = await auth.supabase
    .from("companion_repair_proposals")
    .update({
      status: "rejected"
    })
    .eq("id", repairId)
    .eq("trip_id", id)
    .eq("user_id", auth.user.id)
    .select("*")
    .single();

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    repair: result.data
  });
}
