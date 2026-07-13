type SocialPost = {
  id: string;
  platform?: string | null;
  status?: string | null;
  title?: string | null;
  caption?: string | null;
  hashtags?: unknown;
  destination?: string | null;
  topic?: string | null;
  scheduled_for?: string | null;
  posted_at?: string | null;
  error_message?: string | null;
  created_at?: string | null;
};

function tags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => `#${item.replace(/^#/, "")}`)
    : [];
}

function statusClass(status?: string | null) {
  if (status === "posted") return "bg-ocean/10 text-ocean";
  if (status === "failed") return "bg-coral/10 text-coral";
  if (status === "scheduled" || status === "approved") return "bg-sun/20 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function SocialPostCards({ posts, empty = "No social posts yet." }: { posts: SocialPost[]; empty?: string }) {
  if (!posts.length) {
    return <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">{empty}</p>;
  }

  return (
    <div className="grid gap-3">
      {posts.map((post) => (
        <article key={post.id} className="rounded-[1.25rem] border border-cloud bg-white/92 p-4 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{post.platform || "multi"}</p>
              <h2 className="mt-1 text-lg font-black text-ink">{post.title || post.topic || "Roamly social draft"}</h2>
            </div>
            <span className={`rounded-full px-3 py-2 text-xs font-black ${statusClass(post.status)}`}>
              {post.status || "draft"}
            </span>
          </div>
          {post.caption ? <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">{post.caption}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-500">
            {post.destination ? <span className="rounded-full bg-mist px-3 py-1">{post.destination}</span> : null}
            {post.topic ? <span className="rounded-full bg-mist px-3 py-1">{post.topic}</span> : null}
            {post.scheduled_for ? <span className="rounded-full bg-mist px-3 py-1">Scheduled {post.scheduled_for}</span> : null}
            {post.posted_at ? <span className="rounded-full bg-mist px-3 py-1">Posted {post.posted_at}</span> : null}
            {post.created_at ? <span className="rounded-full bg-mist px-3 py-1">Created {post.created_at}</span> : null}
          </div>
          {tags(post.hashtags).length ? <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{tags(post.hashtags).join(" ")}</p> : null}
          {post.error_message ? <p className="mt-3 rounded-2xl bg-coral/10 px-4 py-3 text-xs font-black text-coral">{post.error_message}</p> : null}
        </article>
      ))}
    </div>
  );
}
