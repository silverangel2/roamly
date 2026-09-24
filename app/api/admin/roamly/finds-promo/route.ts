import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { normalizeFindsPromoInput, readFindsPromoSetting, saveFindsPromo } from "@/lib/roamly/findsPromoStore";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ...(await readFindsPromoSetting()) });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;
  const promo = normalizeFindsPromoInput(await request.json().catch(() => null));
  if (!promo) return NextResponse.json({ ok: false, error: "Enter a valid HTTPS promo with copy and destination." }, { status: 400 });
  const result = await saveFindsPromo(promo);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
