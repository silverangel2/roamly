import { chromium } from "@playwright/test";

const baseUrl = process.env.ROAMLY_BASE_URL || "http://127.0.0.1:3000";
const viewportFilter = process.env.ROAMLY_VIEWPORT;
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
    for (const phrase of ["Build your next trip", "Search stays, flights and experiences", "finds-live-options"]) {
      if (bodyText.includes(phrase)) throw new Error(`${viewport.name}: retired Finds control rendered: ${phrase}`);
    }
    if (await page.locator("form, input").count()) throw new Error(`${viewport.name}: retired native search form rendered`);

    const quickBook = page.getByRole("navigation", { name: "Quick Book" });
    for (const label of ["Stay", "Flights", "Activities", "Gear", "eSIM"]) {
      if (await quickBook.getByRole("link", { name: new RegExp(`^${label}`) }).count() !== 1) throw new Error(`${viewport.name}: missing Quick Book control: ${label}`);
    }
    const quickLinks = await quickBook.locator("a").evaluateAll((anchors) => anchors.map((anchor) => ({ text: anchor.textContent?.trim() || "", href: anchor.getAttribute("href") || "", target: anchor.getAttribute("target") || "" })));
    const byLabel = (label) => quickLinks.find((link) => link.text.startsWith(label));
    if (!byLabel("Stay")?.href.includes("stay22.com")) throw new Error(`${viewport.name}: Stay22 quick handoff is missing`);
    if (byLabel("Flights")?.href !== "#finds-flight-widget") throw new Error(`${viewport.name}: Flights must use the embedded widget anchor`);
    if (!byLabel("Activities")?.href.includes("klook.com")) throw new Error(`${viewport.name}: Klook quick handoff is missing`);
    if (!byLabel("Gear")?.href.includes("tag=roamly060-20")) throw new Error(`${viewport.name}: Amazon attribution is missing`);
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
