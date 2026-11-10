// BoardUI plan-flow checks (2026-11-09, hard-apply batch 6).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface, judged against the familiar apps (the Airbnb plan-flow
// pattern governs this surface). Batch 6 completes the plan form:
// the audit found its core hard-applied but its edges partial —
// hand-written labels instead of the BuiField pattern, the submit
// a plain BuiButton + busy state instead of the morph, and pickable
// cards without the ClickSpark treatment the transport cards have.
//
// This suite pins the batch-6 conversion:
//   (1) the form's fields ride the BoardUI field pattern through
//       PlanField/PlanSelectField/PlanAreaField on useBuiField +
//       BuiFieldError (batch 3/4 wiring: visible label, blur
//       validation, reserved error slot, shake on error);
//   (2) the four validated fields exist as hooks whose validators
//       reproduce validateStep's messages verbatim, goNext and
//       validateBeforeGenerate run them, and the step-notice
//       suppression reads field-owned errors;
//   (3) the historical error-slot ids survive verbatim;
//   (4) the two-line reservation lives in the primitive now
//       (BuiFieldError reserveLines), default rendering unchanged;
//   (5) the submit is the BuiMorphButton wired to the existing
//       busy state, same click handler, same label expression;
//   (6) every pickable card family on the surface carries
//       BuiClickSpark (recents, trip type, transport);
//   (7) the flow itself is untouched: goNext/goBack/validateStep
//       still exist, and the tripBuilderRules ENGINE is NOT wired
//       in — its wire-in is a separate owner-gated decision.
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

const form = read("components/plan/TripPlanForm.tsx");
const fieldPrimitive = read("components/boardui/Field.tsx");

/* ------------------------------------------------------------------ */
/* (1) Fields ride the BoardUI field pattern                           */
/* ------------------------------------------------------------------ */

console.log("(1) plan fields: PlanField family on useBuiField + BuiFieldError");

ok(form.includes('import { BuiFieldError, useBuiField, type BuiField } from "@/components/boardui/Field";'), "1a: the form imports the BoardUI field pattern");
ok(form.includes("function PlanField("), "1b: PlanField exists");
ok(form.includes("function PlanSelectField("), "1c: PlanSelectField exists");
ok(form.includes("function PlanAreaField("), "1d: PlanAreaField exists");
ok(!form.includes("function FieldError("), "1e: the retired local FieldError is gone");
ok(!form.includes("<FieldError"), "1f: no <FieldError usage remains");
ok((form.match(/<label/g) || []).length === 3, "1g: raw <label> elements live only inside the three Plan field components");
ok(form.includes('"bui-shake block"'), "1h: an errored field shakes (form rule: wrong input shakes)");
ok(form.includes("rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead"), "1i: inputs carry the foundation recipe (16px, bold, head ink)");
ok(!form.includes("min-h-12 w-full rounded-xl border border-chair bg-white px-4 py-3 text-base font-semibold text-cink"), "1j: the pre-BoardUI input/select recipe is gone");
ok(form.includes("aria-describedby={field?.error && id"), "1k: inputs describe themselves by their error slot when errored");
ok(form.includes('inputMode="decimal"'), "1l: the budget amount asks for the decimal keypad");

/* ------------------------------------------------------------------ */
/* (2) The four validated fields + flow wiring                         */
/* ------------------------------------------------------------------ */

console.log("(2) validated fields: hooks, verbatim messages, flow runs them");

for (const hook of ["startDateField", "endDateField", "daysField", "budgetField"]) {
  ok(form.includes(`const ${hook} = useBuiField(`), `2a: ${hook} is a useBuiField hook`);
}
ok((form.match(/"Add an estimated budget\."/g) || []).length >= 2, "2b: the budget empty-message exists in validateStep AND the field validator, verbatim");
ok((form.match(/Please enter a realistic trip budget \(at least 100 \$\{budgetCurrency\}\)\./g) || []).length >= 2, "2c: the budget floor-message exists in validateStep AND the field validator, verbatim");
ok(form.includes("planDateFieldErrors(synced.startDate, synced.endDate, daysCount).start"), "2d: the start validator mirrors the synced step computation");
ok(form.includes("planDateFieldErrors(synced.startDate, synced.endDate, value).days"), "2e: the days validator mirrors the synced step computation");
ok(form.includes("if (step === 1) validateDateFields();"), "2f: goNext runs the date fields on the When step");
ok(form.includes("if (step === 3) budgetField.runValidation(budgetAmount);"), "2g: goNext runs the budget field on the Budget step");
ok(form.includes("startDateField.error || endDateField.error || daysField.error"), "2h: the step-notice suppression reads field-owned errors");
ok(form.includes("onBlurExtra={validateDateFields}"), "2i: blurring either date revalidates the whole date group");

/* ------------------------------------------------------------------ */
/* (3) Historical slot ids                                             */
/* ------------------------------------------------------------------ */

console.log("(3) error slot ids preserved verbatim");

for (const id of ["plan-start-date-error", "plan-end-date-error", "plan-days-error", "plan-budget-error"]) {
  ok(form.includes(id), `3: slot id ${id} preserved`);
}

/* ------------------------------------------------------------------ */
/* (4) The two-line reservation lives in the primitive                 */
/* ------------------------------------------------------------------ */

console.log("(4) BuiFieldError reserveLines: additive, default unchanged");

ok(fieldPrimitive.includes("reserveLines = 1"), "4a: reserveLines defaults to 1");
ok(fieldPrimitive.includes('reserveLines === 2 ? "mt-1.5 min-h-10'), "4b: two-line reservation is min-h-10");
ok(fieldPrimitive.includes('"mt-1.5 min-h-5 text-sm font-semibold leading-5"'), "4c: the one-line default rendering is byte-identical to before");
ok((form.match(/reserveLines=\{2\}/g) || []).length >= 2, "4d: the plan form's slots reserve two lines");

/* ------------------------------------------------------------------ */
/* (5) The submit morph                                                */
/* ------------------------------------------------------------------ */

console.log("(5) submit: BuiMorphButton on the existing busy state");

ok(form.includes('import { BuiMorphButton } from "@/components/boardui/MorphButton";'), "5a: the form imports the morph");
ok(form.includes("<BuiMorphButton"), "5b: the final-step submit is the morph");
ok(form.includes('phase={loading || priceChecking ? "busy" : "idle"}'), "5c: the phase is wired to the existing busy state only");
ok(form.includes("onClick={openFinalConfirmation}"), "5d: the submit still fires openFinalConfirmation");
ok(form.includes('translateText("Checking costs...")') && form.includes('translateText("Starting generation...")') && form.includes('translateText("Opening checkout...")'), "5e: the busy label expression is unchanged");
ok(form.includes("disabled={isCheckingSession && !sessionUser}"), "5f: the session-check disable is preserved (busy disables ride the phase)");
ok(form.includes('"flex-none" : "flex-1"'), "5g: the flex slot flips with the phase — flex-1's grow would override the morph's animated width and strand it at full width (probed live in the proof harness)");

/* ------------------------------------------------------------------ */
/* (6) ClickSpark completeness                                         */
/* ------------------------------------------------------------------ */

console.log("(6) pickable cards: ClickSpark on recents, trip type, transport");

ok((form.match(/<BuiClickSpark/g) || []).length >= 3, "6a: at least three BuiClickSpark usages (transport + recents + trip type)");
ok(form.includes("refillFromRecent(recent)"), "6b: the recent-search refill contract is unchanged");

/* ------------------------------------------------------------------ */
/* (7) Flow untouched + the engine boundary                            */
/* ------------------------------------------------------------------ */

console.log("(7) flow functions intact; tripBuilderRules NOT wired in");

ok(form.includes("function goNext("), "7a: goNext intact");
ok(form.includes("function goBack("), "7b: goBack intact");
ok(form.includes("function validateStep("), "7c: validateStep intact");
ok(form.includes("submitPlan(generationPayload)"), "7d: the generation submit path is unchanged");
ok(!form.includes("tripBuilderRules"), "7e: the tripBuilderRules engine is NOT referenced by the form (wire-in is owner-gated, out of this batch)");

console.log(`\nboardui-planflow checks passed (${count} assertions).`);
