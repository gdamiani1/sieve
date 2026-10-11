// Offline: Connect OpenRouter's pure part (openrouter-connect.js): the sign-in URL, reading the URL the
// window ended on, the code-for-key exchange, the key check, the whole flow and its words. Fake windows
// and a fake network; no keys.
import assert from "node:assert/strict";
import { pkcePair } from "../agent-sync.js";
import {
  AUTH_URL, CHECK_URL, EXCHANGE_URL, KEY_LABEL, checkKey, connectOpenRouter, connectUrl, connectWords, exchangeCode, readConnectCallback,
} from "../openrouter-connect.js";

const redirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/";
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "function" ? body() : body) });

// The sign-in URL: OpenRouter's auth page, the callback, an S256 challenge, the state and the key's label.
{
  const { challenge } = await pkcePair("v".repeat(50));
  const u = new URL(connectUrl({ redirect, challenge, state: "st8" }));
  assert.equal(`${u.origin}${u.pathname}`, AUTH_URL);
  assert.equal(u.searchParams.get("callback_url"), redirect);
  assert.equal(u.searchParams.get("code_challenge"), challenge);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "st8");
  assert.equal(u.searchParams.get("key_label"), KEY_LABEL);
  assert.equal(KEY_LABEL, "Sieve for Chrome");
  assert.equal([...u.searchParams.keys()].length, 5, "nothing else in the URL");
  assert.throws(() => connectUrl({ redirect, challenge }), /needs/);
}

// The callback: a code with the right state; anything else fails clearly.
{
  const opts = { redirect, state: "s1" };
  assert.deepEqual(readConnectCallback(`${redirect}?code=abc&state=s1`, opts), { code: "abc" });
  assert.deepEqual(readConnectCallback(`${redirect}?code=abc&state=s2`, opts), { error: "state" });
  assert.deepEqual(readConnectCallback(`${redirect}?code=abc`, opts), { error: "state" }, "a code without the state isn't taken");
  assert.deepEqual(readConnectCallback(`${redirect}?state=s1`, opts), { error: "denied" }, "no code");
  assert.deepEqual(readConnectCallback(`${redirect}?code=&state=s1`, opts), { error: "denied" }, "an empty code");
  assert.deepEqual(readConnectCallback(`${redirect}?error=access_denied`, opts), { error: "denied" }, "a no comes back without the state");
  assert.deepEqual(readConnectCallback(`${redirect}?error=access_denied&code=abc&state=s1`, opts), { error: "denied" });
  assert.deepEqual(readConnectCallback("not a url", opts), { error: "denied" });
  assert.deepEqual(readConnectCallback("https://elsewhere.example/?code=abc&state=s1", opts), { error: "denied" }, "another page");
  assert.deepEqual(readConnectCallback(`${redirect}#code=abc&state=s1`, opts), { error: "state" }, "only the query string counts");
}

// The exchange: one JSON POST with the code, the verifier and S256; the key back, or why not.
{
  const calls = [];
  const ok = await exchangeCode({ code: "c1", verifier: "v1" }, async (url, init) => { calls.push({ url, init }); return res(200, { key: "sk-or-v1-new" }); });
  assert.deepEqual(ok, { key: "sk-or-v1-new" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXCHANGE_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: "c1", code_verifier: "v1", code_challenge_method: "S256" });
  assert.ok(!calls[0].url.includes("c1"), "the code goes in the body, not the URL");

  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(403, { error: "invalid code" })), { error: "refused", status: 403 });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(400, {})), { error: "refused", status: 400 });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => { throw new TypeError("Failed to fetch"); }), { error: "unreachable" });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(200, {})), { error: "no_key" });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(200, { key: "" })), { error: "no_key" });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(200, { key: 42 })), { error: "no_key" });
  assert.deepEqual(await exchangeCode({ code: "c", verifier: "v" }, async () => res(200, () => { throw new SyntaxError("bad json"); })), { error: "no_key" });
}

// The key check is the pasted key's: GET /api/v1/key with the key as a bearer.
{
  const calls = [];
  assert.deepEqual(await checkKey("k1", async (url, init) => { calls.push({ url, init }); return res(200, {}); }), { ok: true });
  assert.equal(calls[0].url, CHECK_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer k1");
  assert.ok(!calls[0].init.method || calls[0].init.method === "GET");
  assert.deepEqual(await checkKey("k1", async () => res(401, {})), { status: 401 });
  assert.deepEqual(await checkKey("k1", async () => { throw new Error("down"); }), { unreachable: true });
}

// The whole flow, with a fake window and network.
const flow = async ({ window, net, saveFails = false } = {}) => {
  const saved = [];
  const steps = [];
  const urls = [];
  const pair = await pkcePair("w".repeat(50));
  const r = await connectOpenRouter({
    redirect, pair, state: "S",
    launch: async (url) => { urls.push(url); return window(url); },
    fetchFn: net,
    save: async (k) => { if (saveFails) throw new Error("quota"); saved.push(k); },
    onStep: (s) => steps.push(s),
  });
  return { r, saved, steps, urls, pair };
};
const goodNet = async (url) => (url === EXCHANGE_URL ? res(200, { key: "sk-or-v1-fresh" }) : res(200, {}));

{
  const { r, saved, steps, urls, pair } = await flow({ window: () => `${redirect}?code=C&state=S`, net: goodNet });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(saved, ["sk-or-v1-fresh"]);
  assert.deepEqual(steps, ["checking"]);
  assert.equal(new URL(urls[0]).searchParams.get("code_challenge"), pair.challenge);
  assert.equal(connectWords(r), "OpenRouter connected. Key saved.");
}
{
  const { r, saved } = await flow({ window: () => { throw new Error("The user did not approve access."); }, net: goodNet });
  assert.deepEqual(r, { error: "closed" });
  assert.deepEqual(saved, []);
  assert.equal(connectWords(r), "OpenRouter sign-in closed. Nothing saved.");
}
{
  const { r, saved, steps } = await flow({ window: () => `${redirect}?code=C&state=other`, net: async () => { throw new Error("no call expected"); } });
  assert.deepEqual(r, { error: "state" });
  assert.deepEqual(saved, []);
  assert.deepEqual(steps, []);
}
{
  const { r } = await flow({ window: () => `${redirect}?error=access_denied`, net: goodNet });
  assert.deepEqual(r, { error: "denied" });
}
{
  const { r, saved } = await flow({ window: () => `${redirect}?code=C&state=S`, net: async () => res(403, {}) });
  assert.deepEqual(r, { error: "refused", status: 403 });
  assert.deepEqual(saved, []);
  assert.equal(connectWords(r), "OpenRouter said 403, so no key was made. Try again.");
}
{
  const { r, saved } = await flow({ window: () => `${redirect}?code=C&state=S`, net: async (url) => (url === EXCHANGE_URL ? res(200, { key: "sk-or-v1-x" }) : res(401, {})) });
  assert.deepEqual(r, { error: "key_refused", status: 401 });
  assert.deepEqual(saved, [], "a key that fails the check isn't saved");
}
{
  const { r } = await flow({ window: () => `${redirect}?code=C&state=S`, net: async (url) => { if (url === EXCHANGE_URL) return res(200, { key: "sk-or-v1-x" }); throw new Error("down"); } });
  assert.deepEqual(r, { error: "key_unreachable" });
}
{
  const { r } = await flow({ window: () => `${redirect}?code=C&state=S`, net: goodNet, saveFails: true });
  assert.deepEqual(r, { error: "not_saved" });
}

// Every word: plain, no em dash, and none says the key.
for (const e of ["closed", "denied", "state", "refused", "unreachable", "no_key", "key_refused", "key_unreachable", "not_saved", "no_permission", "no_window", "other"]) {
  const w = connectWords({ error: e, status: 403 });
  assert.ok(w && !w.includes("—"), `${e}: ${w}`);
  assert.ok(!/sk-or/.test(w));
}
assert.match(connectWords({ error: "no_permission" }), /Paste a key instead/);

// ---- The settings page: Start here's Connect OpenRouter button, through the options-page harness.
const { REDIRECT, page, tick, visible } = await import("./options-page.mjs");
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const stateOf = (url) => new URL(url).searchParams.get("state");

// With no key: Start here shows the button as step 1, the paste fallback, and the credit and cost sentence.
{
  const { $ } = await page({ record: {} });
  assert.ok(visible($("start")));
  const steps = $("start").querySelectorAll("li");
  assert.equal(steps.length, 3);
  assert.ok(steps[0].textContent.includes("Connect OpenRouter"));
  assert.equal($("connectOr").textContent, "Connect OpenRouter");
  assert.ok($("connectOr").classList.contains("primary"));
  assert.equal($("pasteKey").textContent, "Paste a key instead");
  assert.match(steps[1].textContent, /few dollars of credit/);
  assert.match(steps[1].textContent, /3 to 5 US cents per 1,000 posts/);
  assert.equal($("connectMsg").getAttribute("role"), "status");
  assert.equal($("connectMsg").textContent, "");
  assert.ok($("saveKeys").classList.contains("secondary") && !$("saveKeys").classList.contains("primary"), "one filled blue button at a time");
}
{
  const { $ } = await page({ record: {}, store: { orKey: "k" } });
  assert.ok(!visible($("start")));
  assert.ok($("saveKeys").classList.contains("primary") && !$("saveKeys").classList.contains("secondary"));
}

// Paste a key instead: focus goes to the OpenRouter key field.
{
  const { $, doc, asked } = await page({ record: {} });
  $("pasteKey").click();
  assert.equal(doc.activeElement, $("orkey"));
  assert.equal(asked.length, 0, "no permission asked for pasting");
}

// Permission refused: no window, nothing saved, a sentence pointing to paste.
{
  const { $, asked, sets, launched } = await page({ record: {}, granted: false, launch: async () => { throw new Error("never"); } });
  $("connectOr").click();
  await settle();
  assert.deepEqual(asked.map((a) => a.p), [{ permissions: ["identity"] }], "only identity is asked for");
  assert.equal(launched.length, 0);
  assert.deepEqual(sets, []);
  assert.equal($("connectMsg").textContent, "Chrome didn't allow the sign-in window. Nothing saved. Paste a key instead.");
  assert.ok($("connectMsg").classList.contains("alert"));
  assert.equal($("connectOr").disabled, false);
  assert.ok(visible($("start")));
}

// The window closed: a calm sentence, nothing saved, the permission given back.
{
  const { $, sets, launched, removed, fetched } = await page({ record: {}, launch: async () => { throw new Error("The user did not approve access."); } });
  $("connectOr").click();
  await settle();
  assert.equal(launched.length, 1);
  assert.equal(launched[0].interactive, true);
  assert.ok(launched[0].url.startsWith("https://openrouter.ai/auth?"));
  assert.equal(new URL(launched[0].url).searchParams.get("callback_url"), REDIRECT);
  assert.deepEqual(sets, []);
  assert.deepEqual(fetched, []);
  assert.equal($("connectMsg").textContent, "OpenRouter sign-in closed. Nothing saved.");
  assert.ok(!$("connectMsg").classList.contains("alert"));
  assert.deepEqual(removed, [{ permissions: ["identity"] }]);
  assert.ok(visible($("start")));
}

// Success: the code is exchanged, the key checked like a pasted one, saved as orKey; Start here goes and
// the keys line says so. The button is disabled while it runs, so a second click starts nothing.
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const { $, store, launched, fetched, removed } = await page({
    record: {},
    launch: async ({ url }) => { await gate; return `${REDIRECT}?code=CODE1&state=${stateOf(url)}`; },
    net: async (url) => (url === EXCHANGE_URL ? res(200, { key: "sk-or-v1-made" }) : res(200, {})),
  });
  $("connectOr").click();
  await settle();
  assert.equal($("connectOr").disabled, true);
  assert.equal($("connectMsg").textContent, "Waiting for OpenRouter…");
  $("connectOr").click();
  await settle();
  assert.equal(launched.length, 1, "a second click while running opens no second window");
  release();
  await settle();
  assert.deepEqual(fetched.map((f) => f.url), [EXCHANGE_URL, CHECK_URL]);
  assert.deepEqual(JSON.parse(fetched[0].init.body).code, "CODE1");
  assert.equal(fetched[1].init.headers.Authorization, "Bearer sk-or-v1-made");
  assert.equal(store.orKey, "sk-or-v1-made");
  assert.equal($("start").hidden, true, "Start here goes once the key is saved");
  assert.equal($("keyMsg").textContent, "OpenRouter connected. Key saved.");
  assert.ok($("keyMsg").classList.contains("good"));
  assert.equal($("connectOr").disabled, false);
  assert.equal($("orkey").value, "", "the key never shows in the field");
  assert.deepEqual(removed, [{ permissions: ["identity"] }]);
}

// Your agent on: the identity permission stays, since it needs it too.
{
  const { $, removed } = await page({
    record: {}, store: { agentSync: { on: true } },
    launch: async ({ url }) => `${REDIRECT}?code=C&state=${stateOf(url)}`,
    net: async (url) => (url === EXCHANGE_URL ? res(200, { key: "sk-or-v1-made" }) : res(200, {})),
  });
  $("connectOr").click();
  await settle();
  assert.equal($("keyMsg").textContent, "OpenRouter connected. Key saved.");
  assert.deepEqual(removed, []);
}

// A refused exchange or a key that fails the check: said, nothing saved, Start here stays.
{
  const { $, store } = await page({
    record: {},
    launch: async ({ url }) => `${REDIRECT}?code=C&state=${stateOf(url)}`,
    net: async () => res(403, {}),
  });
  $("connectOr").click();
  await settle();
  assert.equal(store.orKey, undefined);
  assert.equal($("connectMsg").textContent, "OpenRouter said 403, so no key was made. Try again.");
  assert.ok($("connectMsg").classList.contains("alert"));
  assert.ok(visible($("start")));
}

// A pasted key still goes through the same check.
{
  const { $, store, fetched } = await page({ record: {}, net: async () => res(200, {}) });
  $("orkey").value = "sk-or-v1-pasted";
  $("saveKeys").click();
  await settle();
  assert.equal(fetched[0].url, CHECK_URL);
  assert.equal(store.orKey, "sk-or-v1-pasted");
  assert.equal($("keyMsg").textContent, "OpenRouter key saved");
}

console.log("openrouter_connect_test: ok");
