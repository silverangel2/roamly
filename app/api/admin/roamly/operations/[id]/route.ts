import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { getOperationsJob } from "@/lib/roamly/opsStore";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const result = await getOperationsJob(guard.admin, id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "JOB_NOT_FOUND" ? 404 : 500 });
  return NextResponse.json({ ok: true, ...result.detail });
}
