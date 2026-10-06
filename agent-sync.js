// Sending the library to the developer's coding agent (extension library sync spec 5.2), the pure part:
// PKCE, the sign-in URL and answers, the library body and its hash, and the words. Nothing here
// touches chrome.* or the network, so it is tested offline (test/agent_sync_test.mjs). The Chrome
// part is agent-sync-run.js.
import { buildExport } from "./export.js";

export const SERVER = "https://mcp.divergada.com";
export const CLIENT_ID = `${SERVER}/clients/chrome.json`;
export const AGENT_URL = `${SERVER}/sieve`;

// The agents' setup lines (connect-your-agent spec 5.2): the chip, the code to copy, and the meta line.
// `method` is the account's sign-in method from GET /v1/account: "google" says Google, anything else email.
const via = (method) => (method === "google" ? "Google" : "email");
export const AGENTS = [
  { id: "claude-code", name: "Claude Code", code: `claude mcp add --scope user --transport http sieve ${AGENT_URL}`,
    meta: (m) => `Then /mcp \u203a sieve \u203a Authenticate, signed in with ${via(m)}.` },
  { id: "claude-ai", name: "claude.ai", code: AGENT_URL,
    meta: (m) => `claude.ai \u203a Customize \u203a Connectors \u203a Add custom connector. Name it Sieve, then Connect with ${via(m)}.` },
  { id: "cursor", name: "Cursor", code: `{ "mcpServers": { "sieve": { "url": "${AGENT_URL}" } } }`,
    meta: () => "Add to ~/.cursor/mcp.json, then sign in from Cursor's MCP settings." },
  { id: "codex", name: "Codex", code: `codex mcp add sieve --url ${AGENT_URL}`,
    meta: (m) => `Then codex mcp login sieve, signed in with ${via(m)}.` },
  { id: "another", name: "Another", code: AGENT_URL,
    meta: () => "Any agent that adds remote MCP servers with sign-in, running on your computer." },
];
export const CLAUDE_LINE = AGENTS[0].code;
// The server's rule for a Chrome id (mcp-server src/core.js CHROME_ID).
export const CHROME_ID = /^chrome:[A-Za-z0-9_:.-]{1,200}$/;
export const SEND_EVERY_MIN = 15;
// The server's cap on one upload (bytes of JSON).
export const MAX_BODY = 8 * 1024 * 1024;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A PKCE verifier (random unless given) and its S256 challenge. */
export async function pkcePair(verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))) {
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export const randomState = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

export function authorizeUrl({ redirect, challenge, state, device, provider = "google" } = {}) {
  if (!redirect || !challenge || !state || !device) throw new Error("authorizeUrl needs redirect, challenge, state and device");
  const u = new URL(`${SERVER}/authorize`);
  u.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: redirect, code_challenge: challenge,
    code_challenge_method: "S256", state, scope: "account library", provider, device,
  }).toString();
  return u.href;
}

/** The redirect launchWebAuthFlow returned: { code } or { error: "state" | "not_invited" | "denied" }. */
export function readCallback(href, state) {
  let u;
  try { u = new URL(href); } catch { return { error: "denied" }; }
  // The server always answers in the query string, never the fragment, so only the query is read.
  const p = u.searchParams;
  if (p.has("iss") && p.get("iss") !== SERVER) return { error: "denied" };
  if (p.get("state") !== state) return { error: "state" };
  if (p.get("error")) return { error: p.get("error_description") === "new_accounts_closed" ? "not_invited" : "denied" };
  const code = p.get("code");
  return code ? { code } : { error: "denied" };
}

export const tokenForm = ({ code, verifier, redirect }) =>
  new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: CLIENT_ID, code_verifier: verifier });
export const refreshForm = (refresh) => new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: CLIENT_ID });

/** { access, refresh, expiresAt } from a /token answer (a minute early), or null. */
export function readTokens(j, now = Date.now()) {
  if (!j || typeof j.access_token !== "string" || !j.access_token || typeof j.refresh_token !== "string" || !j.refresh_token) return null;
  const secs = Number.isFinite(j.expires_in) && j.expires_in > 0 ? j.expires_in : 3600;
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: now + Math.max(secs * 1000 - 60e3, secs * 500) };
}

/** What is sent: the Export library items with ids under chrome:, no digests. `left` counts items
 * whose id the server wouldn't take. `json` is the body as text and `bytes` its size, so the sender
 * checks MAX_BODY and sends `json` without stringifying twice. */
export function libraryBody(data, now = Date.now()) {
  const ex = buildExport({ saved: data?.saved, watched: data?.watched, briefs: data?.briefs }, now);
  const items = [];
  let left = 0;
  for (const it of ex.items) {
    const id = `chrome:${it.id}`;
    if (CHROME_ID.test(id)) items.push({ ...it, id }); else left++;
  }
  const body = { format: ex.format, version: ex.version, exportedAt: ex.exportedAt, items };
  const json = JSON.stringify(body);
  return { body, json, bytes: new TextEncoder().encode(json).length, left };
}

/** Hex SHA-256 of the items only: a library that didn't change hashes the same at any time. */
export async function libraryHash(body) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body.items)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const when = (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const whole = (n) => (Number.isFinite(n) ? n : 0);

/** The line the settings section shows for the stored record { state, email, lastAt, lastItems, detail }. */
export function words(s) {
  const d = s?.detail || {};
  // Something unexpected while acting, in any state (an "invalid" reason is the server's own words).
  if (d.reason === "error" && s?.state !== "invalid") return "Something went wrong. Try again.";
  switch (s?.state) {
    case "off":
      if (d.reason === "offline" || d.reason === "server") return "Turned off here, but your agent's copy may still be on Sieve's server. Turn on and off again to delete it.";
      return "Your coding agent can read what you save here and on iPhone. Invite-only for now.";
    case "not_invited": return "Sending your library to your agent is invite-only for now.";
    case "on": return `Sending to your agent${s.email ? ` as ${s.email}` : ""}. ${s.lastAt ? `Last sent ${when(s.lastAt)}, ${count(whole(s.lastItems), "item", "items")}.` : "Not sent yet."}`;
    case "ended": return `Your invite ended${d.endedOn ? ` on ${d.endedOn}` : ""}. Your agent no longer reads this library.`;
    case "other_device": return "Another Chrome already sends its library to this account.";
    case "shrunk": return `Your agent's copy has ${count(whole(d.stored), "pin", "pins")} and this Chrome has ${count(whole(d.count), "pin", "pins")}. Send anyway?`;
    case "older": return "This computer's clock is behind the copy your agent has. Check the date and time, then send again.";
    case "busy": return `Couldn't reach Sieve's server. Sieve tries again in ${SEND_EVERY_MIN} minutes.`;
    case "limit": return "Sieve sent as many times as it may today. It tries again tomorrow.";
    case "invalid": return d.reason ? `Sieve's server refused the library: ${d.reason}` : "Sieve's server refused the library.";
    // Rounded up, so a library just over the limit never shows as the limit itself.
    case "too_big": return `Your library is too big to send (${(Math.ceil((whole(d.bytes) / (1024 * 1024)) * 10) / 10).toFixed(1)} MB; the limit is ${MAX_BODY / (1024 * 1024)} MB).`;
    case "signed_out": return "This Chrome was signed out. Turn sync on again to keep sending.";
    case "no_permission": return "Sieve needs that permission to send your library.";
    default: return "";
  }
}
