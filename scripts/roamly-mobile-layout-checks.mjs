import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseUrl = process.env.ROAMLY_MOBILE_BASE_URL || "http://127.0.0.1:3318";
const routes = ["/", "/plan", "/finds?destination=Lisbon", "/play"];
const widths = [320, 375, 390];
const browser = await chromium.launch({ headless: true });

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });

    for (const route of routes) {
      const page = await context.newPage();
      const response = await page.goto(new URL(route, baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });
      assert.ok(response?.ok(), `${route} returned ${response?.status()} at ${width}px`);
      await page.evaluate(() => document.fonts.ready);

      const metrics = await page.evaluate(() => {
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        const mobileNav = [...document.querySelectorAll("nav")].find((nav) =>
          getComputedStyle(nav).position === "fixed" && getComputedStyle(nav).display !== "none"
        );
        const links = mobileNav ? [...mobileNav.querySelectorAll("a")] : [];
        const puzzle = document.querySelector('[aria-label^="Jigsaw puzzle"]');
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          nav: mobileNav ? rect(mobileNav) : null,
          navLinks: links.map((link) => ({
            label: link.textContent?.trim() || "",
            ...rect(link),
            clientWidth: link.clientWidth,
            scrollWidth: link.scrollWidth
          })),
          puzzle: puzzle ? rect(puzzle) : null
        };
      });

      assert.ok(
        metrics.documentWidth <= width + 1 && metrics.bodyWidth <= width + 1,
        `${route} overflows horizontally at ${width}px: ${JSON.stringify(metrics)}`
      );
      for (const link of metrics.navLinks) {
        assert.ok(link.x >= 0 && link.x + link.width <= width + 1, `Mobile nav link is outside the viewport at ${width}px: ${JSON.stringify(link)}`);
        assert.ok(link.scrollWidth <= link.clientWidth + 1, `Mobile nav label overflows its target at ${width}px: ${JSON.stringify(link)}`);
      }
      if (metrics.puzzle) {
        assert.ok(metrics.puzzle.width <= width + 1, `Puzzle board exceeds the viewport at ${width}px`);
      }

      console.log(`PASS ${width}px ${route}`);
      await page.close();
    }

    await context.close();
  }
} finally {
  await browser.close();
}
