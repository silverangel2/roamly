import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminEmailConsole } from "@/components/admin/AdminEmailConsole";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getRoamlySupportEmail, isEmailConfigured } from "@/lib/roamly/email";

export default async function AdminEmailPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin || !state.user) return <AdminAccessCard />;

  const emailConfig = isEmailConfigured();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [sentToday, failures, logs, lastSent, lastFailed, retryQueue, completionSent, completionFailed] = await Promise.all([
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
      .select("id,to_email,subject,provider,status,provider_message_id,error,last_error,template,attempt_count,trip_id,created_at,sent_at")
      .order("created_at", { ascending: false })
      .limit(40),
    state.admin
      .from("roamly_email_logs")
      .select("id,subject,provider_message_id,sent_at")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    state.admin
      .from("roamly_email_logs")
      .select("id,subject,error,last_error,created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    state.admin
      .from("roamly_trips")
      .select("id,title,destination_name,completion_email_status,completion_email_attempt_count,completion_email_next_retry_at,completion_email_last_error")
      .in("completion_email_status", ["failed", "pending"])
      .order("completion_email_next_retry_at", { ascending: true, nullsFirst: false })
      .limit(12),
    state.admin
      .from("roamly_trips")
      .select("id", { count: "exact", head: true })
      .eq("completion_email_status", "sent"),
    state.admin
      .from("roamly_trips")
      .select("id", { count: "exact", head: true })
      .eq("completion_email_status", "failed")
  ]);

  const missingConfig = emailConfig.missingVariables.length ? emailConfig.missingVariables.join(", ") : emailConfig.configured ? "None" : emailConfig.reason;

  return (
    <main className="safe-bottom mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <Badge>Email</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Roamly Email Center</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Manage Google Workspace SMTP delivery, branded transactional templates, completion-email retries, and delivery logs.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Active provider", emailConfig.activeProviderLabel],
          ["Sender", emailConfig.smtpUser || "Missing"],
          ["SMTP host", emailConfig.smtpHost || "Missing"],
          ["SMTP port", emailConfig.smtpPort ? `${emailConfig.smtpPort}` : "Missing"],
          ["Secure connection", emailConfig.smtpSecure ? "Enabled" : "STARTTLS"],
          ["Authentication", emailConfig.smtpAuthenticationStatus],
          ["From address", emailConfig.fromEmail],
          ["Support/reply-to", emailConfig.replyToEmail],
          ["Missing configuration", missingConfig],
          ["Last successful send", lastSent.data?.sent_at ? new Date(lastSent.data.sent_at).toLocaleString() : "None"],
          ["Last failed send", lastFailed.data?.created_at ? new Date(lastFailed.data.created_at).toLocaleString() : "None"],
          ["Completion email", `${completionSent.count || 0} sent / ${completionFailed.count || 0} failed`],
          ["Retry queue", `${retryQueue.data?.length || 0}`],
          ["Sent today", `${sentToday.count || 0}`],
          ["Failures today", `${failures.count || 0}`],
          ["Logo asset", emailConfig.logoUrl]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 break-words text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <AdminEmailConsole
          adminEmail={getRoamlySupportEmail()}
          emailConfig={emailConfig}
          initialLogs={logs.data || []}
          retryQueue={retryQueue.data || []}
        />
      </section>
    </main>
  );
}
