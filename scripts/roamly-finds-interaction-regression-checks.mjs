import { chromium } from "@playwright/test";

const baseUrl = process.env.ROAMLY_BASE_URL || "http://127.0.0.1:3000";
const viewportFilter = process.env.ROAMLY_VIEWPORT;

// FORMAL GATE (Stage 4 test-net repair, 2026-11-10 — GATES register
// entry GATE-SERVED-BUILD): this suite drives a REAL served build of
// the app. When no server answers at the base URL it SKIPS with this
// named reason; when one answers — any HTTP response at all — every
// check below runs at full strength and judges what it serves.
try {
  await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
} catch {
  console.log(`GATED test:finds-interactions — missing service: the Roamly app served at ${baseUrl} (point ROAMLY_BASE_URL at a running build). See GATES.md entry GATE-SERVED-BUILD.`);
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 }
  ].filter((candidate) => !viewportFilter || candidate.name === viewportFilter)) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!/events\/app|trips\/active|location\/settings|tp-em\.com|config is not valid|CORS policy|Failed to load resource/i.test(text)) errors.push(text);
    });

    const response = await page.goto(`${baseUrl}/finds`, { waitUntil: "networkidle" });
    if (!response || response.status() !== 200) throw new Error(`${viewport.name}: Finds did not load: ${response?.status()}`);
    const bodyText = await page.locator("body").innerText();
    for (const phrase of ["Build your next trip", "Search stays, flights and experiences"]) {
      if (bodyText.includes(phrase)) throw new Error(`${viewport.name}: retired Finds control rendered: ${phrase}`);
    }
    // RE-PIN (A19, Jakob's Law round, 2026-11-03): the old pin ("no
    // native search form may render") encoded the pre-A19 editorial-only
    // surface. A19 orders a persistent search entry at the top of Deals
    // routing into the existing live tools, so the pin asserts that
    // entry exists exactly once and carries one search field, and sits
    // above the editorial shelves — equal strictness, new ordered
    // behaviour.
    // RE-PIN (Stage 4, 2026-11-10): the A19 pin also demanded the three
    // category controls as buttons INSIDE #finds-search. The NEW-5
    // consolidation (2026-11-06, documented in FindsTabs.tsx) removed
    // those pills on purpose: the tab row is the page's single category
    // control, the search follows the active tab, and the live tools
    // (tablist + panels) render once the search is opened. The pin now
    // drives that real behaviour: submit the entry, the tablist must
    // appear with exactly one tab per category, and switching tabs
    // must re-route the search entry (its state line follows the tab).
    if (await page.locator("#finds-search").count() !== 1) throw new Error(`${viewport.name}: persistent Deals search entry is missing`);
    if (await page.locator('#finds-search input[name="findsQuery"]').count() !== 1) throw new Error(`${viewport.name}: Deals search field is missing`);
    await page.locator('#finds-search input[name="findsQuery"]').fill("Lisbon");
    await page.locator("#finds-search").getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("tab", { name: "Stays", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    for (const label of ["Stays", "Flights", "Things to do"]) {
      if (await page.getByRole("tab", { name: label, exact: true }).count() !== 1) throw new Error(`${viewport.name}: Deals category tab is missing: ${label}`);
    }
    await page.getByRole("tab", { name: "Flights", exact: true }).click();
    if (!(await page.locator("#finds-search").innerText()).includes("Searching flights")) throw new Error(`${viewport.name}: Flights tab does not route the search entry to flights`);
    await page.getByRole("tab", { name: "Things to do", exact: true }).click();
    if (!(await page.locator("#finds-search").innerText()).includes("Searching things to do")) throw new Error(`${viewport.name}: Things to do tab does not route the search entry to activities`);
    await page.getByRole("tab", { name: "Stays", exact: true }).click();
    const searchBeforeShelves = await page.evaluate(() => {
      const search = document.querySelector("#finds-search");
      const shelves = document.querySelector("#worth-packing");
      if (!search || !shelves) return false;
      return Boolean(search.compareDocumentPosition(shelves) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (!searchBeforeShelves) throw new Error(`${viewport.name}: Deals search entry must sit above the editorial shelves`);

    const quickBook = page.getByRole("navigation", { name: "Quick Book" });
    for (const label of ["Stay", "Flights", "Activities", "Gear", "eSIM"]) {
      if (await quickBook.getByRole("link", { name: new RegExp(`^${label}`) }).count() !== 1) throw new Error(`${viewport.name}: missing Quick Book control: ${label}`);
    }
    const quickLinks = await quickBook.locator("a").evaluateAll((anchors) => anchors.map((anchor) => ({ text: anchor.textContent?.trim() || "", href: anchor.getAttribute("href") || "", target: anchor.getAttribute("target") || "" })));
    const byLabel = (label) => quickLinks.find((link) => link.text.startsWith(label));
    if (!byLabel("Stay")?.href.includes("stay22.com")) throw new Error(`${viewport.name}: Stay22 quick handoff is missing`);
    if (byLabel("Flights")?.href !== "#finds-flight-widget") throw new Error(`${viewport.name}: Flights must use the embedded widget anchor`);
    if (!byLabel("Activities")?.href.includes("klook.com")) throw new Error(`${viewport.name}: Klook quick handoff is missing`);
    // R-1 CORRECTION (2026-11-10, final audit fold-in): this pin previously asserted
    // "tag=roamly060-20" — the retired Canada-only tag (owner's records, R-1 resolution
    // 2026-11-10). The Quick Book Gear link carries the unified international tag
    // roamly02e-20 and, since the same fold-in, builds on amazon.com (per-storefront
    // tags earn nothing cross-store). Pin now asserts the true served href.
    if (!byLabel("Gear")?.href.includes("amazon.com/s?k=travel+gear+essentials&tag=roamly02e-20")) throw new Error(`${viewport.name}: Amazon attribution is missing`);
    if (byLabel("eSIM")?.href !== "#finds-esim-widget") throw new Error(`${viewport.name}: eSIM must use the embedded widget anchor`);
    if (await page.locator("#finds-flight-widget").count() !== 1 || await page.locator("#finds-esim-widget").count() !== 1) throw new Error(`${viewport.name}: embedded flight/eSIM widget anchors are missing`);
    for (const phrase of ["Worth packing", "Flights worth checking", "Things worth doing", "More ways to explore", "Stay connected"]) {
      if (!bodyText.includes(phrase)) throw new Error(`${viewport.name}: restored editorial/widget section is missing: ${phrase}`);
    }
    if (quickLinks.filter((link) => link.target === "_blank").some((link) => link.text.startsWith("Flights") || link.text.startsWith("eSIM"))) throw new Error(`${viewport.name}: broken raw widget URLs are used as quick external links`);
    if (errors.length) throw new Error(`${viewport.name}: browser error: ${errors[0]}`);

    console.log(`${viewport.name}: Quick Book plus restored Finds widgets passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
