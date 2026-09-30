import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defineMoneyFinding, runMoneyChecks } from "./specialist-money-check-utils.mjs";

/**
 * SEO specialist money checks — organic traffic without paid ads.
 * Guards the metadata / sitemap / robots foundations so search and social
 * crawlers keep finding Roamly's key routes with rich previews.
 */

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const layout = await read("../app/layout.tsx");
const planPage = await read("../app/plan/page.tsx");
const sitemap = await read("../app/sitemap.ts");
const robots = await read("../app/robots.ts");

await runMoneyChecks(
  "SEO",
  "Grow organic traffic without paid ads: meta/OG tags, sitemap, robots, and server-rendered key routes.",
  [
    defineMoneyFinding(
      "seo-root-open-graph",
      "high",
      "Missing OG tags turn every share into a blank link card and kill social traffic.",
      () => {
        assert.match(layout, /openGraph:\s*\{/, "root layout must define Open Graph metadata");
        assert.match(layout, /twitter:\s*\{/, "root layout must define Twitter card metadata");
        assert.match(layout, /https:\/\/roamlyhq\.com\/opengraph-image/, "OG image must be an absolute URL or crawlers cannot fetch it");
      }
    ),
    defineMoneyFinding(
      "seo-plan-route-metadata",
      "high",
      "/plan is the trial-conversion page; without its own metadata it is invisible in search.",
      () => {
        assert.match(planPage, /export const metadata/, "/plan must be server-rendered with its own metadata export");
        assert.match(planPage, /openGraph/, "/plan must carry its own Open Graph tags");
      }
    ),
    defineMoneyFinding(
      "seo-sitemap-key-routes",
      "medium",
      "Key money routes missing from the sitemap may never be discovered by crawlers.",
      () => {
        for (const route of ['""', '"/plan"', '"/pricing"', '"/finds"']) {
          assert.ok(sitemap.includes(route), `sitemap must include the ${route} route`);
        }
        assert.match(sitemap, /roamly_published_seo_pages/, "sitemap must include published guide pages for compounding organic traffic");
      }
    ),
    defineMoneyFinding(
      "seo-robots-contract",
      "medium",
      "A wrong robots file either blocks crawling or wastes crawl budget on admin routes.",
      () => {
        assert.match(robots, /allow:\s*"\/"/, "robots must allow crawling of public routes");
        assert.ok(robots.includes('"/admin"') && robots.includes('"/api/cron"'), "robots must disallow admin and cron routes");
        assert.match(robots, /sitemap/i, "robots must advertise the sitemap");
      }
    ),
    defineMoneyFinding(
      "seo-no-public-noindex",
      "low",
      "An accidental noindex on public pages silently deletes organic traffic.",
      () => {
        assert.doesNotMatch(layout, /robots:\s*\{[^}]*noindex/, "public layout must not set noindex robots metadata");
      }
    )
  ]
);
