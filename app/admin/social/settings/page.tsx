import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FacebookAutomationControls } from "@/components/admin/social/FacebookAutomationControls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";

function statusTone(ok: boolean) {
  return ok ? "bg-ocean/10 text-ocean" : "bg-sun/20 text-amber-800";
}

export default async function AdminSocialSettingsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const summary = await getFacebookAutomationSummary(state.admin);
  const checks = [
    ["Facebook publishing", summary.env.facebookEnabled, summary.env.facebookEnabled ? "Enabled" : "Disabled"],
    ["Autopost env", summary.env.autoPostEnabled, summary.env.autoPostEnabled ? "Enabled" : "Disabled"],
    ["Manual review", !summary.settings.manualReviewRequired, summary.settings.manualReviewRequired ? "Required" : "Optional"],
    ["Cron secret", summary.env.cronSecretConfigured, summary.env.cronSecretConfigured ? "Configured" : "Missing"],
    ["Page ID", summary.env.pageIdConfigured, summary.env.pageIdConfigured ? "Configured" : "Missing"],
    ["Page token", summary.env.tokenConfigured, summary.env.tokenConfigured ? "Configured" : "Missing"],
    ["Database", summary.tableReady, summary.tableReady ? "Ready" : "Migration needed"],
    ["Publishing ready", summary.env.publishingReady, summary.env.publishingReady ? "Ready" : "Needs attention"]
  ] as const;

  return (
    <main className="safe-bottom">
      <Badge>Settings</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook autopost settings</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Configure schedule, queue size, retry behavior, media rotation, and automation status. Tokens are never displayed.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map(([label, ok, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
            <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusTone(ok)}`}>
              {ok ? "Working" : "Needs attention"}
            </span>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <FacebookAutomationControls summary={summary} />
      </section>
    </main>
  );
}
