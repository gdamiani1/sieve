// Sending the library to the developer's coding agent, the Chrome part (extension library sync spec
// 5.2, 5.3): sign-in with launchWebAuthFlow, tokens in chrome.storage.local (never sync), and sends to
// PUT /v1/library/chrome, batched by an alarm. Imported by background.js only: the settings page asks
// the worker, so there is one place that refreshes tokens. The pure part is agent-sync.js.
//
// One record in chrome.storage.local, `agentSync`:
//   { on, email, device, access, refresh, expiresAt, dirty, lastHash, lastAt, lastItems, state, detail }
// `state` is one of the states agent-sync.js words() knows; `detail` holds that state's numbers
// ({ stored, count, reason, endedOn, bytes }). Tokens and the hash never leave the worker (status()).
import {
  MAX_BODY, SERVER, SEND_EVERY_MIN, authorizeUrl, libraryBody, libraryHash, pkcePair, randomState, readCallback, readTokens, refreshForm, tokenForm,
} from "./agent-sync.js";

export const SYNC_ALARM = "agent-sync";
const KEY = "agentSync";
const LIBRARY_KEYS = ["saved", "watched", "briefs"];
export const OPTIONAL = { permissions: ["identity"], origins: [`${SERVER}/*`] };
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

// Every write to the record goes through one queue, so a library change landing while a send is out
// can't be lost to a read-modify-write race.
let writes = Promise.resolve();
const load = async () => (await chrome.storage.local.get(KEY))[KEY] || {};
const write = (fn) => {
  const run = writes.then(async () => {
    const next = await fn(await load());
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  writes = run.catch(() => {});
  return run;
};
const save = (patch) => write((s) => ({ ...s, ...patch }));

const device = async () => (await load()).device || (await write((s) => (s.device ? s : { ...s, device: crypto.randomUUID().toLowerCase() }))).device;

// Signed out, for whatever reason: only the device id stays (the server knows this Chrome by it).
const signedOut = async (state, detail = null) => {
  const next = await write((s) => ({ on: false, ...(s.device ? { device: s.device } : {}), state, ...(detail ? { detail } : {}) }));
  await chrome.alarms.clear(SYNC_ALARM);
  return next;
};

// One refresh at a time: a second caller waits for the first one's answer. A refused refresh signs
// this Chrome out; a server that can't be reached leaves everything as it was.
let refreshing = null;
async function accessToken({ stale = false } = {}) {
  const s = await load();
  if (!s.on || !s.refresh) return null;
  if (!stale && s.access && Date.now() < s.expiresAt) return s.access;
  refreshing ??= (async () => {
    try {
      const now = await load();
      if (!now.on || !now.refresh) return null;
      // Another caller refreshed while this one waited.
      if (now.access && now.access !== s.access && Date.now() < now.expiresAt) return now.access;
      let res;
      try { res = await fetch(`${SERVER}/token`, { method: "POST", headers: FORM, body: refreshForm(now.refresh).toString() }); } catch { return null; }
      let t = null;
      if (res.ok) { try { t = readTokens(await res.json()); } catch {} }
      if (!t) {
        if (res.status >= 400 && res.status < 500) await signedOut("signed_out");
        return null;
      }
      await save(t);
      return t.access;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

const authed = async (token, init) => ({ ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "X-Sieve-Device": await device() } });

/** A /v1 request with this Chrome's token and device. Null when there is no token to send (signed out,
 * or the refresh couldn't reach the server). A 401 or 404 (a token the server no longer takes, or one
 * for another app) gets one fresh token and one more try; a second one signs this Chrome out. Throws
 * when the network is down. */
async function call(path, init = {}) {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`${SERVER}${path}`, await authed(token, init));
  if (res.status !== 401 && res.status !== 404) return res;
  const fresh = await accessToken({ stale: true });
  if (!fresh) return null;
  const again = await fetch(`${SERVER}${path}`, await authed(fresh, init));
  if (again.status === 401 || again.status === 404) { await signedOut("signed_out"); return null; }
  return again;
}

const json = async (res) => { try { return (await res.json()) || {}; } catch { return {}; } };

// "10 November": the day the invite ends, in UTC like the server's trialEndsAt.
const dayOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
};

/** Turn on: sign in, then send at once. The settings page has already been granted OPTIONAL. */
export async function turnOn(provider = "google") {
  if (!chrome.identity?.launchWebAuthFlow) return signedOut("no_permission");
  const d = await device();
  const redirect = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await pkcePair();
  const state = randomState();
  let back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl({ redirect, challenge, state, device: d, provider }), interactive: true });
  } catch {
    return signedOut("off"); // the person closed the sign-in window
  }
  const cb = readCallback(back, state);
  if (cb.error) return signedOut(cb.error === "not_invited" ? "not_invited" : "off");
  let t = null;
  let reason = "refused";
  try {
    const res = await fetch(`${SERVER}/token`, { method: "POST", headers: FORM, body: tokenForm({ code: cb.code, verifier, redirect }).toString() });
    if (res.ok) t = readTokens(await json(res));
  } catch { reason = "offline"; }
  if (!t) return signedOut("off", { reason });
  await write((s) => ({ device: s.device, on: true, ...t, state: "on", dirty: true }));
  try {
    const res = await call("/v1/account");
    if (res?.ok) {
      const email = (await json(res)).email;
      if (typeof email === "string") await save({ email });
    }
  } catch {}
  return send({ force: true });
}

// A send that is to be tried again (busy, limit) forgets the last hash, so the retry really sends even
// when the library hasn't changed since: the copy the server has may be older.
// Sends run one after another: the second sees what the first stored.
let sending = Promise.resolve();
/** Send if the library changed since the last copy sent. `force` (Send now, Turn on) sends even an
 * unchanged library; `allowShrink` and `replace` are the person's answers to "shrunk" and
 * "other_device". */
export function send(opts = {}) {
  const run = sending.then(() => sendOnce(opts));
  sending = run.catch(() => {});
  return run;
}

async function sendOnce({ force = false, allowShrink = false, replace = false } = {}) {
  const s = await load();
  if (!s.on || s.state === "ended") return s;
  // Cleared before reading the library: a change while this send is out sets it again.
  await save({ dirty: false });
  const { body, json: text, bytes } = libraryBody(await chrome.storage.local.get(LIBRARY_KEYS));
  const hash = await libraryHash(body);
  if (hash === s.lastHash && !force && !allowShrink && !replace) return load();
  if (bytes > MAX_BODY) return save({ state: "too_big", detail: { bytes }, lastHash: hash });
  const headers = { "Content-Type": "application/json" };
  if (allowShrink) headers["X-Sieve-Empty"] = "yes";
  if (replace) headers["X-Sieve-Replace"] = "yes";
  let res = null;
  try { res = await call("/v1/library/chrome", { method: "PUT", headers, body: text }); } catch {}
  if (!res) {
    if (!(await load()).on) return load(); // the refresh signed this Chrome out
    await later();
    return save({ state: "busy", dirty: true, lastHash: null });
  }
  const j = await json(res);
  if (res.ok && (j.result === "stored" || j.result === "unchanged")) {
    return save({ state: "on", detail: null, lastHash: hash, lastAt: Date.now(), lastItems: body.items.length });
  }
  if (res.status === 403 && j.result === "ended") return ended();
  if (res.status === 409 && (j.result === "empty" || j.result === "shrunk")) {
    return save({ state: "shrunk", detail: { stored: Number(j.storedItems) || 0, count: Number(j.items) || 0 } });
  }
  if (res.status === 409 && j.result === "other_device") return save({ state: "other_device", detail: null });
  if (res.status === 409 && j.result === "older") return save({ state: "older", detail: null });
  if (res.status === 413) return save({ state: "too_big", detail: { bytes }, lastHash: hash });
  if (res.status === 429) {
    // Try tomorrow: a library change before then doesn't bring the alarm forward.
    await chrome.alarms.clear(SYNC_ALARM);
    chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 24 * 60 });
    return save({ state: "limit", detail: null, dirty: true, lastHash: null });
  }
  if (res.status === 400) return save({ state: "invalid", detail: { reason: String(j.reason || "").slice(0, 200) }, lastHash: hash });
  await later();
  return save({ state: "busy", detail: null, dirty: true, lastHash: null });
}

// The invite ended: stop sending, and say when it ended if the account still answers.
async function ended() {
  await chrome.alarms.clear(SYNC_ALARM);
  let endedOn = "";
  try {
    const res = await call("/v1/account");
    if (res?.ok) endedOn = dayOf((await json(res)).trialEndsAt);
  } catch {}
  return save({ state: "ended", detail: endedOn ? { endedOn } : null, dirty: false });
}

const later = async () => { if (!(await chrome.alarms.get(SYNC_ALARM))) chrome.alarms.create(SYNC_ALARM, { delayInMinutes: SEND_EVERY_MIN }); };

/** A change to the library while on: send within 15 minutes, once. */
export async function libraryChanged() {
  const s = await load();
  if (!s.on || s.state === "ended") return;
  if (!s.dirty) await save({ dirty: true });
  await later();
}

export async function alarmFired() {
  const s = await load();
  if (s.on && s.dirty) await send();
}

// True when the server couldn't be reached (or there was no token to reach it with).
async function forget(path, method) {
  try { return !(await call(path, { method })); } catch { return true; }
}

/** Turn off: the Chrome copy is deleted, this Chrome signs out, the optional permissions go. The
 * tokens are dropped here even when the server can't be reached. */
export async function turnOff() {
  const a = await forget("/v1/library/chrome", "DELETE");
  const b = await forget("/v1/account/sign-out", "POST");
  await signedOut("off", a || b ? { reason: "offline" } : null);
  try { await chrome.permissions.remove(OPTIONAL); } catch {}
  return load();
}

/** Delete the account and everything the server keeps. Offline, nothing changes here: the person can
 * try again while still signed in. */
export async function deleteAccount() {
  if (await forget("/v1/account", "DELETE")) {
    if (!(await load()).on) return load();
    return save({ detail: { reason: "offline" } });
  }
  await signedOut("off");
  try { await chrome.permissions.remove(OPTIONAL); } catch {}
  return load();
}

/** What the settings page shows: never the tokens or the hash. */
export async function status() {
  const { access: _a, refresh: _r, expiresAt: _e, lastHash: _h, ...shown } = await load();
  return shown;
}

export const isLibraryChange = (changes, area) => area === "local" && LIBRARY_KEYS.some((k) => k in (changes || {}));
