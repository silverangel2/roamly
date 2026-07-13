import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminEmailConsole } from "@/components/admin/AdminEmailConsole";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { isEmailConfigured } from "@/lib/roamly/email";

export default async function AdminEmailPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin || !state.user) return <AdminAccessCard />;

  const emailConfig = isEmailConfigured();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [sentToday, failures, logs] = await Promise.all([
    state.admin
      .from("roamly_email_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("created_at", today.toISOString()),
    state.admin
      .from("roamly_email_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", today.toISOString()),
    state.admin
      .from("roamly_email_logs")
      .select("id,to_email,subject,provider,status,provider_message_id,error,created_at,sent_at")
      .order("created_at", { ascending: false })
      .limit(40)
  ]);

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Badge>Email</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Roamly email center.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Send admin messages, test the provider, and review email logs. If Resend is not configured, sends are safely skipped and logged.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Provider", emailConfig.configured ? `${emailConfig.provider} configured` : emailConfig.reason],
          ["Support email", emailConfig.supportEmailConfigured ? "Configured" : "Missing"],
          ["From email", emailConfig.fromEmailConfigured ? "Configured" : "Missing"],
          ["Reply-to", emailConfig.replyToEmail],
          ["Sent today", `${sentToday.count || 0}`],
          ["Failures today", `${failures.count || 0}`],
          ["Reminders", emailConfig.remindersEnabled ? "Enabled" : "Disabled"]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <AdminEmailConsole adminEmail={state.user.email || ""} initialLogs={logs.data || []} />
      </section>
    </main>
  );
}
