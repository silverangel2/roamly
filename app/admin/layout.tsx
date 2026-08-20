import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/roamly/auth";
import {
  ROAMLY_ADMIN_COOKIE,
  isRoamlyAdminConfigured,
  verifyRoamlyAdminSessionValue
} from "@/lib/roamly/adminAccess";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  if (!isRoamlyAdminConfigured()) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
            Admin setup
          </p>

          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">
            Roamly admin is not configured.
          </h1>

          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            Configure ROAMLY_ADMIN_CODE and ROAMLY_ADMIN_SESSION_SECRET.
          </p>
        </Card>
      </main>
    );
  }

  const cookieStore = await cookies();

  const dedicatedAdmin = await verifyRoamlyAdminSessionValue(
    cookieStore.get(ROAMLY_ADMIN_COOKIE)?.value
  );

  // Preserve the new dedicated Admin Access flow, but also keep the
  // original Roamly/Supabase Admin authentication that already worked.
  if (!dedicatedAdmin) {
    const existingAdmin = await requireAdmin("/admin");

    if (!existingAdmin.ok) {
      redirect("/admin-access");
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[16rem_1fr]">
      <aside className="lg:pt-2">
        <AdminNav />
      </aside>

      <div className="min-w-0">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-cloud bg-white/90 px-4 py-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
              Admin session
            </p>

            <p className="mt-1 text-sm font-black text-ink">
              Dedicated admin access
            </p>
          </div>

          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              Sign out admin
            </button>
          </form>
        </div>

        {children}
      </div>
    </div>
  );
}
