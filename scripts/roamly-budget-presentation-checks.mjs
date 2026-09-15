import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.endsWith(".ts") ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
        }
        return require(id);
      }
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { buildBudgetPresentation } = loadTsModule("lib/roamly/budgetPresentation.ts");

const breakdown = (overrides = {}) => ({
  lodging: "CAD 500 estimate",
  food: "CAD 300 estimate",
  activities: "CAD 200 estimate",
  transport: "CAD 400 estimate",
  buffer: "CAD 100 estimate",
  total_estimate: "CAD 1,500",
  notes: "",
  budget_status: "within_budget",
  budget_category_confidence: [],
  ...overrides
});

const within = buildBudgetPresentation({ budgetAmount: 2000, currency: "CAD", totalEstimateAmount: 1500, breakdown: breakdown() });
assert.equal(within.status, "WITHIN_BUDGET", "complete known estimate is within budget");
assert.equal(within.remainingLabel, "Remaining: CAD 500", "remaining amount is shown only when complete enough");

const likely = buildBudgetPresentation({ budgetAmount: 2000, currency: "CAD", totalEstimateAmount: 1800, breakdown: breakdown({ budget_status: "tight" }) });
assert.equal(likely.status, "LIKELY_WITHIN_BUDGET", "tight budget is distinct from comfortable within-budget state");

const uncertain = buildBudgetPresentation({
  budgetAmount: 2000,
  currency: "CAD",
  totalEstimateAmount: 1500,
  breakdown: breakdown({ selected_hotel_estimate_amount: 700 }),
  priceDiscovery: { unknownMarketPriceCount: 1, unknownMarketPriceCategories: ["hotel"] }
});
assert.equal(uncertain.status, "BUDGET_UNCERTAIN", "material unknown price makes budget uncertain");
assert.equal(uncertain.remainingLabel, null, "uncertain budget does not show a falsely authoritative remainder");
assert.ok(uncertain.uncertainty.some((item) => item.includes("Hotel price")), "unknown hotel cost is explained in customer language");
assert.ok(!JSON.stringify(uncertain).includes("$0"), "unknown cost is not rendered as zero");

const unknownOther = buildBudgetPresentation({
  budgetAmount: 2000,
  currency: "CAD",
  totalEstimateAmount: 1500,
  breakdown: breakdown({ food_estimate_amount: 300 }),
  priceDiscovery: { unknownMarketPriceCount: 1, unknownMarketPriceCategories: ["buffer"] }
});
assert.ok(unknownOther.uncertainty.some((item) => item.includes("other trip costs")), "unknown supporting cost is explained without treating the missing value as zero");
assert.ok(!unknownOther.costDrivers.some((item) => item.label === "Other trip costs" && item.value === "CAD 300"), "partial other-cost data is not presented as a complete total");

const over = buildBudgetPresentation({ budgetAmount: 1000, currency: "CAD", totalEstimateAmount: 1300, breakdown: breakdown({ budget_status: "over_budget" }), confirmedBookingCount: 1 });
assert.equal(over.status, "OVER_BUDGET", "over-budget state remains over budget");
assert.match(over.statusDetail, /Confirmed commitments stay protected/, "over-budget guidance protects confirmed commitments");
assert.equal(over.committedCount, 1, "confirmed booking coverage remains visible");

const incomplete = buildBudgetPresentation({ budgetAmount: null, currency: "CAD", totalEstimateAmount: null, breakdown: breakdown({ budget_status: "unknown" }) });
assert.equal(incomplete.status, "BUDGET_UNCERTAIN", "incomplete budget data produces truthful uncertainty");
assert.equal(incomplete.targetLabel, "Budget target not set");
assert.equal(incomplete.totalLabel, "Not calculated");

console.log("Roamly budget presentation checks passed.");
