import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { runOpsWorkerBatch } from "@/lib/roamly/opsWorker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { anyWorkPresent, countWorkRows } from "@/lib/roamly/workGate";
import { recordCronHeartbeat } from "@/lib/roamly/cronHeartbeat";

export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized operations worker endpoint." }, { status: 401 });
}

function configuredSecret() {
  return (process.env.CRON_SECRET || "").trim();
}

async function runBatch() {
  try {
    // EGRESS DIET (F2): work gate — the batch only ever executes
    // QUEUED jobs (LEVEL_3 verdict recording included), so when the
    // queue is empty skip the 100-row job list + locks scan. Fail
    // open on a count error or a missing admin client.
    const admin = createSupabaseAdminClient();
    if (admin) {
      const queued = await countWorkRows(admin, "roamly_ops_jobs", (query) =>
        query.eq("status", "QUEUED")
      );
      if (!anyWorkPresent([queued])) {
        await recordCronHeartbeat(admin, "roamly-ops-worker", true, { gated: true });
        return NextResponse.json(
          {
            ok: true,
            gated: true,
            reason: "no_queued_ops_jobs",
            processed: 0,
            completed: 0,
            failed: 0,
            skippedPolicy: 0,
            skippedLocked: 0,
            skippedOwnerApproval: 0,
            repairJobsCreated: 0,
            findingsCreated: 0,
            jobIds: []
          },
          { status: 200 }
        );
      }
    }
    const summary = await runOpsWorkerBatch();
    if (admin) await recordCronHeartbeat(admin, "roamly-ops-worker", true);
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
