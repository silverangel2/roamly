import { NextResponse } from "next/server";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";
import { processLiveCompanionTimeLifecycleForTrip } from "@/lib/roamly/liveCompanionLifecycle";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const auth = await requireUserOrFieldTest(id);
  if (!auth.ok) return auth.response;

  const result = await processLiveCompanionTimeLifecycleForTrip(id, auth.userId);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
