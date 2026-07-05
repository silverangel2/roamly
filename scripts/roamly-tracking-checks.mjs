import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/roamly/location.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
  console
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox);

const { calculateDistanceMeters, isWithinRadius, normalizeCoordinates } = sandbox.module.exports;

const cnTower = { latitude: 43.6426, longitude: -79.3871 };
const ripley = { latitude: 43.6424, longitude: -79.386 };
const montreal = { latitude: 45.5019, longitude: -73.5674 };

assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
const normalized = normalizeCoordinates({ latitude: 43.6, longitude: -79.3, accuracy: 12 });
assert.equal(normalized.latitude, 43.6);
assert.equal(normalized.longitude, -79.3);
assert.equal(normalized.accuracy, 12);

assert.ok(calculateDistanceMeters(cnTower.latitude, cnTower.longitude, ripley.latitude, ripley.longitude) < 150);
assert.equal(isWithinRadius(cnTower.latitude, cnTower.longitude, ripley.latitude, ripley.longitude, 250), true);
assert.equal(isWithinRadius(montreal.latitude, montreal.longitude, cnTower.latitude, cnTower.longitude, 250), false);

console.log("Roamly tracking checks passed.");
