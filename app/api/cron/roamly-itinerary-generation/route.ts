import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGenerationWorkerSecrets } from "@/lib/roamly/stagedGenerationBackground";
import { processGenerationQueue } from "@/lib/roamly/generationWorker";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secrets = getGenerationWorkerSecrets();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(token && secrets.includes(token));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId.trim() : "";
  const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId : randomUUID();
  const reason = typeof body.reason === "string" ? body.reason : "protected_worker_wake";

  const summary = await processGenerationQueue({
    tripId: tripId || null,
    requestId,
    reason,
    config: tripId
      ? {
          batchSize: 3,
          concurrency: 1,
          maxLayersPerRun: 4
        }
      : undefined
  });

  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const requestId = randomUUID();
  const summary = await processGenerationQueue({
    requestId,
    reason: "vercel_cron_wake"
  });

  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
