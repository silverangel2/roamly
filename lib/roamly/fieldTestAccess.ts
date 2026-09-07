import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import type { RoamlyTripRecord } from "@/lib/trips";

export const ROAMLY_FIELD_TEST_COOKIE = "roamly_field_test_session";
const FIELD_TEST_TTL_MS = 2 * 60 * 60 * 1000;

type FieldTestMetadata = {
  admin_test?: boolean;
  field_test?: boolean;
  field_test_capability_hash?: string;
  field_test_capability_expires_at?: string;
};

function fieldTestSecret() {
  const value = process.env.ROAMLY_FIELD_TEST_SECRET?.trim();
  if (!value) throw new Error("ROAMLY_FIELD_TEST_SECRET_NOT_CONFIGURED");
  return value;
}

function hashCapability(capability: string) {
  return createHmac("sha256", fieldTestSecret()).update(capability).digest("hex");
}

function equalHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function fieldTestCookieOptions(maxAge = Math.floor(FIELD_TEST_TTL_MS / 1000)) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}

export function createFieldTestCapability() {
  fieldTestSecret();
  const capability = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + FIELD_TEST_TTL_MS).toISOString();
  return { capability, capabilityHash: hashCapability(capability), expiresAt };
}

function metadataFor(trip: RoamlyTripRecord) {
  return (trip.metadata || {}) as FieldTestMetadata;
}

export function fieldTestCapabilityIsValid(trip: RoamlyTripRecord, capability: string) {
  fieldTestSecret();
  const metadata = metadataFor(trip);
  if (trip.trip_companion_status === "completed" || trip.status === "completed" || metadata.field_test !== true || metadata.admin_test !== true || !metadata.field_test_capability_hash || !metadata.field_test_capability_expires_at) return false;
  const expiresAt = Date.parse(metadata.field_test_capability_expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  return Boolean(capability) && equalHash(metadata.field_test_capability_hash, hashCapability(capability));
}

async function readTrip(tripId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { admin: null, trip: null };
  const result = await admin.from("roamly_trips").select("*").eq("id", tripId).maybeSingle();
  return { admin, trip: (result.data as RoamlyTripRecord | null) || null };
}

function parseCookie(value: string | undefined) {
  const [tripId, capability] = String(value || "").split(".");
  return tripId && capability ? { tripId, capability } : null;
}

export async function getFieldTestSession(tripId?: string) {
  const cookieStore = await cookies();
  const parsed = parseCookie(cookieStore.get(ROAMLY_FIELD_TEST_COOKIE)?.value);
  if (!parsed || (tripId && parsed.tripId !== tripId)) return null;
  const resolved = await readTrip(parsed.tripId);
  if (!resolved.admin || !resolved.trip || !fieldTestCapabilityIsValid(resolved.trip, parsed.capability)) return null;
  return {
    fieldTest: true as const,
    tripId: parsed.tripId,
    userId: resolved.trip.user_id,
    userEmail: null as string | null,
    supabase: resolved.admin
  };
}

export async function exchangeFieldTestCapability(tripId: string, capability: string) {
  const resolved = await readTrip(tripId);
  if (!resolved.trip || !fieldTestCapabilityIsValid(resolved.trip, capability)) return null;
  return { tripId, cookieValue: `${tripId}.${capability}` };
}

export async function requireUserOrFieldTest(tripId?: string): Promise<
  | { ok: true; fieldTest: boolean; user: User | null; userId: string; userEmail: string | null; supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>> }
  | { ok: false; response: NextResponse }
> {
  const fieldTest = await getFieldTestSession(tripId);
  if (fieldTest) return { ok: true, ...fieldTest, user: null };
  const auth = await requireUser();
  if (!auth.ok) return auth;
  return { ok: true, fieldTest: false, user: auth.user, userId: auth.user.id, userEmail: auth.user.email || null, supabase: auth.supabase };
}

export const FIELD_TEST_INVALID_MESSAGE = "This field-test link is invalid or expired.";
