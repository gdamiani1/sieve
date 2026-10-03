#!/usr/bin/env node
// Builds the Chrome Web Store package from committed files, never from the working folder.
//   node tools/store-zip.mjs              -> ~/Downloads/sieve-store/sieve-<version>.zip, from HEAD
//   node tools/store-zip.mjs --ref main --out /tmp/x [--repo <extension repo>] [--force]
//   node tools/store-zip.mjs --no-analytics   -> package with usage stats off (empty analytics-config.js)
// The package is every file in the commit except test/, tools/, README.md and .gitignore. Before writing
// anything it checks the package, and refuses, naming the problem, when a packaged file's name or its raw
// bytes mention a word that must never reach the store build, when the commit has a .gitattributes file
// anywhere, when a repo-local .git/info/attributes file exists (a global or system attributes file is
// ignored instead), when manifest.json uses a key store-zip doesn't check yet, or when manifest.json, an
// HTML page or a script loads a file the package doesn't have.
//
// Usage stats: when the commit has analytics-config.js (empty in git on purpose), the package gets the
// real Measurement ID and API secret from analytics-config.local.js beside the repo's files (ignored by
// git, written by the owner). Without that file it refuses, unless --no-analytics says to ship the empty
// one. The local file must be a regular file (not a symlink) holding exactly the two exports and
// comments, and passes the same word check. The package gets a rebuilt copy of those two lines.
// Errors never print the file's contents.
//
// The word check is a tripwire against committing the owner's personal copy by mistake, not a guarantee:
// it reads raw bytes and paths, so a word that's encoded (say, as UTF-16), spelled with an escaped
// character, or split across concatenated strings won't be caught.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = /instagram|fbcdn/i;
const LEFT_OUT = ["test/", "tools/", "README.md", ".gitignore"];
const UNCHECKED_KEYS = [
  "web_accessible_resources",
  "default_locale",
  "declarative_net_request",
  "side_panel",
  "devtools_page",
  "chrome_url_overrides",
  "sandbox",
  "options_page",
];
const KNOWN_FLAGS = new Set(["--repo", "--ref", "--out", "--force", "--no-analytics"]);
const USAGE = "usage: store-zip.mjs [--repo <path>] [--ref <ref>] [--out <dir>] [--force] [--no-analytics]";

const fail = (msg) => { console.error(`store-zip: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!KNOWN_FLAGS.has(a)) fail(`unknown flag ${a}\n${USAGE}`);
  if (a === "--force") { flags.force = true; continue; }
  if (a === "--no-analytics") { flags.noAnalytics = true; continue; }
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${a} needs a value\n${USAGE}`);
  flags[a.slice(2)] = v;
  i += 1;
}

const repo = resolve(flags.repo ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const refArg = flags.ref ?? "HEAD";
const outDir = resolve(flags.out ?? join(homedir(), "Downloads", "sieve-store"));
const force = !!flags.force;

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 64 * 1024 * 1024 });
const paths = (v) => (typeof v === "string" ? [v] : Object.values(v || {}));

let sha;
try { sha = git("rev-parse", "--verify", "--end-of-options", `${refArg}^{commit}`).toString().trim(); }
catch { fail(`can't resolve ${refArg} in ${repo}`); }

let rawFiles;
try {
  rawFiles = git("ls-tree", "-r", "-z", "--name-only", sha).toString("utf8").split("\0").filter(Boolean);
} catch { fail(`can't read ${sha} in ${repo}`); }

if (rawFiles.some((f) => f === ".gitattributes" || f.endsWith("/.gitattributes")))
  fail(".gitattributes in the commit: store-zip doesn't support it, because git archive would apply it after the checks");

// A repo-local info/attributes file is never committed, so the check above can't see it, but git
// archive still applies it. store-zip refuses rather than silently build a package an attribute rule
// changed underneath it.
const infoAttributes = git("rev-parse", "--path-format=absolute", "--git-path", "info/attributes").toString().trim();
if (existsSync(infoAttributes))
  fail(`${infoAttributes} exists: store-zip doesn't support attribute rules from outside the commit`);

const files = rawFiles.filter((f) => !LEFT_OUT.some((x) => (x.endsWith("/") ? f.startsWith(x) : f === x)));
const has = new Set(files);
const read = (f) => git("show", `${sha}:${f}`);

const problems = [];
for (const f of files) {
  const hit = f.match(FORBIDDEN) || read(f).toString("latin1").match(FORBIDDEN);
  if (hit) problems.push(`${f} mentions ${hit[0]}`);
}

let manifest;
try { manifest = JSON.parse(read("manifest.json").toString("utf8")); } catch { fail("manifest.json is missing or isn't valid JSON"); }

for (const key of UNCHECKED_KEYS) if (manifest[key] !== undefined) problems.push(`manifest.json uses ${key}, which store-zip doesn't check yet`);

const need = (from, file) => { if (file && !has.has(posix.normalize(file))) problems.push(`${from} loads ${file}, which isn't in the package`); };
for (const cs of manifest.content_scripts || []) for (const f of [...(cs.js || []), ...(cs.css || [])]) need("manifest.json", f);
need("manifest.json", manifest.background?.service_worker);
need("manifest.json", manifest.action?.default_popup);
need("manifest.json", manifest.options_ui?.page);
for (const f of paths(manifest.icons)) need("manifest.json", f);
for (const f of paths(manifest.action?.default_icon)) need("manifest.json", f);
for (const f of files) {
  if (!f.endsWith(".html") && !f.endsWith(".js")) continue;
  const text = read(f).toString("utf8");
  const refs = f.endsWith(".html")
    ? [...text.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    : [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  for (const r of refs) {
    if (/^[a-z]+:|^\/\//i.test(r)) continue;
    const clean = r.replace(/[?#].*$/, "");
    need(f, posix.join(posix.dirname(f), clean));
  }
  if (f.endsWith(".js")) {
    // chrome.runtime.getURL() takes an extension-root-relative path, not one relative to the calling file.
    for (const m of text.matchAll(/getURL\(\s*["']([^"']+)["']\s*\)/g)) {
      const clean = m[1].replace(/[?#].*$/, "");
      need(f, posix.normalize(clean));
    }
  }
}
if (problems.length) fail(`refusing to build:\n  ${problems.join("\n  ")}`);

let statsConfig = null;
if (has.has("analytics-config.js") && !flags.noAnalytics) {
  const local = join(repo, "analytics-config.local.js");
  let st = null;
  try { st = lstatSync(local); } catch {}
  if (!st) fail("analytics-config.local.js is missing: write it (README, Usage stats) or pass --no-analytics to package with usage stats off");
  if (st.isSymbolicLink()) fail("analytics-config.local.js is a symlink: store-zip only reads a regular file");
  if (!st.isFile()) fail("analytics-config.local.js isn't a regular file");
  let text;
  try { text = readFileSync(local, "utf8"); } catch { fail("can't read analytics-config.local.js"); }
  const code = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const ok = code.length === 2
    && /^export const MEASUREMENT_ID = "G-[A-Z0-9]{4,20}";$/.test(code[0])
    && /^export const API_SECRET = "[A-Za-z0-9_-]{6,64}";$/.test(code[1]);
  if (!ok) fail('analytics-config.local.js must hold only `export const MEASUREMENT_ID = "G-...";` and `export const API_SECRET = "...";` (comments allowed)');
  if (FORBIDDEN.test(text)) fail("analytics-config.local.js mentions a word that must never reach the store build");
  statsConfig = `${code.join("\n")}\n`;
}

const version = String(manifest.version ?? "");
if (!/^\d+(\.\d+){0,3}$/.test(version)) fail(`manifest.json has no usable version (${version || "none"})`);
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `sieve-${version}.zip`);
if (existsSync(zip) && !force) fail(`${zip} already exists; pass --force to replace it`);
const zipTmp = `${zip}.tmp`;
try {
  // core.attributesFile=/dev/null and GIT_ATTR_NOSYSTEM=1 keep a gitattributes file outside the
  // commit -- the user's global one, or the system one -- from changing what archive packages; the
  // repo-local info/attributes is refused outright above, since neither setting reaches it.
  execFileSync("git", ["-C", repo, "-c", "core.attributesFile=/dev/null", "--literal-pathspecs", "archive", "--format=zip", "-o", zipTmp, sha, "--", ...files], {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_ATTR_NOSYSTEM: "1" },
  });
} catch {
  try { rmSync(zipTmp, { force: true }); } catch {}
  fail("git archive failed");
}
if (statsConfig !== null) {
  // Adding a file with the same name replaces the archive's empty analytics-config.js entry.
  const over = mkdtempSync(join(tmpdir(), "sieve-stats-"));
  try {
    writeFileSync(join(over, "analytics-config.js"), statsConfig);
    execFileSync("/usr/bin/zip", ["-q", zipTmp, "analytics-config.js"], { cwd: over });
  } catch {
    try { rmSync(zipTmp, { force: true }); } catch {}
    fail("couldn't put analytics-config.local.js into the package");
  } finally {
    rmSync(over, { recursive: true, force: true });
  }
}
renameSync(zipTmp, zip);
const statsNote = has.has("analytics-config.js") ? `, usage stats ${statsConfig !== null ? "on" : "off"}` : "";
console.log(`store-zip: ${zip} (${files.length} files from ${git("rev-parse", "--short", sha).toString().trim()}${statsNote})`);
