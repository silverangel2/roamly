import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getRoamlyLaunchReadiness, type ReadinessStatus } from "@/lib/roamly/launchReadiness";

function statusClass(status: ReadinessStatus) {
  if (status === "Ready") return "bg-ocean/10 text-ocean";
  if (status === "Optional") return "bg-slate-100 text-slate-500";
  if (status === "Needs setup") return "bg-sun/20 text-amber-700";
  return "bg-coral/10 text-coral";
}

export default async function AdminLaunchPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const checks = getRoamlyLaunchReadiness(state.access);

  return (
    <main className="safe-bottom">
      <Badge>Launch readiness</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Launch readiness.</h1>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => (
          <Card key={`${check.group}-${check.label}`} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{check.group}</p>
                <h2 className="mt-2 text-lg font-black text-ink">{check.label}</h2>
              </div>
              <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(check.status)}`}>
                {check.status}
              </span>
            </div>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{check.detail}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
