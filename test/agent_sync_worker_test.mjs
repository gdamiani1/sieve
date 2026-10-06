// Offline: the real worker signs in to Sieve's server, sends the library to the agent in batches, and
// turns off (agent-sync-run.js, wired in background.js). chrome.* and the server are stubbed: no keys,
// no network. Tokens here are made up; nothing prints them.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_BODY } from "../agent-sync.js";

const SERVER = "https://mcp.divergada.com";
const post = (key, at) => ({ key, platform: "linkedin", authorName: "Jane", text: `Golden sets caught ${key}.`, savedAt: at });
const store = { saved: [post("d1", 3), post("d2", 2), post("d3", 1)] };

// ---- chrome ----
const listeners = { message: null, changed: [], alarm: [], wake: [] };
const alarms = new Map();
const alarmCreates = [];
const permissionRemovals = [];
const event = { addListener: () => {} };
let authAnswer = null; // a test sets a function (state) => href to change what the sign-in window returns
const authUrls = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => Object.hasOwn(store, k)).map((k) => [k, store[k]]))),
      set: async (obj) => { Object.assign(store, structuredClone(obj)); },
      remove: async (keys) => { for (const k of [keys].flat()) delete store[k]; },
    },
    sync: {
      get: async () => { throw new Error("agent sync must never use chrome.storage.sync"); },
      set: async () => { throw new Error("agent sync must never use chrome.storage.sync"); },
    },
    onChanged: { addListener: (fn) => listeners.changed.push(fn) },
  },
  runtime: {
    id: "test",
    onMessage: { addListener: (fn) => { listeners.message = fn; } },
    onInstalled: { addListener: (fn) => listeners.wake.push(fn) }, onStartup: { addListener: (fn) => listeners.wake.push(fn) },
    getManifest: () => ({ version: "1.5.0" }), getURL: (p) => "chrome-extension://test/" + p,
  },
  alarms: {
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    get: async (name) => alarms.get(name),
    clear: async (name) => alarms.delete(name),
    create: (name, info) => { alarmCreates.push([name, info]); alarms.set(name, { name, ...info }); },
  },
  identity: {
    getRedirectURL: () => "https://test.chromiumapp.org/",
    launchWebAuthFlow: async ({ url }) => {
      const u = new URL(url);
      authUrls.push(u);
      server.device = u.searchParams.get("device"); // the device the next tokens are issued for
      const state = u.searchParams.get("state");
      return authAnswer ? authAnswer(state) : `https://test.chromiumapp.org/?code=K&state=${state}`;
    },
  },
  permissions: { contains: async () => true, remove: async (p) => { permissionRemovals.push(p); return true; } },
  notifications: { onClicked: event, create: () => {} },
  tabs: { create: () => {} },
};

// ---- Sieve's server ----
const requests = []; // { method, path, headers, body }
// A request held by a test waits here until the test releases it ("PUT /v1/library/chrome", "POST /token").
// Each hold() holds the next request to that route only.
const holds = new Map(); // route -> [promise]
const hold = (route) => {
  let release;
  const p = new Promise((r) => { release = r; });
  holds.set(route, [...(holds.get(route) || []), p]);
  return () => release();
};
const server = {
  timeout: false, // the PUT times out (AbortSignal.timeout)
  code: 200, // the status /token answers a sign-in code with
  acceptOld: false, // every access token ever issued still works (not just the latest)
  unauthorized: false, // every /v1 request is answered 401, whatever the token
  deleteLibrary: null, deleteAccount: null, // { status, body } instead of success
  put: null, // null: stored/unchanged; or { status, body } for every PUT while set
  token: 200, // the status /token answers a refresh with
  down: false, // every request throws, as with no network
  access: null, refresh: null, device: null, issued: 0, lastStored: null,
};
const issuedAccess = new Set();
const answer = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// The worker catches network errors, so a broken rule inside the fake server is kept here and checked
// at the end instead of being swallowed.
const broken = [];
globalThis.fetch = async (url, init = {}) => {
  try { return await serve(url, init); } catch (e) { if (e instanceof assert.AssertionError) { broken.push(e); console.error(e.message); } throw e; }
};
async function serve(url, init) {
  const u = new URL(String(url));
  assert.equal(u.origin, SERVER, "agent sync talks only to Sieve's server");
  const method = init.method || "GET";
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  requests.push({ method, path: u.pathname, headers, body: init.body, signal: init.signal instanceof AbortSignal });
  const held = holds.get(`${method} ${u.pathname}`)?.shift();
  if (held) await held;
  await new Promise((r) => setTimeout(r, 2)); // a real answer takes a moment, so two requests can overlap
  if (server.down) throw new TypeError("Failed to fetch");
  if (u.pathname === "/token") {
    assert.equal(method, "POST");
    assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
    const form = new URLSearchParams(init.body);
    assert.equal(form.get("client_id"), `${SERVER}/clients/chrome.json`);
    assert.equal(form.get("client_secret"), null);
    if (form.get("grant_type") === "authorization_code") {
      if (server.code !== 200) return answer(server.code, { error: "invalid_grant" });
      assert.equal(form.get("code"), "K");
      assert.ok(form.get("code_verifier"));
    } else {
      assert.equal(form.get("grant_type"), "refresh_token");
      if (server.token !== 200 || form.get("refresh_token") !== server.refresh) return answer(server.token === 200 ? 400 : server.token, { error: "invalid_grant" });
    }
    server.issued++;
    server.access = `acc-${server.issued}`;
    issuedAccess.add(server.access);
    server.refresh = `ref-${server.issued}`;
    return answer(200, { access_token: server.access, refresh_token: server.refresh, expires_in: 3600, token_type: "bearer" });
  }
  // Every /v1 request carries this Chrome's token and the device the token was issued for.
  assert.match(headers["x-sieve-device"], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(headers["x-sieve-device"], server.device);
  const tokenOk = headers.authorization === `Bearer ${server.access}` || (server.acceptOld && issuedAccess.has(headers.authorization?.slice(7)));
  if (server.unauthorized || !tokenOk) return answer(401);
  const route = `${method} ${u.pathname}`;
  if (route === "GET /v1/account") return answer(200, { email: "dev@example.com", method: "google", plan: "trial", trialEndsAt: "2026-11-10T23:59:59.999Z" });
  if (route === "PUT /v1/library/chrome") {
    assert.equal(headers["content-type"], "application/json");
    if (server.timeout) throw new DOMException("The operation timed out.", "TimeoutError");
    if (server.put) return answer(server.put.status, server.put.body);
    const items = JSON.parse(init.body).items;
    const result = init.body === server.lastStored ? "unchanged" : "stored";
    server.lastStored = init.body;
    return answer(200, { result, items: items.length, boards: 0, at: "2026-10-06T10:00:00.000Z" });
  }
  if (route === "DELETE /v1/library/chrome") return server.deleteLibrary ? answer(server.deleteLibrary.status, server.deleteLibrary.body) : answer(200, { result: "deleted" });
  if (route === "POST /v1/account/sign-out") return answer(200, { ok: true });
  if (route === "DELETE /v1/account") return server.deleteAccount ? answer(server.deleteAccount.status, server.deleteAccount.body) : answer(200, { result: "deleted" });
  return answer(404);
}

const src = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "sieve-agent-sync-"));
for (const f of readdirSync(src)) if (f.endsWith(".js")) copyFileSync(join(src, f), join(dir, f));
await import(pathToFileURL(join(dir, "background.js")).href);
// The same module instance background.js uses, for the checks that need its insides.
const run = await import(pathToFileURL(join(dir, "agent-sync-run.js")).href);

const SETTINGS = { id: "test", url: "chrome-extension://test/options.html" };
const POPUP = { id: "test", url: "chrome-extension://test/popup.html" };
const ask = (msg, sender = SETTINGS) => new Promise((resolve) => { listeners.message(msg, sender, resolve); });
const sync = (extra = {}, sender) => ask({ type: "agentSync", ...extra }, sender);
const changed = (changes) => Promise.all(listeners.changed.map((fn) => fn(changes, "local")));
const fire = (name) => { alarms.delete(name); return Promise.all(listeners.alarm.map((fn) => fn({ name }))); };
const puts = () => requests.filter((r) => r.method === "PUT");
const rec = () => store.agentSync || {};
const since = (n) => requests.slice(n);
const tick = () => new Promise((r) => setTimeout(r, 1));
const waitFor = async (what, ok) => { for (let i = 0; i < 2000; i++) { if (ok()) return; await tick(); } throw new Error(`timed out waiting for ${what}`); };
const tokensGone = () => !("access" in rec()) && !("refresh" in rec()) && !("expiresAt" in rec());

try {
  // 15. Nothing but Sieve's own settings page may act.
  for (const sender of [
    POPUP,
    { url: "chrome-extension://test/options.html" }, // no sender id
    { id: "other", url: "chrome-extension://test/options.html" },
    { url: "https://www.linkedin.com/feed/", tab: { id: 1 } },
    { url: "chrome-extension://test/options.html.evil" },
    { url: "chrome-extension://other/options.html" },
    {},
  ]) {
    for (const what of ["on", "off", "delete", "send"]) {
      const r = await sync({ do: what }, sender);
      assert.ok(r.error, `${what} from ${sender.url} is refused`);
    }
  }
  assert.equal(requests.length, 0);
  assert.equal(authUrls.length, 0);
  assert.equal(store.agentSync, undefined);
  assert.ok((await sync({ do: "nonsense" })).error);
  assert.ok((await sync({ do: "toString" })).error);
  assert.ok((await ask({ type: "agentSync", do: "status" }, { url: "https://evil.example/" })).error);
  assert.deepEqual(await ask({ type: "agentSync", do: "status" }, POPUP), {});

  // 14 (before ever turning on). A library change with sync off sets nothing and makes no alarm.
  await changed({ saved: { newValue: store.saved } });
  assert.equal(store.agentSync, undefined);
  assert.equal(alarmCreates.length, 0);

  // 1. Turn on: sign in, then send at once.
  const on = await sync({ do: "on" });
  assert.equal(authUrls.length, 1);
  assert.match(server.device, /^[0-9a-f-]{36}$/);
  assert.equal(on.on, true);
  assert.equal(on.email, "dev@example.com");
  assert.equal(on.state, "on");
  assert.equal(on.lastItems, 3);
  assert.equal(on.device, server.device);
  for (const k of ["access", "refresh", "expiresAt", "lastHash"]) assert.equal(k in on, false, `status hides ${k}`);
  assert.equal(rec().access, server.access);
  assert.equal(puts().length, 1);
  const body = JSON.parse(puts()[0].body);
  assert.equal(body.items.length, 3);
  assert.ok(body.items.every((it) => it.id.startsWith("chrome:")));
  assert.equal("digests" in body, false);
  assert.equal(alarms.has("agent-sync"), false, "the backstop alarm goes once the send is answered");
  assert.equal(rec().dirty, false);

  // 2. A change to the library: dirty, one alarm; a second change makes no second alarm.
  const c0 = alarmCreates.length;
  await changed({ saved: { newValue: store.saved } });
  assert.equal(rec().dirty, true);
  assert.deepEqual(alarmCreates.slice(c0), [["agent-sync", { delayInMinutes: 15 }]]);
  await changed({ briefs: { newValue: {} } });
  assert.equal(alarmCreates.length, c0 + 1);
  await changed({ agentSync: { newValue: {} }, orKey: { newValue: "x" } });
  assert.equal(alarmCreates.length, c0 + 1, "other keys aren't the library");

  // 3. The alarm fires, nothing really changed: no PUT, not dirty.
  let n = requests.length;
  await fire("agent-sync");
  assert.equal(since(n).length, 0);
  assert.equal(rec().dirty, false);

  // 4. A real change, then the alarm: one PUT, a new hash.
  const hash1 = rec().lastHash;
  store.saved = [post("d0", 4), ...store.saved];
  await changed({ saved: { newValue: store.saved } });
  n = requests.length;
  await fire("agent-sync");
  assert.equal(since(n).filter((r) => r.method === "PUT").length, 1);
  assert.notEqual(rec().lastHash, hash1);
  assert.equal(rec().lastItems, 4);
  assert.equal(rec().dirty, false);

  // 5. The server's copy is bigger: "shrunk" with both counts; the person's yes sends X-Sieve-Empty.
  server.put = { status: 409, body: { result: "shrunk", items: 3, storedItems: 40 } };
  let s = await sync({ do: "send" });
  assert.equal(s.state, "shrunk");
  assert.deepEqual(s.detail, { stored: 40, count: 3 });
  server.put = null;
  n = requests.length;
  s = await sync({ do: "send", allowShrink: true });
  assert.equal(s.state, "on");
  assert.equal(s.detail, null);
  assert.equal(since(n).find((r) => r.method === "PUT").headers["x-sieve-empty"], "yes");

  // 6. Another Chrome's copy is there: the person's choice sends X-Sieve-Replace (from settings with a hash).
  server.put = { status: 409, body: { result: "other_device", device: "someone" } };
  assert.equal((await sync({ do: "send" })).state, "other_device");
  server.put = null;
  n = requests.length;
  s = await ask({ type: "agentSync", do: "send", replace: true }, { id: "test", url: "chrome-extension://test/options.html#agent" });
  assert.equal(s.state, "on");
  const replaced = since(n).find((r) => r.method === "PUT");
  assert.equal(replaced.headers["x-sieve-replace"], "yes");
  assert.equal(replaced.headers["x-sieve-empty"], undefined);
  server.put = { status: 409, body: { result: "older" } };
  assert.equal((await sync({ do: "send" })).state, "older");
  server.put = null;

  // 7. Busy (503): tried again at the next alarm.
  alarms.clear();
  server.put = { status: 503, body: { result: "busy" } };
  s = await sync({ do: "send" });
  assert.equal(s.state, "busy");
  assert.equal(rec().dirty, true);
  assert.ok(alarms.has("agent-sync"));
  assert.deepEqual(alarmCreates.at(-1), ["agent-sync", { delayInMinutes: 15 }]);
  server.put = null;
  await fire("agent-sync");
  assert.equal(rec().state, "on");
  assert.equal(rec().dirty, false);

  // Offline: busy too, and the alarm.
  server.down = true;
  s = await sync({ do: "send" });
  assert.equal(s.state, "busy");
  assert.equal(s.on, true);
  assert.ok(alarms.has("agent-sync"));
  server.down = false;
  await fire("agent-sync");
  assert.equal(rec().state, "on");

  // Limit (429): tomorrow, and a change before then doesn't bring it forward.
  server.put = { status: 429, body: { result: "limit" } };
  assert.equal((await sync({ do: "send" })).state, "limit");
  assert.deepEqual(alarms.get("agent-sync").delayInMinutes, 24 * 60);
  await changed({ saved: { newValue: store.saved } });
  assert.equal(alarms.get("agent-sync").delayInMinutes, 24 * 60);
  server.put = null;
  await fire("agent-sync");
  assert.equal(rec().state, "on");

  // Invalid (400): the reason, and no retry until something changes.
  server.put = { status: 400, body: { result: "invalid", reason: "items[0].id" } };
  s = await sync({ do: "send" });
  assert.equal(s.state, "invalid");
  assert.deepEqual(s.detail, { reason: "items[0].id" });
  server.put = null;
  await changed({ saved: { newValue: store.saved } });
  n = requests.length;
  await fire("agent-sync");
  assert.equal(since(n).length, 0, "the same library isn't sent again");
  assert.equal(rec().state, "invalid");
  assert.equal((await sync({ do: "send" })).state, "on", "Send now is the person's choice");

  // 8. An expired token: one refresh before the PUT, even for two sends at once.
  store.agentSync = { ...rec(), expiresAt: Date.now() - 1000 };
  const oldAccess = rec().access;
  n = requests.length;
  const [a, b] = await Promise.all([sync({ do: "send" }), sync({ do: "send" })]);
  assert.equal(a.state, "on");
  assert.equal(b.state, "on");
  const after = since(n);
  assert.equal(after.filter((r) => r.path === "/token").length, 1);
  assert.equal(after[0].path, "/token", "the refresh comes before the PUT");
  assert.notEqual(rec().access, oldAccess);
  assert.ok(after.filter((r) => r.method === "PUT").every((r) => r.headers.authorization === `Bearer ${server.access}`));

  // A token the server no longer takes (401): one refresh and one more try.
  server.access = "revoked-on-the-server";
  n = requests.length;
  s = await sync({ do: "send" });
  assert.equal(s.state, "on");
  assert.deepEqual(since(n).map((r) => `${r.method} ${r.path}`), ["PUT /v1/library/chrome", "POST /token", "PUT /v1/library/chrome"]);

  // Too big for the server (checked here, before sending): nothing sent, and the same library isn't retried.
  const big = post("huge", 9);
  big.text = "x".repeat(MAX_BODY + 10);
  store.saved = [big, ...store.saved];
  n = requests.length;
  s = await sync({ do: "send" });
  assert.equal(s.state, "too_big");
  assert.ok(s.detail.bytes > MAX_BODY);
  assert.equal(since(n).length, 0);
  await changed({ saved: { newValue: store.saved } });
  await fire("agent-sync");
  assert.equal(since(n).length, 0);
  store.saved = store.saved.slice(1);

  // 413 from the server: the same.
  server.put = { status: 413, body: { result: "too-big", max: MAX_BODY } };
  store.saved = [post("d9", 5), ...store.saved];
  s = await sync({ do: "send" });
  assert.equal(s.state, "too_big");
  assert.ok(s.detail.bytes > 0);
  await changed({ saved: { newValue: store.saved } });
  n = requests.length;
  await fire("agent-sync");
  assert.equal(since(n).length, 0);
  server.put = null;

  // 10. The invite ended: stop sending, with the day it ended.
  server.put = { status: 403, body: { result: "ended" } };
  s = await sync({ do: "send" });
  assert.equal(s.state, "ended");
  assert.deepEqual(s.detail, { endedOn: "10 November" });
  assert.equal(alarms.has("agent-sync"), false);
  store.saved = [post("d10", 6), ...store.saved];
  await changed({ saved: { newValue: store.saved } });
  assert.equal(alarms.has("agent-sync"), false);
  n = requests.length;
  await fire("agent-sync");
  await sync({ do: "send" });
  assert.equal(since(n).length, 0);
  server.put = null;

  // 12. Turn off: the Chrome copy deleted, signed out, permissions given back; the device id kept.
  const dev = rec().device;
  n = requests.length;
  s = await sync({ do: "off" });
  assert.deepEqual(since(n).map((r) => `${r.method} ${r.path}`), ["DELETE /v1/library/chrome", "POST /v1/account/sign-out"]);
  assert.deepEqual(permissionRemovals.at(-1), { permissions: ["identity"], origins: [`${SERVER}/*`] });
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  assert.deepEqual(s, { on: false, device: dev, state: "off" });

  // 14. Off: a library change sets nothing and makes no alarm.
  const creates = alarmCreates.length;
  await changed({ saved: { newValue: store.saved } });
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  assert.equal(alarmCreates.length, creates);

  // Off with the network down: the tokens still go.
  server.put = null;
  assert.equal((await sync({ do: "on" })).state, "on");
  assert.equal(rec().device, dev, "the same device signs in again");
  server.down = true;
  s = await sync({ do: "off" });
  server.down = false;
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off", detail: { reason: "offline" } });

  // 11. Not invited: no tokens kept.
  authAnswer = (state) => `https://test.chromiumapp.org/?error=access_denied&error_description=new_accounts_closed&state=${state}`;
  s = await sync({ do: "on" });
  assert.equal(s.state, "not_invited");
  assert.equal(s.on, false);
  assert.equal(rec().access, undefined);
  assert.equal(rec().refresh, undefined);
  // A different state in the answer, or the window closed: off, nothing kept.
  authAnswer = () => "https://test.chromiumapp.org/?code=K&state=forged";
  assert.equal((await sync({ do: "on" })).state, "off");
  authAnswer = () => { throw new Error("The user did not approve access."); };
  assert.equal((await sync({ do: "on" })).state, "off");
  assert.equal(rec().access, undefined);
  authAnswer = null;

  // 9. A refused refresh signs this Chrome out.
  assert.equal((await sync({ do: "on" })).state, "on");
  store.agentSync = { ...rec(), expiresAt: Date.now() - 1000 };
  server.token = 400;
  s = await sync({ do: "send" });
  server.token = 200;
  assert.equal(s.on, false);
  assert.equal(s.state, "signed_out");
  assert.equal(rec().access, undefined);
  assert.equal(rec().refresh, undefined);
  assert.equal(rec().device, dev);
  // Turning off from there: the agent's copy is still on the server, and the record says so.
  s = await sync({ do: "off" });
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off", detail: { reason: "offline" } });

  // A refresh that can't reach the server keeps everything: busy, try later.
  assert.equal((await sync({ do: "on" })).state, "on");
  store.agentSync = { ...rec(), expiresAt: Date.now() - 1000 };
  server.down = true;
  s = await sync({ do: "send" });
  server.down = false;
  assert.equal(s.state, "busy");
  assert.equal(s.on, true);
  assert.ok(rec().refresh);

  // 13. Delete the account: DELETE /v1/account, then the same clean-up as off.
  n = requests.length;
  s = await sync({ do: "delete" });
  assert.ok(since(n).some((r) => r.method === "DELETE" && r.path === "/v1/account"));
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  assert.deepEqual(permissionRemovals.at(-1), { permissions: ["identity"], origins: [`${SERVER}/*`] });

  // Turn on without the identity permission: "no_permission" while off ...
  const identity = chrome.identity;
  delete chrome.identity;
  s = await sync({ do: "on" });
  assert.equal(s.state, "no_permission");
  assert.equal(s.on, false);
  chrome.identity = identity;

  // Two quick Turn on clicks: one sign-in window.
  let authsBefore = authUrls.length;
  const [on1, on2] = await Promise.all([sync({ do: "on" }), sync({ do: "on" })]);
  assert.equal(authUrls.length, authsBefore + 1);
  assert.equal(on1.state, "on");
  assert.equal(on2.state, "on");

  // ... and while on, it leaves the live session alone.
  delete chrome.identity;
  const liveAccess = rec().access;
  s = await sync({ do: "on" });
  chrome.identity = identity;
  assert.equal(s.state, "on");
  assert.equal(s.on, true);
  assert.equal(rec().access, liveAccess);

  // Turn on again while on: the old session is signed out first (best effort), then replaced.
  n = requests.length;
  assert.equal((await sync({ do: "on" })).state, "on");
  const oldOut = since(n).find((r) => r.path === "/v1/account/sign-out");
  assert.ok(oldOut, "the old session signs out");
  assert.equal(oldOut.headers.authorization, `Bearer ${liveAccess}`);
  assert.notEqual(rec().access, liveAccess);

  // Two paths needing a token while it has expired: one refresh, both get the new token.
  store.agentSync = { ...rec(), expiresAt: Date.now() - 1000 };
  n = requests.length;
  const [t1, t2] = await Promise.all([run.accessToken(), run.accessToken()]);
  assert.equal(since(n).filter((r) => r.path === "/token").length, 1);
  assert.equal(t1, server.access);
  assert.equal(t2, server.access);

  // A PUT that times out: busy, try later.
  server.timeout = true;
  s = await sync({ do: "send" });
  server.timeout = false;
  assert.equal(s.state, "busy");
  assert.equal(rec().dirty, true);
  assert.ok(alarms.has("agent-sync"));
  assert.equal((await sync({ do: "send" })).state, "on");
  assert.equal(alarms.has("agent-sync"), false);

  // A change while a send is out: the answer doesn't clear it, and the alarm stays.
  let release = hold("PUT /v1/library/chrome");
  n = requests.length;
  let pending = sync({ do: "send" });
  await waitFor("the PUT", () => since(n).some((r) => r.method === "PUT"));
  assert.ok(alarms.has("agent-sync"), "a backstop alarm before the PUT");
  store.saved = [post("d11", 7), ...store.saved];
  await changed({ saved: { newValue: store.saved } });
  release();
  assert.equal((await pending).state, "on");
  assert.equal(rec().dirty, true);
  assert.ok(alarms.has("agent-sync"));
  await fire("agent-sync");
  assert.equal(rec().dirty, false);
  assert.equal(rec().lastItems, store.saved.length);

  // Delete the account, refused by the server (502) or unreachable: still signed in, and why.
  server.deleteAccount = { status: 502, body: { result: "failed", step: "library" } };
  store.agentSync = { ...rec(), dirty: true }; // a change held back while the delete was out
  alarms.delete("agent-sync");
  s = await sync({ do: "delete" });
  server.deleteAccount = null;
  assert.equal(s.on, true);
  assert.deepEqual(s.detail, { reason: "server" });
  assert.ok(alarms.has("agent-sync"), "a failed delete re-arms the held-back send");
  assert.ok(rec().access);
  server.down = true;
  s = await sync({ do: "delete" });
  server.down = false;
  assert.equal(s.on, true);
  assert.deepEqual(s.detail, { reason: "offline" });
  assert.ok(rec().access);
  assert.equal((await sync({ do: "send" })).state, "on", "sending carries on after a failed delete");
  // The server refuses the token even after a refresh: signed out, and the delete didn't happen.
  server.unauthorized = true;
  s = await sync({ do: "delete" });
  server.unauthorized = false;
  assert.equal(s.on, false);
  assert.equal(s.state, "signed_out");
  assert.deepEqual(s.detail, { reason: "server" });
  assert.equal((await sync({ do: "on" })).state, "on");

  // An older delete finishing late doesn't lift the guard of a newer one still out.
  server.acceptOld = true;
  server.deleteAccount = { status: 502, body: { result: "failed", step: "library" } };
  const releaseA = hold("DELETE /v1/account");
  n = requests.length;
  const delA = sync({ do: "delete" });
  await waitFor("delete A", () => since(n).some((r) => r.path === "/v1/account" && r.method === "DELETE"));
  assert.equal((await sync({ do: "on" })).state, "on"); // a new sign-in while A is out
  const releaseB = hold("DELETE /v1/account");
  n = requests.length;
  const delB = sync({ do: "delete" });
  await waitFor("delete B", () => since(n).some((r) => r.path === "/v1/account" && r.method === "DELETE"));
  releaseA();
  await delA;
  n = requests.length;
  await sync({ do: "send" });
  assert.equal(since(n).filter((r) => r.method === "PUT").length, 0, "no send while delete B is out");
  server.deleteAccount = null;
  releaseB();
  await delB;
  server.acceptOld = false;
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  assert.equal((await sync({ do: "on" })).state, "on");

  // Turn off while a PUT is out: off at once, and the PUT's answer writes nothing back.
  release = hold("PUT /v1/library/chrome");
  n = requests.length;
  pending = sync({ do: "send" });
  await waitFor("the PUT", () => since(n).some((r) => r.method === "PUT"));
  let off = sync({ do: "off" });
  await waitFor("off", () => rec().on === false);
  assert.ok(tokensGone(), "the tokens go before anything else");
  release();
  await pending;
  s = await off;
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  assert.deepEqual(since(n).map((r) => `${r.method} ${r.path}`), ["PUT /v1/library/chrome", "DELETE /v1/library/chrome", "POST /v1/account/sign-out"]);

  // A refresh answered after Turn off doesn't write the tokens back; off signs out with them.
  assert.equal((await sync({ do: "on" })).state, "on");
  store.agentSync = { ...rec(), expiresAt: Date.now() - 1000 };
  release = hold("POST /token");
  n = requests.length;
  pending = sync({ do: "send" });
  await waitFor("the refresh", () => since(n).some((r) => r.path === "/token"));
  off = sync({ do: "off" });
  await waitFor("off", () => rec().on === false);
  release();
  await pending;
  await off;
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off" });
  const signOut = since(n).find((r) => r.path === "/v1/account/sign-out");
  assert.equal(signOut.headers.authorization, `Bearer ${server.access}`, "signed out with the refreshed token");
  assert.equal(since(n).filter((r) => r.method === "PUT").length, 0);

  // Turn off, refused by the server (429 on the library delete): off here anyway, and why.
  assert.equal((await sync({ do: "on" })).state, "on");
  server.deleteLibrary = { status: 429, body: { result: "limit" } };
  s = await sync({ do: "off" });
  server.deleteLibrary = null;
  assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off", detail: { reason: "server" } });

  // A sign-in that fails from there keeps the copy-may-remain reason: window closed, not invited,
  // the token step refused.
  const remains = { on: false, device: dev, state: "off", detail: { reason: "server" } };
  authAnswer = () => { throw new Error("The user did not approve access."); };
  await sync({ do: "on" });
  assert.deepEqual(store.agentSync, remains);
  authAnswer = (state) => `https://test.chromiumapp.org/?error=access_denied&error_description=new_accounts_closed&state=${state}`;
  await sync({ do: "on" });
  assert.deepEqual(store.agentSync, { ...remains, state: "not_invited" });
  authAnswer = null;
  store.agentSync = remains;
  server.code = 400;
  await sync({ do: "on" });
  server.code = 200;
  assert.deepEqual(store.agentSync, remains);

  // Something unexpected while acting: an error is recorded, not the old state shown as if fine, but
  // a copy-may-remain reason stays.
  const getRedirectURL = chrome.identity.getRedirectURL;
  chrome.identity.getRedirectURL = () => { throw new Error("boom"); };
  s = await sync({ do: "on" });
  assert.deepEqual(s.detail, { reason: "server" });
  store.agentSync = { on: false, device: dev, state: "off" };
  s = await sync({ do: "on" });
  chrome.identity.getRedirectURL = getRedirectURL;
  assert.equal(s.on, false);
  assert.equal(s.state, "off", "an error doesn't claim a retry");
  assert.deepEqual(s.detail, { reason: "error" });

  // A worker stopped mid-send keeps the change, and a fresh worker arms the alarm again.
  assert.equal((await sync({ do: "on" })).state, "on");
  hold("PUT /v1/library/chrome"); // never answered: the worker is stopped while the PUT is out
  store.saved = [post("d12", 8), ...store.saved];
  await changed({ saved: { newValue: store.saved } });
  n = requests.length;
  fire("agent-sync");
  await waitFor("the PUT", () => since(n).some((r) => r.method === "PUT"));
  assert.equal(rec().dirty, true);
  assert.ok(alarms.has("agent-sync"));
  holds.clear();
  listeners.changed.length = 0; listeners.alarm.length = 0; listeners.wake.length = 0;
  const dir2 = mkdtempSync(join(tmpdir(), "sieve-agent-sync-"));
  try {
    for (const f of readdirSync(src)) if (f.endsWith(".js")) copyFileSync(join(src, f), join(dir2, f));
    await import(pathToFileURL(join(dir2, "background.js")).href);
    alarms.delete("agent-sync"); // Chrome dropped the alarm (an update, a crash)
    await Promise.all(listeners.wake.map((fn) => fn({ reason: "update" })));
    assert.deepEqual(alarms.get("agent-sync")?.delayInMinutes, 15);
    await fire("agent-sync");
    assert.equal(rec().dirty, false);
    assert.equal(rec().state, "on");
    assert.equal(rec().lastItems, store.saved.length);

    // A delete guard left in the record by an older worker doesn't stop sending.
    store.agentSync = { ...rec(), deleting: true };
    n = requests.length;
    s = await sync({ do: "send" });
    assert.equal(s.state, "on");
    assert.equal(since(n).filter((r) => r.method === "PUT").length, 1);

    // A worker stopped while Turn off's DELETE is out: off, and the record says the copy may remain.
    hold("DELETE /v1/library/chrome"); // never answered
    n = requests.length;
    sync({ do: "off" });
    await waitFor("the DELETE", () => since(n).some((r) => r.method === "DELETE"));
    assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off", detail: { reason: "offline" } });
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
  holds.clear();
  listeners.changed.length = 0; listeners.alarm.length = 0; listeners.wake.length = 0;
  const dir3 = mkdtempSync(join(tmpdir(), "sieve-agent-sync-"));
  try {
    for (const f of readdirSync(src)) if (f.endsWith(".js")) copyFileSync(join(src, f), join(dir3, f));
    await import(pathToFileURL(join(dir3, "background.js")).href);
    await Promise.all(listeners.wake.map((fn) => fn({ reason: "update" })));
    assert.deepEqual(store.agentSync, { on: false, device: dev, state: "off", detail: { reason: "offline" } });
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }

  // Every request can time out; no request ever carried a token in its URL.
  assert.ok(requests.every((r) => r.signal), "every fetch has a timeout signal");
  assert.ok(requests.every((r) => !/acc-|ref-/.test(r.path)));
  assert.deepEqual(broken, [], "every request kept the server's rules");
  console.log("agent_sync_worker_test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
