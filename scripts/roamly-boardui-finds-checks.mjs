// BoardUI finds checks (2026-11-09, hard-apply batch 5).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface. Batch 5 is Finds / Deals — the storefront Junel asked
// about by name — which wore ZERO BoardUI: raw hex colours, legacy
// green/teal tints, slate text, three true-black scrims, and a
// native <details> disclosure. This suite pins the batch-5 face:
//
//   (1) no black utility anywhere on the surface (ink = deep navy);
//       the three black scrims are the brand navy recipe the
//       itinerary adopted in PR #113 (cnavy scrims/gradient);
//   (2) the cards, buttons and the rental disclosure ride the real
//       primitives (BuiCard / BuiButton / controlled BuiAccordion);
//       the accordion's new controlled mode is additive — the
//       uncontrolled default is untouched;
//   (3) money truth: every rendered price carries its source line
//       composed from the card's OWN provider fields (priceNote +
//       provider, already set by the card builders) — nothing
//       invented, and no discount/saving renders anywhere (the feed
//       carries no original-price pair to discount from);
//   (4) revenue wiring is byte-identical: affiliate hrefs, rel
//       attributes, the house-ad click path and the widget loader's
//       logic lines are pinned unchanged — only the clothing moved.
import assert from "node:assert/strict";
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

const page = read("app/finds/page.tsx");
const tabs = read("components/roamly/FindsTabs.tsx");
const magazine = read("components/roamly/FindsEditorialMagazine.tsx");
const widgets = read("components/roamly/FindsCommercialWidgets.tsx");
const deals = read("components/roamly/FindsTravelDeals.tsx");
const quickBook = read("components/roamly/FindsQuickBook.tsx");
const houseAd = read("components/roamly/HouseAdCard.tsx");
const houseAdImage = read("components/roamly/HouseAdImage.tsx");
const accordion = read("components/boardui/Accordion.tsx");

const surfaceFiles = { page, tabs, magazine, widgets, deals, quickBook, houseAd, houseAdImage };

// (1) NO BLACK anywhere on the surface. font-black is a font WEIGHT,
// not a colour, and is deliberately not in the utility alternation.
const blackUtility = /(?:bg|text|border|ring|from|via|to|shadow|decoration|fill|stroke)-black(?=[/"'\s]|$)/m;
for (const [name, source] of Object.entries(surfaceFiles)) {
  ok(!blackUtility.test(source), `(1) no black utility in ${name}`);
  ok(!/(?:^|[\s"'])(?:text|bg|border|ring)-slate-/.test(source), `(1) no slate colour in ${name}`);
}
ok(magazine.includes("bg-cnavy/45"), "(1) the story slide-toggle pill is the navy scrim, not black");
ok(magazine.includes("from-cnavy/90") && magazine.includes("via-cnavy/15"), "(1) the story photo gradient is the PR #113 navy recipe");
ok(houseAd.includes("bg-cnavy/70"), "(1) the house-ad Sponsored pill is navy, not black");
ok(houseAd.includes("bg-cnavy/55") && houseAd.includes("hover:bg-cnavy/75"), "(1) the house-ad close button is navy, not black");

// Legacy raw palette is gone from the converted files; the only hex
// left is #0A6FE0, BuiButton primary's own hover value (house rule).
const legacyHex = /#223354|#087BFF|#657795|#9AA5B8|#DCE5F0|#E6EFFA|#F2F6FC|#203c43|#60766d|#e8f4ec|#c8ddd0|#f7fbf7|#0e605a|#d8e5dd|#d8f1dd|#9CC2F5|#D7E3F2|#eef3ec/i;
for (const [name, source] of Object.entries({ page, tabs, magazine, widgets, deals, quickBook, houseAd })) {
  ok(!legacyHex.test(source), `(1) no legacy raw hex in ${name}`);
}

// (2) Primitives carry the surface.
ok(/bg-cbg/.test(page) && /text-chead/.test(page), "(2) the finds page shell wears the page tokens");
ok(tabs.includes('from "@/components/boardui/Card"') && tabs.includes('from "@/components/boardui/Button"'), "(2) FindsTabs imports BuiCard + BuiButton");
ok(tabs.includes('id="finds-search"'), "(2) the search entry keeps its finds-search anchor on the BuiCard");
ok(tabs.includes("busy={searchingHotels}") && tabs.includes('busy={searchingCategory === "flight"}') && tabs.includes('busy={searchingCategory === "attraction"}'), "(2) the three search submits are busy-wired BuiButtons (double-submit impossible)");
ok(tabs.includes("trailingIcon={Search}"), "(2) the search-entry submit is a BuiButton with the Lucide trailing icon");
ok(magazine.includes('from "@/components/boardui/Card"') && magazine.includes('from "@/components/boardui/Accordion"'), "(2) the magazine imports BuiCard + BuiAccordion");
ok(!magazine.includes("<details"), "(2) no native details element remains in the magazine");
ok(magazine.includes("<BuiAccordion") && magazine.includes('config={findsWidgets.cars}'), "(2) the rental disclosure is the BoardUI accordion around the same widget");
ok(magazine.includes('window.matchMedia("(max-width: 1023px)")'), "(2) the rental disclosure keeps its responsive open-state rule");
ok(accordion.includes("open?: boolean") && accordion.includes("onOpenChange"), "(2) BuiAccordion gained the additive controlled mode");
ok(accordion.includes("defaultOpen") && accordion.includes("useState(defaultOpen)"), "(2) BuiAccordion's uncontrolled default is untouched");
ok(widgets.includes('from "@/components/boardui/Card"') && widgets.includes('from "@/components/boardui/Button"'), "(2) the widget chrome imports BuiCard + BuiButton");
ok(widgets.includes('role="status"') && widgets.includes('aria-live="polite"'), "(2) the widget unavailable state stays a polite live region on a BuiCard");
ok(deals.includes("rounded-bui-card") && deals.includes("border-chair"), "(2) deal rows carry the card recipe (radius + hairline + press)");
ok(quickBook.includes("border-chair") && quickBook.includes("text-cblue"), "(2) Quick Book wears the tokens");

// (3) Money truth: the price source line is composed from the card's
// own fields in both priced renderers, and nothing invents a saving.
const sourceLine = (magazine.match(/\[card\.priceNote, card\.provider\]/g) || []).length;
ok(sourceLine >= 2, "(3) priced cards render the priceNote + provider source line (live card + flight card)");
const curatedBlock = magazine.slice(magazine.indexOf("function CuratedProductCard"), magazine.indexOf("function RentalWidgetDisclosure"));
ok(!curatedBlock.includes("card.price"), "(3) curated category cards still render no price (they have none)");
ok(curatedBlock.includes("Illustrative image"), "(3) curated cards keep their illustrative-image honesty label");
ok(!magazine.includes("card.saving") && !magazine.includes("savingPercent"), "(3) no discount/saving renders on the magazine (no original-price pair exists)");

// (4) Revenue wiring byte-identical.
ok((magazine.match(/href=\{card\.href\}/g) || []).length === 4, "(4) the four card outbound hrefs are unchanged");
ok((magazine.match(/href=\{`\/plan/g) || []).length === 1, "(4) the story plan link is unchanged");
for (const href of [
  "https://booking.stay22.com/roamly/YhpfMFjm2n",
  "https://kkday.tpo.lu/DrPvqlSH",
  "https://intui.tpo.lu/6GQiV5Ai",
  "https://getrentacar.tpo.lu/l16uVhOn",
  "https://airalo.tpo.lu/5dcQRiO5"
]) {
  ok(deals.includes(href), `(4) deal href unchanged: ${href}`);
}
// R-1 RE-PIN (2026-11-10, owner's own records — ASSESSMENT-B addendum): the Amazon gear
// href below changed ON PURPOSE, so it leaves the byte-identical loop above. The old
// value (amazon.ca + tag roamly060-20) was the retired Canada-only setup, a leftover
// from before Junel's 2026-10-14 unification on the international tag roamly02e-20
// (amazon.com — US + PH clicks earn, Canadians redirect to .ca under the same ID).
// Every other href in this section remains byte-identical.
ok(deals.includes("https://www.amazon.com/s?k=travel+gear+essentials&tag=roamly02e-20"), "(4) deal href re-pinned per R-1: Amazon gear earns on the unified international tag");
ok(deals.includes('rel="sponsored nofollow noopener"'), "(4) deal rel attributes unchanged");
ok(houseAd.includes("houseAdClickPath(creative.id)") && houseAd.includes('rel="sponsored noopener"'), "(4) the house-ad click path and sponsored rel are unchanged");
ok(houseAd.includes('data-house-ad={creative.id}'), "(4) the house-ad identity hook is unchanged");
ok(widgets.includes("isTrustedTravelpayoutsWidgetUrl(config.src)"), "(4) widget URL trust check unchanged");
ok(widgets.includes('document.createElement("script")'), "(4) widget script mounting unchanged");
ok(widgets.includes("tp-cascoon"), "(4) widget settle detection unchanged");
ok(widgets.includes("window.setInterval(settleReadyIfUsable, 250)"), "(4) widget settle interval unchanged");
ok(widgets.includes('strategy="afterInteractive"'), "(4) framed widget script strategy unchanged");
ok(!widgets.includes("dangerouslySetInnerHTML"), "(4) widgets still never inject raw HTML");
ok((tabs.match(/\/api\/roamly\/market-search/g) || []).length === 2, "(4) both live searches still post to the market-search endpoint");
for (const label of ["For your trip", "Stays", "Flights", "Things to do", "Travel essentials", "Getting around"]) {
  ok(tabs.includes(`label: "${label}"`), `(4) tab label unchanged: ${label}`);
}

console.log(`\nPASS: ${count} BoardUI Finds checks — the storefront rides the primitives, no black anywhere, prices carry their source, and the revenue wiring is byte-identical.`);
