// Test-only resolve hooks, used alongside roamly-test-register.mjs:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs --import ./scripts/roamly-test-server-only-register.mjs ...
// 1. "server-only" is a Next.js build-time marker with no runtime exports,
//    and it is absent from this checkout's node_modules (pre-existing gap,
//    unrelated to the code under test) — stub it with an empty module.
// 2. Next.js resolves extensionless relative imports ("./bookingPhotoCore"
//    -> "./bookingPhotoCore.ts"); node's strip-types loader does not — retry
//    failed relative resolutions with .ts/.tsx/.mjs/index.ts suffixes.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!isRelative || error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    for (const ext of [".ts", ".tsx", ".mjs", "/index.ts"]) {
      try {
        return await nextResolve(new URL(specifier + ext, context.parentURL).href, context);
      } catch {
        // Try the next suffix.
      }
    }
    throw error;
  }
}
