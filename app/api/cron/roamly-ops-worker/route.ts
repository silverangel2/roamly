import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { runOpsWorkerBatch } from "@/lib/roamly/opsWorker";

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized operations worker endpoint." }, { status: 401 });
}

function configuredSecret() {
  return (process.env.CRON_SECRET || "").trim();
}

async function runBatch() {
  try {
    const summary = await runOpsWorkerBatch();
    return NextResponse.json({ ok: true, ...summary }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "Operations worker batch failed." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Operations worker secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return unauthorized();
  return runBatch();
}

export async function GET(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Operations worker secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return unauthorized();
  return runBatch();
}
