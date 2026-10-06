// Offline: on a fresh install the worker opens the settings page, where a "Start here" box shows until
// a key is saved; an update or a Chrome update opens nothing. Loads the real worker from a temp copy, as
// analytics_worker_test does; storage and network are stubbed.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const installed = [];
let opened = 0;
const event = { addListener: () => {} };
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: event },
  runtime: {
    onMessage: event, onStartup: event, onInstalled: { addListener: (fn) => installed.push(fn) },
    openOptionsPage: async () => { opened++; },
    getManifest: () => ({ version: "1.4.1" }), getURL: (p) => "chrome-extension://test/" + p,
  },
  alarms: { onAlarm: event, get: async () => undefined, clear: async () => {}, create: () => {} },
  notifications: { onClicked: event, create: () => {} },
  tabs: { create: () => {} },
};
globalThis.fetch = async () => { throw new Error("no network in this test"); };

const src = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "sieve-welcome-"));
for (const f of readdirSync(src)) if (f.endsWith(".js")) copyFileSync(join(src, f), join(dir, f));
writeFileSync(join(dir, "analytics-config.js"), 'export const MEASUREMENT_ID = "";\nexport const API_SECRET = "";\n');
try {
  await import(pathToFileURL(join(dir, "background.js")).href);
  const fire = async (details) => { for (const fn of installed) await fn(details); };

  await fire({ reason: "update", previousVersion: "1.4.0" });
  await fire({ reason: "chrome_update" });
  assert.equal(opened, 0, "an update opens nothing");
  await fire({ reason: "install" });
  assert.equal(opened, 1, "a fresh install opens the settings page once");

  // The settings page carries the Start here box, hidden until options.js finds no key.
  const html = readFileSync(join(src, "options.html"), "utf8");
  assert.match(html, /<section id="start" hidden/);
  assert.match(html, /https:\/\/openrouter\.ai\/keys/);
  const js = readFileSync(join(src, "options.js"), "utf8");
  assert.match(js, /\$\("start"\)\.hidden = /);
  console.log("welcome_test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
