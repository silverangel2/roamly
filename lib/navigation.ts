function isAuthLoopPath(path: string) {
  const pathname = path.split(/[?#]/, 1)[0];
  return pathname === "/login" || pathname === "/signup" || pathname === "/auth/callback" || pathname === "/auth/logout";
}

export function safeNextPath(value: string | string[] | undefined, fallback = "/dashboard") {
  const next = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof next === "string" ? next.trim() : "";

  if (!trimmed) return fallback;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("://") || trimmed.includes("\\")) return fallback;

  return trimmed;
}

export function safeAuthNextPath(value: string | string[] | undefined, fallback = "/plan") {
  const next = safeNextPath(value, fallback);
  return isAuthLoopPath(next) ? fallback : next;
}
