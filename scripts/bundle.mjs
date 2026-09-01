#!/usr/bin/env node
/**
 * Build a single-file CLI at dist/ok.js (source + npm deps, no runtime node_modules).
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "dist");
const outfile = path.join(outdir, "ok.js");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile,
  define: {
    __OK_VERSION__: JSON.stringify(pkg.version),
  },
  // Node built-ins only — @comark/ansi and rangi are inlined.
  packages: "bundle",
  logLevel: "info",
});

let code = fs.readFileSync(outfile, "utf8");
code = code.replace(/^(#!.*\n)+/, "");
fs.writeFileSync(outfile, "#!/usr/bin/env node\n" + code);
fs.chmodSync(outfile, 0o755);

const size = fs.statSync(outfile).size;
console.log(`built ${path.relative(root, outfile)} (${(size / 1024).toFixed(1)}kb)`);
