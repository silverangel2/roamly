import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { sendStagedGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function emailKind(value: string) {
  if (value === "failure" || value === "itinerary_generation_failure") return "failure" as const;
  return "completion" as const;
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const logId = getString(body.logId);
  let tripId = getString(body.tripId);
  let kind = emailKind(getString(body.kind));

  if (logId && uuidPattern.test(logId)) {
    const { data, error } = await guard.admin
      .from("roamly_email_logs")
      .select("trip_id,template,metadata")
      .eq("id", logId)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    tripId = getString(data?.trip_id) || tripId;
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
    kind = emailKind(getString(data?.template) || getString(metadata.type));
  }

  if (!uuidPattern.test(tripId)) {
    return NextResponse.json({ ok: false, error: "A valid related trip ID is required for retry." }, { status: 400 });
  }

  const result = await sendStagedGenerationEmail({ tripId, kind });
  return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : result.status === "skipped" ? 202 : 400 });
}
