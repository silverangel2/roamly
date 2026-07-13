import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";

type GuidePageProps = {
  params: Promise<{ slug: string }>;
};

type GuideContent = {
  headings?: Array<{ heading?: string; body?: string }>;
  internalLinks?: Array<{ label?: string; href?: string }>;
  faq?: Array<{ question?: string; answer?: string }>;
  cta?: { label?: string; href?: string };
  affiliateDisclosure?: string;
};

type GuidePageRow = {
  slug: string;
  seo_title: string;
  meta_description: string;
  h1: string;
  canonical_url: string | null;
  content: GuideContent | null;
  json_ld: Record<string, unknown> | null;
  og_metadata: Record<string, unknown> | null;
  status: string;
};

async function getPage(slug: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("roamly_published_seo_pages")
    .select("slug,seo_title,meta_description,h1,canonical_url,content,json_ld,og_metadata,status")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  return (data as GuidePageRow | null) || null;
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return {};
  const canonical = page.canonical_url || `${ROAMLY_PUBLIC_DOMAIN}/guides/${page.slug}`;
  return {
    title: page.seo_title,
    description: page.meta_description,
    alternates: { canonical },
    openGraph: {
      title: page.seo_title,
      description: page.meta_description,
      url: canonical,
      siteName: "Roamly",
      type: "article"
    }
  };
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const content = page.content || {};
  const ctaHref = content.cta?.href || "/plan";
  const ctaLabel = content.cta?.label || "Start planning your trip";

  return (
    <main className="safe-bottom mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {page.json_ld ? (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(page.json_ld) }}
        />
      ) : null}
      <Badge>Roamly Guide</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">{page.h1}</h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-600">{page.meta_description}</p>
      <div className="mt-6">
        <Link href={ctaHref} className="inline-flex rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft">
          {ctaLabel}
        </Link>
      </div>

      <section className="mt-8 grid gap-5">
        {(content.headings || []).map((section) => (
          <Card key={section.heading} className="p-5">
            <h2 className="text-2xl font-black text-ink">{section.heading}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">{section.body}</p>
          </Card>
        ))}
      </section>

      {content.internalLinks?.length ? (
        <section className="mt-8">
          <h2 className="text-2xl font-black text-ink">Useful Roamly links</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {content.internalLinks.map((link) => (
              <Link key={link.href} href={link.href || "/plan"} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-ink shadow-soft ring-1 ring-cloud">
                {link.label || "Open Roamly"}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {content.faq?.length ? (
        <section className="mt-8">
          <h2 className="text-2xl font-black text-ink">FAQ</h2>
          <div className="mt-4 grid gap-3">
            {content.faq.map((item) => (
              <Card key={item.question} className="p-5">
                <h3 className="text-lg font-black text-ink">{item.question}</h3>
                <p className="mt-2 text-sm font-bold leading-7 text-slate-600">{item.answer}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {content.affiliateDisclosure ? (
        <p className="mt-8 rounded-xl bg-sun/15 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{content.affiliateDisclosure}</p>
      ) : null}
    </main>
  );
}
