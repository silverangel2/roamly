// BoardUI trip-tail checks (2026-11-09, hard-apply batch 4).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface. Batch 4 is the trip page's long tail: surfaces that wore
// the BoardUI shell with a pre-BoardUI interior, plus the named
// correction — the StaySelector imported ZERO BoardUI primitives and
// hand-copied the card recipe in raw classes (it looked BoardUI and
// would have drifted). This suite pins the batch-4 conversion:
//
//   (1) the StaySelector is built on the REAL primitives (BuiCard
//       interactive + BuiClickSpark), no hand-copied recipe classes
//       remain in it, and the LIVE-PROVEN stay save contract is
//       byte-for-byte the old one (endpoint, optimistic pick,
//       revert-on-failure, router.refresh, the face's exact lines);
//   (2) the hotel options + picker ride BuiCard/BuiButton/BuiNotice/
//       BuiChip with the choice contract untouched (same posts, same
//       in-flight guard, same words, prices keep their states);
//   (3) the partner row + tracked recommendation button carry token
//       colours only — tracking, rel and labels unchanged;
//   (4) gap cards and the weather card shells are BuiCards (the
//       weather layout itself — huge temperature, one left edge,
//       range bars, provenance — is untouched);
//   (5) the customize forms ride the BuiField pattern through the
//       shared chrome: visible labels, blur validation, the reserved
//       error slot (submit never moves), always-enabled submits that
//       explain themselves, same endpoints and preview/apply flow;
//   (6) the activity removal/replacement panels, the rename control,
//       the trip note box/form, the extract-review card (batch 3's
//       deferral), the post-trip ask card and the two small trip
//       buttons ride the primitives with their contracts unchanged;
//   (7) no non-token warm hex and no black remains on these surfaces.
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

const selector = read("components/trip/StaySelector.tsx");
const hotelOptions = read("components/trip/HotelProductOptions.tsx");
const picker = read("components/trip/HotelProductChoicePicker.tsx");
const partners = read("components/trip/HotelPartnerChoices.tsx");
const recoButton = read("components/trip/BookingRecommendationButton.tsx");
const guarded = read("components/trip/GuardedHotelActionButton.tsx");
const gaps = read("components/roamly/TripGapCards.tsx");
const weather = read("components/roamly/TripWeatherCard.tsx");
const chrome = read("components/roamly/packageChangeChrome.tsx");
const budget = read("components/roamly/CustomerBudgetChange.tsx");
const dates = read("components/roamly/CustomerDateChange.tsx");
const destination = read("components/roamly/CustomerDestinationChange.tsx");
const intent = read("components/roamly/CustomerTripIntentChange.tsx");
const customize = read("components/roamly/CustomizeYourTrip.tsx");
const removal = read("components/roamly/CustomerActivityRemoval.tsx");
const replacement = read("components/roamly/CustomerActivityReplacement.tsx");
const rename = read("components/trip/TripRenameControl.tsx");
const commentBox = read("components/trip/TripCommentBox.tsx");
const commentForm = read("components/trip/TripCommentForm.tsx");
const manager = read("components/roamly/TripBookingsManager.tsx");
const askCard = read("components/trip/PostTripLibraryAskCard.tsx");
const refreshBtn = read("components/trip/MarketPriceRefreshButton.tsx");
const translateBtn = read("components/trip/TranslateItineraryButton.tsx");

/* ------------------------------------------------------------------ */
/* (1) StaySelector — real primitives, unchanged save contract         */
/* ------------------------------------------------------------------ */

console.log("(1) stay selector: BuiCard + ClickSpark, save contract intact");

ok(selector.includes('from "@/components/boardui/Card"') && selector.includes("<BuiCard"), "1a: the stay card is a real BuiCard");
ok(selector.includes('from "@/components/boardui/ClickSpark"') && selector.includes("<BuiClickSpark"), "1b: the stay card rides BuiClickSpark like the other selectors");
ok(selector.includes("interactive") && selector.includes('role="radio"') && selector.includes('role="radiogroup"') && selector.includes("aria-checked"), "1c: the BuiCard carries the radio semantics");
ok(!selector.includes("bui-squircle") && !selector.includes("rounded-bui-card") && !selector.includes("shadow-bui-card"), "1d: no hand-copied recipe classes remain in the selector — the recipe lives in BuiCard");
ok(selector.includes("onKeyDown") && selector.includes('"Enter"'), "1e: Enter/Space on the card run the same pick() a click runs");
ok(selector.includes("if (saving || option.id === selectedId) return;"), "1f: the pick guard is unchanged (no double-pick, no re-pick)");
ok(selector.includes("/stay-selection") && selector.includes("router.refresh()"), "1g: the save endpoint + refresh contract are unchanged");
ok(selector.includes("setSelectedId(previousId)") && selector.includes("saveFailed") && selector.includes("initialSelectionId"), "1h: optimistic pick, revert-on-failure and the stored-pick seam are unchanged");
ok(selector.includes("Added to your itinerary and budget.") && selector.includes("Suggested for this trip") && selector.includes("no saved price for these dates") && selector.includes("Stay prices from Stay22 partner search") && selector.includes("Trip total"), "1i: the face's exact lines are unchanged");
ok(selector.includes('"--bui-delay"') && selector.includes("index * 70") && selector.includes("bui-badge-pop") && selector.includes("bui-enter"), "1j: the entrance cascade + badge pop survive on the primitive");

/* ------------------------------------------------------------------ */
/* (2) Hotel options + picker                                          */
/* ------------------------------------------------------------------ */

console.log("(2) hotel options + picker: primitives, choice contract intact");

ok(hotelOptions.includes('from "@/components/boardui/Card"') && hotelOptions.includes("<BuiCard"), "2a: the options shell is a BuiCard");
ok(!/#e8dfd0|#fffdf8/.test(hotelOptions), "2b: no non-token warm hex remains in the options shell");
ok(!/<button|<a\b|onClick/.test(hotelOptions), "2c: the options shell stays non-interactive (the picker owns the actions)");
ok(hotelOptions.includes("Room &amp; rate options") && hotelOptions.includes("exact product booking is not verified"), "2d: the comparison disclosure copy is unchanged");
ok(picker.includes("<BuiCard") && picker.includes("<BuiButton") && picker.includes("<BuiNotice") && picker.includes("<BuiChip"), "2e: the picker rides BuiCard + BuiButton + BuiNotice + BuiChip");
ok(!/#eee5d7|#fffdf8/.test(picker) && !/slate-/.test(picker), "2f: no warm hex and no slate classes remain in the picker");
ok(picker.includes("fetchWithSupabaseAuth") && picker.includes("hotel-product-choice") && picker.includes("mutationInFlight.current"), "2g: the choice posts + in-flight guard are unchanged");
ok(picker.includes("disabled={Boolean(busyProductId)}") && picker.includes("aria-label={`Choose this hotel option"), "2h: the busy disabling + accessible names are unchanged");
ok(picker.includes("Selected option") && picker.includes("Choose this option") && picker.includes("Comparison only") && picker.includes("does not guarantee availability, pricing, or booking terms"), "2i: the picker's words are unchanged");
ok(picker.includes('role="alertdialog"') && picker.includes("readableChanges(review.changes)") && picker.includes("choose(productId, review.changes)"), "2j: the material-change review flow is unchanged");
ok(picker.includes('role="status"'), "2k: the not-shown-anymore panel still announces itself");

/* ------------------------------------------------------------------ */
/* (3) Partner row + recommendation button + guarded action            */
/* ------------------------------------------------------------------ */

console.log("(3) partner row, recommendation button, guarded action");

ok(!/slate-/.test(partners) && partners.includes("emphasis={primary ? \"primary\" : \"secondary\"}") && partners.includes("Roamly may earn a commission"), "3a: partner row is token-coloured, structure + disclosure unchanged");
ok(!/#f3efe6|#e9e2d4|#17899a/.test(recoButton) && recoButton.includes("bui-press"), "3b: the recommendation button's tones are tokens now (no warm beige, no one-off teal hover)");
ok(recoButton.includes("trackedAffiliateHref") && recoButton.includes("noopener noreferrer sponsored") && recoButton.includes("booking_link_clicked"), "3c: affiliate tracking + sponsored rel are unchanged");
ok(guarded.includes("<BuiButton") && guarded.includes("busy={busy}"), "3d: the guarded hotel action rides BuiButton's busy state (double-submit impossible)");
ok(guarded.includes("/hotel-action") && guarded.includes('body: "{}"'), "3e: the hotel-action call is unchanged");

/* ------------------------------------------------------------------ */
/* (4) Gap cards + weather card                                        */
/* ------------------------------------------------------------------ */

console.log("(4) gap cards + weather card shells");

ok(gaps.includes("<BuiCard") && gaps.includes("<BuiNotice"), "4a: gap cards are BuiCards and the load/dismiss error is a BuiNotice");
ok(gaps.includes("dismiss(card.type)") && gaps.includes("A few gaps worth closing") && !/slate-/.test(gaps), "4b: dismiss behaviour + heading unchanged, slate gone");
ok(weather.includes("<BuiCard") && weather.includes('data-trip-weather="ready"') && weather.includes('data-trip-weather="too-early"'), "4c: both weather shells are BuiCards, state markers unchanged");
ok(weather.includes("text-[56px]") && weather.includes("Weather: Open-Meteo") && weather.includes("bg-cblue") , "4d: the weather rules survive — huge headline temperature, range bars, provenance line");

/* ------------------------------------------------------------------ */
/* (5) Customize forms on the BuiField pattern                         */
/* ------------------------------------------------------------------ */

console.log("(5) package-change chrome + the four customer forms");

ok(chrome.includes("BuiFieldError") && chrome.includes("aria-describedby"), "5a: the shared field renders the reserved BuiFieldError slot wired by aria-describedby");
ok(chrome.includes('packageLabelClass = "block text-sm font-black text-chead"'), "5b: the shared label is the BoardUI label style");
ok(chrome.includes("bui-input") && chrome.includes("border-chair"), "5c: the shared input class is the BoardUI recipe");
ok(!chrome.includes("packagePrimaryClass") && !chrome.includes("packageQuietClass") && chrome.includes("<BuiButton"), "5d: the hand-rolled button classes are retired — buttons are BuiButtons");
ok(chrome.includes('aria-label={actionLabel}') && chrome.includes("ChevronRight"), "5e: the change rows keep their accessible names + chevron");
for (const [form, label] of [[budget, "budget"], [dates, "dates"], [destination, "destination"], [intent, "intent"]]) {
  ok(form.includes("<BuiButton") && form.includes("<BuiNotice"), `5f-${label}: the ${label} form rides BuiButton + BuiNotice`);
}
ok(budget.includes("useBuiField") && budget.includes("runValidation(value)") && budget.includes("Enter the new budget."), "5g: the budget amount validates on the BuiField pattern before preview");
ok(budget.includes("/budget-change") && budget.includes("Preview change") && budget.includes("Approve budget change") && budget.includes("Confirmed commitments remain protected"), "5h: the budget flow + words are unchanged");
ok(dates.includes("runValidation(start)") && dates.includes("runValidation(end)") && dates.includes("The end date is before the start date."), "5i: both dates validate, including the end-before-start check, before preview");
ok(dates.includes("/date-change") && dates.includes("Your existing bookings will not be changed") && dates.includes("Create new itinerary"), "5j: the date flow + words are unchanged");
ok(!destination.includes("disabled={busy || !destination}") && destination.includes("Choose a destination first."), "5k: the destination preview is never a silent disabled button — it explains itself");
ok(destination.includes("/destination-change") && destination.includes("freshly evaluated"), "5l: the destination flow + words are unchanged");
ok(intent.includes("Enter at least 1 adult.") && intent.includes('type="number"') && intent.includes('inputMode="numeric"'), "5m: traveller counts validate as quantities (number inputs, numeric keypad — counts are quantities, not codes)");
ok(intent.includes("/intent-change") && intent.includes("Approve and create fresh plan"), "5n: the intent flow + words are unchanged");
ok(customize.includes("<BuiCard") && customize.includes("divide-y") && !/#f7f3ea|#e7dfd2/.test(customize), "5o: the customize shell is a BuiCard, warm hex gone, row dividers kept");
ok(customize.includes("Tell us what to change — we’ll rebuild the parts that need it") && customize.includes("flexible stop can be swapped or removed"), "5p: the customize copy is unchanged");

/* ------------------------------------------------------------------ */
/* (6) Panels, rename, notes, review card, ask card, small buttons     */
/* ------------------------------------------------------------------ */

console.log("(6) removal/replacement, rename, notes, review card, ask card, buttons");

ok(removal.includes("<BuiCard") && removal.includes("<BuiButton") && !/#e8dfd0|#fffdf8/.test(removal), "6a: the removal confirm panel is a BuiCard with BuiButtons, warm hex gone");
ok(removal.includes("REMOVE_OPTIONAL_ACTIVITY") && removal.includes("Confirm removal") && removal.includes("Remove from itinerary"), "6b: the removal flow + words are unchanged");
ok(replacement.includes("<BuiCard") && replacement.includes("<BuiButton") && !/#e8dfd0|#fffdf8/.test(replacement), "6c: the replacement panel is a BuiCard with BuiButtons, warm hex gone");
ok(replacement.includes("REPLACE_OPTIONAL_ACTIVITY") && replacement.includes("Price unknown") && replacement.includes("Find a replacement"), "6d: the replacement flow + price-honesty words are unchanged");
ok(rename.includes("<BuiButton") && rename.includes("bui-input") && rename.includes("Trip name") && rename.includes("/rename"), "6e: rename rides BuiButton + the recipe input, labelled, endpoint unchanged");
ok(commentForm.includes("Add a note for your trip") && !commentForm.includes('className="sr-only"') && commentForm.includes("<BuiButton") && commentForm.includes("/comments"), "6f: the note field's label is VISIBLE now (was screen-reader-only), post contract unchanged");
ok(commentBox.includes("<BuiCard") && commentBox.includes("Tell us anything") && !/slate-/.test(commentBox), "6g: the note box is a BuiCard, copy unchanged, slate gone");
ok(manager.includes('<BuiCard className="bui-enter p-4">') && !manager.includes("rounded-bui-panel border border-cblue/25 bg-csoft"), "6h: the extract-review shell (batch 3's deferral) is a BuiCard, not the hand tinted div");
ok(manager.includes('label="Confirmation"') && !manager.includes('label="Confirmation"\n          type="number"') && manager.includes('label="Amount"\n          type="number"'), "6i: the confirmation CODE stays a text field; the Amount stays a number (quantity exception)");
ok(askCard.includes("<BuiCard") && askCard.includes("How was it, really?") && !/slate-/.test(askCard), "6j: the post-trip ask card is a BuiCard, copy unchanged, slate gone");
ok(refreshBtn.includes("<BuiButton") && refreshBtn.includes("market-search") && refreshBtn.includes("Refresh prices"), "6k: the market refresh button rides BuiButton, endpoint + words unchanged");
ok(translateBtn.includes("<BuiButton") && translateBtn.includes("/translate") && !/slate-/.test(translateBtn), "6l: the translate button rides BuiButton (ghost), endpoint unchanged, slate gone");

/* ------------------------------------------------------------------ */
/* (7) No black on the batch's surfaces                                */
/* ------------------------------------------------------------------ */

console.log("(7) no black anywhere in the batch");

const all = [selector, hotelOptions, picker, partners, recoButton, guarded, gaps, weather, chrome, budget, dates, destination, intent, customize, removal, replacement, rename, commentBox, commentForm, manager, askCard, refreshBtn, translateBtn].join("\n");
ok(!/from-black|bg-black|text-black|border-black/.test(all), "7a: no black classes on any batch-4 surface");
ok(!/#e8dfd0|#fffdf8|#eee5d7|#f7f3ea|#e7dfd2|#e6dece/.test(all), "7b: no non-token warm hex remains on any batch-4 surface");

console.log(`\nboardui-trip-tail checks passed (${count} assertions).`);
