import { chromium } from "@playwright/test";

const baseUrl = process.env.ROAMLY_BASE_URL || "http://127.0.0.1:3000";
const viewportFilter = process.env.ROAMLY_VIEWPORT;
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 }
  ].filter((candidate) => !viewportFilter || candidate.name === viewportFilter)) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.name === "mobile",
      hasTouch: viewport.name === "mobile"
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!/events\/app|trips\/active|location\/settings|tp-em\.com|config is not valid|CORS policy|Failed to load resource/i.test(text)) errors.push(text);
    });

    const response = await page.goto(`${baseUrl}/finds`, { waitUntil: "networkidle" });
    if (!response || response.status() !== 200) throw new Error(`${viewport.name}: Finds did not load: ${response?.status()}`);

    if (await page.locator("form, input, summary, [role=tab]").count()) {
      throw new Error(`${viewport.name}: retired Finds forms or accordion controls are still rendered`);
    }
    const bodyText = await page.locator("body").innerText();
    for (const phrase of ["Build your next trip", "Search stays", "Check flights", "Explore experiences", "finds-live-panel"]) {
      if (bodyText.includes(phrase)) throw new Error(`${viewport.name}: retired Finds phrase rendered: ${phrase}`);
    }

    const links = await page.locator("a[target='_blank']").evaluateAll((anchors) => anchors.map((anchor) => ({
      text: anchor.textContent?.replace(/\s+/g, " ").trim() || "",
      href: anchor.href,
      rel: anchor.getAttribute("rel") || ""
    })));
    const expected = ["Book your stay", "Find flights", "Book activities", "Shop travel gear", "Get an eSIM"];
    for (const title of expected) {
      if (!links.some((link) => link.text.includes(title))) throw new Error(`${viewport.name}: missing direct partner card: ${title}`);
    }
    const stay = links.find((link) => link.text.includes("Book your stay"));
    const flight = links.find((link) => link.text.includes("Find flights"));
    const activity = links.find((link) => link.text.includes("Book activities"));
    const gear = links.find((link) => link.text.includes("Shop travel gear"));
    const esim = links.find((link) => link.text.includes("Get an eSIM"));
    if (!stay?.href.includes("booking.stay22.com/roamly/")) throw new Error(`${viewport.name}: Stay22 handoff is wrong: ${stay?.href}`);
    if (!flight?.href.includes("tpwdgt.com/content") || !flight.href.includes("shmarker=750294")) throw new Error(`${viewport.name}: flight handoff lost Travelpayouts attribution`);
    if (!activity?.href.includes("klook.com") || (!activity.href.includes("aid=") && !activity.href.includes("k_site="))) throw new Error(`${viewport.name}: Klook handoff lost partner attribution`);
    if (!gear?.href.includes("amazon.ca") || !gear.href.includes("tag=roamly060-20")) throw new Error(`${viewport.name}: Amazon handoff lost roamly060-20`);
    if (!esim?.href.includes("tpwdgt.com/content") || !esim.href.includes("promo_id=8588") || !esim.href.includes("campaign_id=541")) throw new Error(`${viewport.name}: eSIM handoff lost campaign attribution`);
    if (links.some((link) => link.rel !== "noopener noreferrer")) throw new Error(`${viewport.name}: external card is missing safe opener isolation`);
    if (errors.length) throw new Error(`${viewport.name}: browser error: ${errors[0]}`);

    console.log(`${viewport.name}: direct Finds partner cards passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
