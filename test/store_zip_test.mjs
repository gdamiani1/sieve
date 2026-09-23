// Offline: tools/store-zip.mjs builds the store package from a commit, leaves out the tests, tools and
// README, and refuses a package that mentions a forbidden word or loads a file it doesn't have. Runs the
// real script against a throwaway git repo, then against this repo's own HEAD.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../tools/store-zip.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const unzipList = (zip) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean).sort();

const tmp = mkdtempSync(join(tmpdir(), "sieve-store-zip-"));
const repo = join(tmp, "repo");
const out = join(tmp, "out");
mkdirSync(join(repo, "test"), { recursive: true });
mkdirSync(join(repo, "icons"));
const write = (f, s) => writeFileSync(join(repo, f), s);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "t@example.com");
git("config", "user.name", "t");
const goodManifest = JSON.stringify({ manifest_version: 3, name: "T", version: "9.9.9", background: { service_worker: "background.js", type: "module" }, action: { default_popup: "popup.html" }, icons: { 16: "icons/i.png" }, content_scripts: [{ matches: ["https://example.com/*"], js: ["page.js"], css: ["page.css"] }] });
write("manifest.json", goodManifest);
write("background.js", 'import { a } from "./a.js";\n');
write("a.js", "export const a = 1;\n");
write("popup.html", '<script src="popup.js"></script>');
write("popup.js", "");
write("page.js", "");
write("page.css", "");
write("icons/i.png", "png");
write("README.md", "readme");
write(".gitignore", "x");
write("test/t_test.mjs", "// a test");
git("add", "-A");
git("commit", "-qm", "one");

// A clean commit: the zip holds the package and nothing else.
let r = run("--repo", repo, "--out", out);
assert.equal(r.status, 0, r.stderr);
assert.deepEqual(unzipList(join(out, "sieve-9.9.9.zip")), ["a.js", "background.js", "icons/i.png", "manifest.json", "page.css", "page.js", "popup.html", "popup.js"]);
// It won't replace a zip without --force.
r = run("--repo", repo, "--out", out);
assert.notEqual(r.status, 0);
assert.match(r.stderr, /already exists/);
assert.equal(run("--repo", repo, "--out", out, "--force").status, 0);

// Only committed files count: an uncommitted mention changes nothing.
write("page.js", "// instagram");
assert.equal(run("--repo", repo, "--out", out, "--force").status, 0, "the working folder is never packaged");
// Committed, it is refused, the refusal names the file, and nothing is written.
git("commit", "-qam", "two");
r = run("--repo", repo, "--out", join(tmp, "out2"));
assert.notEqual(r.status, 0);
assert.match(r.stderr, /page\.js mentions instagram/i);
assert.ok(!existsSync(join(tmp, "out2", "sieve-9.9.9.zip")), "nothing is written when it refuses");
write("page.js", "// FBCDN");
git("commit", "-qam", "three");
assert.match(run("--repo", repo, "--out", join(tmp, "out3")).stderr, /page\.js mentions FBCDN/);
write("page.js", "");
git("commit", "-qam", "four");
assert.equal(run("--repo", repo, "--out", join(tmp, "out4")).status, 0, "clean again");

// A file the package loads but doesn't have: named by the manifest, an HTML page, or an import.
for (const [file, content, missing] of [
  ["manifest.json", JSON.stringify({ manifest_version: 3, name: "T", version: "9.9.9", content_scripts: [{ matches: ["https://example.com/*"], js: ["gone.js"] }] }), "gone.js"],
  ["popup.html", '<script src="gone2.js"></script>', "gone2.js"],
  ["a.js", 'import { b } from "./gone3.js";\n', "gone3.js"],
]) {
  write(file, content);
  git("commit", "-qam", `missing ${missing}`);
  r = run("--repo", repo, "--out", join(tmp, `m-${missing}`));
  assert.notEqual(r.status, 0, `refused: ${missing}`);
  assert.match(r.stderr, new RegExp(`loads ${missing.replace(".", "\\.")}, which isn't in the package`));
  git("revert", "--no-edit", "HEAD");
}

// This repo's own HEAD makes a clean package.
r = run("--out", join(tmp, "real"));
assert.equal(r.status, 0, r.stderr);
const real = unzipList(r.stdout.match(/store-zip: (\S+\.zip)/)[1]);
assert.ok(real.includes("manifest.json") && real.includes("background.js") && real.includes("watch-drawer.js"));
assert.ok(!real.some((f) => f.startsWith("test/") || f.startsWith("tools/") || f === "README.md" || f === ".gitignore"));

rmSync(tmp, { recursive: true, force: true });
console.log("store zip: all checks passed");
