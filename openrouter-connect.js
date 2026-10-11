// Connect OpenRouter: OpenRouter's OAuth PKCE flow gives Sieve a key of the person's own, stored
// exactly where a pasted key goes (orKey). The settings page runs it (options.js): the permission, the
// sign-in window and the words. Everything here takes its window and network as arguments, so it is
// tested offline (test/openrouter_connect_test.mjs). Never log the key or the code.
// OpenRouter makes the key at the exchange: a tab closed between the exchange and the save leaves a
// "Sieve for Chrome" key on the person's OpenRouter account that Sieve never stored.
import { pkcePair, randomState } from "./agent-sync.js";

export const AUTH_URL = "https://openrouter.ai/auth";
export const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
export const CHECK_URL = "https://openrouter.ai/api/v1/key";
export const KEY_LABEL = "Sieve for Chrome";
const TIMEOUT = 60e3;

/** Where the sign-in window opens: OpenRouter knows the app by its callback URL, no client id. */
export function connectUrl({ redirect, challenge, state } = {}) {
  if (!redirect || !challenge || !state) throw new Error("connectUrl needs redirect, challenge and state");
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    callback_url: redirect, code_challenge: challenge, code_challenge_method: "S256", key_label: KEY_LABEL, state,
  }).toString();
  return u.href;
}

/** The URL the window ended on: { code }, or { error: "denied" | "state" }. OpenRouter leaves `state`
 * out when the person says no, so an error is read before the state is compared. */
export function readConnectCallback(href, { redirect, state } = {}) {
  let u;
  try { u = new URL(href); } catch { return { error: "denied" }; }
  if (redirect && `${u.origin}${u.pathname}` !== new URL(redirect).href.replace(/[?#].*$/, "")) return { error: "denied" };
  const p = u.searchParams;
  if (p.has("error")) return { error: "denied" };
  if (p.get("state") !== state) return { error: "state" };
  const code = p.get("code");
  return code ? { code } : { error: "denied" };
}

const timed = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** The code and verifier for a key: { key }, or { error: "refused", status } | { error: "unreachable" }
 * | { error: "no_key" }. Codes are single-use and last 10 minutes. */
export async function exchangeCode({ code, verifier }, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: timed(TIMEOUT),
    });
  } catch { return { error: "unreachable" }; }
  if (!res || !res.ok) return { error: "refused", status: res?.status ?? 0 };
  let j = null;
  try { j = await res.json(); } catch {}
  const key = typeof j?.key === "string" ? j.key.trim() : "";
  return key ? { key } : { error: "no_key" };
}

/** A key checked the way a pasted one is (GET /api/v1/key): { ok: true }, or { status } | { unreachable: true }. */
export async function checkKey(key, fetchFn = fetch) {
  const r = await fetchFn(CHECK_URL, { headers: { Authorization: `Bearer ${key}` }, signal: timed(TIMEOUT) }).catch(() => null);
  if (!r) return { unreachable: true };
  return r.ok ? { ok: true } : { status: r.status };
}

/**
 * The whole flow after the permission: the window, the callback, the exchange, the check and the save.
 * launch(url) resolves to the URL the window ended on and throws when the person closes it. save(key)
 * stores it (and may throw). onStep("checking") says the window is done. Resolves to { ok: true }
 * ({ ok: true, unchecked: true } when OpenRouter didn't answer the check) or { error, status? }, which
 * connectWords() puts into words. The check is tried twice, `retryMs` apart: the key was just made, so a
 * check that can't reach OpenRouter saves it anyway (the scorer says so later if it's bad) rather than
 * leave it on the account unused.
 */
export async function connectOpenRouter({ launch, redirect, save, fetchFn = fetch, onStep = () => {}, pair, state = randomState(), retryMs = 1000 }) {
  const { verifier, challenge } = pair || await pkcePair();
  let back;
  try { back = await launch(connectUrl({ redirect, challenge, state })); } catch { return { error: "closed" }; }
  if (!back) return { error: "closed" };
  const cb = readConnectCallback(back, { redirect, state });
  if (cb.error) return cb;
  onStep("checking");
  const ex = await exchangeCode({ code: cb.code, verifier }, fetchFn);
  if (ex.error) return ex;
  let c = await checkKey(ex.key, fetchFn);
  if (!c.ok) {
    await new Promise((r) => setTimeout(r, retryMs));
    c = await checkKey(ex.key, fetchFn);
  }
  if (!c.ok && !c.unreachable) return { error: "key_refused", status: c.status };
  try { await save(ex.key); } catch { return { error: "not_saved" }; }
  return c.ok ? { ok: true } : { ok: true, unchecked: true };
}

/** What the settings page says for a result. */
export function connectWords(r) {
  if (r?.ok && r.unchecked) return "OpenRouter connected. Key saved, but OpenRouter didn't answer when Sieve checked it. If posts don't get scored, connect again or paste a key.";
  if (r?.ok) return "OpenRouter connected. Key saved.";
  switch (r?.error) {
    case "closed": return "OpenRouter sign-in ended before a key was made. Nothing saved. If you just made an OpenRouter account, press Connect OpenRouter again.";
    case "denied": return "OpenRouter didn't give Sieve a key. Nothing saved.";
    case "state": return "That sign-in didn't start on this page. Nothing saved. Try again.";
    case "refused": return `OpenRouter said ${r.status || "no"}, so no key was made. Try again.`;
    case "unreachable": return "OpenRouter unreachable. Nothing saved. Try again.";
    case "no_key": return "OpenRouter didn't send a key. Nothing saved. Try again.";
    case "key_refused": return `OpenRouter said ${r.status || "no"} to the new key, so it wasn't saved. A leftover "Sieve for Chrome" key may be at openrouter.ai/keys: you can delete it there. Try again.`;
    case "not_saved": return "Sieve couldn't save the key in this browser. Try again.";
    case "no_permission": return "Sign-in needs Chrome's permission, which wasn't given. Nothing saved. Paste a key instead.";
    case "no_window": return "Chrome couldn't open the sign-in window. Reload this page and try again, or paste a key instead.";
    default: return "Something went wrong. Nothing saved. Try again.";
  }
}
