// Test-only ESM loader: resolves the `@/` path alias to the repo root so
// pure-function unit tests can import TS sources with node
// --experimental-strip-types. Not used by the app.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const root = process.env.ROAMLY_TEST_ROOT || process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.json`, path.join(base, "index.ts")];
    for (const candidate of candidates) {
      if (existsSync(candidate) && !candidate.endsWith("/")) {
        try {
          const stat = await import("node:fs/promises").then((fs) => fs.stat(candidate));
          if (stat.isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
          // fall through
        }
      }
    }
    // Fall back to the raw path and let Node report the miss.
    return { url: pathToFileURL(base).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "json", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
