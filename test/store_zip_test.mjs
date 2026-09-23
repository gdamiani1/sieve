// Offline: tools/store-zip.mjs builds the store package from a commit, leaves out the tests, tools and
// README, and refuses a package that mentions a forbidden word (by name or by bytes), has a .gitattributes
// file, uses a manifest key store-zip doesn't check, or loads a file it doesn't have. Runs the real script
// against a throwaway git repo, then against this repo's own HEAD.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../tools/store-zip.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
// git archive writes directory entries, which the package doesn't need to list.
const unzipList = (zip) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter((f) => f && !f.endsWith("/")).sort();

const tmp = mkdtempSync(join(tmpdir(), "sieve-store-zip-"));
try {
  const repo = join(tmp, "repo");
  const out = join(tmp, "out");
  mkdirSync(join(repo, "test"), { recursive: true });
  mkdirSync(join(repo, "icons"));
  mkdirSync(join(repo, "sub"));
  const write = (f, s) => writeFileSync(join(repo, f), s);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");

  const goodManifestObj = {
    manifest_version: 3,
    name: "T",
    version: "9.9.9",
    background: { service_worker: "background.js", type: "module" },
    action: { default_popup: "popup.html" },
    icons: { 16: "icons/i.png" },
    content_scripts: [{ matches: ["https://example.com/*"], js: ["page.js"], css: ["page.css"] }],
  };
  const goodManifest = JSON.stringify(goodManifestObj);
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

  const baseList = ["a.js", "background.js", "icons/i.png", "manifest.json", "page.css", "page.js", "popup.html", "popup.js"];

  // A clean commit: the zip holds the package and nothing else.
  let r = run("--repo", repo, "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(unzipList(join(out, "sieve-9.9.9.zip")), baseList);
  // It won't replace a zip without --force.
  r = run("--repo", repo, "--out", out);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  assert.equal(run("--repo", repo, "--out", out, "--force").status, 0);

  // Only committed files count: an uncommitted mention changes nothing, and the zip really does hold the
  // committed (empty) page.js, not the edited working-folder copy.
  write("page.js", "// instagram");
  r = run("--repo", repo, "--out", out, "--force");
  assert.equal(r.status, 0, "the working folder is never packaged");
  assert.equal(
    execFileSync("unzip", ["-p", join(out, "sieve-9.9.9.zip"), "page.js"], { encoding: "utf8" }),
    "",
    "the zip's page.js is still the committed (empty) content",
  );
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

  // A file the package loads but doesn't have: named by the manifest (every field it checks), an HTML
  // page, a static import, a side-effect import, a dynamic import, or a "../" import from a subfolder.
  const missingFileCases = [
    ["manifest.json", JSON.stringify({ ...goodManifestObj, content_scripts: [{ matches: ["https://example.com/*"], js: ["gone.js"] }] }), "gone.js"],
    ["popup.html", '<script src="gone2.js"></script>', "gone2.js"],
    ["a.js", 'import { b } from "./gone3.js";\n', "gone3.js"],
    ["a.js", 'import "./gone4.js";\n', "gone4.js"],
    ["a.js", 'import("./gone5.js");\n', "gone5.js"],
    ["sub/inner.js", 'import "../gone6.js";\n', "gone6.js"],
    ["manifest.json", JSON.stringify({ ...goodManifestObj, background: { service_worker: "gone-sw.js" } }), "gone-sw.js"],
    ["manifest.json", JSON.stringify({ ...goodManifestObj, content_scripts: [{ matches: ["https://example.com/*"], js: ["page.js"], css: ["gone-css.css"] }] }), "gone-css.css"],
    ["manifest.json", JSON.stringify({ ...goodManifestObj, icons: { 16: "gone-icon.png" } }), "gone-icon.png"],
    ["manifest.json", JSON.stringify({ ...goodManifestObj, action: { default_popup: "gone-popup.html" } }), "gone-popup.html"],
    ["manifest.json", JSON.stringify({ ...goodManifestObj, options_ui: { page: "gone-options.html" } }), "gone-options.html"],
  ];
  for (const [file, content, missing] of missingFileCases) {
    write(file, content);
    git("add", "-A");
    git("commit", "-qm", `missing ${missing}`);
    r = run("--repo", repo, "--out", join(tmp, `m-${missing}`));
    assert.notEqual(r.status, 0, `refused: ${missing}`);
    assert.match(r.stderr, new RegExp(`loads ${missing.replace(".", "\\.")}, which isn't in the package`));
    git("revert", "--no-edit", "HEAD");
  }

  // A manifest key store-zip doesn't check yet is refused rather than passed silently.
  write("manifest.json", JSON.stringify({ ...goodManifestObj, sandbox: { pages: ["sandboxed.html"] } }));
  git("commit", "-qam", "unchecked manifest key");
  r = run("--repo", repo, "--out", join(tmp, "unchecked-key"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /manifest\.json uses sandbox, which store-zip doesn't check yet/);
  git("revert", "--no-edit", "HEAD");

  // Invalid manifest JSON.
  write("manifest.json", "{ not json");
  git("commit", "-qam", "invalid json");
  r = run("--repo", repo, "--out", join(tmp, "bad-json"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /manifest\.json is missing or isn't valid JSON/);
  git("revert", "--no-edit", "HEAD");

  // A manifest with no version.
  const noVersion = { ...goodManifestObj };
  delete noVersion.version;
  write("manifest.json", JSON.stringify(noVersion));
  git("commit", "-qam", "no version");
  r = run("--repo", repo, "--out", join(tmp, "no-version"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no usable version/);
  git("revert", "--no-edit", "HEAD");

  // A ref that doesn't exist.
  r = run("--repo", repo, "--out", join(tmp, "bad-ref"), "--ref", "nope");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /can't resolve nope/);

  // An unknown flag.
  r = run("--repo", repo, "--out", join(tmp, "bad-flag"), "--reff", "x");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag --reff/);

  // A .gitattributes file anywhere in the commit: git archive would apply it after the checks, so it's refused.
  write(".gitattributes", "* text=auto\n");
  git("add", "-A");
  git("commit", "-qm", "gitattributes");
  r = run("--repo", repo, "--out", join(tmp, "gitattributes"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\.gitattributes in the commit/);
  git("revert", "--no-edit", "HEAD");

  // A filename that mentions the forbidden word, even with harmless bytes.
  write("icons/instagram.png", "png");
  git("add", "-A");
  git("commit", "-qm", "forbidden filename");
  r = run("--repo", repo, "--out", join(tmp, "forbidden-name"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /icons\/instagram\.png mentions instagram/i);
  git("revert", "--no-edit", "HEAD");

  // A filename with a glob character: it must be packaged as itself, and --literal-pathspecs must stop it
  // from acting as a wildcard that pulls in files that are supposed to be left out.
  mkdirSync(join(repo, "tools"), { recursive: true });
  write("tools/secret.js", "should never be packaged");
  write("t*", "literal star file");
  git("add", "-A");
  git("commit", "-qm", "glob filename");
  r = run("--repo", repo, "--out", join(tmp, "glob"));
  assert.equal(r.status, 0, r.stderr);
  const globZip = r.stdout.match(/store-zip: (\S+\.zip)/)[1];
  const globList = unzipList(globZip);
  assert.ok(globList.includes("t*"), "the literal filename is packaged");
  assert.ok(!globList.some((f) => f.startsWith("tools/") || f.startsWith("test/")), "a glob character in a filename can't pull in left-out files");
  git("revert", "--no-edit", "HEAD");

  // This repo's own HEAD makes a clean package.
  r = run("--out", join(tmp, "real"));
  assert.equal(r.status, 0, r.stderr);
  const real = unzipList(r.stdout.match(/store-zip: (\S+\.zip)/)[1]);
  assert.ok(real.includes("manifest.json") && real.includes("background.js") && real.includes("watch-drawer.js"));
  assert.ok(!real.some((f) => f.startsWith("test/") || f.startsWith("tools/") || f === "README.md" || f === ".gitignore"));

  console.log("store zip: all checks passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
