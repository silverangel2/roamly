// Pack-wait release backoff proof (Koeln 2026-11-22, KF-2 #3 reclassified SLOW).
//
// The stall: a cold big city needs a destination-pack build whose live
// collection lane takes up to ~210 s of continuous work, but the outline
// stage released the job immediately-due on every pack-wait cycle, so the
// harness's ~4 s advance polling re-claimed it at once and re-kicked a
// ~50 s drive that discarded its partial live collection — 75 waits in
// 5 min, pack never published. The */5 cron wake that could host the
// full 300 s drive never got an uncontested claim. Koeln completed on its
// own at the 19:50 wake, 14m32s in.
//
// The fix (one mechanism, one PR):
// - lib/roamly/generationWorker.ts: the pack-wait busy branch releases
//   with next_attempt_at = now + PACK_WAIT_RELEASE_BACKOFF_MS (90 s).
//   Only that branch gets the delay.
// - lib/roamly/generationQueue.ts: releaseGenerationJob accepts an
//   optional nextAttemptAt and passes it as p_next_attempt_at. Omitted
//   means the RPC call is identical to before.
// - supabase/migrations/20261122_roamly_release_backoff.sql: the release
//   RPC takes an optional p_next_attempt_at and sets it on release;
//   NULL (the default) keeps the existing value.
//
// PROOF STANDARD (Junel 2026-11-20: no weak code): this script must FAIL
// on the unfixed code and PASS on the fixed code.
// - Part 1 (source contract) fails on unfixed code: no backoff constant,
//   no waitingForPack branch, no p_next_attempt_at anywhere.
// - Part 2 (real releaseGenerationJob, vm-loaded, never re-implemented)
//   fails on unfixed code: the delay call carries no p_next_attempt_at.
// - Part 3 (real Postgres 17 on a Dell scratch DB, dropped after each
//   run) proves the mechanism end to end against the REAL RPCs:
//   BEFORE (old release RPC): release -> immediate re-claim, 5/5, and
//   next_attempt_at never moves — the Koeln spin, reproduced.
//   AFTER (new release RPC): release with backoff -> next_attempt_at
//   ~90 s out, the job is NOT claimable while backed off, and once the
//   backoff lapses the job claims again (no wedge); a release with no
//   backoff leaves next_attempt_at untouched.
//
// REQUIREMENT: a Postgres reachable through the Dell SSH helper
// (~/workspace/dell-ssh/dell_ssh_direct.sh, direct Tailscale SSH to the
// Dell; the scratch DB lives in the roamly-db container and is dropped
// at the end of every run, pass or fail). Override with:
//   BACKOFF_SSH_HELPER — path to the helper script
//   BACKOFF_TEST_DB    — scratch database name (default pack_wait_release_backoff_test)
// Run: npm run test:pack-wait-release-backoff
//
// Proof level: release behavior + claim eligibility against real
// Postgres with the real RPC text read from the migration files, and the
// real TS release wrapper. NOT proven here: that a live cold-city
// generation completes inside the 300 s window — that needs the next
// cold-city daily test (Koeln itself is warm now).

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const SSH_HELPER =
  process.env.BACKOFF_SSH_HELPER ||
  path.join(os.homedir(), "workspace/dell-ssh/dell_ssh_direct.sh");
const TEST_DB = process.env.BACKOFF_TEST_DB || "pack_wait_release_backoff_test";

const NEW_MIGRATION = "supabase/migrations/20261122_roamly_release_backoff.sql";
const OLD_MIGRATION = "supabase/migrations/20260731_roamly_generation_worker_resume.sql";
const CLAIM_MIGRATION = "supabase/migrations/20260715_roamly_generation_worker.sql";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const JOB_ID = "b0000001-0000-4000-8000-000000000001";
const WORKER_ID = "backoff-test-worker";

// ---- Part 1: source contract (fails on unfixed code) ----
const workerSource = read("lib/roamly/generationWorker.ts");
assert.match(
  workerSource,
  /export const PACK_WAIT_RELEASE_BACKOFF_MS = 90_000;/,
  "the worker must export a 90 s pack-wait release backoff"
);
assert.match(
  workerSource,
  /"waitingForPack" in result && result\.waitingForPack === true/,
  "the busy branch must gate the backoff on waitingForPack"
);
assert.match(
  workerSource,
  /new Date\(Date\.now\(\) \+ PACK_WAIT_RELEASE_BACKOFF_MS\)\.toISOString\(\)/,
  "the backoff must be now + PACK_WAIT_RELEASE_BACKOFF_MS"
);
assert.match(
  workerSource,
  /\.\.\.\(packWaitBackoff \? \{ nextAttemptAt: packWaitBackoff \} : \{\}\)/,
  "the busy branch must pass nextAttemptAt only when the backoff applies"
);
assert.equal(
  (workerSource.match(/nextAttemptAt:/g) || []).length,
  1,
  "exactly one release site in the worker may pass nextAttemptAt (the pack-wait busy branch)"
);
const queueSource = read("lib/roamly/generationQueue.ts");
assert.match(
  queueSource,
  /nextAttemptAt\?: string;/,
  "releaseGenerationJob must accept an optional nextAttemptAt"
);
assert.match(
  queueSource,
  /\.\.\.\(params\.nextAttemptAt \? \{ p_next_attempt_at: params\.nextAttemptAt \} : \{\}\)/,
  "releaseGenerationJob must pass p_next_attempt_at only when one is given"
);
const newSql = read(NEW_MIGRATION);
assert.match(newSql, /p_next_attempt_at timestamptz default null/, "new migration must add the optional backoff parameter");
assert.match(
  newSql,
  /next_attempt_at = coalesce\(p_next_attempt_at, next_attempt_at\)/,
  "new RPC must set next_attempt_at only when a backoff is passed"
);
assert.match(
  newSql,
  /drop function if exists public\.roamly_release_generation_job\(uuid, text, text\);/,
  "new migration must drop the old 3-argument function (no overload split)"
);
const oldSql = read(OLD_MIGRATION);
assert.doesNotMatch(oldSql, /p_next_attempt_at/, "old RPC must not contain the backoff (negative control guard)");
console.log("PASS source contract: backoff exists only on the pack-wait busy release; old RPC is the unfixed version");

// ---- Part 2: the REAL releaseGenerationJob (vm-loaded, never re-implemented) ----
function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const ext = path.extname(absolute);
    if (ext === ".json") return JSON.parse(fs.readFileSync(absolute, "utf8"));
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      console,
      require(id) {
        if (id === "server-only") return {};
        if (id === "openai") return { __esModule: true, default: class FakeOpenAI {} };
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.match(/\.(ts|tsx|mjs|json)$/) ? resolved : `${resolved}.ts`);
        }
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const { releaseGenerationJob } = loadTsModule("lib/roamly/generationQueue.ts");
assert.equal(typeof releaseGenerationJob, "function", "generationQueue must export releaseGenerationJob");

const rpcCalls = [];
const fakeSupabase = {
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: true, error: null };
  }
};
const noDelay = await releaseGenerationJob({
  supabase: fakeSupabase,
  jobId: JOB_ID,
  workerId: WORKER_ID,
  nextStatus: "waiting"
});
// NOTE: values returned by the vm-loaded module live in the vm realm, so
// assert.deepEqual fails on identical object contents (different Object
// prototype) — compare fields individually, as the day-batch checks do
// for arrays.
assert.equal(noDelay.ok, true, "plain release must succeed");
assert.equal(noDelay.released, true, "plain release must report released");
assert.equal(rpcCalls[0].name, "roamly_release_generation_job", "plain release must call the release RPC");
assert.ok(!("p_next_attempt_at" in rpcCalls[0].args), "plain release must NOT send p_next_attempt_at (call identical to before)");
const backoffAt = "2026-11-22T20:00:00.000Z";
const withDelay = await releaseGenerationJob({
  supabase: fakeSupabase,
  jobId: JOB_ID,
  workerId: WORKER_ID,
  nextStatus: "waiting",
  nextAttemptAt: backoffAt
});
assert.equal(withDelay.ok, true, "backoff release must succeed");
assert.equal(withDelay.released, true, "backoff release must report released");
assert.equal(rpcCalls[1].args.p_next_attempt_at, backoffAt, "backoff release must pass the exact timestamp through");
const failingSupabase = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
const failed = await releaseGenerationJob({
  supabase: failingSupabase,
  jobId: JOB_ID,
  workerId: WORKER_ID,
  nextStatus: "waiting",
  nextAttemptAt: backoffAt
});
assert.equal(failed.ok, false, "an RPC error must surface as ok:false");
assert.equal(failed.error, "boom", "an RPC error must preserve the message");
assert.equal(failed.released, false, "an RPC error must report not released");
console.log("PASS real releaseGenerationJob: backoff passed through only when given; plain call unchanged; errors preserved");

// ---- Part 3: real Postgres (Dell scratch DB) ----
function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runRemote(remoteCmd, stdinFile = null) {
  const pipeline = stdinFile
    ? `bash ${shq(SSH_HELPER)} ${shq(remoteCmd)} < ${shq(stdinFile)}`
    : `bash ${shq(SSH_HELPER)} ${shq(remoteCmd)}`;
  return new Promise((resolve, reject) => {
    execFile("bash", ["-c", pipeline], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const psqlCmd = (db) =>
  `wsl -d Ubuntu docker exec -i roamly-db psql -U supabase_admin -d ${db} -v ON_ERROR_STOP=1 -t -A`;
const createdbCmd = `wsl -d Ubuntu docker exec roamly-db createdb -U supabase_admin ${TEST_DB}`;
const dropdbCmd = `wsl -d Ubuntu docker exec roamly-db dropdb -U supabase_admin --if-exists ${TEST_DB}`;

async function psql(db, sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backoff-psql-"));
  const file = path.join(dir, "input.sql");
  try {
    fs.writeFileSync(file, sql);
    const { stdout, stderr } = await runRemote(psqlCmd(db), file);
    if (stderr.trim()) process.stderr.write(`[psql ${db}] ${stderr}`);
    return stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SCHEMA_SQL = `
create table public.roamly_trips (
  id uuid primary key,
  user_id uuid,
  status text,
  itinerary_status text
);
create table public.roamly_trip_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid,
  user_id uuid,
  status text,
  retry_count integer not null default 0,
  priority integer not null default 0,
  next_attempt_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roamly_trip_generation_jobs_active_trip_idx
  on public.roamly_trip_generation_jobs (trip_id)
  where status in ('queued', 'running', 'waiting');
`;

// The Koeln job shape at the stall: running, locked, due since creation,
// retry 0, no error — the state every pack-wait release started from.
const SEED_SQL = `
insert into public.roamly_trips (id, user_id, status, itinerary_status) values
  ('${TRIP_ID}', '${USER_ID}', 'active', 'generating');
insert into public.roamly_trip_generation_jobs
  (id, trip_id, user_id, status, retry_count, priority, next_attempt_at, completed_at, created_at, started_at, locked_by, locked_at, lease_expires_at) values
  ('${JOB_ID}', '${TRIP_ID}', '${USER_ID}', 'running', 0, 0, now() - interval '1 day', null, now() - interval '1 day', now() - interval '1 day', '${WORKER_ID}', now(), now() + interval '240 seconds');
`;

async function freshDb() {
  await runRemote(dropdbCmd);
  await runRemote(createdbCmd);
  await psql(TEST_DB, SCHEMA_SQL);
}

function lines(out) {
  return out.trim().split("\n").filter(Boolean);
}

async function main() {
  const claimSql = read(CLAIM_MIGRATION);
  try {
    // ---- BEFORE: the old release RPC spins (the Koeln shape, reproduced) ----
    await freshDb();
    await psql(TEST_DB, claimSql);
    await psql(TEST_DB, oldSql);
    await psql(TEST_DB, SEED_SQL);
    for (let cycle = 1; cycle <= 5; cycle++) {
      const out = await psql(
        TEST_DB,
        `select public.roamly_release_generation_job('${JOB_ID}', '${WORKER_ID}', 'waiting');\n` +
          `select extract(epoch from (now() - next_attempt_at)) from public.roamly_trip_generation_jobs where id = '${JOB_ID}';\n` +
          `select id from public.roamly_claim_generation_job_by_trip('${TRIP_ID}', '${WORKER_ID}') where id is not null;`
      );
      const [released, dueSeconds, claimed] = lines(out);
      assert.equal(released, "t", `cycle ${cycle}: old release must succeed`);
      assert.ok(
        Number(dueSeconds) > 3600,
        `cycle ${cycle}: old release must leave next_attempt_at in the past (due ${dueSeconds}s), got ${dueSeconds}`
      );
      assert.equal(claimed, JOB_ID, `cycle ${cycle}: old release must let the job re-claim at once (the spin)`);
    }
    console.log("PASS negative control (old RPC): 5/5 immediate re-claims, next_attempt_at never moves — the Koeln spin");

    // ---- AFTER: the new release RPC backs off ----
    await freshDb();
    await psql(TEST_DB, claimSql);
    await psql(TEST_DB, oldSql);
    await psql(TEST_DB, newSql);
    const fnCount = await psql(
      TEST_DB,
      `select count(*) from pg_proc where proname = 'roamly_release_generation_job' and pronamespace = 'public'::regnamespace;`
    );
    assert.equal(lines(fnCount)[0], "1", "exactly one release function must exist after the migration (no overload split)");
    await psql(TEST_DB, SEED_SQL);

    // Release with the 90 s backoff, then read the stored value in the same
    // script so the delta is measured in milliseconds, not SSH round-trips.
    const backoffOut = await psql(
      TEST_DB,
      `select public.roamly_release_generation_job('${JOB_ID}', '${WORKER_ID}', 'waiting', now() + interval '90 seconds');\n` +
        `select status from public.roamly_trip_generation_jobs where id = '${JOB_ID}';\n` +
        `select round(extract(epoch from (next_attempt_at - now()))::numeric, 1) from public.roamly_trip_generation_jobs where id = '${JOB_ID}';`
    );
    const [backoffReleased, backoffStatus, backoffSeconds] = lines(backoffOut);
    assert.equal(backoffReleased, "t", "backoff release must succeed");
    assert.equal(backoffStatus, "waiting", "backoff release must leave the job waiting");
    const secondsOut = Number(backoffSeconds);
    assert.ok(
      secondsOut >= 60 && secondsOut <= 95,
      `next_attempt_at must sit ~90 s out after a backoff release, got ${backoffSeconds}s`
    );

    // While backed off, the job must NOT be claimable — twice, mirroring
    // the harness polling every ~4 s.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const claimOut = await psql(
        TEST_DB,
        `select id from public.roamly_claim_generation_job_by_trip('${TRIP_ID}', '${WORKER_ID}') where id is not null;`
      );
      assert.equal(lines(claimOut).length, 0, `claim attempt ${attempt} while backed off must return nothing`);
    }
    console.log(`PASS backoff holds: next_attempt_at ${backoffSeconds}s out, 2 claim attempts refused`);

    // Once the backoff lapses the job must claim again (no wedge), and a
    // release with no backoff must leave next_attempt_at untouched.
    const resumeOut = await psql(
      TEST_DB,
      `update public.roamly_trip_generation_jobs set next_attempt_at = now() - interval '1 minute' where id = '${JOB_ID}';\n` +
        `select id from public.roamly_claim_generation_job_by_trip('${TRIP_ID}', '${WORKER_ID}') where id is not null;\n` +
        `select public.roamly_release_generation_job('${JOB_ID}', '${WORKER_ID}', 'waiting');\n` +
        `select extract(epoch from (now() - next_attempt_at)) from public.roamly_trip_generation_jobs where id = '${JOB_ID}';`
    );
    // Output lines: "UPDATE 1", the claimed id, "t", the due seconds.
    const allResume = lines(resumeOut);
    const claimedId = allResume.find((line) => line === JOB_ID);
    assert.ok(claimedId, `job must claim again once the backoff lapses, got: ${resumeOut}`);
    assert.ok(allResume.includes("t"), "plain release after reclaim must succeed");
    const dueAfterPlain = Number(allResume[allResume.length - 1]);
    assert.ok(
      dueAfterPlain > 30 && dueAfterPlain < 300,
      `plain release must leave next_attempt_at untouched (still ~60 s due), got ${dueAfterPlain}s`
    );
    console.log("PASS no wedge: job re-claims after the backoff lapses; plain release leaves next_attempt_at untouched");
  } finally {
    await runRemote(dropdbCmd).catch(() => {});
  }

  console.log("PASS pack-wait-release-backoff: old RPC spins 5/5; new RPC backs off ~90 s, refuses claims while backed off, re-claims after");
}

main().catch((error) => {
  console.error(`FAIL pack-wait-release-backoff: ${error.message}`);
  if (error.stderr) console.error(error.stderr.slice(0, 2000));
  process.exit(1);
});
