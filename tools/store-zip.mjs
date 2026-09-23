#!/usr/bin/env node
// Builds the Chrome Web Store package from committed files, never from the working folder.
//   node tools/store-zip.mjs              -> ~/Downloads/sieve-store/sieve-<version>.zip, from HEAD
//   node tools/store-zip.mjs --ref main --out /tmp/x [--repo <extension repo>] [--force]
// The package is every file in the commit except test/, tools/, README.md and .gitignore. Before writing
// anything it checks the package, and refuses, naming the problem, when a file mentions a word that must
// never reach the store build, or when manifest.json, an HTML page or a script loads a file the package
// doesn't have.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = /instagram|fbcdn/i;
const LEFT_OUT = ["test/", "tools/", "README.md", ".gitignore"];

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const repo = resolve(opt("--repo", join(dirname(fileURLToPath(import.meta.url)), "..")));
const ref = opt("--ref", "HEAD");
const outDir = resolve(opt("--out", join(homedir(), "Downloads", "sieve-store")));
const force = args.includes("--force");

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 64 * 1024 * 1024 });
const fail = (msg) => { console.error(`store-zip: ${msg}`); process.exit(1); };

let files;
try {
  files = git("ls-tree", "-r", "--name-only", ref).toString().split("\n").filter(Boolean)
    .filter((f) => !LEFT_OUT.some((x) => (x.endsWith("/") ? f.startsWith(x) : f === x)));
} catch { fail(`can't read ${ref} in ${repo}`); }
const has = new Set(files);
const read = (f) => git("show", `${ref}:${f}`);

const problems = [];
for (const f of files) {
  const hit = read(f).toString("latin1").match(FORBIDDEN);
  if (hit) problems.push(`${f} mentions ${hit[0]}`);
}

let manifest;
try { manifest = JSON.parse(read("manifest.json").toString("utf8")); } catch { fail("manifest.json is missing or isn't valid JSON"); }
const need = (from, file) => { if (file && !has.has(posix.normalize(file))) problems.push(`${from} loads ${file}, which isn't in the package`); };
for (const cs of manifest.content_scripts || []) for (const f of [...(cs.js || []), ...(cs.css || [])]) need("manifest.json", f);
need("manifest.json", manifest.background?.service_worker);
need("manifest.json", manifest.action?.default_popup);
need("manifest.json", manifest.options_ui?.page);
for (const f of Object.values(manifest.icons || {})) need("manifest.json", f);
for (const f of Object.values(manifest.action?.default_icon || {})) need("manifest.json", f);
for (const f of files) {
  if (!f.endsWith(".html") && !f.endsWith(".js")) continue;
  const text = read(f).toString("utf8");
  const refs = f.endsWith(".html")
    ? [...text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    : [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  for (const r of refs) if (!/^[a-z]+:|^\/\//i.test(r)) need(f, posix.join(posix.dirname(f), r));
}
if (problems.length) fail(`refusing to build:\n  ${problems.join("\n  ")}`);

const version = String(manifest.version ?? "");
if (!/^\d+(\.\d+){0,3}$/.test(version)) fail(`manifest.json has no usable version (${version || "none"})`);
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `sieve-${version}.zip`);
if (existsSync(zip) && !force) fail(`${zip} already exists; pass --force to replace it`);
git("archive", "--format=zip", "-o", zip, ref, "--", ...files);
console.log(`store-zip: ${zip} (${files.length} files from ${git("rev-parse", "--short", ref).toString().trim()})`);
