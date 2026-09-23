import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { FacebookAutomationControls } from "@/components/admin/social/FacebookAutomationControls";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getStoredRoamlyFacebookConnection } from "@/lib/roamly/facebookConnector";
import { getFacebookAutomationSummaries, getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";
import { MetaVisibilityDiagnostic } from "@/components/admin/social/MetaVisibilityDiagnostic";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}

export default async function AdminSocialAutomationPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const [summary, summaries] = await Promise.all([
    getFacebookAutomationSummary(state.admin, "roamly"),
    getFacebookAutomationSummaries(state.admin)
  ]);
  const reviewIntelSummary = summaries.reviewintel;

  const facebookConnection =
    await getStoredRoamlyFacebookConnection().catch(() => null);

  return (
    <main className="safe-bottom">
      <Badge>Automation</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook automation controls</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Control the background system that fills each brand queue, publishes due Facebook Reels, retries temporary failures, and records every attempt.
      </p>

      <section className="mt-6">
        <Card className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
                Roamly Facebook connection
              </p>

              {facebookConnection ? (
                <>
                  <p className="mt-2 text-lg font-black text-ink">
                    Connected
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-600">
                    {facebookConnection.pageName || "Facebook Page"}
                    {facebookConnection.pageId
                      ? ` · ${facebookConnection.pageId}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    Roamly publishing now prefers this stored Facebook Page connection instead of the temporary environment token.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-lg font-black text-ink">
                    Not connected
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-600">
                    Connect Facebook once so Roamly can obtain and store the Page access token automatically.
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {facebookConnection ? (
                <>
                  <a
                    href="/api/auth/facebook/start"
                    className="rounded-xl bg-ocean px-5 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ink"
                  >
                    Reconnect Facebook
                  </a>

                  <form
                    method="post"
                    action="/api/auth/facebook/disconnect"
                  >
                    <button
                      type="submit"
                      className="rounded-xl border border-cloud bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-soft transition hover:border-coral hover:text-coral"
                    >
                      Disconnect Facebook
                    </button>
                  </form>
                </>
              ) : (
                <a
                  href="/api/auth/facebook/start"
                  className="rounded-xl bg-ocean px-5 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ink"
                >
                  Connect Facebook
                </a>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-6">
        <FacebookAutomationControls summary={summary} brand="roamly" title="Roamly Facebook Reel controls" />
        <FacebookAutomationControls summary={reviewIntelSummary} brand="reviewintel" title="ReviewIntel Facebook Reel controls" />
      </section>

      <section className="mt-6">
        <MetaVisibilityDiagnostic />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Roamly status</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Page", summary.env.pageName || summary.env.facebookStatusLabel],
              ["Page ID", summary.env.pageId || "Not configured"],
              ["Token", summary.env.tokenConfigured ? "Configured" : "Missing"],
              ["Publishing", summary.env.publishingReady ? "Ready" : summary.env.blockingIssues[0] || "Needs attention"],
              ["Queue size", `${summary.counts.queueSize}`],
              ["Published", `${summary.counts.published}`],
              ["Failed", `${summary.counts.failed}`],
              ["Retry queue", `${summary.counts.retrying}`],
              ["Last run", formatDate(summary.lastCron?.finished_at || summary.lastCron?.started_at)],
              ["Next run", formatDate(summary.nextAutomationRun)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-mist px-4 py-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                <p className="mt-1 break-words text-sm font-black leading-6 text-ink">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Roamly latest cron summary</p>
          <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-ink p-4 text-xs font-bold leading-6 text-white">
            {JSON.stringify(summary.lastCron?.summary || { status: "No cron run yet" }, null, 2)}
          </pre>
        </Card>
      </section>
    </main>
  );
}
