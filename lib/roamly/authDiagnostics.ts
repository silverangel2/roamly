import { getSupabaseUrl } from "@/lib/supabase/config";

type DiagnosticValue = string | number | boolean | null | undefined | string[];

function cookieNames(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.split("=", 1)[0]?.trim())
    .filter(Boolean);
}

export function getSupabaseProjectHost() {
  try {
    return new URL(getSupabaseUrl()).host;
  } catch {
    return "";
  }
}

export function getExpectedSupabaseAuthCookiePrefix() {
  const host = getSupabaseProjectHost();
  const projectRef = host.split(".", 1)[0] || "";
  return projectRef ? `sb-${projectRef}-auth-token` : "";
}

export function isExpectedSupabaseAuthCookieName(name: string) {
  const expectedPrefix = getExpectedSupabaseAuthCookiePrefix();
  return Boolean(expectedPrefix && (name === expectedPrefix || name.startsWith(`${expectedPrefix}.`)));
}

export function isStaleSupabaseAuthCookieName(name: string) {
  return name.startsWith("sb-") && name.includes("auth-token") && !isExpectedSupabaseAuthCookieName(name);
}

export function isSupabaseAuthCookieName(name: string) {
  return isExpectedSupabaseAuthCookieName(name) || isStaleSupabaseAuthCookieName(name);
}

export function getSupabaseAuthCookieDiagnostics(cookieHeader: string) {
  const names = cookieNames(cookieHeader);
  const expectedPrefix = getExpectedSupabaseAuthCookiePrefix();
  const authCookieNames = names.filter(isSupabaseAuthCookieName);
  const staleAuthCookieNames = names.filter(isStaleSupabaseAuthCookieName);

  return {
    authCookiePresent: authCookieNames.length > 0,
    authCookieCount: authCookieNames.length,
    expectedAuthCookiePresent: expectedPrefix
      ? authCookieNames.some((name) => name === expectedPrefix || name.startsWith(`${expectedPrefix}.`))
      : false,
    staleAuthCookieCount: staleAuthCookieNames.length,
    codeVerifierPresent: expectedPrefix ? names.includes(`${expectedPrefix}-code-verifier`) : false
  };
}

export function logAuthDiagnostic(event: string, details: Record<string, DiagnosticValue>) {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...details
  };

  console.info("[roamly-auth]", JSON.stringify(payload));
}
