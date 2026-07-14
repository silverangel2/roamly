import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { approveCompanionRepairProposal } from "@/lib/roamly/companionRepairEngine";

type RouteContext = {
  params: Promise<{
    id: string;
    repairId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id, repairId } = await context.params;

  const result = await approveCompanionRepairProposal({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    repairProposalId: repairId
  });

  if (!result.ok) {
    const status =
      result.error === "REPAIR_PROPOSAL_NOT_FOUND"
        ? 404
        : result.error === "EXTERNAL_PAID_ACTION_NOT_ALLOWED"
          ? 409
          : 400;

    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
