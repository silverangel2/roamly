// GAP-CLOSURE WAVE 3 — test-only ESM loader for the queue-worker /
// staged-AI suites. Combines the repo's own test shims (the @/ alias
// from scripts/roamly-test-alias-loader.mjs and the server-only +
// extensionless handling from
// scripts/roamly-phase5-server-only-stub-loader.mjs) with the two
// injection redirects of the fix1 harness template
// (~/workspace/roamly-e2e-fixes-2026-10-23/fix1/harness/loader.mjs):
//
//   @/lib/supabase/admin                 -> ./roamly-gap-stub-admin.mjs
//     (createSupabaseAdminClient() returns globalThis.__roamlyFakeSupabase)
//   @/lib/roamly/itineraryGenerationEmail -> ./roamly-gap-stub-generation-email.mjs
//     (captures sends into globalThis.__capturedGenerationEmails)
//
// Everything else is the REAL tree code, unmodified.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stubAdminUrl = new URL("./roamly-gap-stub-admin.mjs", import.meta.url).href;
const stubEmailUrl = new URL("./roamly-gap-stub-generation-email.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase/admin") {
    return { url: stubAdminUrl, shortCircuit: true };
  }
  if (specifier === "@/lib/roamly/itineraryGenerationEmail") {
    return { url: stubEmailUrl, shortCircuit: true };
  }
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const base = path.join(treeRoot, specifier.slice(2));
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.json`,
      path.join(base, "index.ts")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        try {
          const { stat } = await import("node:fs/promises");
          if ((await stat(candidate)).isFile()) {
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        } catch {
          // fall through
        }
      }
    }
    return { url: pathToFileURL(base).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL &&
      context.parentURL.startsWith("file:") &&
      error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "json", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
