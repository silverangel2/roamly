import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { listOperationsJobs } from "@/lib/roamly/opsStore";

export async function GET(request: Request) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  const limit = Number(new URL(request.url).searchParams.get("limit") || 50);
  const result = await listOperationsJobs(guard.admin, limit);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, jobs: result.jobs });
}
