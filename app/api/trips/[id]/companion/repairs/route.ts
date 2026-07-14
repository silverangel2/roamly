import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { createCompanionRepairProposal } from "@/lib/roamly/companionRepairEngine";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let body: { companionEventId?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  if (!body.companionEventId) {
    return NextResponse.json(
      { ok: false, error: "COMPANION_EVENT_ID_REQUIRED" },
      { status: 400 }
    );
  }

  const result = await createCompanionRepairProposal({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    companionEventId: body.companionEventId
  });

  if (!result.ok) {
    const status =
      result.error === "COMPANION_EVENT_NOT_FOUND" ||
      result.error === "IMPACT_ANALYSIS_NOT_FOUND"
        ? 404
        : 400;

    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
