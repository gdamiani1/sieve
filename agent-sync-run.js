// Sending the library to the developer's coding agent, the Chrome part (extension library sync spec
// 5.2, 5.3): sign-in with launchWebAuthFlow, tokens in chrome.storage.local (never sync), and sends to
// PUT /v1/library/chrome, batched by an alarm. Imported by background.js only: the settings page asks
// the worker, so there is one place that refreshes tokens. The pure part is agent-sync.js.
//
// One record in chrome.storage.local, `agentSync`:
//   { on, gen, email, device, access, refresh, expiresAt, dirty, changes, lastHash, lastAt, lastItems,
//     state, detail }
// `state` is one of the states agent-sync.js words() knows; `detail` holds that state's numbers
// ({ stored, count, reason, endedOn, bytes }). `gen` is new at every sign-in: anything that finishes
// after an await writes only if the record is still on with the same `gen`, so a late answer can't
// bring back a session that was turned off. `changes` counts library changes, so a send clears
// `dirty` only when nothing changed while it was out. Tokens, the hash and `gen` never leave the
// worker (status()).
import {
  MAX_BODY, SERVER, SEND_EVERY_MIN, authorizeUrl, libraryBody, libraryHash, pkcePair, randomState, readCallback, readTokens, refreshForm, tokenForm,
} from "./agent-sync.js";

export const SYNC_ALARM = "agent-sync";
const KEY = "agentSync";
const LIBRARY_KEYS = ["saved", "watched", "briefs"];
export const OPTIONAL = { permissions: ["identity"], origins: [`${SERVER}/*`] };
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const TIMEOUT = 60e3;
const PUT_TIMEOUT = 120e3;

// Every request can time out; a timeout throws like a network that's down.
const net = (path, init = {}, ms = TIMEOUT) => fetch(`${SERVER}${path}`, { ...init, signal: AbortSignal.timeout(ms) });

// Every write to the record goes through one queue, so two writes can't lose each other's changes.
let writes = Promise.resolve();
const load = async () => (await chrome.storage.local.get(KEY))[KEY] || {};
const write = (fn) => {
  const run = writes.then(async () => {
    const before = await load();
    const next = await fn(before);
    if (next !== before) await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  writes = run.catch(() => {});
  return run;
};
const save = (patch) => write((s) => ({ ...s, ...patch }));
const live = (s, gen) => !!s.on && s.gen === gen;
// A write for the sign-in `gen` only: a no-op once that session is off or replaced. True if it applied.
const saveFor = async (gen, patch) => {
  let applied = false;
  await write((s) => {
    if (!live(s, gen)) return s;
    applied = true;
    return { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
  });
  return applied;
};

const device = async () => (await load()).device || (await write((s) => (s.device ? s : { ...s, device: crypto.randomUUID().toLowerCase() }))).device;

// Signed out: only the device id stays (the server knows this Chrome by it).
const offRecord = (s, state, detail) => ({ on: false, ...(s.device ? { device: s.device } : {}), state, ...(detail ? { detail } : {}) });
const signedOut = async (state, detail = null) => {
  const next = await write((s) => offRecord(s, state, detail));
  await chrome.alarms.clear(SYNC_ALARM);
  return next;
};
// An off record with one of these reasons says the agent's copy may still be on the server (words()).
const MAY_REMAIN = ["offline", "server"];
const keptReason = (s, detail) => (!s.on && MAY_REMAIN.includes(s.detail?.reason) ? s.detail : detail);

// A sign-in that didn't finish: a session that's already on carries on; otherwise off (or not
// invited), keeping a copy-may-remain reason rather than overwriting it.
const signInFailed = async (state, detail = null) => {
  if ((await load()).on) return load();
  return write((s) => offRecord(s, state, keptReason(s, detail)));
};

// Signed out by the server (a refused refresh or token), only if that session is still the live one.
const signedOutFor = async (gen) => {
  let applied = false;
  await write((s) => { if (!live(s, gen)) return s; applied = true; return offRecord(s, "signed_out"); });
  if (applied) await chrome.alarms.clear(SYNC_ALARM);
};

// One refresh at a time: a second caller waits for the first one's answer. A refused refresh signs
// this Chrome out; a server that can't be reached leaves everything as it was. The last tokens a
// refresh got are kept here too, so Turn off can sign out with them after it dropped the record's.
let refreshing = null;
let refreshed = null; // { gen, access }
async function refresh(s) {
  const { gen } = s;
  let res;
  try { res = await net("/token", { method: "POST", headers: FORM, body: refreshForm(s.refresh).toString() }); } catch { return null; }
  let t = null;
  if (res.ok) { try { t = readTokens(await res.json()); } catch {} }
  if (!t) {
    if (res.status >= 400 && res.status < 500) await signedOutFor(gen);
    return null;
  }
  refreshed = { gen, access: t.access };
  return (await saveFor(gen, t)) ? t.access : null;
}

/** This Chrome's access token, refreshed when it has expired (or `stale`). Null when signed out or
 * the server can't be reached. */
export async function accessToken({ stale = false } = {}) {
  const s = await load();
  if (!s.on || !s.refresh) return null;
  if (!stale && s.access && Date.now() < s.expiresAt) return s.access;
  refreshing ??= (async () => {
    try {
      const now = await load();
      if (!live(now, s.gen) || !now.refresh) return null;
      // Another caller refreshed while this one waited.
      if (now.access && now.access !== s.access && Date.now() < now.expiresAt) return now.access;
      return await refresh(now);
    } finally { refreshing = null; }
  })();
  return refreshing;
}

const authed = async (token, init) => ({ ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "X-Sieve-Device": await device() } });

/** A /v1 request with this Chrome's token and device. Null when there is no token to send (signed out,
 * or the refresh couldn't reach the server). A 401 or 404 (a token the server no longer takes, or one
 * for another app) gets one fresh token and one more try; a second one signs this Chrome out. Throws
 * when the network is down or the request times out. */
async function call(path, init = {}, ms = TIMEOUT) {
  const { gen } = await load();
  const token = await accessToken();
  if (!token) return null;
  const res = await net(path, await authed(token, init), ms);
  if (res.status !== 401 && res.status !== 404) return res;
  const fresh = await accessToken({ stale: true });
  if (!fresh) return null;
  const again = await net(path, await authed(fresh, init), ms);
  if (again.status === 401 || again.status === 404) { await signedOutFor(gen); return null; }
  return again;
}

const json = async (res) => { try { return (await res.json()) || {}; } catch { return {}; } };

// "10 November": the day the invite ends, in UTC like the server's trialEndsAt.
const dayOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
};

/** Turn on: sign in, then send at once. The settings page has already been granted OPTIONAL. A second
 * Turn on while the first is still signing in joins it: one sign-in window. */
let turningOn = null;
export function turnOn(provider = "google") {
  turningOn ??= signIn(provider).finally(() => { turningOn = null; });
  return turningOn;
}

async function signIn(provider) {
  if (!chrome.identity?.launchWebAuthFlow) {
    // Without the permission there's no sign-in; a session that's already on carries on.
    if ((await load()).on) return load();
    return signedOut("no_permission");
  }
  const d = await device();
  const redirect = chrome.identity.getRedirectURL();
  const { verifier, challenge } = await pkcePair();
  const state = randomState();
  let back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl({ redirect, challenge, state, device: d, provider }), interactive: true });
  } catch {
    return signInFailed("off"); // the person closed the sign-in window
  }
  const cb = readCallback(back, state);
  if (cb.error) return signInFailed(cb.error === "not_invited" ? "not_invited" : "off");
  let t = null;
  try {
    const res = await net("/token", { method: "POST", headers: FORM, body: tokenForm({ code: cb.code, verifier, redirect }).toString() });
    if (res.ok) t = readTokens(await json(res));
  } catch {}
  // A sign-in that failed at the last step: "error" (try again), not "offline", which on an off record
  // means a copy may remain on the server.
  if (!t) return signInFailed("off", { reason: "error" });
  // Turn on while already on: the old session signs out first (best effort), then is replaced.
  const old = await load();
  if (old.on) await ask("/v1/account/sign-out", "POST", await tokenOf(old));
  const gen = crypto.randomUUID();
  await write((s) => ({ device: s.device, on: true, gen, ...t, state: "on", dirty: true, changes: 0 }));
  try {
    const res = await call("/v1/account");
    if (res?.ok) {
      const email = (await json(res)).email;
      if (typeof email === "string") await saveFor(gen, { email });
    }
  } catch {}
  return send({ force: true });
}

// The sign-in being deleted, if a delete is out. In memory only: a delete can't outlive its worker.
let deletingGen = null;

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

const later = async () => { if (!(await chrome.alarms.get(SYNC_ALARM))) chrome.alarms.create(SYNC_ALARM, { delayInMinutes: SEND_EVERY_MIN }); };

async function sendOnce({ force = false, allowShrink = false, replace = false } = {}) {
  const s = await load();
  if (!s.on || s.state === "ended" || (deletingGen && deletingGen === s.gen)) return s;
  const { gen } = s;
  const changes = s.changes || 0;

  // A final answer: the server has this library (or the person must act). Not dirty, no alarm,
  // unless the library changed while this send was out.
  const final = async (patch) => {
    let clean = false;
    const applied = await saveFor(gen, (now) => {
      clean = (now.changes || 0) === changes;
      return { ...patch, ...(clean ? { dirty: false } : {}) };
    });
    if (applied && clean && patch.state !== "limit") await chrome.alarms.clear(SYNC_ALARM);
    return load();
  };
  // Try again at the next alarm. A send to be tried again forgets the last hash, so the retry really
  // sends even when the library hasn't changed since: the copy the server has may be older.
  const retry = async (patch) => {
    if (await saveFor(gen, { ...patch, dirty: true, lastHash: null })) await later();
    return load();
  };

  const { body, json: text, bytes } = libraryBody(await chrome.storage.local.get(LIBRARY_KEYS));
  const hash = await libraryHash(body);
  if (hash === s.lastHash && !force && !allowShrink && !replace) return final({});
  if (bytes > MAX_BODY) return final({ state: "too_big", detail: { bytes }, lastHash: hash });

  // A backstop: if the worker is stopped while the PUT is out, the change and the alarm survive.
  await saveFor(gen, { dirty: true });
  await later();

  const headers = { "Content-Type": "application/json" };
  if (allowShrink) headers["X-Sieve-Empty"] = "yes";
  if (replace) headers["X-Sieve-Replace"] = "yes";
  let res = null;
  try { res = await call("/v1/library/chrome", { method: "PUT", headers, body: text }, PUT_TIMEOUT); } catch {}
  if (!res) {
    if (!live(await load(), gen)) return load(); // signed out or turned off meanwhile
    return retry({ state: "busy", detail: null });
  }
  const j = await json(res);
  if (res.ok && (j.result === "stored" || j.result === "unchanged")) {
    return final({ state: "on", detail: null, lastHash: hash, lastAt: Date.now(), lastItems: body.items.length });
  }
  if (res.status === 403 && j.result === "ended") return ended(gen);
  if (res.status === 409 && (j.result === "empty" || j.result === "shrunk")) {
    return final({ state: "shrunk", detail: { stored: Number(j.storedItems) || 0, count: Number(j.items) || 0 } });
  }
  if (res.status === 409 && j.result === "other_device") return final({ state: "other_device", detail: null });
  if (res.status === 409 && j.result === "older") return final({ state: "older", detail: null });
  if (res.status === 413) return final({ state: "too_big", detail: { bytes }, lastHash: hash });
  if (res.status === 400) return final({ state: "invalid", detail: { reason: String(j.reason || "").slice(0, 200) }, lastHash: hash });
  if (res.status === 429) {
    // Try tomorrow: a library change before then doesn't bring the alarm forward.
    if (await saveFor(gen, { state: "limit", detail: null, dirty: true, lastHash: null })) {
      await chrome.alarms.clear(SYNC_ALARM);
      chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 24 * 60 });
    }
    return load();
  }
  return retry({ state: "busy", detail: null });
}

// The invite ended: stop sending, and say when it ended if the account still answers.
async function ended(gen) {
  let endedOn = "";
  try {
    const res = await call("/v1/account");
    if (res?.ok) endedOn = dayOf((await json(res)).trialEndsAt);
  } catch {}
  if (await saveFor(gen, { state: "ended", detail: endedOn ? { endedOn } : null, dirty: false })) await chrome.alarms.clear(SYNC_ALARM);
  return load();
}

/** A change to the library while on: send within 15 minutes, once. */
export async function libraryChanged() {
  let applied = false;
  await write((s) => {
    if (!s.on || s.state === "ended") return s;
    applied = true;
    return { ...s, dirty: true, changes: (s.changes || 0) + 1 };
  });
  if (applied) await later();
}

export async function alarmFired() {
  const s = await load();
  if (s.on && s.dirty) await send();
}

/** After a restart or an update: a change still waiting to be sent gets its alarm back. */
export async function wake() {
  const s = await load();
  if (s.on && s.dirty && s.state !== "ended") await later();
}

// The token a session had when it was turned off, for signing out: a refresh that finished after the
// record dropped its tokens counts too. Null when there's none that works.
async function tokenOf(prior) {
  if (refreshed?.gen === prior.gen) return refreshed.access;
  if (prior.access && Date.now() < prior.expiresAt) return prior.access;
  if (!prior.refresh) return null;
  try {
    const res = await net("/token", { method: "POST", headers: FORM, body: refreshForm(prior.refresh).toString() });
    return res.ok ? readTokens(await json(res))?.access || null : null;
  } catch { return null; }
}

// "offline" (no answer or no token), "server" (an answer that isn't a yes), or "" (done).
async function ask(path, method, token, done = (res) => res.ok) {
  if (!token) return "offline";
  try {
    const res = await net(path, await authed(token, { method }));
    return (await done(res)) ? "" : "server";
  } catch { return "offline"; }
}

/** Turn off: the tokens go here at once (the person asked to stop), then the Chrome copy is deleted
 * and this Chrome signs out with the token it had, and the optional permissions go. The off record
 * says "offline" from the start (the agent's copy may still be there) and loses it only when the
 * server says yes to both, so a worker stopped halfway leaves the honest answer behind. */
export async function turnOff() {
  let prior = {};
  await write((s) => {
    prior = s;
    // Signed out by the server, or turned off before without its yes: the copy is still there.
    const remains = s.on || s.state === "signed_out" || MAY_REMAIN.includes(s.detail?.reason);
    const reason = s.on || s.state === "signed_out" ? "offline" : s.detail?.reason;
    return offRecord(s, "off", remains ? { reason } : null);
  });
  await chrome.alarms.clear(SYNC_ALARM);
  // Let a send or a refresh that was already out finish first; neither writes once the record is off.
  await sending;
  await refreshing;
  if (prior.on) {
    const token = await tokenOf(prior);
    const a = await ask("/v1/library/chrome", "DELETE", token, async (res) => res.ok && (await json(res)).result === "deleted");
    const b = await ask("/v1/account/sign-out", "POST", token);
    const reason = a === "offline" || b === "offline" ? "offline" : a || b;
    await write((s) => {
      if (s.on) return s;
      const { detail: _d, ...rest } = s;
      return reason ? { ...rest, detail: { reason } } : rest;
    });
  }
  try { await chrome.permissions.remove(OPTIONAL); } catch {}
  return load();
}

/** Delete the account and everything the server keeps. Sends stop while it's out; if the server
 * can't be reached or says no, this Chrome stays signed in and `detail.reason` says why. */
export async function deleteAccount() {
  const s = await load();
  if (!s.on) return s;
  const { gen } = s;
  deletingGen = gen;
  let reason = "offline";
  try {
    await sending;
    try {
      const res = await call("/v1/account", { method: "DELETE" });
      if (res) reason = res.ok ? "" : "server";
    } catch {}
  } finally { if (deletingGen === gen) deletingGen = null; } // a newer delete may hold it now
  if (reason) {
    const now = await write((x) => {
      if (live(x, gen)) return { ...x, detail: { reason } };
      // The server refused this Chrome's token: signed out, and the account is still there.
      if (!x.on && x.state === "signed_out") return { ...x, detail: { reason: "server" } };
      return x;
    });
    if (live(now, gen) && now.dirty) await later();
    return now;
  }
  await signedOut("off");
  try { await chrome.permissions.remove(OPTIONAL); } catch {}
  return load();
}

/** Something unexpected went wrong while acting: say so instead of showing the old state as if fine. */
export const failed = () => write((s) => ({ ...s, state: s.state || "off", detail: keptReason(s, { reason: "error" }) }));

/** What the settings page shows: never the tokens, the hash or the sign-in's gen. */
export async function status() {
  const { access: _a, refresh: _r, expiresAt: _e, lastHash: _h, gen: _g, ...shown } = await load();
  return shown;
}

export const isLibraryChange = (changes, area) => area === "local" && LIBRARY_KEYS.some((k) => k in (changes || {}));
