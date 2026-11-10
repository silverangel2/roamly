// BoardUI bookings checks (2026-11-09, hard-apply batch 3).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface. The bookings surfaces were the audit's form-rules worst
// case: the Manual Booking Form rendered its fields from a local
// hand-rolled Field with NO validation at all (a blocked save was
// the only feedback, and its one error line rendered directly above
// the submit button, pushing it down — form rule 3 inverted), the
// wallet's cards/pills/disclosures were hand-rolled (native
// <details>, non-token #e8dfd0 hairlines), the review + cancel
// actions were hand-rolled buttons, and the Booking Recon face on
// the bookings page never spoke the owner's state words. This suite
// pins the batch-3 conversion end to end:
//
//   (1) the manual form rides BuiField: every field carries an id +
//       a real visible label (never placeholder-as-label), the seven
//       required fields validate via useBuiField (blur-first), the
//       submit runs them again and lands a BuiErrorSummary at the
//       top, and nothing error-shaped renders above the submit;
//   (2) the confirmation code is a text input — no type="number"
//       anywhere in the form (codes are not quantities);
//   (3) the save contract is untouched: same endpoint, same payload
//       currency line, same success toast flag, busy-guarded submit
//       (double-submit impossible);
//   (4) the wallet rides the primitives: BuiCard rows, BuiChip
//       status pills (words unchanged), the BoardUI accordion for
//       "More details", no native <details>, no non-token hex;
//   (5) review + cancel actions ride BuiButton/BuiCard/BuiNotice
//       with their posts and copy unchanged;
//   (6) the recon face reads exactly "activated" / "not activated"
//       on one quiet line, and the panel shell is a BuiCard;
//   (7) booking cards carry the BoardUI card recipe; the bookings
//       manager's disclosure is the accordion;
//   (8) no black anywhere on these surfaces.
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

const form = fs.readFileSync(path.join(root, "components/companion/ManualBookingForm.tsx"), "utf8");
const wallet = fs.readFileSync(path.join(root, "components/companion/BookingWalletTimeline.tsx"), "utf8");
const review = fs.readFileSync(path.join(root, "components/companion/BookingReviewActions.tsx"), "utf8");
const cancel = fs.readFileSync(path.join(root, "components/companion/BookingCancelAction.tsx"), "utf8");
const cards = fs.readFileSync(path.join(root, "components/trip/BookingCardsClient.tsx"), "utf8");
const gmail = fs.readFileSync(path.join(root, "components/roamly/GmailImportPanel.tsx"), "utf8");
const manager = fs.readFileSync(path.join(root, "components/roamly/TripBookingsManager.tsx"), "utf8");

/* ------------------------------------------------------------------ */
/* (1) The manual form rides BuiField                                  */
/* ------------------------------------------------------------------ */

console.log("(1) manual form: BuiField labels, blur validation, top summary");

ok(form.includes('from "@/components/boardui/Field"'), "1a: the BoardUI Field module is imported");
ok(form.includes("useBuiField") && form.includes("BuiFieldError") && form.includes("BuiErrorSummary"), "1b: useBuiField + BuiFieldError + BuiErrorSummary are all used");
ok((form.match(/useBuiField\(/g) || []).length === 7, "1c: exactly seven validated fields (provider, title, flight number, start date, end date, origin, destination)");
ok(form.includes("field.runValidation(entry.value)"), "1d: submit re-runs every required field's validator");
ok(form.includes("onBlur={field ? () => field.onBlur(value) : undefined}"), "1e: validation fires on blur, never on the first keystroke");
ok(form.includes("field?.onChange(event.target.value)"), "1f: after a first error, keystrokes re-check so the error clears when fixed");
ok(form.includes("<BuiErrorSummary errors={fieldSummary} />"), "1g: the submit-time summary renders at the top of the form");
ok(form.includes("`${id}-error`"), "1h: each validated field reserves its BuiFieldError slot (the submit never moves)");
const fieldBlocks = form.match(/<BookingField[\s\S]*?(?=\/>)/g) || [];
ok(fieldBlocks.length >= 20, "1i: every form field renders through the labelled BookingField");
ok(fieldBlocks.every((block) => block.includes('id="booking-')), "1j: every field carries a stable id (the summary links jump to them)");
ok(fieldBlocks.every((block) => block.includes("label={t(")), "1k: every field carries a real visible label — no placeholder-only fields");
ok(form.includes('className={`bui-input '), "1l: inputs ride the foundation bui-input class (16px text, styled autofill)");
ok(!form.includes("bg-rose-50 px-4 py-3 text-sm font-black text-rose-700"), "1m: the old error line above the submit button is gone");
ok(form.includes('<BuiNotice tone="error" title={error} />'), "1n: server errors land in the top BuiNotice slot, in human words");
ok(form.includes('from "@/components/boardui/Card"') && form.includes("<BuiCard"), "1o: the form's shell is a BuiCard");

/* ------------------------------------------------------------------ */
/* (2) Codes are not quantities                                        */
/* ------------------------------------------------------------------ */

console.log("(2) codes: text inputs, never type=number");

ok(!form.includes('type="number"'), "2a: no type=\"number\" anywhere in the manual form");
ok(form.includes('id="booking-confirmation-code"'), "2b: the confirmation code field exists as a plain text field (BookingField default type)");

/* ------------------------------------------------------------------ */
/* (3) The save contract is untouched                                  */
/* ------------------------------------------------------------------ */

console.log("(3) save contract: endpoint, payload, toast flag, busy guard");

ok(form.includes("currency: tripCurrency || null"), "3a: the payload still carries one currency field for every manual kind");
ok(form.includes("/api/trips/${tripId}/bookings/extract"), "3b: the extraction upload endpoint is unchanged");
ok(form.includes("BOOKING_ADDED_FLAG"), "3c: the success toast flag is still written before navigating");
ok(form.includes('t("ui.booking.saveFailed"'), "3d: save failures still map to the plain-words message");
ok(form.includes("if (busy) return;"), "3e: save() refuses re-entry while a save is in flight");
ok(form.includes("busy={busy}") && form.includes("onClick={() => void save()}"), "3f: the submit is the busy-guarded BuiButton (double-submit impossible)");

/* ------------------------------------------------------------------ */
/* (4) The wallet rides the primitives                                 */
/* ------------------------------------------------------------------ */

console.log("(4) wallet: BuiCard rows, BuiChip pills, accordion details");

ok(wallet.includes('from "@/components/boardui/Card"') && wallet.includes("<BuiCard"), "4a: booking rows are BuiCards");
ok(wallet.includes('from "@/components/boardui/Badge"') && wallet.includes("<BuiChip"), "4b: status pills are BuiChips");
ok(wallet.includes("function statusTone") && wallet.includes("function pillToneFor"), "4c: pill tones map from the same status rules (test bookings stay neutral)");
ok(wallet.includes('from "@/components/boardui/Accordion"') && wallet.includes("More details"), "4d: 'More details' is the BoardUI accordion");
ok(!wallet.includes("<details") && !wallet.includes("<summary"), "4e: no native <details>/<summary> remains in the wallet");
ok(!wallet.includes("#e8dfd0") && !wallet.includes("bg-[#F2F6FC]"), "4f: non-token hex hairlines/fills are gone (chair + page ground instead)");
ok(wallet.includes("customerStatus") && wallet.includes("Action needed") && wallet.includes("Nothing booked yet") && wallet.includes("No longer active"), "4g: every status word and section label is unchanged");
ok(wallet.includes('from "@/components/boardui/Notice"') && wallet.includes("Bookings could not be loaded"), "4h: the load failure is a BuiNotice with the retry action — never an empty wallet");
ok(wallet.includes("/trip/${tripId}/bookings/add"), "4i: the Add booking actions still open the manual booking flow");

/* ------------------------------------------------------------------ */
/* (5) Review + cancel actions ride the primitives                     */
/* ------------------------------------------------------------------ */

console.log("(5) review + cancel: BuiButton/BuiCard/BuiNotice, posts unchanged");

ok(review.includes('from "@/components/boardui/Button"') && review.includes("<BuiButton"), "5a: review actions are BuiButtons");
ok(review.includes('from "@/components/boardui/Card"') && review.includes("<BuiCard"), "5b: the correction + dismiss forms sit in BuiCards");
ok(review.includes('from "@/components/boardui/Notice"'), "5c: review outcomes and errors are BuiNotices");
for (const label of ["Title", "Provider", "Confirmation", "Amount", "Currency", "Start date", "Reason (optional)"]) {
  ok(review.includes(`>${label}<input`), `5d: the '${label}' field keeps its real visible label`);
}
ok(review.includes('"/api/roamly/bookings/review"') && review.includes('post("assert")') && review.includes('post("dismiss"') && review.includes('post("correct"'), "5e: the review post contract (assert/dismiss/correct) is unchanged");
ok(cancel.includes('from "@/components/boardui/Button"') && cancel.includes('variant="danger"'), "5f: the stop-tracking confirm is the danger BuiButton");
ok(cancel.includes("Stop tracking this booking?") && cancel.includes("does not cancel with the") && cancel.includes("Yes, stop tracking"), "5g: the two-tap confirm copy is unchanged");
ok(cancel.includes('from "@/components/boardui/Notice"'), "5h: the cancel failure is a human BuiNotice, never silent");

/* ------------------------------------------------------------------ */
/* (6) The recon face speaks the owner's state words                   */
/* ------------------------------------------------------------------ */

console.log("(6) recon face: exactly 'activated' / 'not activated', BuiCard shell");

ok(gmail.includes("Booking Recon:") && gmail.includes('connected ? "activated" : "not activated"'), "6a: the connection state line reads exactly 'activated' / 'not activated'");
ok(gmail.includes('from "@/components/boardui/Card"') && gmail.includes("<BuiCard"), "6b: the panel shell is a BuiCard, not a hand-copied recipe");
ok(gmail.includes("Kept aside, not deleted") && gmail.includes("setQuarantined"), "6c: the quarantined section is unchanged");
ok(gmail.includes("Sync now") && gmail.includes("Attach to this trip") && gmail.includes("Disconnect"), "6d: sync / attach / disconnect actions are unchanged");
ok(!gmail.includes("auto-apply") && !gmail.includes("autoApply"), "6e: no auto-apply vocabulary or behaviour was introduced on the face");

/* ------------------------------------------------------------------ */
/* (7) Booking cards + the manager's disclosure                        */
/* ------------------------------------------------------------------ */

console.log("(7) booking cards recipe; manager disclosure is the accordion");

ok(cards.includes("bui-squircle") && cards.includes("shadow-bui-card") && cards.includes("border-chair"), "7a: suggestion cards carry the BoardUI card recipe (squircle, hairline, BoardUI shadow)");
ok(!cards.includes("border-cloud") && !cards.includes("shadow-soft"), "7b: the legacy cloud/soft card styling is gone");
ok(!manager.includes("<details") && !manager.includes("<summary"), "7c: no native <details> remains in the bookings manager");
ok(manager.includes('from "@/components/boardui/Accordion"') && manager.includes("Booking details"), "7d: 'Booking details' is the BoardUI accordion");
ok(manager.includes("<BuiCard"), "7e: the manager's booking rows are BuiCards");

/* ------------------------------------------------------------------ */
/* (8) No black on these surfaces                                      */
/* ------------------------------------------------------------------ */

console.log("(8) no black anywhere on the batch-3 surfaces");

for (const [name, source] of [["form", form], ["wallet", wallet], ["review", review], ["cancel", cancel], ["cards", cards], ["gmail", gmail], ["manager", manager]]) {
  ok(!/bg-black|text-black|#000000/.test(source), `8-${name}: no black classes or hex in ${name}`);
}

console.log(`\n${count} boardui bookings checks passed`);
