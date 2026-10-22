import type { BudgetVerdictDisplay } from "@/lib/roamly/engine/budgetVerdictDisplay";

/*
 * BudgetVerdictCard — the all-in budget verdict on the trip page
 * (ship defect #2, 2026-10-22). Renders ONLY the display payload
 * finalization stamped onto engine-generated itineraries
 * (`budget_verdict_display`): the verdict in plain words, the
 * whole-trip estimated total, what the evidence covered, and the
 * component lines — priced ones with their ranges, unpriced ones
 * NAMED as not counted (never $0). Incumbent itineraries never
 * carry the payload and keep the legacy BudgetSummary.
 */

const VERDICT_TONES: Record<BudgetVerdictDisplay["verdict"], string> = {
  WITHIN: "border-ocean/40 bg-ocean/5",
  "AT RISK": "border-sun/60 bg-sun/10",
  OVER: "border-coral/50 bg-coral/5",
  UNVERIFIABLE: "border-[#e8dfd0] bg-white"
};

export function BudgetVerdictCard({ display }: { display: BudgetVerdictDisplay }) {
  return (
    <div className={`rounded-[1.35rem] border px-5 py-5 shadow-[0_10px_30px_rgba(16,32,51,0.04)] ${VERDICT_TONES[display.verdict]}`}>
      <p className="text-[0.8125rem] font-medium text-slate-500">Whole-trip budget verdict</p>
      <p className="mt-1 text-[1.3rem] font-semibold leading-7 tracking-[-0.02em] text-ink">{display.headline}</p>
      {display.totalLabel ? <p className="mt-1 text-[1.05rem] font-medium text-ink">{display.totalLabel}</p> : null}
      {display.capLabel ? <p className="mt-0.5 text-sm text-slate-600">{display.capLabel}</p> : null}
      <p className="mt-3 text-sm leading-6 text-slate-600">{display.reason}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{display.coverageLabel}</p>
      {display.componentLines.length ? (
        <ul className="mt-4 grid gap-2">
          {display.componentLines.map((line) => (
            <li key={line.label} className="rounded-xl bg-white/70 px-3 py-2 text-sm leading-6">
              <span className="font-semibold text-ink">{line.label}: </span>
              <span className={line.evidenced ? "text-slate-700" : "text-slate-600"}>{line.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-[0.8125rem] leading-5 text-slate-500">{display.scopeNote}</p>
    </div>
  );
}
