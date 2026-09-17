import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { runRoamlyMetaVisibilityDiagnostic } from "@/lib/roamly/metaVisibilityDiagnostic";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  try {
    return NextResponse.json({ ok: true, diagnostic: await runRoamlyMetaVisibilityDiagnostic(guard.admin) });
  } catch {
    return NextResponse.json({ ok: false, error: "Meta visibility diagnosis failed safely." }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "GET-only diagnostic." }, { status: 405 });
}
