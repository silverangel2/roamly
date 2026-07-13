import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { SocialDraftComposer } from "@/components/admin/social/SocialDraftComposer";
import { SocialPostCards } from "@/components/admin/social/SocialPostCards";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import {
  ROAMLY_SOCIAL_AFFILIATE_PARTNERS,
  ROAMLY_SOCIAL_CONTENT_TYPES,
  getRoamlySocialEnvStatus,
  isSocialTableMissingError
} from "@/lib/roamly/social";

export default async function AdminSocialPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const env = getRoamlySocialEnvStatus();
  const [drafts, scheduled, posted, recent] = await Promise.all([
    state.admin.from("roamly_social_posts").select("id", { count: "exact", head: true }).eq("status", "draft"),
    state.admin.from("roamly_social_posts").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
    state.admin.from("roamly_social_posts").select("id", { count: "exact", head: true }).eq("status", "posted"),
    state.admin
      .from("roamly_social_posts")
      .select("id,platform,status,title,caption,hashtags,destination,topic,scheduled_for,posted_at,error_message,created_at")
      .order("created_at", { ascending: false })
      .limit(6)
  ]);
  const tableReady = ![drafts.error, scheduled.error, posted.error, recent.error].some(isSocialTableMissingError);

  return (
    <main className="safe-bottom">
      <Badge>Social</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Roamly Social Center.</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Generate Roamly-owned drafts for Facebook, Instagram, TikTok/Reels, and LinkedIn. Meta posting stays disabled unless launch envs explicitly allow it.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Facebook", env.facebookStatusLabel],
          ["Instagram", env.instagramStatusLabel],
          ["Auto-post", env.autoPostEnabled ? "Enabled" : "Disabled"],
          ["Approval", env.requireApproval ? "Required" : "Not required"],
          ["Cron secret", env.cronSecretConfigured ? "Configured" : "Missing"],
          ["Drafts", tableReady ? `${drafts.count || 0}` : "Table missing"],
          ["Scheduled", tableReady ? `${scheduled.count || 0}` : "Table missing"],
          ["Posted", tableReady ? `${posted.count || 0}` : "Table missing"]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <SocialDraftComposer contentTypes={ROAMLY_SOCIAL_CONTENT_TYPES} affiliatePartners={ROAMLY_SOCIAL_AFFILIATE_PARTNERS} />
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-black text-ink">Recent social drafts</h2>
        <div className="mt-4">
          <SocialPostCards posts={tableReady ? recent.data || [] : []} empty={tableReady ? "No social drafts yet." : "Run the social migration to enable drafts."} />
        </div>
      </section>
    </main>
  );
}
