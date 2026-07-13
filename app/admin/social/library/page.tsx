import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { MediaAssetActions } from "@/components/admin/social/MediaAssetActions";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { getFacebookAutomationSummary } from "@/lib/roamly/socialAutomation";
import { isSocialTableMissingError } from "@/lib/roamly/social";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

export default async function AdminSocialLibraryPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const [summary, assets] = await Promise.all([
    getFacebookAutomationSummary(state.admin),
    state.admin
      .from("roamly_social_media_assets")
      .select("id,title,media_url,status,asset_type,approved_for_automation,excluded_from_automation,use_count,last_used_at,is_vertical,source,rights_note,created_at,metadata")
      .order("created_at", { ascending: false })
      .limit(80)
  ]);
  const tableReady = !isSocialTableMissingError(assets.error);

  return (
    <main className="safe-bottom">
      <Badge>Content Library</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook content library</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Approved media is rotated automatically. Newer, unused assets are preferred, and excluded or archived media is skipped.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Media assets", `${summary.counts.mediaAssets}`],
          ["Maximum uses", `${summary.settings.media.maximumUsesPerAsset} per asset`],
          ["Reuse wait", `${summary.settings.media.minimumDaysBeforeReuse} days`],
          ["Generated visuals", summary.settings.media.allowGeneratedVisuals ? "Allowed" : "Disabled"],
          ["Statement graphics", summary.settings.media.allowStatementGraphics ? "Allowed" : "Disabled"],
          ["Prefer newest", summary.settings.media.preferNewestUploads ? "Yes" : "No"],
          ["Fallback media", summary.settings.media.allowStockFallbackMedia ? "Allowed" : "Disabled"],
          ["Affiliate disclosure", ROAMLY_AFFILIATE_DISCLOSURE]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-4">
        {(tableReady ? assets.data || [] : []).map((asset) => (
          <Card key={asset.id} className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{asset.asset_type || "media"}</p>
                <h2 className="mt-2 break-words text-xl font-black text-ink">{asset.title || asset.media_url || "Untitled asset"}</h2>
                <p className="mt-2 break-words text-sm font-bold leading-6 text-slate-600">{asset.media_url || "No public URL saved."}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:w-96">
                {[
                  ["Status", asset.status || "draft"],
                  ["Approved", asset.approved_for_automation ? "Yes" : "No"],
                  ["Excluded", asset.excluded_from_automation ? "Yes" : "No"],
                  ["Reel-ready", asset.is_vertical ? "Yes" : "No"],
                  ["Uses", `${asset.use_count || 0}`],
                  ["Last used", formatDate(asset.last_used_at)]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-mist px-3 py-2">
                    <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-black text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            {asset.rights_note ? <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm font-bold text-slate-600">{asset.rights_note}</p> : null}
            <MediaAssetActions id={asset.id} />
          </Card>
        ))}
        {tableReady && !assets.data?.length ? (
          <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            No media assets yet. Upload or register approved images and vertical videos before unattended Reels go live.
          </p>
        ) : null}
        {!tableReady ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Run the social migration to enable media tracking.</p> : null}
      </section>
    </main>
  );
}
