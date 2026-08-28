import { NextRequest, NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";

export async function GET(request: NextRequest) {
  const valid = await verifyRoamlyAdminSessionValue(
    request.cookies.get(ROAMLY_ADMIN_COOKIE)?.value
  );

  return NextResponse.json(
    { ok: valid },
    {
      status: valid ? 200 : 401,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
