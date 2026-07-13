import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FacebookAutomationControls } from "@/components/admin/social/FacebookAutomationControls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}

export default async function AdminSocialAutomationPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const summary = await getFacebookAutomationSummary(state.admin);

  return (
    <main className="safe-bottom">
      <Badge>Automation</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook automation controls</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Control the background system that fills the queue, publishes due Facebook posts and Reels, retries temporary failures, and records every attempt.
      </p>

      <section className="mt-6">
        <FacebookAutomationControls summary={summary} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        {[
          ["Page connection", summary.env.pageName || summary.env.facebookStatusLabel],
          ["Page ID", summary.env.pageId || "Not configured"],
          ["Token status", summary.env.tokenConfigured ? "Configured" : "Missing"],
          ["Required permissions", summary.env.permissions.join(", ")],
          ["Last automation run", formatDate(summary.lastCron?.finished_at || summary.lastCron?.started_at)],
          ["Next automation run", formatDate(summary.nextAutomationRun)],
          ["Queue size", `${summary.counts.queueSize}`],
          ["Failed posts", `${summary.counts.failed}`],
          ["Retry queue", `${summary.counts.retrying}`]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 break-words text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Latest cron summary</p>
          <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-ink p-4 text-xs font-bold leading-6 text-white">
            {JSON.stringify(summary.lastCron?.summary || { status: "No cron run yet" }, null, 2)}
          </pre>
        </Card>
      </section>
    </main>
  );
}
