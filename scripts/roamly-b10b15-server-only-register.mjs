// Test bootstrap: registers the B10–B15 "server-only" stub hook. Use alongside
// roamly-test-register.mjs:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs --import ./scripts/roamly-b10b15-server-only-register.mjs ...
import { register } from "node:module";
register("./roamly-b10b15-server-only-hooks.mjs", import.meta.url);
