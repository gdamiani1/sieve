// Offline: the real worker counts what the user did, only after a yes, and answers the popup's and
// settings' "stats" messages. Copies the extension's scripts into a temp folder beside a config with
// made-up IDs; storage and network are stubbed.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JEV_OPENROUTER } from "../jev.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const store = { orKey: "stub", saved: [{ key: "d1", platform: "linkedin", authorName: "Jane", text: "Golden sets caught 3 regressions.", savedAt: Date.now() }] };
let listener;
const event = { addListener: () => {} };
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => Object.hasOwn(store, k)).map((k) => [k, store[k]]))),
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    remove: async (keys) => { for (const k of [keys].flat()) delete store[k]; },
  }, onChanged: event },
  runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, onInstalled: event, onStartup: event, getManifest: () => ({ version: "1.4.1" }), getURL: (p) => "chrome-extension://test/" + p },
  alarms: { onAlarm: event, get: async () => undefined, clear: async () => {}, create: () => {} },
  notifications: { onClicked: event, create: () => {} },
  tabs: { create: () => {} },
};
// Every fetch is OpenRouter here; a GA request would be a bug in this test (nothing is due today).
// A post gets a brief answer; the digest request gets a digest.
const gaCalls = [];
let jevStatus = 200; // a test sets 500 to make Jev fail, so the chat scorer answers
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body });
globalThis.fetch = async (url, init) => {
  if (String(url).includes("google-analytics")) { gaCalls.push(url); return new Response(null, { status: 204 }); }
  if (String(url) === JEV_OPENROUTER) {
    return reply(jevStatus, jevStatus === 200 ? { answers: { worth: { noul: 0.9 }, topic: { choice: "t0" }, kind: { choice: "technique" } }, usage: { cost: 0.00004 } } : { error: { message: "down" } });
  }
  const body = JSON.parse(init.body);
  const user = body.messages.at(-1).content;
  // Scoring is the only request the worker sends at temperature 0 (briefs 0.2 or 0.5, digests 0.3).
  const content = body.temperature === 0 ? '{"worth":0.2,"topic":"other","kind":"news","angle":"none"}'
    : user.includes("Golden sets") ? "## What people built or tested\n- Ran golden sets on every prompt change [Jane]"
    : JSON.stringify({ technique: true, what: "a technique", try: ["Try it"], skill: { worth: false, why: "" }, warning: "" });
  return reply(200, { choices: [{ message: { content }, finish_reason: "stop" }], usage: { cost: 0 } });
};

const src = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "sieve-worker-stats-"));
for (const f of readdirSync(src)) if (f.endsWith(".js")) copyFileSync(join(src, f), join(dir, f));
writeFileSync(join(dir, "analytics-config.js"), 'export const MEASUREMENT_ID = "G-TEST123";\nexport const API_SECRET = "secret-test";\n');
await import(pathToFileURL(join(dir, "background.js")).href);

const ask = (msg, sender = { url: "chrome-extension://test/popup.html" }) => new Promise((resolve) => { listener(msg, sender, resolve); });
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return (store.statsDays || {})[`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`] || {}; };
const post = (platform, key) => ({ platform, key, text: `A post about a technique ${key}`, authorName: "Someone" });

try {
  // The cases run in order and share state (storage, the saved posts and today's counts).
  // Not asked yet: the popup sees the question; actions count nothing.
  assert.deepEqual(await ask({ type: "stats", action: "status" }), { available: true, consent: null, installCode: "" });
  await ask({ type: "brief", post: post("x", "k1") });
  await ask({ type: "count", name: "prompt_copied", where: "brief" });
  assert.equal(store.statsDays, undefined);

  // A page on a feed (a content script) can't answer for the user.
  const refused = await ask({ type: "stats", action: "consent", on: true }, { tab: { id: 1 }, url: "https://www.linkedin.com/feed/" });
  assert.equal(refused.error, "Usage stats can only be changed from Sieve's popup or settings.");
  assert.equal(store.statsConsent, undefined);

  // Yes from the popup.
  const st = await ask({ type: "stats", action: "consent", on: true });
  assert.equal(st.consent, true);
  assert.match(st.installCode, /^[0-9A-F]{6}$/);

  await ask({ type: "brief", post: post("x", "k2") });
  await ask({ type: "save", post: { ...post("reddit", "k3"), worth: 1 } });
  await ask({ type: "count", name: "prompt_copied", where: "brief" });
  await ask({ type: "count", name: "prompt_copied", where: "digest" });
  await ask({ type: "count", name: "library_exported" });
  await ask({ type: "count", name: "brief_made" }); // pages can't count worker events
  await ask({ type: "count", name: "posts_scored" });
  const c = today();
  assert.equal(c["brief_made|x"], 1);
  assert.equal(c["post_saved|reddit"], 1);
  assert.equal(c["post_saved|x"], 1, "a brief saves its post too");
  assert.equal(c["prompt_copied|brief"], 1);
  assert.equal(c["prompt_copied|digest"], 1);
  assert.equal(c["library_exported"], 1);
  assert.equal(c["brief_made|other"], undefined);
  assert.equal(Object.keys(c).some((k) => k.startsWith("posts_scored")), false);

  // A brief that fails counts nothing.
  const before = c["brief_made|x"];
  await ask({ type: "brief", post: { platform: "x", key: "k4" } }); // no text: an error
  assert.equal(today()["brief_made|x"], before);

  // A brief shown again from the cache counts nothing.
  await ask({ type: "brief", post: post("x", "k2") });
  assert.equal(today()["brief_made|x"], 1);

  // A watched video shown again from the cache counts nothing.
  store.watched = { Abc_1234567: { id: "Abc_1234567", platform: "youtube", title: "A video", at: Date.now() } };
  await ask({ type: "watch", platform: "youtube", id: "Abc_1234567" });
  assert.equal(Object.keys(today()).some((k) => k.startsWith("video_watched")), false);

  // Scoring counts a verdict by who answered; a missing key is an error and counts nothing.
  const scored = { type: "classify", platform: "linkedin", state: { author: "Dana", post: "We ran golden sets." } };
  assert.ok(!(await ask(scored)).error);
  assert.equal(today()["posts_scored|linkedin|jev"], 1);
  jevStatus = 500;
  assert.equal((await ask(scored)).scorer, "openrouter");
  jevStatus = 200;
  assert.equal(today()["posts_scored|linkedin|fallback"], 1);
  assert.equal(today()["posts_scored|linkedin|jev"], 1);
  const orKey = store.orKey;
  delete store.orKey; delete store.apiKey;
  assert.deepEqual(await ask(scored), { error: "no_key" });
  store.orKey = orKey;
  assert.equal(today()["posts_scored|linkedin|jev"], 1);
  assert.equal(today()["posts_scored|linkedin|fallback"], 1);

  // A digest counts once.
  await ask({ type: "digest", since: 0 });
  assert.equal(today()["digest_made"], 1);

  // No: everything gone.
  const off = await ask({ type: "stats", action: "consent", on: false });
  assert.deepEqual(off, { available: true, consent: false, installCode: "" });
  assert.equal(store.statsDays, undefined);
  assert.equal(gaCalls.length, 0, "nothing sent on the day itself");
  console.log("analytics_worker_test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
