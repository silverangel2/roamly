import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: false, error: "Roamly supports Gmail webhooks only." }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "Roamly supports Gmail webhooks only." }, { status: 410 });
}
