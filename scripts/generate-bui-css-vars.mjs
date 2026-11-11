/**
 * generate-bui-css-vars — G11 single-source derivation (Stage 8, 2026-11-11).
 *
 * components/boardui/tokens.ts is the ONE canonical home of the BoardUI
 * brand tokens. tailwind.config.ts imports it directly; CSS cannot
 * import TS, so the --bui-* variables in app/globals.css are DERIVED
 * from tokens.ts by this generator:
 *
 *   node scripts/generate-bui-css-vars.mjs           → check mode (exit 1 on drift)
 *   node scripts/generate-bui-css-vars.mjs --write   → rewrite the var values in place
 *
 * Only the VALUES of existing --bui-* declarations are rewritten; the
 * block's structure, comments, and ordering are the stylesheet's own.
 * Hex values are emitted lowercase, matching globals.css's standing
 * convention (CSS hex is case-insensitive; the token is the hex code —
 * the drift suite compares hex case-insensitively and every other
 * value byte-exactly).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TREE = fileURLToPath(new URL("..", import.meta.url));

/** --bui-* variable → where its value lives in tokens.ts. */
export const BUI_CSS_VAR_SOURCES = {
  "--bui-blue": ["primitives", "blue"],
  "--bui-navy": ["primitives", "navy"],
  "--bui-head": ["primitives", "head"],
  "--bui-ink": ["primitives", "ink"],
  "--bui-gray": ["primitives", "gray"],
  "--bui-gray-2": ["primitives", "gray2"],
  "--bui-hairline": ["primitives", "hairline"],
  "--bui-bg": ["primitives", "bg"],
  "--bui-soft": ["primitives", "soft"],
  "--bui-card": ["primitives", "card"],
  "--bui-success": ["primitives", "success"],
  "--bui-orange": ["primitives", "orange"],
  "--bui-purple": ["primitives", "purple"],
  "--bui-warning": ["primitives", "warning"],
  "--bui-ease": ["motion", "ease"],
  "--bui-shadow-card": ["shadow", "card"],
  "--bui-shadow-lift": ["shadow", "lift"],
  "--bui-spring-ease": ["spring", "springEase"]
};

function parseObjectBlock(source, exportName) {
  const start = source.indexOf(`export const ${exportName} = {`);
  if (start < 0) throw new Error(`tokens.ts: ${exportName} block not found`);
  const end = source.indexOf("}", start);
  const block = source.slice(start, end);
  const entries = {};
  for (const match of block.matchAll(/(\w+):\s*"([^"]*)"/g)) entries[match[1]] = match[2];
  return entries;
}

/** Parse tokens.ts into { primitives, shadow, motion, spring } value maps. */
export function readBuiTokens(tokensSource) {
  return {
    primitives: parseObjectBlock(tokensSource, "buiPrimitives"),
    shadow: parseObjectBlock(tokensSource, "buiShadow"),
    motion: parseObjectBlock(tokensSource, "buiMotion"),
    spring: parseObjectBlock(tokensSource, "buiSpringPhysics")
  };
}

/** The value each --bui-* variable must carry, per tokens.ts. */
export function computeBuiCssVars(tokens) {
  const vars = {};
  for (const [name, [section, key]] of Object.entries(BUI_CSS_VAR_SOURCES)) {
    const value = tokens[section]?.[key];
    if (typeof value !== "string") throw new Error(`tokens.ts: no value for ${name} (${section}.${key})`);
    vars[name] = value.startsWith("#") ? value.toLowerCase() : value;
  }
  return vars;
}

/** Rewrite the --bui-* values in a globals.css source string. Returns the new source. */
export function applyBuiCssVars(cssSource, vars) {
  let out = cssSource;
  for (const [name, value] of Object.entries(vars)) {
    const pattern = new RegExp(`(${name}:\\s*)[^;]+;`);
    if (!pattern.test(out)) throw new Error(`globals.css: declaration ${name} not found`);
    out = out.replace(pattern, `$1${value};`);
  }
  return out;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const tokens = readBuiTokens(readFileSync(TREE + "components/boardui/tokens.ts", "utf8"));
  const vars = computeBuiCssVars(tokens);
  const cssPath = TREE + "app/globals.css";
  const css = readFileSync(cssPath, "utf8");
  const next = applyBuiCssVars(css, vars);
  if (process.argv.includes("--write")) {
    if (next !== css) {
      writeFileSync(cssPath, next);
      console.log("globals.css --bui-* values rewritten from tokens.ts");
    } else {
      console.log("globals.css already matches tokens.ts — no change");
    }
  } else if (next !== css) {
    console.error("DRIFT: app/globals.css --bui-* values differ from components/boardui/tokens.ts");
    console.error("Run: node scripts/generate-bui-css-vars.mjs --write");
    process.exit(1);
  } else {
    console.log("OK: globals.css --bui-* values match tokens.ts");
  }
}
