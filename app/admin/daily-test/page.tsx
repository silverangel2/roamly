import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { DailyTestProvisionPanel } from "@/components/admin/DailyTestProvisionPanel";
import { Badge } from "@/components/ui/Badge";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { dailyTestProvisioningEnabled } from "@/lib/roamly/dailyTestClaim";

const DEFAULT_DAILY_TEST_EMAIL = "daily.checks@roamlyhq.com";

export default async function AdminDailyTestPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const testEmail = (process.env.ROAMLY_DAILY_TEST_EMAIL || "").trim() || DEFAULT_DAILY_TEST_EMAIL;

  return (
    <main className="safe-bottom">
      <Badge>Daily test</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Daily test account provisioning.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        The automation-owned account the daily end-to-end test signs in as. Provisioning issues a
        one-time claim code; the automation exchanges it for the account password over a direct
        connection, so the password never appears in this UI, in chat, or in any log.
      </p>

      <DailyTestProvisionPanel provisioningEnabled={dailyTestProvisioningEnabled()} testEmail={testEmail} />
    </main>
  );
}
