import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export const runtime = "nodejs";

const DEFAULT_DAILY_TEST_EMAIL = "daily.checks@roamlyhq.com";

function provisioningEnabled() {
  return /^(true|1|enabled)$/i.test((process.env.ROAMLY_DAILY_TEST_PROVISIONING || "").trim());
}

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
  if (!provisioningEnabled()) {
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

  // Idempotent: the persistent test account is created exactly once. A
  // re-run returns the existing account and never a duplicate — and never
  // a password, because the stored credential lives in the automation's
  // secret store, not here.
  if (existing.user) {
    return NextResponse.json({ ok: true, created: false, userId: existing.user.id, email });
  }

  const password = randomBytes(24).toString("base64url");
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

  console.info("[Roamly daily test] Test account provisioned", { email, userId: created.data.user.id });

  // The generated password is returned exactly once, in this
  // admin-authenticated response only, so the calling automation can write
  // it straight into its secret store. It is never logged.
  return NextResponse.json({ ok: true, created: true, userId: created.data.user.id, email, password });
}
