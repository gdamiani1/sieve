// Sending the library to the developer's coding agent (extension library sync spec 5.2), the pure part:
// PKCE, the sign-in URL and answers, the library body and its hash, and the words. Nothing here
// touches chrome.* or the network, so it is tested offline (test/agent_sync_test.mjs). The Chrome
// part is agent-sync-run.js.
import { buildExport } from "./export.js";

export const SERVER = "https://mcp.divergada.com";
export const CLIENT_ID = `${SERVER}/clients/chrome.json`;
export const AGENT_URL = `${SERVER}/sieve`;
export const CLAUDE_LINE = `claude mcp add --transport http sieve ${AGENT_URL}`;
// The server's rule for a Chrome id (mcp-server src/core.js CHROME_ID).
export const CHROME_ID = /^chrome:[A-Za-z0-9_:.-]{1,200}$/;
export const SEND_EVERY_MIN = 15;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A PKCE verifier (random unless given) and its S256 challenge. */
export async function pkcePair(verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))) {
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export const randomState = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

export function authorizeUrl({ redirect, challenge, state, device, provider = "google" }) {
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
  const p = u.searchParams;
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
  if (!j || typeof j.access_token !== "string" || typeof j.refresh_token !== "string") return null;
  const secs = Number.isFinite(j.expires_in) ? j.expires_in : 3600;
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: now + secs * 1000 - 60e3 };
}

/** What is sent: the Export library items with ids under chrome:, no digests. `left` counts items
 * whose id the server wouldn't take. */
export function libraryBody(data, now = Date.now()) {
  const ex = buildExport({ saved: data?.saved, watched: data?.watched, briefs: data?.briefs }, now);
  const items = [];
  let left = 0;
  for (const it of ex.items) {
    const id = it.id.startsWith("chrome:") ? it.id : `chrome:${it.id}`;
    if (CHROME_ID.test(id)) items.push({ ...it, id }); else left++;
  }
  return { body: { format: ex.format, version: ex.version, exportedAt: ex.exportedAt, items }, left };
}

/** Hex SHA-256 of the items only: a library that didn't change hashes the same at any time. */
export async function libraryHash(body) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body.items)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const when = (ms) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The line the settings section shows for a state. */
export function words(s) {
  switch (s.state) {
    case "off": return "Your coding agent can read what you save here and on iPhone. Invite-only for now.";
    case "not_invited": return "Sending your library to your agent is invite-only for now.";
    case "on": return `Sending to your agent as ${s.email}. ${s.lastAt ? `Last sent ${when(s.lastAt)}, ${s.items} item${s.items === 1 ? "" : "s"}.` : "Not sent yet."}`;
    case "ended": return `Your invite ended${s.endedOn ? ` on ${s.endedOn}` : ""}. Your agent no longer reads this library.`;
    case "other_device": return "Another Chrome already sends its library to this account.";
    case "shrunk": return `Your agent's copy has ${s.stored} pins and this Chrome has ${s.count}. Send anyway?`;
    case "older": return "This computer's clock is behind the copy your agent has. Check the date and time, then send again.";
    case "busy": return `Couldn't reach Sieve's server. Sieve tries again in ${SEND_EVERY_MIN} minutes.`;
    case "limit": return "Sieve sent as many times as it may today. It tries again tomorrow.";
    case "invalid": return `Sieve's server refused the library: ${s.reason}`;
    case "signed_out": return "This Chrome was signed out. Turn sync on again to keep sending.";
    case "no_permission": return "Sieve needs that permission to send your library.";
    default: return "";
  }
}
