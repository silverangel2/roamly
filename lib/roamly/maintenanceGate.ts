// Edge-safe maintenance gate for middleware.
//
// The flag lives in roamly_admin_settings under the key "site_maintenance"
// (see lib/roamly/maintenanceMode.ts for the owner-side read/write path).
// Middleware cannot use the Supabase service client, so the flag is read
// straight from PostgREST with the service-role key (server-side only —
// middleware code never ships to the browser) and cached per instance for
// a few seconds: a flip takes effect within ~10s everywhere, which is
// instant enough for a deploy window, and the database is never hit per
// request. ANY read failure fails OPEN to the normal site: a broken flag
// read must never take Roamly down by itself.
//
// ROAMLY_MAINTENANCE_MODE=on|off is an emergency override that wins over
// the stored flag (changing it needs a redeploy, so it is a break-glass
// control, not the normal switch).

const MAINTENANCE_SETTING_KEY = "site_maintenance";
const CACHE_TTL_MS = 10_000;
const FAILURE_CACHE_TTL_MS = 2_000;
const READ_TIMEOUT_MS = 3_000;

let cached: { value: boolean; expiresAt: number } | null = null;

function envOverride(): boolean | null {
  const raw = (process.env.ROAMLY_MAINTENANCE_MODE || "").trim().toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") return true;
  if (raw === "off" || raw === "0" || raw === "false") return false;
  return null;
}

export async function isMaintenanceModeOn(): Promise<boolean> {
  const override = envOverride();
  if (override !== null) return override;

  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    cached = { value: false, expiresAt: now + FAILURE_CACHE_TTL_MS };
    return false;
  }

  try {
    // AbortController + timer rather than AbortSignal.timeout: the edge
    // sandbox does not guarantee the static helper, and a throw here would
    // silently fail the gate open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${url}/rest/v1/roamly_admin_settings?key=eq.${MAINTENANCE_SETTING_KEY}&select=value`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json"
        },
        signal: controller.signal,
        cache: "no-store"
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`maintenance flag read failed: ${response.status}`);
    const rows = (await response.json()) as Array<{ value?: unknown }>;
    const value = rows?.[0]?.value;
    const enabled =
      Boolean(value) && typeof value === "object" && (value as Record<string, unknown>).enabled === true;
    cached = { value: enabled, expiresAt: now + CACHE_TTL_MS };
    return enabled;
  } catch {
    // Fail OPEN: the normal site keeps serving when the flag cannot be read.
    cached = { value: false, expiresAt: now + FAILURE_CACHE_TTL_MS };
    return false;
  }
}

// Paths the maintenance gate never intercepts: every API route (cron,
// admin, QA seams, health and the generation drivers must keep working
// during a maintenance window), the maintenance page itself, framework
// internals, and static files (anything whose last segment carries a file
// extension: sw.js, manifest, icons, robots.txt, images, ...).
export function isMaintenanceExemptPath(pathname: string) {
  if (pathname === "/maintenance" || pathname.startsWith("/maintenance/")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname === "/admin-access" || pathname.startsWith("/admin-access/")) return true;
  const lastSegment = pathname.split("/").pop() || "";
  if (lastSegment.includes(".")) return true;
  return false;
}

// Member pages a signed-in traveler may keep using while maintenance is on
// (existing trips stay viewable; the pages enforce real auth themselves).
// Starting something new begins on the public planner, which stays gated.
export function isMemberAreaPath(pathname: string) {
  return ["/trip", "/dashboard", "/account", "/notifications", "/preview"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}
