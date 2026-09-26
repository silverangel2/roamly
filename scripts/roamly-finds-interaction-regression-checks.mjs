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
    const hydrationErrors = [];
    const marketRequests = [];
    page.on("request", (request) => { if (request.url().includes("/api/roamly/market-search")) marketRequests.push(request.method()); });
    page.on("response", (response) => { if (response.url().includes("/api/roamly/market-search")) marketRequests.push(`status:${response.status()}`); });
    page.on("pageerror", (error) => { if (/hydration|server rendered/i.test(error.message)) hydrationErrors.push(`pageerror: ${error.message}`); });
    page.on("console", (message) => { if (message.type() === "error" && /hydration|server rendered/i.test(message.text())) hydrationErrors.push(`console: ${message.text()}`); });
    await page.route("**/api/roamly/market-search", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "AUTH_REQUIRED" }) });
    });
    await page.goto(`${baseUrl}/finds?destination=Turks%20%26%20Caicos&startDate=2026-09-26&endDate=2026-09-27`, { waitUntil: "networkidle" });

    const summary = page.locator("summary").filter({ hasText: "Search stays, flights and experiences" });
    await summary.click();
    const tabs = page.getByRole("tab");

    await page.getByRole("tab", { name: "Stays", exact: true }).click();
    await page.getByRole("textbox", { name: "Destination", exact: true }).fill("Turks & Caicos");
    await page.getByRole("textbox", { name: "Country", exact: true }).fill("turks & Caicos");
    await page.getByRole("textbox", { name: "Check in", exact: true }).fill("2026-09-26");
    await page.getByRole("textbox", { name: "Check out", exact: true }).fill("2026-09-27");
    const stayMessage = page.locator('p[aria-live="polite"]');
    const stayFormState = await page.getByRole("button", { name: "Check current stays", exact: true }).evaluate((button) => ({ formId: button.form?.id || null, valid: button.form?.checkValidity() || false }));
    if (stayFormState.formId !== "finds-live-panel" || !stayFormState.valid) throw new Error(`${viewport.name}: stay CTA form association/validity failed: ${JSON.stringify(stayFormState)}`);
    await page.getByRole("button", { name: "Check current stays", exact: true }).click();
    await page.locator('[data-find-state="terminal"]').waitFor({ state: "visible", timeout: 5000 });

    await page.getByRole("tab", { name: "Flights", exact: true }).click();
    await page.getByRole("textbox", { name: "From", exact: true }).fill("YHZ");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("LIS");
    await page.getByRole("textbox", { name: "Depart", exact: true }).fill("2026-09-26");
    const flightMessage = page.locator('p[aria-live="polite"]');
    const flightFormId = await page.getByRole("button", { name: "Check flights", exact: true }).evaluate((button) => button.form?.id || null);
    if (flightFormId !== "finds-live-panel") throw new Error(`${viewport.name}: flight CTA is not associated with the live form`);
    await page.getByRole("button", { name: "Check flights", exact: true }).click();
    if (!marketRequests.includes("POST")) throw new Error(`${viewport.name}: flight CTA did not start a provider request`);
    await page.locator('[data-find-state="terminal"]').waitFor({ state: "visible", timeout: 5000 });

    await page.getByRole("tab", { name: "Things to do", exact: true }).click();
    await page.getByRole("textbox", { name: "What sounds fun?", exact: true }).fill("museum");
    const activityMessage = page.locator('p[aria-live="polite"]');
    const activityFormId = await page.getByRole("button", { name: "Explore experiences", exact: true }).evaluate((button) => button.form?.id || null);
    if (activityFormId !== "finds-live-panel") throw new Error(`${viewport.name}: activity CTA is not associated with the live form`);
    await page.getByRole("button", { name: "Explore experiences", exact: true }).click();
    if (marketRequests.filter((item) => item === "POST").length < 3) throw new Error(`${viewport.name}: activity CTA did not start a provider request`);
    await page.locator('[data-find-state="terminal"]').waitFor({ state: "visible", timeout: 5000 });

    await tabs.filter({ hasText: "Things to do" }).press("ArrowRight");
    await page.getByRole("tab", { name: "Travel essentials", exact: true }).click();
    if (await page.locator("#finds-live-panel").innerText() === "") throw new Error(`${viewport.name}: travel essentials tab produced no rendered outcome`);
    await page.getByRole("tab", { name: "Getting around", exact: true }).click();
    if (await page.locator("#finds-live-panel").innerText() === "") throw new Error(`${viewport.name}: getting around tab produced no rendered outcome`);
    for (const [label, target] of [["Worth packing", "worth-packing"], ["Stays", "stay-heading"], ["Flights", "flights-heading"], ["Things to do", "activities-heading"], ["More to explore", "travel-tools-heading"]]) {
      await page.getByRole("link", { name: label, exact: true }).click();
      if (await page.locator(`#${target}`).count() !== 1) throw new Error(`${viewport.name}: section target missing for ${label}`);
      if (new URL(page.url()).hash !== `#${target}`) throw new Error(`${viewport.name}: section hash did not update for ${label}`);
    }
    if (hydrationErrors.length) throw new Error(`${viewport.name}: hydration error: ${hydrationErrors[0]}`);
    console.log(`${viewport.name}: rendered CTA and keyboard-tab interaction passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
