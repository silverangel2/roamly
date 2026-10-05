// Test bootstrap: registers the @/ alias loader. Use:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs ...
import { register } from "node:module";
register("./roamly-test-alias-loader.mjs", import.meta.url);
