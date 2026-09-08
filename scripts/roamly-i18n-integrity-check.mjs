import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const locales = ["en", "fr", "es", "ja", "ko", "zh"];
const bundles = Object.fromEntries(
  locales.map((locale) => [locale, JSON.parse(fs.readFileSync(path.join(root, "messages", `${locale}.json`), "utf8"))])
);

function flatten(value, pathName = "", result = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, pathName ? `${pathName}.${key}` : key, result);
  } else {
    result[pathName] = value;
  }
  return result;
}

function shape(value, pathName = "root") {
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.map((item) => shape(item, `${pathName}[]`)) };
  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, shape(child, `${pathName}.${key}`)])
      )
    };
  }
  return { type: typeof value };
}

function placeholders(value) {
  if (typeof value !== "string") return [];
  const malformed = (value.match(/\{/g) || []).length !== (value.match(/\}/g) || []).length;
  assert.equal(malformed, false, `malformed interpolation braces in value: ${value}`);
  return [...value.matchAll(/\{([\w.-]+)\}/g)].map((match) => match[1]).sort();
}

const canonical = flatten(bundles.en);
const candidates = {};
let structuralErrors = 0;
for (const locale of locales.slice(1)) {
  const flat = flatten(bundles[locale]);
  const missing = Object.keys(canonical).filter((key) => !(key in flat));
  const unexpected = Object.keys(flat).filter((key) => !(key in canonical));
  const typeMismatch = Object.keys(canonical).filter((key) => key in flat && typeof canonical[key] !== typeof flat[key]);
  const interpolationMismatch = Object.keys(canonical).filter((key) => key in flat && placeholders(canonical[key]).join("|") !== placeholders(flat[key]).join("|"));
  const structureMismatch = JSON.stringify(shape(bundles.en)) !== JSON.stringify(shape(bundles[locale]));
  structuralErrors += missing.length + unexpected.length + typeMismatch.length + interpolationMismatch.length + (structureMismatch ? 1 : 0);
  candidates[locale] = Object.keys(canonical).filter((key) => key in flat && canonical[key] === flat[key] && typeof canonical[key] === "string").length;
  console.log(`${locale}: missing=${missing.length} unexpected=${unexpected.length} typeMismatch=${typeMismatch.length} structureMismatch=${structureMismatch ? 1 : 0} interpolationMismatch=${interpolationMismatch.length} identicalToEnglish=${candidates[locale]}`);
}

assert.equal(structuralErrors, 0, "message bundle integrity check failed");
console.log(`Translation review candidates: ${JSON.stringify(candidates)}`);
