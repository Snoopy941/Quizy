// Copy packages that Next's standalone tracing can miss (loaded dynamically
// at runtime, e.g. tesseract.js's worker + WebAssembly core) together with
// their full dependency trees into the standalone server's node_modules.
//   node scripts/copy-runtime-deps.js <standalone-dir> tesseract.js [...]
"use strict";
const fs = require("fs");
const path = require("path");

const [, , outDir, ...roots] = process.argv;
if (!outDir || !roots.length) {
  console.error("usage: copy-runtime-deps.js <standalone-dir> <pkg> [pkg...]");
  process.exit(1);
}
const ROOT = path.resolve(__dirname, "..");
const seen = new Set();

function pkgDir(name, from) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function copy(name, from) {
  const dir = pkgDir(name, from);
  if (!dir || seen.has(dir)) return;
  seen.add(dir);
  const rel = path.relative(ROOT, dir);
  const dest = path.join(outDir, rel);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(dir, dest, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const dep of Object.keys({ ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) })) {
    copy(dep, dir);
  }
}

for (const r of roots) {
  if (!pkgDir(r, ROOT)) {
    console.error(`missing package ${r} — run npm install first`);
    process.exit(1);
  }
  copy(r, ROOT);
}
console.log(`==> copied ${seen.size} runtime package(s) into ${outDir}`);
