import { NextRequest, NextResponse } from "next/server";
import { isRoamlyConfiguredTesterEmail } from "@/lib/roamly/access";

function cleanEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = cleanEmail(body.email);

  if (!email) {
    return NextResponse.json({ ok: false, isTesterEmail: false }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    isTesterEmail: isRoamlyConfiguredTesterEmail(email)
  });
}
