// BoardUI public + marketing checks (2026-11-09, hard-apply batch 8).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface, judged against the familiar apps. Batch 8 completes the
// public/marketing surfaces and retires the legacy components/ui/
// kit from every customer route (the audit's Axis-5 finding: three
// parallel design systems — BoardUI / legacy ui / hand-copied).
//
// This suite pins the batch-8 conversion:
//   (1) NO RAW HEX on the converted home surfaces — app/page.tsx,
//       DynamicDestinationHero, BookYourTrip, CityPuzzle,
//       HomepageTravelShowcase and the entry-gate views ride the
//       BoardUI tokens; the only hex literals left in app/page.tsx
//       are the three BoardUI soft-tone values that live as literals
//       inside components/boardui/Badge.tsx itself;
//   (2) the legacy kit has ZERO importers among customer routes —
//       its remaining importers are exactly the internal set (admin
//       pages, admin-access, preview, field-test, components/admin),
//       so the kit itself stands, undeleted, for the internal lane;
//   (3) LEGAL TEXT IS SACRED — the terms/privacy `sections` blocks
//       hash to the exact pre-batch values (clothing changed, wording
//       did not move by one character);
//   (4) the entry-gate views keep the owner-accepted copy and the
//       46px banner law — only the legacy green palette became the
//       brand navy tokens;
//   (5) error shells wear BoardUI with human words and both
//       recovery actions (retry / home) preserved, no raw codes;
//   (6) money + photo truth — PH peso prices and the affiliate
//       hrefs are byte-identical; the homepage's three named-city
//       Unsplash photos are byte-identical.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const root = path.resolve(new URL("..", import.meta.url).pathname);

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const hexes = (src) => [...new Set(src.match(/#[0-9A-Fa-f]{6}\b/g) || [])].sort();

function walkSources(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkSources(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* (1) No raw hex on the converted home surfaces                       */
/* ------------------------------------------------------------------ */

console.log("(1) home + entry surfaces ride the tokens, no raw hex");

const homePage = read("app/page.tsx");
ok(
  JSON.stringify(hexes(homePage)) === JSON.stringify(["#B4501B", "#E5F6EE", "#FFF0E6"]),
  "1a: app/page.tsx hex set is exactly the BoardUI soft-tone literals (Badge.tsx softTone values)"
);
ok(homePage.includes("bg-cbg") && homePage.includes("text-cblue"), "1b: home root + eyebrows ride cbg/cblue tokens");
ok(homePage.includes("bg-csoft") && homePage.includes("border-chair"), "1c: home sections ride csoft/chair tokens");
ok(homePage.includes("bg-cblue") && homePage.includes("bg-corange") && homePage.includes("bg-cpurple"), "1d: journey timeline dots are token classes, not inline-style hex");
ok(!homePage.includes("backgroundColor"), "1e: no inline-style colours left on the home page");
ok(!homePage.includes("text-slate-"), "1f: no slate palette left on the home page");

const hero = read("components/roamly/DynamicDestinationHero.tsx");
ok(hexes(hero).length === 0, "1g: DynamicDestinationHero has zero raw hex");
ok(hero.includes("bg-cbg") && hero.includes("from-cnavy/60"), "1h: hero ground + photo scrim ride cbg/cnavy tokens");
ok(hero.includes("shadow-soft"), "1i: hero search card shadow is the token shadow (green-tinted rgba gone)");
ok(!hero.includes("39,88,80"), "1j: no legacy green rgba left in the hero");
ok(
  hero.includes("order-1 min-w-0 lg:order-2") && hero.includes("order-2 flex min-w-0 flex-col items-start lg:order-1"),
  "1k: mobile hero order — photo panel first, headline/search column second; lg side-by-side order unchanged (owner order 2026-11-10)"
);

const book = read("components/roamly/BookYourTrip.tsx");
ok(hexes(book).length === 0, "1k: BookYourTrip has zero raw hex");
ok(book.includes("rounded-bui-panel") && book.includes("border-chair"), "1l: partner cards ride the panel radius + hairline token");

const puzzle = read("components/roamly/CityPuzzle.tsx");
ok(hexes(puzzle).length === 0, "1m: CityPuzzle has zero raw hex (the teal-green palette is gone)");
ok(puzzle.includes("BuiCard") && puzzle.includes("BuiButtonLink") && puzzle.includes("BuiButton"), "1n: CityPuzzle shell + solved CTAs ride the primitives");
ok(!puzzle.includes("0e605a") && !puzzle.includes("28665d"), "1o: no teal hover/text colours left in CityPuzzle");

const showcase = read("components/roamly/HomepageTravelShowcase.tsx");
ok(hexes(showcase).length === 0, "1p: HomepageTravelShowcase has zero raw hex");
ok(showcase.includes("bg-csoft") && showcase.includes("rounded-app"), "1q: showcase wells + shell radius ride the tokens");
ok(!showcase.includes("bg-lagoon") && !showcase.includes("rgba(16,32,51"), "1r: showcase lagoon dots + ink-rgba scrims are gone");

/* ------------------------------------------------------------------ */
/* (2) Legacy kit retired from customer routes                         */
/* ------------------------------------------------------------------ */

console.log("(2) legacy components/ui kit: zero customer importers");

const customerFiles = [
  "app/about/page.tsx",
  "app/contact/page.tsx",
  "app/help/page.tsx",
  "app/ph/page.tsx",
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/guides/[slug]/page.tsx",
  "app/error.tsx",
  "app/not-found.tsx",
  "app/loading.tsx"
];
for (const [i, file] of customerFiles.entries()) {
  ok(!read(file).includes('from "@/components/ui/'), `2${"abcdefghij"[i]}: ${file} imports nothing from components/ui`);
}

const importers = [...walkSources("app"), ...walkSources("components")].filter((rel) =>
  read(rel).includes('from "@/components/ui/')
);
const internalOnly = (rel) =>
  rel.startsWith("app/admin/") ||
  rel.startsWith("app/admin-access/") ||
  rel.startsWith("app/preview/") ||
  rel.startsWith("app/field-test/") ||
  rel.startsWith("components/admin/") ||
  rel.startsWith("components/ui/");
ok(importers.length > 0, "2k: the legacy kit still has its internal importers (not force-deleted)");
ok(
  importers.every(internalOnly),
  `2l: every remaining components/ui importer is internal — got: ${importers.filter((r) => !internalOnly(r)).join(", ") || "none outside"}`
);
ok(exists("components/ui/Button.tsx") && exists("components/ui/Card.tsx"), "2m: the kit files stand for the internal lane");

/* ------------------------------------------------------------------ */
/* (3) Legal text is sacred                                            */
/* ------------------------------------------------------------------ */

console.log("(3) terms + privacy wording hashes are byte-identical");

function sectionsHash(rel) {
  const m = read(rel).match(/const sections = \[[\s\S]*?\n\];/);
  assert.ok(m, `${rel}: sections block found`);
  return crypto.createHash("sha256").update(m[0]).digest("hex");
}
ok(
  sectionsHash("app/terms/page.tsx") === "410187af391d5dad58f50fa8b46dcc0a34f5c1f0939a5ff4665ca0eb43e51302",
  "3a: terms sections hash == the pre-batch value"
);
ok(
  sectionsHash("app/privacy/page.tsx") === "d286817fc019e625b0aed950b8296d1475d220669d59dbd15b44d085a76a9518",
  "3b: privacy sections hash == the pre-batch value"
);
const terms = read("app/terms/page.tsx");
const privacy = read("app/privacy/page.tsx");
ok(terms.includes("Once generated, an itinerary is locked and cannot be remade or regenerated."), "3c: terms payment wording intact");
ok(privacy.includes("support@roamlyhq.com"), "3d: privacy contact wording intact");
ok(terms.includes("BuiCard") && privacy.includes("BuiCard"), "3e: legal sections render on BuiCard");
ok(terms.includes("BuiBadge") && privacy.includes("BuiBadge"), "3f: legal pages open with BuiBadge");

/* ------------------------------------------------------------------ */
/* (4) Entry-gate views: copy + 46px law intact, palette tokenised     */
/* ------------------------------------------------------------------ */

console.log("(4) entry-gate views: owner-accepted copy, navy tokens");

const gates = read("components/roamly/gateViews.tsx");
ok(hexes(gates).length === 0, "4a: gateViews has zero raw hex (the legacy green palette is gone)");
ok(gates.includes("bg-cnavy") && gates.includes("text-cnavy"), "4b: gate banner + brand rows ride cnavy");
ok(gates.includes("h-[46px]"), "4c: the persistent banner is still exactly 46px (owner-accepted scale law)");
ok(gates.includes("Put Roamly on your phone"), "4d: install sheet title copy intact");
ok(gates.includes("that&apos;s a phone rule, not ours."), "4e: install sheet reason copy intact");
ok(gates.includes("Turn on trip alerts") && gates.includes("Trip alerts are off"), "4f: alerts sheet copy intact");
ok(gates.includes("data-measure=\"gate-banner\"") || gates.includes('data-measure="gate-banner"'), "4g: banner measure hook intact");
ok(gates.includes("BuiSheet") && gates.includes("dismissible={false}"), "4h: gates still ride BuiSheet, non-dismissible as accepted");

/* ------------------------------------------------------------------ */
/* (5) Error shells                                                    */
/* ------------------------------------------------------------------ */

console.log("(5) error shells: BoardUI clothing, human words, recovery kept");

const errorPage = read("app/error.tsx");
ok(errorPage.includes("BuiCard") && errorPage.includes("BuiButton") && errorPage.includes("BuiButtonLink"), "5a: error shell rides BuiCard/BuiButton/BuiButtonLink");
ok(errorPage.includes("onClick={reset}"), "5b: the retry action is preserved on BuiButton");
ok(errorPage.includes("This page didn’t load as expected."), "5c: error words stay human and specific");
ok(!errorPage.includes("from-cyan-500") && !errorPage.includes("to-sky-500"), "5d: the cyan gradient button is gone");
ok(errorPage.includes('href="/"'), "5e: the back-home recovery action is preserved");
ok(errorPage.includes("text-cred"), "5f: error eyebrow rides the cred token (legacy coral alias gone)");

const notFound = read("app/not-found.tsx");
ok(notFound.includes("BuiCard") && notFound.includes("BuiButtonLink"), "5g: not-found rides BuiCard/BuiButtonLink");
ok(notFound.includes("We couldn’t find that page."), "5h: not-found words stay human");
ok(notFound.includes('href="/"') && notFound.includes('href="/plan"'), "5i: both recovery actions preserved (home + plan)");

const loading = read("app/loading.tsx");
ok(loading.includes("BuiSkeleton"), "5j: loading shell rides BuiSkeleton");
ok(loading.includes('role="status"') && loading.includes('aria-label="Loading page"'), "5k: loading live-region contract preserved");
ok(!loading.includes("bg-lagoon") && !loading.includes("bg-cloud"), "5l: loading bars carry no legacy teal/cloud colours");

/* ------------------------------------------------------------------ */
/* (6) Money + photo truth                                             */
/* ------------------------------------------------------------------ */

console.log("(6) PH prices, affiliate hrefs, named-city photos — byte-identical");

const ph = read("app/ph/page.tsx");
ok(ph.includes("₱99") && ph.includes("₱79") && ph.includes("₱149"), "6a: PH peso prices unchanged (₱99/₱79/₱149)");
ok(ph.includes("formatPeso("), "6b: PH prices still format from the pack data");
ok(ph.includes("BuiCard") && ph.includes("BuiButtonLink"), "6c: PH page rides BuiCard/BuiButtonLink");
ok(hexes(ph).length === 0, "6d: PH page has zero raw hex");
ok(ph.includes("bg-cnavy"), "6e: PH sample panel is the deep-navy token (teal panel gone)");

ok(book.includes("https://booking.stay22.com/roamly/YhpfMFjm2n"), "6f: Stay22 affiliate href byte-identical");
ok(book.includes("https://kkday.tpo.lu/DrPvqlSH"), "6g: KKday affiliate href byte-identical");
// 6h — R-1 RE-PIN (2026-11-10, owner's own records — ASSESSMENT-B addendum): this pin
// changed ON PURPOSE, unlike the byte-identical pins around it. The old value
// (amazon.ca + tag roamly060-20) was the retired Canada-only setup, a leftover from
// before Junel's 2026-10-14 unification on the international tag roamly02e-20
// (amazon.com — US + PH clicks earn, Canadians redirect to .ca under the same ID).
ok(book.includes("https://www.amazon.com/s?k=travel+gear+essentials&tag=roamly02e-20"), "6h: Amazon affiliate href carries the unified international tag (re-pinned per R-1)");
ok(book.includes('rel="sponsored nofollow noopener"'), "6i: affiliate rel contract preserved");

ok(showcase.includes("https://images.unsplash.com/photo-1539037116277-4db20889f2d4"), "6j: Barcelona photo URL byte-identical");
ok(showcase.includes("https://images.unsplash.com/photo-1540959733332-eab4deabeeaf"), "6k: Tokyo photo URL byte-identical");
ok(showcase.includes("https://images.unsplash.com/photo-1537996194471-e657df975ab4"), "6l: Bali photo URL byte-identical");

const guides = read("app/guides/[slug]/page.tsx");
ok(guides.includes("BuiCard") && guides.includes("BuiBadge") && guides.includes("BuiButtonLink"), "6m: guides page rides the primitives");
ok(guides.includes("DEFAULT_GUIDE_LINKS"), "6n: the D14 empty-links fallback is intact");
ok(guides.includes("content.affiliateDisclosure"), "6o: the affiliate disclosure still renders from content");

const about = read("app/about/page.tsx");
const help = read("app/help/page.tsx");
const contact = read("app/contact/page.tsx");
ok(about.includes("BuiButtonLink") && help.includes("BuiButtonLink"), "6p: about + help CTAs ride BuiButtonLink");
ok(contact.includes("BuiCard") && contact.includes("BuiBadge") && contact.includes("ContactForm"), "6q: contact shell rides the primitives around the untouched BUI form");
ok(contact.includes("mailto:${supportEmail}"), "6r: contact email action preserved");

console.log(`\nboardui-public: ${count} checks passed`);
