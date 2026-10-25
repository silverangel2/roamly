// Test bootstrap: registers the "server-only" stub hook. Use alongside
// roamly-test-register.mjs:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs --import ./scripts/roamly-booking-cancel-server-only-register.mjs ...
import { register } from "node:module";
register("./roamly-booking-cancel-server-only-hooks.mjs", import.meta.url);
