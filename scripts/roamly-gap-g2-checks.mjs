// GAP-CLOSURE WAVE 3 — G2: TRUE SIGKILL proof.
//
// kf2 fabricated the crash inside one process (persisted state
// shape + blocked waiter, driven by a failure-injecting store).
// This suite performs the literal event instead:
//   1. CONTROL — a child process runs the zero-engine
//      Charlottetown generation to completion against a
//      file-backed EngineGenerationStore (roamly-gap-g2-file-store.mjs,
//      same contract + CAS semantics as kf2's memory store). Its
//      canonical final itinerary is the control truth.
//   2. VICTIM — a second child, same trip, fresh file store. Its
//      pack store blocks ~3 s mid day-batch stage (after the batch
//      flip has been persisted to disk; marker file proves the
//      stage is in flight). The parent sends SIGKILL. Assertions:
//      the child died BY SIGKILL, no completion marker exists, and
//      the on-disk state is exactly the interrupted shape
//      (generating, batch generating, no final itinerary).
//   3. RESUME — a third process loads the victim's file store and
//      drives the remaining wakes. Assertions: completes, final
//      itinerary canon IDENTICAL to the unkilled control, exactly
//      one itinerary row and one prediction on disk.
//
// FIDELITY NOTE — the one cross-process adaptation: the ENGINE
// store is file-backed exactly as tasked. The PACK store is kf2's
// in-memory store, whose pin table cannot cross processes (in
// production the pin is a Postgres row via SupabasePackStore and
// persists). The resume child therefore re-pins from the durable
// run record in the file store (metadata.zeroEngine.packVersionId),
// after asserting the re-seeded pack is the identical content-
// addressed version. The stranded-batch age gate is waited out in
// real time with production env knobs shortened (lease 8 s + day
// timeout 4 s = 12 s vs 285 s at defaults); the gate code itself
// runs unmodified.
//
// Run via: npm run test:gap-g2 (from the repo root). Slow by
// design (three real child processes) — own suite, kept out of
// the shared battery timing path.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileEngineStore } from "./roamly-gap-g2-file-store.mjs";

const { getStagedGenerationState } = await import("@/lib/roamly/stagedItineraryGeneration.ts");

let assertions = 0;
const failures = [];
function check(label, cond, detail) {
  assertions += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label} — ${detail}`);
    failures.push(`${label}: ${detail}`);
  }
}

const TREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = path.join(TREE_ROOT, "scripts", "roamly-gap-g2-child.mjs");
const REGISTER = "./scripts/roamly-phase5-test-register.mjs";

function spawnChild(mode, storePath, markerDir) {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--import", REGISTER, CHILD, "--mode", mode, "--store", storePath, "--markers", markerDir],
    {
      cwd: TREE_ROOT,
      stdio: "ignore",
      // Production operator knobs, shortened so the stranded-batch
      // age gate (lease + day-stage timeout = 12 s here, vs 285 s
      // at defaults) can be waited out in real time by the resume
      // child. The gate itself executes unmodified.
      env: {
        ...process.env,
        ROAMLY_STAGED_GENERATION_LEASE_MS: "8000",
        OPENAI_DAY_TIMEOUT_MS: "4000"
      }
    }
  );
  return child;
}
const waitExit = (child) =>
  new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
async function waitFor(file, timeoutMs) {
  const start = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

const workDir = mkdtempSync(path.join(TREE_ROOT, "scripts", ".g2-run-"));
import { mkdirSync } from "node:fs";
mkdirSync(path.join(workDir, "control-markers"));
mkdirSync(path.join(workDir, "victim-markers"));

/* ═══ 1. CONTROL run (unkilled) ═══ */
console.log("G2/control: unkilled child run");
const controlStorePath = path.join(workDir, "control-store.json");
const control = spawnChild("run", controlStorePath, path.join(workDir, "control-markers"));
const controlExit = await waitExit(control);
check("control child exits 0", controlExit.code === 0, JSON.stringify(controlExit));
const controlCompleted = JSON.parse(
  readFileSync(path.join(workDir, "control-markers", "completed-run.json"), "utf8")
);
check("control generation completed", controlCompleted.status === "complete", controlCompleted.status);
check("control wrote exactly one itinerary", controlCompleted.itineraries === 1, `${controlCompleted.itineraries}`);
check("control wrote exactly one prediction", controlCompleted.predictions === 1, `${controlCompleted.predictions}`);

/* ═══ 2. VICTIM run — SIGKILL mid-stage ═══ */
console.log("G2/victim: SIGKILL during the day-batch stage");
const victimStorePath = path.join(workDir, "victim-store.json");
const victimMarkers = path.join(workDir, "victim-markers");
const victim = spawnChild("run", victimStorePath, victimMarkers);
const markerAppeared = await waitFor(path.join(victimMarkers, "inflight.marker"), 60000);
check("victim reached the in-flight marker (stage running)", markerAppeared, "marker never appeared");
process.kill(victim.pid, "SIGKILL");
const victimExit = await waitExit(victim);
check("victim died by SIGKILL", victimExit.signal === "SIGKILL", JSON.stringify(victimExit));
check(
  "victim wrote no completion marker",
  !existsSync(path.join(victimMarkers, "completed-run.json")),
  "completed-run.json exists"
);
const killedStore = new FileEngineStore(victimStorePath);
const killedRow = await killedStore.loadTrip("trip-g2-shared", "g2-harness-user");
const killedState = getStagedGenerationState(killedRow.metadata, "trip-g2-shared");
check("on-disk state is mid-generation", killedState.status === "generating_day", killedState.status);
const killedBatch = Object.values(killedState.batches).find((b) => b.status === "generating");
check("a day batch is stuck in 'generating' on disk", Boolean(killedBatch), JSON.stringify(Object.values(killedState.batches).map((b) => b.status)));
const killedData = killedStore.read();
check("no final itinerary on disk after the kill", !killedData.itineraries["trip-g2-shared"]?.final, "final itinerary present");

/* ═══ 3. RESUME in a second process ═══ */
console.log("G2/resume: second process resumes the victim's file store");
const resume = spawnChild("resume", victimStorePath, victimMarkers);
const resumeExit = await waitExit(resume);
check("resume child exits 0", resumeExit.code === 0, JSON.stringify(resumeExit));
const resumedCompleted = JSON.parse(
  readFileSync(path.join(victimMarkers, "completed-resume.json"), "utf8")
);
check("resumed generation completed", resumedCompleted.status === "complete", resumedCompleted.status);
check(
  "resumed itinerary canon EQUALS the unkilled control",
  resumedCompleted.canon === controlCompleted.canon,
  "canon divergence between killed+resumed and control runs"
);
check("exactly one itinerary after resume", resumedCompleted.itineraries === 1, `${resumedCompleted.itineraries}`);
check("exactly one prediction after resume", resumedCompleted.predictions === 1, `${resumedCompleted.predictions}`);

console.log(`\nGAP-G2 TRUE-SIGKILL: ${assertions} assertions, ${failures.length} failures`);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`work dir kept for debugging: ${workDir}`);
  process.exit(1);
}
(await import("node:fs")).rmSync(workDir, { recursive: true, force: true });
console.log("GAP-G2 TRUE-SIGKILL PASSED");
