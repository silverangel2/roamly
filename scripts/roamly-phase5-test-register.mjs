// Phase 5 test bootstrap: the server-only stub loader, then the
// shared @/ alias loader. Use:
//   node --experimental-strip-types --import ./scripts/roamly-phase5-test-register.mjs ...
import { register } from "node:module";
register("./roamly-phase5-server-only-stub-loader.mjs", import.meta.url);
register("./roamly-test-alias-loader.mjs", import.meta.url);
