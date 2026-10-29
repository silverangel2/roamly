// roamly-ux-offline-proof.mjs — OFFLINE RESTORATION PROOF (2026-10-27,
// local only, headless Chromium). Proves in a real browser:
//  (a) offline→online recovery (offline label visible offline, cleared online);
//  (b) sign-out cache clearing (caches empty, no trip content restores);
//  (c) trip switching online + offline (selected trip's content only);
//  (d) per-account isolation (account switch deletes the prior cache);
//  (e) no credential material in any cached body (checked in-memory,
//      values never printed).
// Headless bound (stated, not hidden): the headless browser cannot
// egress through the VM proxy, so the page's Supabase getUser() cannot
// return the tester id; the proof posts the SAME roamly_set_user
// message the ServiceWorkerRegistrar posts on a real phone, carrying
// the real tester user id obtained via node sign-in (never printed).
// Captures: renders/offline-2026-10-27/ (390px + 320px offline render).
// Run with SUPABASE_URL + SUPABASE_KEY from the 0600 .render-env.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/package.json");
const { chromium } = require("playwright-core");
const { createServerClient } = require("@supabase/ssr");

const BASE = "http://localhost:3100";
const OUT = "/home/hatch/workspace/roamly-ux-repair-2026-10-25/renders/offline-2026-10-27";
mkdirSync(OUT, { recursive: true });
const MONTREAL = "4e5ac222-4ba9-4cb9-ba4b-ce618a03059f";
const TORONTO = "fd7ed132-3a67-43d5-9cab-754141c14324";
const EXE = "/home/hatch/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const env = Object.fromEntries(readFileSync("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/.render-env", "utf8").trim().split("\n").map((l) => l.split("=")));
const account = JSON.parse(readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-secrets/test-account.json", "utf8"));
const jar = new Map();
const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (list) => { for (const c of list) jar.set(c.name, c.value); } }
});
const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
if (signInError) { console.error("sign-in failed:", signInError.message); process.exit(3); }
const testerUserId = signInData.user.id; // used, never printed
const sessionCookieValues = [...jar.values()]; // checked in-memory only, never printed
const cookies = [...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const report = { steps: [], generatedAt: new Date().toISOString() };
function log(step, obj) { report.steps.push({ step, ...obj }); console.log(`--- ${step}: ${JSON.stringify(obj)}`); }

async function makeCtx(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, userAgent: IPHONE_UA, locale: "en-CA", timezoneId: "America/Moncton" });
  await ctx.addCookies(cookies);
  return ctx;
}
async function postToWorker(page, message) {
  await page.evaluate(async (msg) => {
    const reg = await navigator.serviceWorker.ready;
    const target = reg.active || navigator.serviceWorker.controller;
    target?.postMessage(msg);
  }, message);
  await page.waitForTimeout(800);
}
async function cacheInventory(page) {
  return page.evaluate(async () => {
    const names = await caches.keys().catch(() => []);
    const detail = {};
    for (const name of names) {
      try { const c = await caches.open(name); detail[name] = (await c.keys()).map((r) => r.url.replace(location.origin, "")); } catch {}
    }
    return detail;
  });
}
async function bodyInfo(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    const banner = document.querySelector('[data-testid="offline-trip-banner"]');
    const fallback = document.querySelector('[data-testid="roamly-photo-fallback"]');
    return {
      chars: text.length,
      hasMontreal: text.includes("Montreal"),
      hasToronto: text.includes("Toronto"),
      hasDay1: /Day 1/.test(text),
      hasMusee: text.includes("Musée"),
      // Final local round (2026-10-27): branded photo fallback —
      // true when the trip photo could not load offline and the
      // Roamly placeholder renders instead of a bare gradient.
      hasPhotoFallback: Boolean(fallback),
      photoFallbackText: fallback ? fallback.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : null,
      banner: banner ? banner.textContent.replace(/\s+/g, " ").trim() : null,
      head: text.replace(/\s+/g, " ").slice(0, 220)
    };
  });
}
async function skipGate(page, tripId) {
  await page.goto(`${BASE}/trip/${tripId}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const link = [...document.querySelectorAll("a")].find((a) => (a.textContent || "").trim().startsWith("Skip for now"));
    if (link) link.click();
  });
  await page.waitForTimeout(3000);
}
async function loadOnline(page, tripId) {
  // Full online load + controlled reload so the worker (now controlling)
  // caches the document, trip APIs, and RSC payloads.
  await page.goto(`${BASE}/trip/${tripId}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3500);
}

// ================= MAIN SEQUENCE (390px) =================
const ctx = await makeCtx(390);
const page = await ctx.newPage();
await page.goto(`${BASE}/trip/${MONTREAL}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);
await postToWorker(page, { type: "roamly_set_user", userId: testerUserId });
await skipGate(page, MONTREAL);
await loadOnline(page, MONTREAL);
const invMontreal = await cacheInventory(page);
log("online-montreal-cached", { docsCache: Object.keys(invMontreal).filter((k) => k.includes("docs-")), entries: Object.values(invMontreal).flat() });
await skipGate(page, TORONTO);
await loadOnline(page, TORONTO);
const invBoth = await cacheInventory(page);
log("online-both-cached", { entries: Object.values(invBoth).flat() });

// Online Montreal (label must be ABSENT) + capture for the side-by-side set.
await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3000);
const onlineInfo = await bodyInfo(page);
log("online-montreal", { banner: onlineInfo.banner, hasMontreal: onlineInfo.hasMontreal, hasDay1: onlineInfo.hasDay1, chars: onlineInfo.chars });
await page.screenshot({ path: join(OUT, "online-montreal-390-viewport.png") });

// (a) OFFLINE: Montreal restores WITH the label.
await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch((e) => console.log("offline reload err:", String(e).slice(0, 150)));
await page.waitForTimeout(3000);
const offlineInfo = await bodyInfo(page);
log("offline-montreal", { banner: offlineInfo.banner, hasMontreal: offlineInfo.hasMontreal, hasDay1: offlineInfo.hasDay1, hasMusee: offlineInfo.hasMusee, hasPhotoFallback: offlineInfo.hasPhotoFallback, photoFallbackText: offlineInfo.photoFallbackText, chars: offlineInfo.chars });
await page.screenshot({ path: join(OUT, "offline-montreal-390-viewport.png") });

// (c) OFFLINE trip switching: Toronto offline shows Toronto, never Montreal content.
await page.goto(`${BASE}/trip/${TORONTO}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((e) => console.log("offline toronto nav err:", String(e).slice(0, 150)));
await page.waitForTimeout(3000);
const offlineToronto = await bodyInfo(page);
log("offline-toronto-switch", { banner: offlineToronto.banner, hasToronto: offlineToronto.hasToronto, hasMontreal: offlineToronto.hasMontreal, chars: offlineToronto.chars });
await page.screenshot({ path: join(OUT, "offline-toronto-390-viewport.png") });
await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);
const offlineBack = await bodyInfo(page);
log("offline-montreal-switch-back", { banner: offlineBack.banner, hasMontreal: offlineBack.hasMontreal, hasToronto: offlineBack.hasToronto, chars: offlineBack.chars });
await page.screenshot({ path: join(OUT, "offline-montreal-switchback-390-viewport.png") });

// (e) No credential material in any cached body (booleans only, in-memory).
// Final-round hardening: each body read races a 5s timeout, so one
// slow body can never wedge the proof (a timed-out body counts as
// skipped and is reported, never silently treated as clean).
const tokenCheck = await page.evaluate(async (cookieValues) => {
  const names = await caches.keys().catch(() => []);
  let checked = 0; let jwtHits = 0; let cookieHits = 0; let setCookieHeaders = 0; let tokenWordValues = 0; let skipped = 0;
  const timedText = (res) => Promise.race([
    res.clone().text().catch(() => ""),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000))
  ]);
  for (const name of names) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const text = await timedText(res);
      if (text === null) { skipped += 1; continue; }
      checked += 1;
      if (/eyJ[A-Za-z0-9_-]{20,}/.test(text)) jwtHits += 1;
      if (cookieValues.some((v) => typeof v === "string" && v.length > 8 && text.includes(v))) cookieHits += 1;
      if (res.headers.has("set-cookie")) setCookieHeaders += 1;
      if (/sb-access-token|sb-refresh-token/.test(text)) tokenWordValues += 1;
    }
  }
  return { checked, jwtHits, cookieHits, setCookieHeaders, tokenWordValues, skipped };
}, sessionCookieValues);
log("cached-bodies-token-check", tokenCheck);

// (a, continued) ONLINE RECOVERY: label clears, fresh content shows.
await ctx.setOffline(false);
await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);
const recovered = await bodyInfo(page);
log("online-recovered-montreal", { banner: recovered.banner, hasMontreal: recovered.hasMontreal, hasDay1: recovered.hasDay1, chars: recovered.chars });
await page.screenshot({ path: join(OUT, "online-recovered-montreal-390-viewport.png") });

// (d) ACCOUNT SWITCH: a new user id deletes the prior user's caches.
await postToWorker(page, { type: "roamly_set_user", userId: "offline-proof-user-b" });
const invAfterSwitch = await cacheInventory(page);
log("after-account-switch", { caches: Object.keys(invAfterSwitch), entries: Object.values(invAfterSwitch).flat() });
await postToWorker(page, { type: "roamly_set_user", userId: testerUserId });
await loadOnline(page, MONTREAL);
await loadOnline(page, TORONTO);

// (b) SIGN-OUT: caches empty, no trip content restores.
await postToWorker(page, { type: "roamly_logout" });
const invAfterLogout = await cacheInventory(page);
log("after-signout", { caches: Object.keys(invAfterLogout), entries: Object.values(invAfterLogout).flat() });
await ctx.setOffline(true);
await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch((e) => console.log("post-signout offline nav err:", String(e).slice(0, 150)));
await page.waitForTimeout(3000);
const signoutOffline = await bodyInfo(page);
log("offline-after-signout", { banner: signoutOffline.banner, hasMontreal: signoutOffline.hasMontreal, hasDay1: signoutOffline.hasDay1, chars: signoutOffline.chars, head: signoutOffline.head });
await page.screenshot({ path: join(OUT, "signout-offline-390-viewport.png") });
await ctx.setOffline(false);

// ================= 320px offline render =================
const ctx320 = await makeCtx(320);
const page320 = await ctx320.newPage();
await page320.goto(`${BASE}/trip/${MONTREAL}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page320.waitForTimeout(3000);
await postToWorker(page320, { type: "roamly_set_user", userId: testerUserId });
await skipGate(page320, MONTREAL);
await loadOnline(page320, MONTREAL);
await ctx320.setOffline(true);
await page320.reload({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page320.waitForTimeout(3000);
const offline320 = await bodyInfo(page320);
log("offline-montreal-320", { banner: offline320.banner, hasMontreal: offline320.hasMontreal, hasDay1: offline320.hasDay1, chars: offline320.chars });
await page320.screenshot({ path: join(OUT, "offline-montreal-320-viewport.png") });
await ctx320.setOffline(false);

writeFileSync(join(OUT, "offline-proof-report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("PROOF DONE");
