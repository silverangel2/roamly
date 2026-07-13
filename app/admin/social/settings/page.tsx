import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getRoamlySocialEnvStatus, isSocialTableMissingError } from "@/lib/roamly/social";

function statusTone(ok: boolean) {
  return ok ? "bg-ocean/10 text-ocean" : "bg-sun/20 text-amber-700";
}

export default async function AdminSocialSettingsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const env = getRoamlySocialEnvStatus();
  const settings = await state.admin
    .from("roamly_social_settings")
    .select("key,value,updated_at")
    .order("key", { ascending: true });
  const tableReady = !isSocialTableMissingError(settings.error);

  const checks = [
    ["ROAMLY_SOCIAL_AUTOPOST_ENABLED", env.autoPostEnabled, env.autoPostEnabled ? "Enabled" : "Disabled"],
    ["ROAMLY_SOCIAL_REQUIRE_APPROVAL", env.requireApproval, env.requireApproval ? "Required" : "Not required"],
    ["ROAMLY_SOCIAL_CRON_SECRET", env.cronSecretConfigured, env.cronSecretConfigured ? "Configured" : "Missing"],
    ["ROAMLY_SOCIAL_FACEBOOK_ENABLED", env.facebookEnabled, env.facebookEnabled ? "Enabled" : "Disabled"],
    ["ROAMLY_META_PAGE_ID", env.pageIdConfigured, env.pageIdConfigured ? "Configured" : "Missing"],
    ["ROAMLY_META_ACCESS_TOKEN", env.tokenConfigured, env.tokenConfigured ? "Configured" : "Missing"],
    ["ROAMLY_SOCIAL_INSTAGRAM_ENABLED", env.instagramEnabled, env.instagramEnabled ? "Enabled" : "Disabled"],
    ["ROAMLY_INSTAGRAM_BUSINESS_ACCOUNT_ID", env.instagramAccountConfigured, env.instagramAccountConfigured ? "Configured" : "Missing"]
  ] as const;

  return (
    <main className="safe-bottom">
      <Badge>Settings</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Social settings.</h1>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map(([label, ok, value]) => (
          <Card key={label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(ok)}`}>{value}</span>
            </div>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Facebook</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{env.facebookStatusLabel}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Draft and copy mode remains available when Facebook is not connected.
          </p>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Instagram</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{env.instagramStatusLabel}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Instagram posting requires a business account, token, and media URL.
          </p>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-black text-ink">Saved social settings</h2>
        <div className="mt-4 grid gap-3">
          {tableReady && settings.data?.length ? (
            settings.data.map((setting) => (
              <Card key={setting.key} className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{setting.key}</p>
                <p className="mt-2 text-sm font-bold text-slate-600">Updated {setting.updated_at}</p>
              </Card>
            ))
          ) : (
            <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
              {tableReady ? "No saved social settings yet." : "Run the social migration to enable saved settings."}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
