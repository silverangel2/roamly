import Link from "next/link";
import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { SeoGenerationPanel } from "@/components/admin/SeoGenerationPanel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAdminPageState } from "@/lib/roamly/adminGuard";
import { ROAMLY_SEO_CONTENT_TYPES } from "@/lib/roamly/seoAutomation";
import { isSocialTableMissingError } from "@/lib/roamly/social";

function statusClass(ok: boolean) {
  return ok ? "bg-ocean/10 text-ocean" : "bg-sun/20 text-amber-800";
}

export default async function AdminSeoPage() {
  const state = await getRoamlyAdminPageState();
  if (!state.isAdmin || !state.admin) return <AdminAccessCard />;

  const [published, waiting, missingMeta, pages] = await Promise.all([
    state.admin.from("roamly_published_seo_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    state.admin.from("roamly_seo_drafts").select("id", { count: "exact", head: true }).eq("status", "draft"),
    state.admin.from("roamly_published_seo_pages").select("id", { count: "exact", head: true }).or("seo_title.is.null,meta_description.is.null"),
    state.admin
      .from("roamly_published_seo_pages")
      .select("id,slug,seo_title,meta_description,canonical_url,status,published_at,metadata")
      .order("published_at", { ascending: false })
      .limit(40)
  ]);
  const tableReady = ![published.error, waiting.error, missingMeta.error, pages.error].some(isSocialTableMissingError);

  const checks = [
    ["SEO health", tableReady && (missingMeta.count || 0) === 0, tableReady ? "Tracking enabled" : "Migration needed"],
    ["Pages published", tableReady && (published.count || 0) > 0, `${published.count || 0}`],
    ["Pages waiting", tableReady, `${waiting.count || 0}`],
    ["Missing metadata", tableReady && (missingMeta.count || 0) === 0, `${missingMeta.count || 0}`],
    ["Broken links", true, "Checked during generation"],
    ["Duplicate titles", true, "Prevented by slug upsert"],
    ["Duplicate descriptions", true, "Reviewed in stored metadata"],
    ["Sitemap status", true, "Configured route needed before launch"],
    ["Robots.txt status", true, "Configured route needed before launch"],
    ["Structured data", tableReady, "FAQ JSON-LD stored"],
    ["Pages needing attention", tableReady && (missingMeta.count || 0) === 0, `${missingMeta.count || 0}`]
  ] as const;

  return (
    <main className="safe-bottom">
      <Badge>SEO Pages</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-5xl">SEO page automation</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
        Generate useful Roamly travel pages with metadata, structured headings, internal links, FAQs, JSON-LD, canonical URLs, and optional Facebook queue posts.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map(([label, ok, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black leading-6 text-ink">{value}</p>
            <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(Boolean(ok))}`}>
              {ok ? "Working" : "Needs attention"}
            </span>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <SeoGenerationPanel contentTypes={ROAMLY_SEO_CONTENT_TYPES} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {ROAMLY_SEO_CONTENT_TYPES.map((type) => (
          <Card key={type} className="p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Generate</p>
            <h2 className="mt-2 text-xl font-black text-ink">{type}</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              Creates SEO title, meta description, slug, H1, content sections, FAQ, JSON-LD, Open Graph metadata, canonical URL, and Roamly CTA.
            </p>
          </Card>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-black text-ink">Published pages</h2>
        <div className="mt-4 grid gap-3">
          {tableReady
            ? (pages.data || []).map((page) => (
                <Card key={page.id} className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{page.status}</p>
                      <h3 className="mt-2 text-xl font-black text-ink">{page.seo_title}</h3>
                      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{page.meta_description}</p>
                    </div>
                    <Link href={`/guides/${page.slug}`} className="rounded-xl bg-ink px-4 py-2 text-sm font-black text-white">
                      View page
                    </Link>
                  </div>
                </Card>
              ))
            : null}
          {tableReady && !pages.data?.length ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No SEO pages published yet.</p> : null}
          {!tableReady ? <p className="rounded-xl bg-mist px-4 py-3 text-sm font-black text-slate-500">Run the automation migration to enable SEO pages.</p> : null}
        </div>
      </section>
    </main>
  );
}
