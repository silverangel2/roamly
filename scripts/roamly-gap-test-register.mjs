// GAP-CLOSURE WAVE 3 test bootstrap: registers the gap loader
// (admin + generation-email redirects, @/ alias, server-only stub).
import { register } from "node:module";
register("./roamly-gap-loader.mjs", import.meta.url);
