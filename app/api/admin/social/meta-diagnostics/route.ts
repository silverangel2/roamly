import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { runFacebookMetaVisibilityDiagnostic } from "@/lib/roamly/metaVisibilityDiagnostic";

export async function GET(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const brandValue = request.nextUrl.searchParams.get("brand") || "roamly";
  if (brandValue !== "roamly" && brandValue !== "reviewintel") {
    return NextResponse.json({ ok: false, error: "Unsupported Facebook brand." }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, diagnostic: await runFacebookMetaVisibilityDiagnostic(guard.admin, brandValue) });
  } catch {
    return NextResponse.json({ ok: false, error: "Meta visibility diagnosis failed safely." }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "GET-only diagnostic." }, { status: 405 });
}
