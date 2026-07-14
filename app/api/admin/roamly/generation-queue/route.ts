import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  adminCancelGenerationJob,
  adminRetryGenerationJob,
  getGenerationQueueHealth,
  listAdminGenerationQueue
} from "@/lib/roamly/generationScalability";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
  const [health, queue] = await Promise.all([
    getGenerationQueueHealth(guard.admin),
    listAdminGenerationQueue({ supabase: guard.admin, limit })
  ]);
  if (!health.ok) return NextResponse.json({ ok: false, error: health.error }, { status: 500 });
  if (!queue.ok) return NextResponse.json({ ok: false, error: queue.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    health: health.health,
    jobs: queue.jobs
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  const body = record(await request.json().catch(() => ({})));
  const action = typeof body.action === "string" ? body.action : "";
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  if (!jobId) return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });

  if (action === "retry") {
    const result = await adminRetryGenerationJob({ supabase: guard.admin, jobId, reason });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, job: result.job });
  }

  if (action === "cancel") {
    const result = await adminCancelGenerationJob({ supabase: guard.admin, jobId, reason });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, job: result.job });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
