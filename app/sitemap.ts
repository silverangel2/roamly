import type { MetadataRoute } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = ROAMLY_PUBLIC_DOMAIN;
  const staticRoutes = ["", "/plan", "/pricing", "/contact", "/privacy", "/terms"].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7
  }));

  const admin = createSupabaseAdminClient();
  if (!admin) return staticRoutes;

  const { data } = await admin
    .from("roamly_published_seo_pages")
    .select("slug,updated_at,published_at")
    .eq("status", "published")
    .limit(500);

  const guideRoutes = (data || []).map((page) => ({
    url: `${base}/guides/${page.slug}`,
    lastModified: new Date(page.updated_at || page.published_at || Date.now()),
    changeFrequency: "monthly" as const,
    priority: 0.65
  }));

  return [...staticRoutes, ...guideRoutes];
}
