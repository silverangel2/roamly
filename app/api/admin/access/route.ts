import { NextRequest, NextResponse } from "next/server";
import {
  ROAMLY_ADMIN_COOKIE,
  createRoamlyAdminSession,
  isRoamlyAdminConfigured,
  roamlyAdminCookieOptions,
  verifyRoamlyAdminCode
} from "@/lib/roamly/adminAccess";

// P1-1: in-memory per-IP rate limiting — 5 failed attempts -> 15-minute lockout.
// NOTE: serverless instances do not share this memory, so a distributed
// brute-force spread across instances is not fully stopped. For a durable
// lockout, move this state to a shared store (Supabase / Upstash).
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { fails: number; lockedUntil: number }>();

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function lockoutRemainingMs(key: string) {
  const entry = failedAttempts.get(key);
  if (!entry || entry.fails < MAX_FAILED_ATTEMPTS) return 0;
  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) {
    failedAttempts.delete(key);
    return 0;
  }
  return remaining;
}

export async function POST(request: NextRequest) {
  if (!isRoamlyAdminConfigured()) {
    return NextResponse.redirect(
      new URL("/admin-access?error=setup", request.url),
      303
    );
  }

  const ip = clientIp(request);
  const remaining = lockoutRemainingMs(ip);
  if (remaining > 0) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(remaining / 1000)) }
      }
    );
  }

  const form = await request.formData();

  const password = String(form.get("password") || "");

  const valid = await verifyRoamlyAdminCode(password);

  if (!valid) {
    const entry = failedAttempts.get(ip) || { fails: 0, lockedUntil: 0 };
    entry.fails += 1;
    if (entry.fails >= MAX_FAILED_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
    failedAttempts.set(ip, entry);
    return NextResponse.redirect(
      new URL("/admin-access?error=invalid", request.url),
      303
    );
  }

  failedAttempts.delete(ip);

  const session = await createRoamlyAdminSession();

  const response = NextResponse.redirect(
    new URL("/admin", request.url),
    303
  );

  response.cookies.set(
    ROAMLY_ADMIN_COOKIE,
    session.value,
    roamlyAdminCookieOptions(session.maxAge)
  );

  return response;
}
