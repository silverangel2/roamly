import type { SupabaseClient } from "@supabase/supabase-js";
import { ROAMLY_AFFILIATE_DISCLOSURE, ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";
import { queueFacebookPostForSeoPage } from "@/lib/roamly/socialAutomation";

export const ROAMLY_SEO_CONTENT_TYPES = [
  "Destination guides",
  "Travel itineraries",
  "Road-trip guides",
  "Budget guides",
  "Packing guides",
  "Travel checklists",
  "Things-to-do pages",
  "Weekend guides",
  "Safety guides",
  "Travel-product pages"
];

function clean(value?: string | null) {
  return (value || "").trim();
}

function slug(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function guideTopic(contentType: string, topic?: string | null) {
  const base = clean(topic);
  if (base) return base;
  if (/packing/i.test(contentType)) return "Carry-on packing checklist";
  if (/budget/i.test(contentType)) return "Budget-friendly weekend trip planning";
  if (/road/i.test(contentType)) return "Easy road-trip planning";
  if (/safety/i.test(contentType)) return "Travel safety checklist";
  if (/product/i.test(contentType)) return "Useful travel essentials";
  if (/things/i.test(contentType)) return "Things to do on a first visit";
  if (/itinerar/i.test(contentType)) return "Three-day city itinerary";
  return "Smart travel planning";
}

function sectionsFor(contentType: string, topic: string) {
  const shared = [
    {
      heading: `Why ${topic.toLowerCase()} works better with a plan`,
      body:
        "A useful travel page should make the next decision easier. Start with the route, dates, budget, booking details, and travel-day needs before adding optional activities."
    },
    {
      heading: "What to decide first",
      body:
        "Confirm the destination, trip length, arrival window, daily pace, and must-do activities. Then use those decisions to shape lodging, transportation, packing, and reminders."
    },
    {
      heading: "How Roamly helps",
      body:
        "Roamly connects itinerary planning, budget checks, booking organization, and live trip support so the plan stays realistic before and during travel."
    }
  ];

  if (/product/i.test(contentType)) {
    return [
      ...shared,
      {
        heading: "How to choose travel products",
        body:
          "Choose gear that matches the actual itinerary. Avoid buying for every possible situation, and check baggage rules, weather, transit time, and comfort needs first."
      }
    ];
  }

  if (/packing|checklist/i.test(contentType)) {
    return [
      ...shared,
      {
        heading: "Simple checklist",
        body:
          "Pack documents, chargers, medication, weather layers, comfortable shoes, one backup payment method, and only the activity-specific items your itinerary really needs."
      }
    ];
  }

  return [
    ...shared,
    {
      heading: "A practical next step",
      body:
        "Build a draft itinerary, check the daily pace, save important bookings, and leave space for meals, transit, rest, and one flexible option each day."
    }
  ];
}

export function buildSeoDraft(contentType: string, topicInput?: string | null) {
  const topic = guideTopic(contentType, topicInput);
  const pageSlug = slug(`${topic}-${contentType}`);
  const seoTitle = `${topic}: Roamly ${contentType.replace(/s$/i, "")}`;
  const metaDescription = `Plan ${topic.toLowerCase()} with practical tips, internal links, FAQs, and a Roamly travel-planning CTA.`;
  const canonicalUrl = `${ROAMLY_PUBLIC_DOMAIN}/guides/${pageSlug}`;
  const includeAffiliateDisclosure = /product|packing/i.test(contentType);
  const faq = [
    {
      question: `What should I plan first for ${topic.toLowerCase()}?`,
      answer: "Start with dates, route, budget, lodging, transportation, and the activities that matter most."
    },
    {
      question: "Can Roamly help create the plan?",
      answer: "Yes. Roamly helps build practical itineraries, organize booking details, and keep travel-day reminders together."
    },
    {
      question: "Should I add affiliate product links?",
      answer: "Only when a product is directly relevant to the travel topic, and always include the required disclosure."
    }
  ];
  return {
    contentType,
    topic,
    seoTitle,
    metaDescription,
    slug: pageSlug,
    h1: seoTitle,
    canonicalUrl,
    content: {
      headings: sectionsFor(contentType, topic),
      internalLinks: [
        { label: "Plan a trip with Roamly", href: "/plan" },
        { label: "Roamly pricing", href: "/pricing" },
        { label: "Contact Roamly support", href: "/contact" }
      ],
      faq,
      cta: {
        label: "Start planning your trip",
        href: "/plan"
      },
      affiliateDisclosure: includeAffiliateDisclosure ? ROAMLY_AFFILIATE_DISCLOSURE : ""
    },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer
        }
      }))
    },
    ogMetadata: {
      title: seoTitle,
      description: metaDescription,
      url: canonicalUrl,
      type: "article"
    }
  };
}

export async function generateAndPublishSeoPage(
  admin: SupabaseClient,
  {
    contentType,
    topic,
    actorEmail,
    queueSocialPost = true
  }: {
    contentType: string;
    topic?: string | null;
    actorEmail?: string | null;
    queueSocialPost?: boolean;
  }
) {
  const selectedType = ROAMLY_SEO_CONTENT_TYPES.includes(contentType) ? contentType : ROAMLY_SEO_CONTENT_TYPES[0];
  const draft = buildSeoDraft(selectedType, topic);
  const { data: draftRow, error: draftError } = await admin
    .from("roamly_seo_drafts")
    .upsert(
      {
        content_type: draft.contentType,
        topic: draft.topic,
        seo_title: draft.seoTitle,
        meta_description: draft.metaDescription,
        slug: draft.slug,
        h1: draft.h1,
        content: draft.content,
        status: "published",
        quality_score: 92,
        metadata: { canonicalUrl: draft.canonicalUrl, ogMetadata: draft.ogMetadata, jsonLd: draft.jsonLd },
        created_by: actorEmail || null
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();
  if (draftError) return { ok: false as const, error: draftError.message };

  const { data: page, error: pageError } = await admin
    .from("roamly_published_seo_pages")
    .upsert(
      {
        draft_id: draftRow.id,
        slug: draft.slug,
        seo_title: draft.seoTitle,
        meta_description: draft.metaDescription,
        h1: draft.h1,
        content: draft.content,
        canonical_url: draft.canonicalUrl,
        og_metadata: draft.ogMetadata,
        json_ld: draft.jsonLd,
        status: "published",
        metadata: { contentType: draft.contentType, topic: draft.topic }
      },
      { onConflict: "slug" }
    )
    .select("id,slug")
    .single();
  if (pageError) return { ok: false as const, error: pageError.message };

  const social = queueSocialPost
    ? await queueFacebookPostForSeoPage(
        admin,
        {
          slug: draft.slug,
          seoTitle: draft.seoTitle,
          metaDescription: draft.metaDescription,
          contentType: draft.contentType,
          canonicalUrl: draft.canonicalUrl
        },
        actorEmail
      )
    : null;

  return {
    ok: true as const,
    page,
    draft,
    social
  };
}
