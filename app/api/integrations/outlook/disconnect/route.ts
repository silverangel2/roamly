import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ ok: false, error: "Roamly supports Gmail connections only." }, { status: 410 });
}
