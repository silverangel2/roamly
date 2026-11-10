import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
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

/*
 * D14 (consolidation 2026-11-06): guides published before the
 * generator started writing internalLinks render their "Useful
 * Roamly links" section EMPTY. The page now falls back to the
 * same standard link set the generator writes today, so a
 * published guide never shows an empty links section.
 */
const DEFAULT_GUIDE_LINKS = [
  { label: "Plan a trip with Roamly", href: "/plan" },
  { label: "Roamly pricing", href: "/pricing" },
  { label: "Contact Roamly support", href: "/contact" }
];

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
      type: "article",
      images: [
        {
          url: "https://roamlyhq.com/opengraph-image",
          width: 1200,
          height: 630,
          alt: page.seo_title
        }
      ]
    }
  };
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const content = page.content || {};
  const guideLinks = content.internalLinks?.length ? content.internalLinks : DEFAULT_GUIDE_LINKS;
  const ctaHref = content.cta?.href || "/plan";
  const ctaLabel = content.cta?.label || "Start planning your trip";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {page.json_ld ? (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(page.json_ld).replace(/</g, "\u003c") }}
        />
      ) : null}
      <BuiBadge>Roamly Guide</BuiBadge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-chead sm:text-6xl">{page.h1}</h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-cink">{page.meta_description}</p>
      <div className="mt-6">
        <BuiButtonLink href={ctaHref}>
          {ctaLabel}
        </BuiButtonLink>
      </div>

      <section className="mt-8 grid gap-5">
        {(content.headings || []).map((section) => (
          <BuiCard key={section.heading} className="p-5">
            <h2 className="text-2xl font-black text-chead">{section.heading}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-cink">{section.body}</p>
          </BuiCard>
        ))}
      </section>

      {guideLinks.length ? (
        <section className="mt-8">
          <h2 className="text-2xl font-black text-chead">Useful Roamly links</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {guideLinks.map((link) => (
              <Link key={link.href} href={link.href || "/plan"} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-chead shadow-soft ring-1 ring-chair">
                {link.label || "Open Roamly"}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {content.faq?.length ? (
        <section className="mt-8">
          <h2 className="text-2xl font-black text-chead">FAQ</h2>
          <div className="mt-4 grid gap-3">
            {content.faq.map((item) => (
              <BuiCard key={item.question} className="p-5">
                <h3 className="text-lg font-black text-chead">{item.question}</h3>
                <p className="mt-2 text-sm font-bold leading-7 text-cink">{item.answer}</p>
              </BuiCard>
            ))}
          </div>
        </section>
      ) : null}

      {content.affiliateDisclosure ? (
        <p className="mt-8 rounded-xl bg-sun/15 px-4 py-3 text-sm font-bold leading-6 text-chead">{content.affiliateDisclosure}</p>
      ) : null}
    </div>
  );
}
