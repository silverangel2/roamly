// Test-only resolve hooks:
// 1. Map the "server-only" marker import to an empty stub module so check
//    scripts can import production modules that pull it in transitively.
//    No production effect.
// 2. Resolve extensionless relative imports (./foo, ../foo) to their .ts /
//    .tsx / .mjs files, which node --experimental-strip-types does not do
//    on its own. The @/ alias is handled by roamly-test-register.mjs.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".json"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: new URL("./roamly-booking-cancel-server-only-stub.mjs", import.meta.url).href,
      shortCircuit: true
    };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    !path.extname(specifier)
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const base = path.resolve(parentDir, specifier);
    const candidates = [
      ...CANDIDATE_EXTENSIONS.map((ext) => `${base}${ext}`),
      path.join(base, "index.ts"),
      path.join(base, "index.tsx")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
