/**
 * Re-render the ABX3 material-discovery brief into src/data/material-discovery-body.html.
 *
 * The brief lives in the material_discovery repo as a static Next.js page
 * (sites/research_manager_brief). It has no client hooks, so the React tree is
 * pre-rendered to HTML here and inlined by src/pages/material-discovery.astro.
 *
 * Usage:  MD_BRIEF_SRC=/path/to/sites/research_manager_brief node scripts/render-material-discovery.mjs
 */
import { createRequire } from "module";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC =
  process.env.MD_BRIEF_SRC ||
  path.resolve(HERE, "../../../Documents/material_discovery/sites/research_manager_brief");

if (!existsSync(path.join(SRC, "app/page.tsx"))) {
  console.error(`Brief source not found at ${SRC}\nSet MD_BRIEF_SRC to the research_manager_brief directory.`);
  process.exit(1);
}

const require_ = createRequire(path.join(SRC, "node_modules/wrangler/index.js"));
const esbuild = require_("esbuild");

const entry = path.join(SRC, ".render_entry.jsx");
const out = path.join(SRC, ".render_out.cjs");
writeFileSync(
  entry,
  'import React from "react";\n' +
    'import { renderToStaticMarkup } from "react-dom/server";\n' +
    'import Page from "./app/page";\n' +
    "export const html = renderToStaticMarkup(React.createElement(Page));\n"
);

try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    outfile: out,
    loader: { ".css": "empty" },
    absWorkingDir: SRC,
    logLevel: "error",
    conditions: ["node", "require", "default"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { html } = createRequire(out)(out);
  const target = path.join(HERE, "../src/data/material-discovery-body.html");
  writeFileSync(target, html);
  console.log(`rendered ${html.length} bytes -> ${path.relative(path.join(HERE, ".."), target)}`);
} finally {
  for (const f of [entry, out]) if (existsSync(f)) unlinkSync(f);
}
