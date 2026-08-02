import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pdfPath = process.env.ROAMLY_PDF_FIXTURE || process.argv[2];

assert.ok(pdfPath, "Provide a PDF path as ROAMLY_PDF_FIXTURE or the first argument.");
assert.ok(fs.existsSync(pdfPath), `PDF fixture not found: ${pdfPath}`);

function hasCommand(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function structuralPageCount(buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

let pages = 0;
if (hasCommand("pdfinfo")) {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pagesMatch = info.match(/^Pages:\s+(\d+)/m);
  assert.ok(pagesMatch, "pdfinfo did not report a page count.");
  pages = Number(pagesMatch[1]);
} else {
  pages = structuralPageCount(fs.readFileSync(pdfPath));
}

assert.ok(pages >= 3 && pages <= 5, `4-day itinerary PDF must stay within 3-5 pages; got ${pages}.`);

const textPath = path.join(os.tmpdir(), `roamly-pdf-${process.pid}.txt`);
try {
  if (hasCommand("pdftotext")) {
    execFileSync("pdftotext", [pdfPath, textPath], { stdio: "ignore" });
    const text = fs.readFileSync(textPath, "utf8").toLowerCase();
    [
      "day-by-day",
      "overview",
      "budget",
      "bookings",
      "essentials",
      "travel notes",
      "search link unavailable",
      "affiliate disclosure",
      "partner link"
    ].forEach((needle) => {
      assert.equal(text.includes(needle), false, `PDF must not contain desktop/tab/affiliate text: ${needle}`);
    });
  } else {
    console.warn("pdftotext not found; skipped PDF text extraction checks.");
  }
} finally {
  fs.rmSync(textPath, { force: true });
}

console.info(`Roamly PDF checks passed (${pages} pages).`);
