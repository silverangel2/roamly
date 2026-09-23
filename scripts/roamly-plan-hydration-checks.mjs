import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planForm = readFileSync("components/plan/TripPlanForm.tsx", "utf8");

assert.match(planForm, /const \[draftHydratedState, setDraftHydratedState\] = useState\(false\)/);
assert.match(planForm, /setStep\(clampStep\(record\.currentStep \?\? record\.step\)\)/);

const restoreEffect = planForm.match(
  /useEffect\(\(\) => \{[\s\S]*?const raw = window\.localStorage\.getItem\(PLAN_DRAFT_KEY\);[\s\S]*?restorePlanDraft\(record\);[\s\S]*?if \(bookingFallbackSource\) \{[\s\S]*?if \(restoredStoredDraft\) \{[\s\S]*?Your saved trip plan was kept\.[\s\S]*?\} else \{[\s\S]*?setDestinationPlace\(readDraftPlace\(fallbackDestination\)\);[\s\S]*?\}[\s\S]*?draftHydrated\.current = true;[\s\S]*?setDraftHydratedState\(true\);[\s\S]*?\}, \[bookingFallbackSource,[\s\S]*?shouldShowResumeNotice\]\);/
);
assert.ok(restoreEffect, "saved planner state must be restored before the hydration-complete signal");
assert.match(planForm, /function readIsoDate\(value: string \| null\)/, "booking fallback dates are strictly validated as real ISO calendar dates");
assert.match(planForm, /searchParams\.get\("startDate"\) \|\| searchParams\.get\("checkInDate"\)/, "flight and hotel date parameter conventions are both restored");

const hydrationGate = planForm.match(/\{!draftHydratedState \? \([\s\S]*?\) : \([\s\S]*?steps\[step\]\.detail[\s\S]*?\)\}/);
assert.ok(hydrationGate, "step labels and their matching step content must render only after saved-state hydration");
assert.match(hydrationGate[0], /Preparing your saved trip plan\.\.\./);
assert.match(hydrationGate[0], /aria-busy="true"/);

console.log("PASS: saved planner state hydrates before the stepper and fields render");
