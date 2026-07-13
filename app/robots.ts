import type { MetadataRoute } from "next";
import { ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/admin", "/api/cron"]
    },
    sitemap: `${ROAMLY_PUBLIC_DOMAIN}/sitemap.xml`
  };
}
