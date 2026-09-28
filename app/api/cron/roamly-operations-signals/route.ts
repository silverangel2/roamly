import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { enqueueOperationsJob } from "@/lib/roamly/opsStore";
import { normalizeOperationsSignal, scheduleSignal, triageOperationsSignal, type SignalEnvelope } from "@/lib/roamly/operationsSignals";

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized operations signal endpoint." }, { status: 401 });
}

function configuredSecret() {
  return (process.env.CRON_SECRET || "").trim();
}

async function persistTriage(signal: SignalEnvelope) {
  const processed = triageOperationsSignal(signal, undefined, Date.now(), true);
  if (!processed.decision.accepted || !processed.decision.job) {
    return { ok: true, accepted: false, suppressed: processed.suppressed, reason: processed.reason };
  }
  const stored = await enqueueOperationsJob(processed.decision.job);
  if (!stored.ok && !stored.duplicate) return { ok: false, accepted: false, suppressed: false, reason: stored.error };
  return { ok: true, accepted: stored.ok, suppressed: stored.duplicate, reason: stored.duplicate ? stored.error : processed.reason, jobId: stored.ok ? stored.jobId : undefined };
}

export async function POST(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Operations signal secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return unauthorized();
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 32_000) return NextResponse.json({ ok: false, error: "Signal payload too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid signal JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "Signal object required." }, { status: 400 });
  const normalized = normalizeOperationsSignal(body as Parameters<typeof normalizeOperationsSignal>[0]);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  const result = await persistTriage(normalized.signal);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export async function GET(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "Operations signal secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return unauthorized();
  // Vercel Cron authenticates with Authorization but does not send a custom
  // schedule header. This endpoint is intentionally bound to the first
  // production schedule until separately secured endpoints are introduced.
  const scheduleId = request.headers.get("x-roamly-schedule-id")?.trim() || "gap_audit_daily";
  if (scheduleId !== "gap_audit_daily") {
    return NextResponse.json({ ok: false, error: "Schedule is not active." }, { status: 400 });
  }
  const normalized = scheduleSignal(scheduleId);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  const result = await persistTriage(normalized.signal);
  return NextResponse.json({ ...result, scheduleId }, { status: result.ok ? 200 : 503 });
}
