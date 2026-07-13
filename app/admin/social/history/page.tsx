import Link from "next/link";
import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { isSocialTableMissingError } from "@/lib/roamly/social";

type HistoryPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}

function statusClass(status: string) {
  if (status === "published") return "bg-ocean/10 text-ocean";
  if (status === "failed") return "bg-coral/10 text-coral";
  if (status === "retrying") return "bg-sun/20 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export default async function AdminSocialHistoryPage({ searchParams }: HistoryPageProps) {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const params = searchParams ? await searchParams : {};
  const filter = param(params.filter) || "all";
  const status =
    filter === "published"
      ? ["published"]
      : filter === "failed"
        ? ["failed"]
        : filter === "retrying"
          ? ["retrying"]
          : ["published", "failed", "retrying", "skipped", "archived"];

  const query = state.admin
    .from("roamly_social_queue")
    .select(
      "id,queue_status,scheduled_for,published_at,facebook_post_id,facebook_reel_id,facebook_media_id,facebook_url,attempt_count,last_error,permanent_failure,metadata,draft:roamly_social_drafts(id,content_type,post_format,hook,caption,selected_media_url,generation_source,amazon_affiliate_link,affiliate_disclosure)"
    )
    .in("queue_status", status)
    .order("updated_at", { ascending: false })
    .limit(100);

  const result = await query;
  const tableReady = !isSocialTableMissingError(result.error);
  type DraftRow = {
    content_type: string;
    post_format: string;
    hook: string;
    caption: string;
    selected_media_url: string | null;
    generation_source: string;
    amazon_affiliate_link: string | null;
    affiliate_disclosure: string | null;
  };
  const rawRows = (result.data || []) as unknown as Array<{
    id: string;
    queue_status: string;
    scheduled_for: string;
    published_at: string | null;
    facebook_post_id: string | null;
    facebook_reel_id: string | null;
    facebook_media_id: string | null;
    facebook_url: string | null;
    attempt_count: number;
    last_error: string | null;
    permanent_failure: boolean;
    draft: DraftRow | DraftRow[];
  }>;
  const rows = rawRows
    .map((item) => ({ ...item, draft: Array.isArray(item.draft) ? item.draft[0] : item.draft }))
    .filter((item): item is Omit<(typeof rawRows)[number], "draft"> & { draft: DraftRow } => Boolean(item.draft));

  const filters = [
    ["all", "All"],
    ["published", "Published"],
    ["failed", "Failed"],
    ["retrying", "Retrying"],
    ["reels", "Reels"],
    ["affiliate", "Affiliate"]
  ];

  const displayed = rows.filter((item) => {
    if (filter === "reels") return item.draft.post_format === "reel";
    if (filter === "affiliate") return Boolean(item.draft.amazon_affiliate_link);
    return true;
  });

  return (
    <main className="safe-bottom">
      <Badge>History</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Facebook autopost history</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Review scheduled, published, failed, and retrying items without exposing Meta tokens or other credentials.
      </p>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {filters.map(([value, label]) => (
          <Link
            key={value}
            href={`/admin/social/history?filter=${value}`}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black shadow-soft ring-1 ring-cloud ${
              filter === value ? "bg-ink text-white" : "bg-white text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="mt-5 grid gap-4">
        {tableReady
          ? displayed.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
                      {item.draft.post_format} · {item.draft.content_type}
                    </p>
                    <h2 className="mt-2 text-xl font-black text-ink">{item.draft.hook}</h2>
                  </div>
                  <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(item.queue_status)}`}>{item.queue_status}</span>
                </div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">{item.draft.caption}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Scheduled", formatDate(item.scheduled_for)],
                    ["Published", formatDate(item.published_at)],
                    ["Facebook ID", item.facebook_post_id || item.facebook_reel_id || item.facebook_media_id || "None"],
                    ["Attempts", `${item.attempt_count || 0}`],
                    ["Media used", item.draft.selected_media_url || "Caption-only"],
                    ["Generation", item.draft.generation_source],
                    ["Affiliate", item.draft.amazon_affiliate_link ? "Yes" : "No"],
                    ["Final status", item.permanent_failure ? "Permanent failure" : item.queue_status]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-mist px-3 py-2">
                      <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                      <p className="mt-1 break-words text-sm font-black text-ink">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.facebook_url ? (
                    <a href={item.facebook_url} target="_blank" rel="noreferrer" className="rounded-xl bg-ink px-4 py-2 text-sm font-black text-white">
                      View on Facebook
                    </a>
                  ) : null}
                  <Link href={`/admin/social/drafts`} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-ink shadow-soft ring-1 ring-cloud">
                    Duplicate as draft
                  </Link>
                  <Link href={`/admin/social`} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-ink shadow-soft ring-1 ring-cloud">
                    Retry or regenerate
                  </Link>
                </div>
                {item.last_error ? <p className="mt-3 rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{item.last_error}</p> : null}
              </Card>
            ))
          : null}
        {tableReady && !displayed.length ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No matching history yet.</p> : null}
        {!tableReady ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Run the automation migration to enable history.</p> : null}
      </section>
    </main>
  );
}
