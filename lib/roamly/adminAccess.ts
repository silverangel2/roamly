export const ROAMLY_ADMIN_COOKIE = "roamly_admin_session";

const SESSION_SECONDS = 60 * 60;

function adminCode() {
  return String(process.env.ROAMLY_ADMIN_CODE || "").trim();
}

function adminSecret() {
  return String(process.env.ROAMLY_ADMIN_SESSION_SECRET || "").trim();
}

export function isRoamlyAdminConfigured() {
  return Boolean(
    adminCode() &&
    adminSecret()
  );
}

function base64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signValue(value: string) {
  const secret = adminSecret();

  if (!secret) {
    return "";
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const result = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64Url(new Uint8Array(result));
}

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);

  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return mismatch === 0;
}

export async function verifyRoamlyAdminCode(
  code: string
) {
  if (!isRoamlyAdminConfigured()) {
    return false;
  }

  return secureEqual(
    String(code || ""),
    adminCode()
  );
}

export async function createRoamlyAdminSession() {
  if (!isRoamlyAdminConfigured()) {
    throw new Error("ROAMLY_ADMIN_NOT_CONFIGURED");
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + SESSION_SECONDS;

  const payload = String(expiresAt);
  const signature = await signValue(payload);

  return {
    value: `${payload}.${signature}`,
    maxAge: SESSION_SECONDS
  };
}

export async function verifyRoamlyAdminSessionValue(
  value: string | null | undefined
) {
  if (!value || !isRoamlyAdminConfigured()) {
    return false;
  }

  const pieces = value.split(".");

  if (pieces.length !== 2) {
    return false;
  }

  const [expiresRaw, signature] = pieces;
  const expiresAt = Number(expiresRaw);

  if (
    !expiresRaw ||
    !signature ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expectedSignature = await signValue(expiresRaw);

  return secureEqual(
    signature,
    expectedSignature
  );
}

export function roamlyAdminCookieOptions(
  maxAge = SESSION_SECONDS
) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}
