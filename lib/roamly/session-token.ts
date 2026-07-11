import crypto from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RoamlySessionTokenPayload = {
  userId: string;
  email: string | null;
  exp: number;
  purpose: "roamly_api";
};

const TOKEN_TTL_SECONDS = 6 * 60 * 60;

function tokenSecret() {
  return process.env.ROAMLY_SESSION_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createRoamlySessionToken(user: Pick<User, "id" | "email"> | null | undefined) {
  const secret = tokenSecret();
  if (!secret || !user?.id) return "";

  const payload: RoamlySessionTokenPayload = {
    userId: user.id,
    email: user.email || null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    purpose: "roamly_api"
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyRoamlySessionToken(token: string | null | undefined) {
  const secret = tokenSecret();
  if (!secret || !token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<RoamlySessionTokenPayload>;
    if (payload.purpose !== "roamly_api" || !payload.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      userId: payload.userId,
      email: typeof payload.email === "string" ? payload.email : null
    };
  } catch {
    return null;
  }
}

export async function getUserFromRoamlySessionToken(token: string | null | undefined) {
  const payload = verifyRoamlySessionToken(token);
  if (!payload) return null;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.auth.admin.getUserById(payload.userId);
  if (error || !data.user) return null;

  return { user: data.user, supabase: admin };
}
