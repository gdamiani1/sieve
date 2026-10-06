// Offline: the pure part of sending the library to the agent. No keys, no network.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  SERVER, CLIENT_ID, CHROME_ID, pkcePair, authorizeUrl, readCallback, tokenForm, refreshForm, readTokens,
  libraryBody, libraryHash, words, MAX_BODY,
} from "../agent-sync.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

assert.equal(SERVER, "https://mcp.divergada.com");
assert.equal(CLIENT_ID, "https://mcp.divergada.com/clients/chrome.json");

// PKCE: a 64-character verifier and its S256 challenge (RFC 7636 appendix B vector).
const { verifier, challenge } = await pkcePair();
assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
assert.equal((await pkcePair("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

// The /authorize URL.
const u = new URL(authorizeUrl({ redirect: "https://abc.chromiumapp.org/", challenge: "C", state: "S", device: "0b3e2c1a-1111-2222-3333-444455556666", provider: "google" }));
assert.equal(u.origin + u.pathname, "https://mcp.divergada.com/authorize");
assert.deepEqual(Object.fromEntries(u.searchParams), {
  response_type: "code", client_id: CLIENT_ID, redirect_uri: "https://abc.chromiumapp.org/", code_challenge: "C",
  code_challenge_method: "S256", state: "S", scope: "account library", provider: "google", device: "0b3e2c1a-1111-2222-3333-444455556666",
});

// The callback.
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?code=K&state=S", "S"), { code: "K" });
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?code=K&state=X", "S"), { error: "state" });
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?error=access_denied&error_description=new_accounts_closed&state=S", "S"), { error: "not_invited" });
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?error=access_denied&state=S", "S"), { error: "denied" });
assert.deepEqual(readCallback("not a url", "S"), { error: "denied" });
assert.deepEqual(readCallback("https://abc.chromiumapp.org/#code=K&state=S", "S"), { error: "state" }, "the server answers in the query, never the fragment");
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?code=K", "S"), { error: "state" }, "a code with no state");
assert.deepEqual(readCallback("https://abc.chromiumapp.org/?code=K&state=S&iss=https%3A%2F%2Fevil.example", "S"), { error: "denied" }, "a foreign issuer");
assert.deepEqual(readCallback(`https://abc.chromiumapp.org/?code=K&state=S&iss=${encodeURIComponent(SERVER)}`, "S"), { code: "K" });
const full = { redirect: "R", challenge: "C", state: "S", device: "D" };
for (const k of Object.keys(full)) assert.throws(() => authorizeUrl({ ...full, [k]: "" }), undefined, `authorizeUrl needs ${k}`);
assert.throws(() => authorizeUrl(), undefined);

// Token requests and answers.
assert.equal(tokenForm({ code: "K", verifier: "V", redirect: "R" }).toString(), new URLSearchParams({ grant_type: "authorization_code", code: "K", redirect_uri: "R", client_id: CLIENT_ID, code_verifier: "V" }).toString());
assert.equal(refreshForm("RT").toString(), new URLSearchParams({ grant_type: "refresh_token", refresh_token: "RT", client_id: CLIENT_ID }).toString());
assert.deepEqual(readTokens({ access_token: "A", refresh_token: "B", expires_in: 3600 }, 1000), { access: "A", refresh: "B", expiresAt: 1000 + 3600e3 - 60e3 });
assert.equal(readTokens({ access_token: "A" }, 1000), null, "no refresh token");
assert.equal(readTokens(null, 1000), null);
assert.equal(readTokens({ access_token: "", refresh_token: "B" }, 1000), null, "empty access");
assert.equal(readTokens({ access_token: "A", refresh_token: "" }, 1000), null, "empty refresh");
for (const bad of [0, -5, "3600", NaN, undefined]) assert.equal(readTokens({ access_token: "A", refresh_token: "B", expires_in: bad }, 0).expiresAt, 3540e3, `expires_in ${String(bad)} falls back to an hour`);
assert.equal(readTokens({ access_token: "A", refresh_token: "B", expires_in: 30 }, 0).expiresAt, 15e3, "a short life is never already over");

// The library body: the export's items, ids under chrome:, no digests, odd ids left out and counted.
const data = {
  saved: [
    { key: "123", platform: "linkedin", authorName: "Lena", text: "Golden sets", kind: "technique", savedAt: Date.UTC(2026, 9, 5) },
    { key: "a b", platform: "x", authorName: "Odd", text: "space in the key", savedAt: Date.UTC(2026, 9, 4) },
  ],
  digests: [{ at: 1, since: 0, count: 1, text: "d" }],
};
const { body, left } = libraryBody(data, Date.UTC(2026, 9, 6));
assert.equal(body.format, "sieve-library");
assert.equal(body.version, 1);
assert.equal(body.exportedAt, "2026-10-06T00:00:00.000Z");
assert.deepEqual(body.items.map((i) => i.id), ["chrome:123"]);
assert.equal(MAX_BODY, 8 * 1024 * 1024);
assert.equal(libraryBody(data, Date.UTC(2026, 9, 6)).json, JSON.stringify(body));
assert.equal(libraryBody(data, Date.UTC(2026, 9, 6)).bytes, new TextEncoder().encode(JSON.stringify(body)).length);
// Always one prefix: an id that already starts with chrome: is prefixed again, one to one.
assert.deepEqual(libraryBody({ saved: [{ key: "chrome:1", platform: "linkedin", text: "t" }] }).body.items.map((i) => i.id), ["chrome:chrome:1"]);
// Missing or malformed data gives an empty library, not a throw.
for (const bad of [undefined, null, 5, "x", [], { saved: "no", watched: 3, briefs: [] }]) {
  const r = libraryBody(bad, 0);
  assert.deepEqual(r.body.items, []); assert.equal(r.left, 0); assert.equal(typeof r.json, "string");
}
assert.equal(left, 1);
assert.equal("digests" in body, false);
assert.ok(body.items.every((i) => CHROME_ID.test(i.id)));

// The hash ignores exportedAt, so an unchanged library isn't sent again.
const again = libraryBody(data, Date.UTC(2026, 9, 7)).body;
assert.equal(await libraryHash(body), await libraryHash(again));
const changed = libraryBody({ ...data, saved: [{ ...data.saved[0], topic: "Evals" }] }, Date.UTC(2026, 9, 6)).body;
assert.notEqual(await libraryHash(body), await libraryHash(changed));

// Words, from the stored record: { state, email, lastAt, lastItems, detail }.
assert.equal(words({ state: "off" }), "Your coding agent can read what you save here and on iPhone. Invite-only for now.");
assert.equal(words({ state: "not_invited" }), "Sending your library to your agent is invite-only for now.");
assert.equal(words({ state: "on", email: "a@b.co", lastAt: null }), "Sending to your agent as a@b.co. Not sent yet.");
assert.match(words({ state: "on", email: "a@b.co", lastAt: Date.UTC(2026, 9, 6, 10, 42), lastItems: 63 }), /^Sending to your agent as a@b\.co\. Last sent .+, 63 items\.$/);
assert.match(words({ state: "on", email: "a@b.co", lastAt: Date.UTC(2026, 9, 6, 10, 42), lastItems: 1 }), /, 1 item\.$/);
const noItems = words({ state: "on", email: "a@b.co", lastAt: Date.UTC(2026, 9, 6, 10, 42) });
assert.match(noItems, /, 0 items\.$/); assert.doesNotMatch(noItems, /undefined/);
assert.equal(words({ state: "ended", detail: { endedOn: "10 November" } }), "Your invite ended on 10 November. Your agent no longer reads this library.");
assert.equal(words({ state: "ended" }), "Your invite ended. Your agent no longer reads this library.");
assert.equal(words({ state: "other_device" }), "Another Chrome already sends its library to this account.");
assert.equal(words({ state: "shrunk", detail: { stored: 40, count: 3 } }), "Your agent's copy has 40 pins and this Chrome has 3 pins. Send anyway?");
assert.equal(words({ state: "shrunk", detail: { stored: 1, count: 0 } }), "Your agent's copy has 1 pin and this Chrome has 0 pins. Send anyway?");
assert.equal(words({ state: "older" }), "This computer's clock is behind the copy your agent has. Check the date and time, then send again.");
assert.equal(words({ state: "busy" }), "Couldn't reach Sieve's server. Sieve tries again in 15 minutes.");
assert.equal(words({ state: "limit" }), "Sieve sent as many times as it may today. It tries again tomorrow.");
assert.equal(words({ state: "invalid", detail: { reason: "x" } }), "Sieve's server refused the library: x");
assert.equal(words({ state: "invalid" }), "Sieve's server refused the library.");
assert.equal(words({ state: "signed_out" }), "This Chrome was signed out. Turn sync on again to keep sending.");
assert.equal(words({ state: "no_permission" }), "Sieve needs that permission to send your library.");
assert.equal(words({ state: "too_big", detail: { bytes: 9.26 * 1024 * 1024 } }), "Your library is too big to send (9.3 MB; the limit is 8 MB).");
// Turned off, but the server didn't confirm the delete and sign-out.
const mayRemain = "Turned off here, but your agent's copy may still be on Sieve's server. Turn on and off again to delete it.";
assert.equal(words({ state: "off", detail: { reason: "offline" } }), mayRemain);
assert.equal(words({ state: "off", detail: { reason: "server" } }), mayRemain);
// Something unexpected, in any state: no promise of a retry.
for (const state of ["off", "on", "busy", "signed_out", "not_invited", "ended"]) {
  assert.equal(words({ state, email: "a@b.co", detail: { reason: "error" } }), "Something went wrong. Try again.", `error words for ${state}`);
}
assert.equal(words({ state: "invalid", detail: { reason: "error" } }), "Sieve's server refused the library: error", "the server's own reason stays");
assert.equal(words({ state: "nonsense" }), "");
assert.equal(words(undefined), "");
assert.equal(words({}), "");
const all = [{ state: "off" }, { state: "not_invited" }, { state: "on", email: "a@b.co", lastAt: 1, lastItems: 2 }, { state: "on", email: "a@b.co" },
  { state: "ended", detail: { endedOn: "1 Nov" } }, { state: "other_device" }, { state: "shrunk", detail: { stored: 4, count: 1 } }, { state: "older" },
  { state: "busy" }, { state: "limit" }, { state: "invalid", detail: { reason: "x" } }, { state: "invalid" }, { state: "signed_out" },
  { state: "no_permission" }, { state: "too_big", detail: { bytes: 9e6 } }];
for (const s of all) assert.doesNotMatch(words(s), /—|undefined|NaN/, `clean words for ${s.state}`);

// The manifest: identity and the server are optional, asked on Turn on, so an update shows no prompt.
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
assert.deepEqual(manifest.optional_permissions, ["identity"]);
assert.deepEqual(manifest.optional_host_permissions, ["https://mcp.divergada.com/*"]);
assert.ok(!manifest.permissions.includes("identity"), "never a required permission: no prompt on update");
assert.ok(!manifest.host_permissions.some((h) => h.includes("divergada")), "never a required host");

console.log("agent_sync_test: ok");
