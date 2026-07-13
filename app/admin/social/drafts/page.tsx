import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { isSocialTableMissingError } from "@/lib/roamly/social";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

export default async function AdminSocialDraftsPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const queue = await state.admin
    .from("roamly_social_queue")
    .select(
      "id,queue_status,scheduled_for,facebook_post_id,facebook_reel_id,last_error,attempt_count,draft:roamly_social_drafts(id,content_type,post_format,hook,caption,on_screen_text,media_direction,selected_media_url,call_to_action,hashtags,music_or_audio_mood,roamly_link,amazon_affiliate_link,affiliate_disclosure,generation_source,status,quality_score,quality_reasons,created_at)"
    )
    .in("queue_status", ["scheduled", "retrying", "processing"])
    .order("scheduled_for", { ascending: true })
    .limit(100);
  const tableReady = !isSocialTableMissingError(queue.error);

  type DraftRow = {
    id: string;
    content_type: string;
    post_format: string;
    hook: string;
    caption: string;
    on_screen_text: string | null;
    media_direction: string | null;
    selected_media_url: string | null;
    call_to_action: string | null;
    hashtags: string[] | null;
    music_or_audio_mood: string | null;
    roamly_link: string | null;
    amazon_affiliate_link: string | null;
    affiliate_disclosure: string | null;
    generation_source: string;
    quality_score: number;
    quality_reasons: string[] | null;
  };
  const rawRows = (queue.data || []) as unknown as Array<{
    id: string;
    queue_status: string;
    scheduled_for: string;
    last_error: string | null;
    attempt_count: number;
    draft: DraftRow | DraftRow[];
  }>;
  const rows = rawRows
    .map((item) => ({ ...item, draft: Array.isArray(item.draft) ? item.draft[0] : item.draft }))
    .filter((item): item is Omit<(typeof rawRows)[number], "draft"> & { draft: DraftRow } => Boolean(item.draft));

  return (
    <main className="safe-bottom">
      <Badge>Drafts</Badge>
      <h1 className="mt-4 text-4xl font-black text-ink">Scheduled Facebook drafts</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        These posts are in the automated queue. Manual review is optional; the system can publish due items without approval when enabled.
      </p>

      <section className="mt-6 grid gap-4">
        {tableReady
          ? rows.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
                      {item.draft.post_format} · {item.draft.content_type}
                    </p>
                    <h2 className="mt-2 text-xl font-black text-ink">{item.draft.hook}</h2>
                  </div>
                  <span className="rounded-full bg-sun/20 px-3 py-2 text-xs font-black text-amber-800">{item.queue_status}</span>
                </div>
                <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">{item.draft.caption}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Scheduled", formatDate(item.scheduled_for)],
                    ["Quality", `${item.draft.quality_score}/100`],
                    ["Source", item.draft.generation_source],
                    ["Attempts", `${item.attempt_count || 0}`],
                    ["CTA", item.draft.call_to_action || "None"],
                    ["Audio", item.draft.music_or_audio_mood || "Not applicable"],
                    ["Roamly link", item.draft.roamly_link || "None"],
                    ["Affiliate", item.draft.amazon_affiliate_link ? "Included" : "No"]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-mist px-3 py-2">
                      <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                      <p className="mt-1 break-words text-sm font-black text-ink">{value}</p>
                    </div>
                  ))}
                </div>
                {item.draft.on_screen_text ? <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm font-bold text-slate-600">On-screen text: {item.draft.on_screen_text}</p> : null}
                {item.draft.media_direction ? <p className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm font-bold text-slate-600">Media: {item.draft.media_direction}</p> : null}
                {item.last_error ? <p className="mt-3 rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{item.last_error}</p> : null}
              </Card>
            ))
          : null}
        {tableReady && !rows.length ? (
          <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No scheduled drafts yet. Generate 100 posts from Facebook Autopost.</p>
        ) : null}
        {!tableReady ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Run the automation migration to enable drafts.</p> : null}
      </section>
    </main>
  );
}
