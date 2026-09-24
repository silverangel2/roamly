import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
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
          const aliased = id.slice(2);
          if (aliased.endsWith(".json")) return JSON.parse(fs.readFileSync(path.join(root, aliased), "utf8"));
          return load(`${aliased}.ts`);
        }
        if (id.startsWith(".")) {
          const relative = path.join(path.dirname(file), id);
          if (relative.endsWith(".json")) return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
          const candidate = relative.endsWith(".ts") ? relative : `${relative}.ts`;
          return load(candidate);
        }
        return require(id);
      },
      URL,
      console,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { compareTransportOptions, transportOptionCostCents } = loadTsModule("lib/roamly/transportOptions.ts");

const baseInput = {
  origin: "Mysteryville",
  destination: "Unknownhaven",
  originCountry: "Canada",
  destinationCountry: "Canada",
  startDate: "2026-10-09",
  endDate: "2026-10-12",
  daysCount: 4,
  travelersCount: 1,
  budgetAmount: 2000,
  budgetCurrency: "CAD",
  returnToOrigin: true
};

const unknownDrive = compareTransportOptions(baseInput).options.find((option) => option.mode === "drive");
assert(unknownDrive, "unknown same-country pair still exposes a driving discovery action");
assert.equal(unknownDrive.availability, "not_available");
assert.equal(unknownDrive.realistic, false);
assert.equal(unknownDrive.distance_km, undefined);
assert.equal(unknownDrive.estimated_duration_hours, null);
assert.equal(unknownDrive.estimated_cost_min, null);
assert.equal(unknownDrive.estimated_cost_max, null);
assert.equal(unknownDrive.cost_breakdown, undefined);
assert.equal(unknownDrive.price_confidence, "unknown");
assert.equal(unknownDrive.budget_fit, "unknown");
assert.equal(transportOptionCostCents(unknownDrive), null, "unknown transport cost must not coerce to zero");
assert.match(unknownDrive.search_url || "", /^https:\/\/www\.google\.com\/maps\/dir\//);
assert.equal(unknownDrive.search_url, unknownDrive.booking_url);
assert.match(unknownDrive.warning, /unknown/i);
assert(!JSON.stringify(unknownDrive).includes("520"), "arbitrary 520 km fallback must not leak into unknown route output");

const knownRoute = compareTransportOptions({
  ...baseInput,
  origin: "Saint John",
  destination: "Montreal",
  originCountry: "Canada",
  destinationCountry: "Canada"
}).options.find((option) => option.mode === "drive");
assert(knownRoute, "known route pair retains a driving option");
assert.equal(knownRoute.distance_km, 755);
assert.equal(knownRoute.price_confidence, "estimated");
assert.equal(typeof knownRoute.estimated_duration_hours, "number");
assert.equal(typeof knownRoute.estimated_cost_min, "number");
assert.equal(typeof knownRoute.estimated_cost_max, "number");
assert.equal(transportOptionCostCents(knownRoute), Math.round(((knownRoute.estimated_cost_min + knownRoute.estimated_cost_max) / 2) * 100));

console.log("Roamly unknown-route transport checks passed (unknown geometry stays unknown, known estimates remain, map discovery remains available).");
