import { AdminNav } from "@/components/admin/AdminNav";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireAdmin } from "@/lib/roamly/auth";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const guard = await requireAdmin("/admin");

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

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_1fr]">
      <aside className="lg:pt-2">
        <AdminNav />
      </aside>
      <div>{children}</div>
    </div>
  );
}
