import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  claimedDailyTestRecord,
  dailyTestProvisioningEnabled,
  verifyDailyTestClaim,
  type DailyTestClaimRecord
} from "@/lib/roamly/dailyTestClaim";

export const runtime = "nodejs";

/*
 * Claim exchange for the daily-test account.
 *
 * This route is deliberately NOT admin-cookie gated: the one-time claim
 * code issued by the provisioning route is the capability. It IS gated
 * by the same provisioning flag (off -> 404). The VM automation calls it
 * directly over TLS and receives the account password exactly once, in
 * this response only. Every rejection is the same generic 403 so the
 * route is not an oracle for which check failed.
 */

// In-memory per-IP rate limiting, mirroring /api/admin/access: 5 failed
// attempts -> 15-minute lockout. NOTE: serverless instances do not share
// this memory, so a distributed brute-force spread across instances is
// not fully stopped; the claim code's 192-bit entropy and 15-minute life
// are the primary defenses.
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

function recordFailure(key: string) {
  const entry = failedAttempts.get(key) || { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  failedAttempts.set(key, entry);
}

async function findUser(admin: SupabaseClient, email: string, userId: string) {
  const targetEmail = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { user: null, error };
    const match =
      data.users.find((candidate) =>
        userId
          ? candidate.id === userId
          : String(candidate.email || "").trim().toLowerCase() === targetEmail
      ) || null;
    if (match) return { user: match, error: null };
    if (data.users.length < 1000) break;
  }
  return { user: null, error: null };
}

function rejected() {
  return NextResponse.json({ ok: false, error: "CLAIM_REJECTED" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!dailyTestProvisioningEnabled()) {
    return NextResponse.json({ ok: false, error: "DAILY_TEST_PROVISIONING_DISABLED" }, { status: 404 });
  }

  const ip = clientIp(request);
  const remaining = lockoutRemainingMs(ip);
  if (remaining > 0) {
    return NextResponse.json(
      { ok: false, error: "CLAIM_REJECTED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(remaining / 1000)) } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const claimCode = typeof body.claimCode === "string" ? body.claimCode : "";
  const email = typeof body.email === "string" ? body.email : "";
  const userId = typeof body.userId === "string" ? body.userId : "";

  if (!claimCode || (!email && !userId)) {
    recordFailure(ip);
    return rejected();
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "SUPABASE_ADMIN_NOT_CONFIGURED" }, { status: 500 });
  }

  const found = await findUser(admin, email, userId);
  if (found.error) {
    console.error("[Roamly daily test] Claim user lookup failed", { error: found.error.message });
    return NextResponse.json({ ok: false, error: "CLAIM_LOOKUP_FAILED" }, { status: 500 });
  }

  const user: User | null = found.user;
  const record = user?.user_metadata?.daily_test_claim as DailyTestClaimRecord | undefined;
  const password = user ? verifyDailyTestClaim(record, claimCode, user.id) : null;

  if (!user || !record || password === null) {
    recordFailure(ip);
    return rejected();
  }

  // Burn the claim BEFORE returning the password: mark it claimed and
  // wipe the cipher from metadata. If the wipe fails, the password is
  // not returned — the code stays live until expiry and the caller can
  // retry; a fresh provisioning run rotates everything anyway.
  const wiped = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata || {}),
      daily_test_claim: claimedDailyTestRecord(record)
    }
  });
  if (wiped.error) {
    console.error("[Roamly daily test] Claim burn failed", { error: wiped.error.message });
    return NextResponse.json({ ok: false, error: "CLAIM_BURN_FAILED" }, { status: 500 });
  }

  failedAttempts.delete(ip);
  console.info("[Roamly daily test] Claim redeemed", { email: user.email, userId: user.id });

  return NextResponse.json({ ok: true, userId: user.id, email: user.email, password });
}
