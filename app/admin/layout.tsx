import { AdminNav } from "@/components/admin/AdminNav";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/roamly/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const requestedPath = requestHeaders.get("x-roamly-path") || "/admin";
  const guard = await requireAdmin(requestedPath);

  if (!guard.ok) {
    if (guard.redirectTo) redirect(guard.redirectTo);

    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone={guard.reason === "denied" ? "coral" : "sun"}>
            {guard.reason === "denied" ? "Access denied" : "Admin setup"}
          </Badge>
          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">Roamly admin is protected.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            {guard.reason === "denied"
              ? "This account is signed in, but it is not listed in ROAMLY_ADMIN_EMAILS."
              : "Admin access needs Supabase and a configured service role before launch operations can run."}
          </p>
          <div className="mt-5">
            <Button href={guard.reason === "denied" ? "/dashboard" : "/"}>Leave admin</Button>
          </div>
        </Card>
      </main>
    );
  }

  const provider = typeof guard.user.app_metadata?.provider === "string" ? guard.user.app_metadata.provider : "supabase";

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[16rem_1fr]">
      <aside className="lg:pt-2">
        <AdminNav />
      </aside>
      <div className="min-w-0">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-cloud bg-white/90 px-4 py-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Admin session</p>
            <p className="mt-1 break-words text-sm font-black text-ink">{guard.user.email}</p>
          </div>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-cloud bg-mist px-4 py-3 text-sm font-black text-ink outline-none transition focus:ring-4 focus:ring-ocean/10">
              Profile
              <span aria-hidden="true" className="text-slate-400 group-open:rotate-180">v</span>
            </summary>
            <div className="right-0 z-20 mt-2 grid w-full gap-2 rounded-2xl border border-cloud bg-white p-3 shadow-soft sm:absolute sm:w-80">
              {[
                ["Admin email", guard.user.email || "Unknown"],
                ["Login provider", provider],
                ["Session status", "Active"],
                ["Admin access", "Allowed"]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-mist px-3 py-2">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                  <p className="mt-1 break-words text-sm font-black text-ink">{value}</p>
                </div>
              ))}
              <Button href="/auth/logout" tone="secondary">Sign out</Button>
            </div>
          </details>
        </div>
        {children}
      </div>
    </div>
  );
}
