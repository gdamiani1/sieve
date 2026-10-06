// Offline: the pure part of sending the library to the agent. No keys, no network.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  SERVER, CLIENT_ID, CHROME_ID, pkcePair, authorizeUrl, readCallback, tokenForm, refreshForm, readTokens,
  libraryBody, libraryHash, words,
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

// Token requests and answers.
assert.equal(tokenForm({ code: "K", verifier: "V", redirect: "R" }).toString(), new URLSearchParams({ grant_type: "authorization_code", code: "K", redirect_uri: "R", client_id: CLIENT_ID, code_verifier: "V" }).toString());
assert.equal(refreshForm("RT").toString(), new URLSearchParams({ grant_type: "refresh_token", refresh_token: "RT", client_id: CLIENT_ID }).toString());
assert.deepEqual(readTokens({ access_token: "A", refresh_token: "B", expires_in: 3600 }, 1000), { access: "A", refresh: "B", expiresAt: 1000 + 3600e3 - 60e3 });
assert.equal(readTokens({ access_token: "A" }, 1000), null, "no refresh token");
assert.equal(readTokens(null, 1000), null);

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
assert.equal(left, 1);
assert.equal("digests" in body, false);
assert.ok(body.items.every((i) => CHROME_ID.test(i.id)));

// The hash ignores exportedAt, so an unchanged library isn't sent again.
const again = libraryBody(data, Date.UTC(2026, 9, 7)).body;
assert.equal(await libraryHash(body), await libraryHash(again));
const changed = libraryBody({ ...data, saved: [{ ...data.saved[0], topic: "Evals" }] }, Date.UTC(2026, 9, 6)).body;
assert.notEqual(await libraryHash(body), await libraryHash(changed));

// Words.
assert.equal(words({ state: "off" }), "Your coding agent can read what you save here and on iPhone. Invite-only for now.");
assert.equal(words({ state: "not_invited" }), "Sending your library to your agent is invite-only for now.");
assert.equal(words({ state: "on", email: "a@b.co", lastAt: null }), "Sending to your agent as a@b.co. Not sent yet.");
assert.match(words({ state: "on", email: "a@b.co", lastAt: Date.UTC(2026, 9, 6, 10, 42), items: 63 }), /^Sending to your agent as a@b\.co\. Last sent .+, 63 items\.$/);
assert.equal(words({ state: "ended", endedOn: "10 November" }), "Your invite ended on 10 November. Your agent no longer reads this library.");
assert.equal(words({ state: "other_device" }), "Another Chrome already sends its library to this account.");
assert.equal(words({ state: "shrunk", stored: 40, count: 3 }), "Your agent's copy has 40 pins and this Chrome has 3. Send anyway?");
assert.equal(words({ state: "older" }), "This computer's clock is behind the copy your agent has. Check the date and time, then send again.");
assert.equal(words({ state: "busy" }), "Couldn't reach Sieve's server. Sieve tries again in 15 minutes.");
assert.equal(words({ state: "limit" }), "Sieve sent as many times as it may today. It tries again tomorrow.");
assert.equal(words({ state: "invalid", reason: "x" }), "Sieve's server refused the library: x");
assert.equal(words({ state: "signed_out" }), "This Chrome was signed out. Turn sync on again to keep sending.");
for (const s of ["off", "not_invited", "ended", "busy", "limit", "older"]) assert.doesNotMatch(words({ state: s, endedOn: "1 Nov" }), /—/, "no em dashes");

console.log("agent_sync_test: ok");
