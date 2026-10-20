import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  createDailyTestClaim,
  dailyTestProvisioningEnabled
} from "@/lib/roamly/dailyTestClaim";

export const runtime = "nodejs";

const DEFAULT_DAILY_TEST_EMAIL = "daily.checks@roamlyhq.com";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { user: null, error };
    const match =
      data.users.find((candidate) => String(candidate.email || "").trim().toLowerCase() === target) || null;
    if (match) return { user: match, error: null };
    if (data.users.length < 1000) break;
  }
  return { user: null, error: null };
}

export async function POST(request: NextRequest) {
  if (!dailyTestProvisioningEnabled()) {
    return NextResponse.json({ ok: false, error: "DAILY_TEST_PROVISIONING_DISABLED" }, { status: 404 });
  }

  const gate = await requireRoamlyAdmin();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requestedEmail = typeof body.email === "string" ? body.email.trim() : "";
  const email = (requestedEmail || (process.env.ROAMLY_DAILY_TEST_EMAIL || "").trim() || DEFAULT_DAILY_TEST_EMAIL).toLowerCase();

  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: "INVALID_TEST_EMAIL" }, { status: 400 });
  }

  const existing = await findUserByEmail(gate.admin, email);
  if (existing.error) {
    console.error("[Roamly daily test] Test user lookup failed", { email, error: existing.error.message });
    return NextResponse.json({ ok: false, error: "DAILY_TEST_USER_LOOKUP_FAILED" }, { status: 500 });
  }

  // The account password is generated fresh on every call and is NEVER
  // returned. The caller receives only a one-time claim code; the
  // password itself is stored encrypted under a key derived from that
  // code in the test user's metadata and is revealed exactly once, by
  // the claim route, to whoever presents the code within 15 minutes.
  // Password and claim code are never logged.
  const password = randomBytes(24).toString("base64url");

  if (existing.user) {
    // Rotation: an existing account gets a fresh password + a fresh
    // claim record. This is the designed remedy for a lost secret store:
    // re-running provisioning re-keys the account and issues a new code;
    // every previously issued code dies with the old record.
    const { claimCode, record } = createDailyTestClaim(password, existing.user.id);
    const updated = await gate.admin.auth.admin.updateUserById(existing.user.id, {
      password,
      user_metadata: {
        ...(existing.user.user_metadata || {}),
        daily_test: true,
        daily_test_claim: record
      }
    });
    if (updated.error || !updated.data.user) {
      console.error("[Roamly daily test] Test user rotation failed", { email, error: updated.error?.message });
      return NextResponse.json({ ok: false, error: "DAILY_TEST_USER_ROTATE_FAILED" }, { status: 500 });
    }
    console.info("[Roamly daily test] Test account rotated, claim issued", { email, userId: existing.user.id });
    return NextResponse.json({
      ok: true,
      created: false,
      rotated: true,
      userId: existing.user.id,
      email,
      claimCode,
      expiresAt: record.expiresAt
    });
  }

  const created = await gate.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { daily_test: true }
  });

  if (created.error || !created.data.user) {
    console.error("[Roamly daily test] Test user create failed", { email, error: created.error?.message });
    return NextResponse.json({ ok: false, error: "DAILY_TEST_USER_CREATE_FAILED" }, { status: 500 });
  }

  // The claim hash binds the code to the user id, so the claim record can
  // only be attached once the user exists.
  const userId = created.data.user.id;
  const { claimCode, record } = createDailyTestClaim(password, userId);
  const claimed = await gate.admin.auth.admin.updateUserById(userId, {
    user_metadata: { daily_test: true, daily_test_claim: record }
  });
  if (claimed.error) {
    console.error("[Roamly daily test] Test user claim attach failed", { email, error: claimed.error.message });
    return NextResponse.json({ ok: false, error: "DAILY_TEST_CLAIM_ISSUE_FAILED" }, { status: 500 });
  }

  console.info("[Roamly daily test] Test account provisioned, claim issued", { email, userId });

  return NextResponse.json({
    ok: true,
    created: true,
    rotated: false,
    userId,
    email,
    claimCode,
    expiresAt: record.expiresAt
  });
}
