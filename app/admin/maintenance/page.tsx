import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { MaintenanceModePanel } from "@/components/admin/MaintenanceModePanel";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";

export default async function AdminMaintenancePage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  return (
    <main className="safe-bottom">
      <Badge>Maintenance</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Site maintenance switch.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        The deploy-window switch for Roamly. Flipping it is a settings change, not a redeploy:
        turn it on before a risky release, verify, then turn it off to go live again. If the flag
        can&rsquo;t be read, the site fails open and keeps serving normally.
      </p>

      <MaintenanceModePanel />
    </main>
  );
}
