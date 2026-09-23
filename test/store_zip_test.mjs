// Offline: tools/store-zip.mjs builds the store package from a commit, leaves out the tests, tools and
// README, and refuses a package that mentions a forbidden word (by name or by bytes), has a .gitattributes
// file, uses a manifest key store-zip doesn't check, or loads a file it doesn't have. Runs the real script
// against a throwaway git repo, then against this repo's own HEAD.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.ok(!existsSync(`${join(out, "sieve-9.9.9.zip")}.tmp`), "no .tmp file is left behind after a successful build");
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
    ["manifest.json", JSON.stringify({ ...goodManifestObj, action: { default_icon: "gone-di.png" } }), "gone-di.png"],
    ["popup.html", '<img src="gone-img.png">', "gone-img.png"],
    ["a.js", 'chrome.runtime.getURL("gone-page.html");\n', "gone-page.html"],
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

  // A script tag's src can carry a query string; the part after "?" is stripped before the file is
  // looked up, so a cache-busting suffix doesn't make a real, present file read as missing.
  write("popup.html", '<script src="popup.js?v=2"></script>');
  git("commit", "-qam", "query string on a script src");
  r = run("--repo", repo, "--out", join(tmp, "query-string"));
  assert.equal(r.status, 0, r.stderr);
  git("revert", "--no-edit", "HEAD");

  // chrome.runtime.getURL() takes a path from the package root, not one relative to the calling file:
  // a subfolder script naming a real root file builds cleanly instead of being refused as missing.
  mkdirSync(join(repo, "sub"), { recursive: true });
  write("sub/inner.js", 'chrome.runtime.getURL("popup.html");\n');
  git("add", "-A");
  git("commit", "-qm", "getURL from a subfolder resolves from the package root");
  r = run("--repo", repo, "--out", join(tmp, "geturl-root-relative"));
  assert.equal(r.status, 0, r.stderr);
  git("revert", "--no-edit", "HEAD");

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

  // "--out" followed immediately by another flag: "--force" looks like a value but starts with "--",
  // so it's refused as a missing value rather than silently taken as the output directory.
  r = run("--out", "--force");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--out needs a value/);

  // A .gitattributes file anywhere in the commit: git archive would apply it after the checks, so it's refused.
  write(".gitattributes", "* text=auto\n");
  git("add", "-A");
  git("commit", "-qm", "gitattributes");
  r = run("--repo", repo, "--out", join(tmp, "gitattributes"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\.gitattributes in the commit/);
  git("revert", "--no-edit", "HEAD");

  // A repo-local .git/info/attributes file is never committed, so the check above can't see it, but
  // git archive still applies it: store-zip refuses rather than build a package it changed underneath.
  writeFileSync(join(repo, ".git", "info", "attributes"), "a.js export-ignore\n");
  r = run("--repo", repo, "--out", join(tmp, "info-attributes"));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /info\/attributes exists/);
  assert.ok(!existsSync(join(tmp, "info-attributes", "sieve-9.9.9.zip")), "nothing is written when it refuses");
  rmSync(join(repo, ".git", "info", "attributes"));

  // A gitattributes file the repo's own config points at (the same thing a global core.attributesFile
  // would do) must not change what gets packaged: the archive call resets core.attributesFile to
  // /dev/null for its own run, so an export-ignore rule sitting in a file like this never reaches it.
  const configuredAttrs = join(tmp, "configured-attributes");
  writeFileSync(configuredAttrs, "a.js export-ignore\n");
  git("config", "core.attributesFile", configuredAttrs);
  r = run("--repo", repo, "--out", join(tmp, "configured-attributes-out"));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(unzipList(r.stdout.match(/store-zip: (\S+\.zip)/)[1]).includes("a.js"), "a configured attributesFile doesn't drop a.js from the package");
  git("config", "--unset", "core.attributesFile");

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

  // A non-ASCII filename: ls-tree is read with -z, so a name git would otherwise C-quote (as
  // "caf\303\251.js", wrapped in double quotes) instead comes back, and is packaged, as its raw UTF-8
  // bytes. Checked directly against the zip's bytes rather than through unzip, whose own filename
  // decoding varies by platform and locale.
  write("café.js", "// café\n");
  git("add", "-A");
  git("commit", "-qm", "non-ascii filename");
  r = run("--repo", repo, "--out", join(tmp, "non-ascii"));
  assert.equal(r.status, 0, r.stderr);
  const nonAsciiZip = readFileSync(r.stdout.match(/store-zip: (\S+\.zip)/)[1]);
  assert.ok(nonAsciiZip.includes(Buffer.from("café.js", "utf8")), "the filename is packaged as its raw UTF-8 bytes");
  assert.ok(!nonAsciiZip.includes(Buffer.from('"caf\\303\\251.js"')), "not left C-quoted, which -z avoids");
  git("revert", "--no-edit", "HEAD");

  // This repo's own HEAD makes a clean package.
  r = run("--out", join(tmp, "real"));
  assert.equal(r.status, 0, r.stderr);
  const real = unzipList(r.stdout.match(/store-zip: (\S+\.zip)/)[1]);
  assert.ok(real.includes("manifest.json") && real.includes("background.js") && real.includes("watch-drawer.js"));
  assert.ok(!real.some((f) => f.startsWith("test/") || f.startsWith("tools/") || f === "README.md" || f === ".gitignore"));

  // Tripwire over the whole public repo, not just the store package: the platform name must never sit
  // committed anywhere in this tree, in code, docs or anything else. tools/store-zip.mjs and this test
  // are the only two files that get to name it, since the checks above need it as literal text. git grep
  // exits 1 for "no match", which here means the tree is clean; 0 means it found the word and names the
  // files; anything else is a git grep failure worth surfacing rather than swallowing as a pass.
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const tripwire = spawnSync(
    "git",
    ["grep", "-ilE", "instagram|fbcdn", "HEAD", "--", ".", ":!tools/store-zip.mjs", ":!test/store_zip_test.mjs"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.notEqual(tripwire.status, 0, `forbidden word committed outside the store package:\n${tripwire.stdout}`);
  assert.equal(tripwire.status, 1, `git grep did not run cleanly (status ${tripwire.status}): ${tripwire.stderr}`);

  console.log("store zip: all checks passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
