import crypto from "node:crypto";

type RoamlySessionTokenPayload = {
  userId: string;
  email: string | null;
  exp: number;
  purpose: "roamly_api";
  scopes: RoamlySessionScope[];
};

export type RoamlySessionScope = { method: "GET" | "POST"; path: string };

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

function isValidScopes(scopes: readonly RoamlySessionScope[]): scopes is readonly RoamlySessionScope[] {
  return scopes.length > 0 && scopes.length <= 12 && scopes.every((scope) =>
    (scope.method === "GET" || scope.method === "POST") &&
    scope.path.startsWith("/api/") &&
    !/[?#]/.test(scope.path) &&
    !scope.path.includes("..")
  );
}

export function createRoamlySessionToken(
  user: { id: string; email?: string | null } | null | undefined,
  scopes: readonly RoamlySessionScope[]
) {
  const secret = tokenSecret();
  if (!secret || !user?.id || !isValidScopes(scopes)) return "";

  const payload: RoamlySessionTokenPayload = {
    userId: user.id,
    email: user.email || null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    purpose: "roamly_api",
    scopes: [...scopes]
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyRoamlySessionToken(
  token: string | null | undefined,
  request: { method: string; path: string } | null | undefined
) {
  const secret = tokenSecret();
  if (!secret || !token || !request) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  if (!timingSafeEqual(signature, signPayload(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<RoamlySessionTokenPayload>;
    if (payload.purpose !== "roamly_api" || !payload.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!Array.isArray(payload.scopes) || !isValidScopes(payload.scopes)) return null;
    const method = request.method.toUpperCase();
    const path = request.path.split(/[?#]/, 1)[0];
    if (!payload.scopes.some((scope) => scope.method === method && scope.path === path)) return null;
    return {
      userId: payload.userId,
      email: typeof payload.email === "string" ? payload.email : null
    };
  } catch {
    return null;
  }
}
