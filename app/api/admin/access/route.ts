import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ROAMLY_ADMIN_COOKIE,
  createRoamlyAdminSession,
  isRoamlyAdminConfigured,
  roamlyAdminCookieOptions,
  verifyRoamlyAdminCode
} from "@/lib/roamly/adminAccess";
import {
  adminAccessActorHash,
  clearAdminAccessFailures,
  getAdminAccessLockout,
  recordAdminAccessFailure
} from "@/lib/roamly/adminAccessRateLimit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// P1-1: per-IP rate limiting — 5 failed attempts -> 15-minute lockout.
// Stage 5 (2026-11-11) added the shared-store layer this route's note
// always called for: lockout state now also lives in
// roamly_admin_access_rate_limits (migration 20261111000200 §1), keyed
// by an HMAC hash of the caller IP, so a guessing spread across
// serverless instances hits the same wall. The in-memory map remains
// as the same-instance fast path AND the fallback: when the store is
// unreachable or unconfigured the door degrades to exactly the
// pre-Stage-5 memory-only posture — never weaker, and a database
// outage can never lock the owner out of his own recovery door.
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

type SharedLockoutStore = { admin: SupabaseClient; actorHash: string };

function sharedLockoutStore(request: NextRequest): SharedLockoutStore | null {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate = forwarded ? forwarded.split(",")[0]?.trim() || "" : "";
  const realIp = request.headers.get("x-real-ip")?.trim() || "";
  const ip = isIP(candidate) ? candidate : isIP(realIp) ? realIp : "";
  const actorHash = ip ? adminAccessActorHash(ip, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
  return actorHash ? { admin, actorHash } : null;
}

async function sharedLockoutRemainingMs(store: SharedLockoutStore | null) {
  if (!store) return 0;
  const lockout = await getAdminAccessLockout(store.admin, store.actorHash);
  if (!lockout.ok || !lockout.locked) return 0;
  return lockout.retryAfterSeconds * 1000;
}

export async function POST(request: NextRequest) {
  if (!isRoamlyAdminConfigured()) {
    return NextResponse.redirect(
      new URL("/admin-access?error=setup", request.url),
      303
    );
  }

  const ip = clientIp(request);
  const store = sharedLockoutStore(request);
  const remaining = Math.max(lockoutRemainingMs(ip), await sharedLockoutRemainingMs(store));
  if (remaining > 0) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(remaining / 1000)) }
      }
    );
  }

  // Empty/invalid body (consolidation 2026-11-06, Block H): an
  // empty JSON POST used to throw inside formData() and surface
  // as a bare 500. An unparseable submission is a client error —
  // a clean 400 that names what was expected.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a form submission carrying the admin code." },
      { status: 400 }
    );
  }

  const password = String(form.get("password") || "");

  const valid = await verifyRoamlyAdminCode(password);

  if (!valid) {
    const entry = failedAttempts.get(ip) || { fails: 0, lockedUntil: 0 };
    entry.fails += 1;
    if (entry.fails >= MAX_FAILED_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
    failedAttempts.set(ip, entry);
    if (store) {
      await recordAdminAccessFailure(store.admin, store.actorHash, MAX_FAILED_ATTEMPTS, LOCKOUT_MS / 1000);
    }
    return NextResponse.redirect(
      new URL("/admin-access?error=invalid", request.url),
      303
    );
  }

  failedAttempts.delete(ip);
  if (store) {
    await clearAdminAccessFailures(store.admin, store.actorHash);
  }

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
