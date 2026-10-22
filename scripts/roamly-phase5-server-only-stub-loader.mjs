// Phase 5 test-only ESM loader: (1) stubs Next's `server-only` marker
// package for plain-node test runs — it is not an installed
// dependency (Next resolves it through its bundler at build time) and
// semantically it is a no-op marker outside the react-server export
// condition; (2) retries extensionless relative imports (`./foo`,
// `../foo`) with `.ts` / `.tsx` appended, matching the bundler
// resolution the production sources were written against (the shared
// alias loader only covers `@/` specifiers, and the earlier wiring
// suites never imported the server graph). Both shims exist so the
// Phase 5 harness can import the real adapter module — the seam under
// test — unmodified. Test-only; never used by the app.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL &&
      context.parentURL.startsWith("file:") &&
      error && error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    throw error;
  }
}
