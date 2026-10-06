// Offline: the "Your agent" section of the settings page. Runs the real options.js against a fake DOM
// built from options.html's ids, with chrome stubbed: which lines and buttons each stored record shows,
// that Turn on asks for the optional permissions before it messages the worker (and not at all when
// refused), and the messages each button sends. No keys, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "./fake-dom.mjs";
import { AGENT_URL, CLAUDE_LINE, words } from "../agent-sync.js";

const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
let loads = 0;

// A fresh page: options.html's elements, nested as the HTML nests them, with `hidden` as the HTML has
// it, focus, and querySelectorAll by tag name. Returns the page and what it sent.
const VOID = new Set(["input", "br", "meta", "img", "hr", "link", "source"]);
async function page({ record, granted = true, confirmed = true, answer } = {}) {
  const doc = fakeDocument();
  const body = html.slice(html.indexOf("<main>"), html.indexOf("</main>") + 7);
  const stack = [doc.body];
  for (const m of body.matchAll(/<(\/?)(\w+)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (close) { if (stack.length > 1 && stack.at(-1).tagName === tag.toUpperCase()) stack.pop(); continue; }
    const el = doc.createElement(tag);
    el.id = attrs.match(/\sid="([^"]+)"/)?.[1] || "";
    el.className = attrs.match(/\sclass="([^"]+)"/)?.[1] || "";
    el.hidden = /\shidden(\s|$)/.test(attrs);
    for (const [, k, v] of attrs.matchAll(/\s([\w-]+)="([^"]*)"/g)) el.attrs[k] = v;
    el.querySelectorAll = (sel) => {
      const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
      return all(el).filter((c) => c.tagName === sel.toUpperCase());
    };
    el.focus = () => { doc.activeElement = el; };
    stack.at(-1).append(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  doc.activeElement = doc.body;
  doc.querySelector = () => ({ checked: false });
  const sent = [];
  const asked = [];
  globalThis.document = doc;
  globalThis.window = {};
  globalThis.confirm = () => confirmed;
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    permissions: { request: async (p) => { asked.push({ p, before: sent.length }); return granted; } },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type !== "agentSync") return null;
        sent.push(msg);
        if (msg.do === "status") return record;
        return typeof answer === "function" ? answer(msg) : answer;
      },
    },
  };
  await import(`../options.js?page=${++loads}`);
  await tick(); await tick();
  const $ = (id) => doc.getElementById(id);
  return { $, sent, asked, window: globalThis.window };
}

const on = { on: true, state: "on", email: "dev@example.com", lastAt: Date.UTC(2026, 9, 6, 9), lastItems: 12, device: "d" };

// Off: the invite-only line, Turn on and Use email instead; nothing of the on box.
{
  const { $, sent } = await page({ record: { on: false, state: "off" } });
  assert.deepEqual(sent, [{ type: "agentSync", do: "status" }]);
  assert.equal($("agentLine").textContent, "Your coding agent can read what you save here and on iPhone. Invite-only for now.");
  assert.equal($("agentOff").hidden, false);
  assert.equal($("agentOnBox").hidden, true);
  assert.equal($("agentMsg").textContent, "");
}

// No record yet (a fresh install): the same off line.
{
  const { $ } = await page({ record: {} });
  assert.equal($("agentLine").textContent, words({ state: "off" }));
  assert.equal($("agentOff").hidden, false);
}

// On: the line with the email and last send, the address and the Claude Code line, Send now, Turn off
// and Delete; neither answer button.
{
  const { $ } = await page({ record: on });
  assert.equal($("agentLine").textContent, words(on));
  assert.match($("agentLine").textContent, /^Sending to your agent as dev@example\.com\. Last sent .*, 12 items\.$/);
  assert.equal($("agentOff").hidden, true);
  assert.equal($("agentOnBox").hidden, false);
  assert.equal($("agentUrl").textContent, AGENT_URL);
  assert.equal($("agentCmd").textContent, CLAUDE_LINE);
  assert.equal($("agentReplace").hidden, true);
  assert.equal($("agentShrink").hidden, true);
  assert.equal($("agentSend").classList.contains("quiet"), false);
  assert.equal($("agentMsg").textContent, "");
}

// On with state "off" (shouldn't happen): the on line.
{
  const { $ } = await page({ record: { ...on, state: "off" } });
  assert.equal($("agentLine").textContent, words(on));
}

// Other device: the line and Use this Chrome's library instead, which resends with replace.
{
  const { $, sent } = await page({ record: { ...on, state: "other_device" }, answer: on });
  assert.equal($("agentLine").textContent, "Another Chrome already sends its library to this account.");
  assert.equal($("agentReplace").hidden, false);
  assert.equal($("agentShrink").hidden, true);
  assert.ok($("agentSend").classList.contains("quiet"), "one filled button: Send now steps back");
  $("agentReplace").click();
  assert.equal($("agentReplace").disabled, true, "disabled while the request runs");
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "send", replace: true });
  assert.equal($("agentReplace").disabled, false);
  assert.equal($("agentReplace").hidden, true, "the answer redraws the section");
  assert.equal($("agentSend").classList.contains("quiet"), false);
  assert.equal($("agentLine").textContent, words(on));
}

// Shrunk: the counts and Send anyway, which resends with allowShrink.
{
  const rec = { ...on, state: "shrunk", detail: { stored: 40, count: 3 } };
  const { $, sent } = await page({ record: rec, answer: on });
  assert.equal($("agentLine").textContent, "Your agent's copy has 40 pins and this Chrome has 3 pins. Send anyway?");
  assert.equal($("agentShrink").hidden, false);
  assert.equal($("agentReplace").hidden, true);
  $("agentShrink").click();
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "send", allowShrink: true });
}

// Every state words() knows shows its own line, on or off.
for (const rec of [
  { on: false, state: "not_invited" }, { on: false, state: "signed_out" }, { on: false, state: "no_permission" },
  { on: false, state: "off", detail: { reason: "offline" } }, { on: false, state: "off", detail: { reason: "error" } },
  { ...on, state: "ended", detail: { endedOn: "10 November" } }, { ...on, state: "busy" }, { ...on, state: "limit" },
  { ...on, state: "older" }, { ...on, state: "invalid", detail: { reason: "bad item" } }, { ...on, state: "too_big", detail: { bytes: 9e6 } },
]) {
  const { $ } = await page({ record: rec });
  assert.equal($("agentLine").textContent, words(rec), rec.state);
  assert.ok($("agentLine").textContent, `a line for ${rec.state}`);
  assert.equal($("agentOff").hidden, rec.on, `Turn on for ${rec.state}`);
  assert.equal($("agentOnBox").hidden, !rec.on, `the on box for ${rec.state}`);
  assert.doesNotMatch($("agentLine").textContent + $("agentMsg").textContent, /—/);
}

// Turn on: the permissions first, then the worker with Google; email uses the email provider.
{
  const { $, sent, asked } = await page({ record: { on: false, state: "off" }, answer: on });
  $("agentOn").click();
  assert.equal(asked.length, 1, "asked at once, from the click");
  assert.deepEqual(asked[0].p, { permissions: ["identity"], origins: ["https://mcp.divergada.com/*"] });
  assert.equal(asked[0].before, 1, "before any message but the status read");
  assert.equal($("agentOn").disabled, true);
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "on", provider: "google" });
  assert.equal($("agentOn").disabled, false);
  assert.equal($("agentOnBox").hidden, false);
  assert.equal($("agentLine").textContent, words(on));
}
{
  const { $, sent } = await page({ record: { on: false, state: "off" }, answer: on });
  $("agentEmail").click();
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "on", provider: "email" });
}

// Turn on refused at the prompt: the permission line, and the worker isn't asked.
{
  const { $, sent, window } = await page({ record: { on: false, state: "off" }, granted: false });
  $("agentOn").click();
  await tick(); await tick();
  assert.deepEqual(sent.map((m) => m.do), ["status"]);
  assert.equal($("agentMsg").textContent, "Sieve needs that permission to send your library.");
  assert.equal($("agentOff").hidden, false);
  // Coming back to the page re-reads the status and keeps the line.
  window.onfocus();
  await tick(); await tick();
  assert.deepEqual(sent.map((m) => m.do), ["status", "status"]);
  assert.equal($("agentMsg").textContent, "Sieve needs that permission to send your library.");
}

// Send now and Turn off.
{
  const { $, sent } = await page({ record: on, answer: { on: false, state: "off" } });
  $("agentSend").click();
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "send" });
  $("agentOffBtn").click();
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "off" });
  assert.equal($("agentOff").hidden, false);
  assert.equal($("agentLine").textContent, words({ state: "off" }));
}

// Delete: nothing without the confirmation; a failed delete says so; a done delete is off.
{
  const { $, sent } = await page({ record: on, confirmed: false });
  $("agentDelete").click();
  await tick();
  assert.deepEqual(sent.map((m) => m.do), ["status"]);
}
for (const reason of ["offline", "server"]) {
  const { $, sent } = await page({ record: on, answer: { ...on, detail: { reason } } });
  $("agentDelete").click();
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), { type: "agentSync", do: "delete" });
  assert.equal($("agentMsg").textContent, reason === "offline"
    ? "Couldn't delete your account. Check your connection and try again."
    : "Sieve's server couldn't delete your account. Try again in a minute.");
  assert.equal($("agentOnBox").hidden, false);
}
// Refused because the server signed this Chrome out meanwhile: the account is still there.
{
  const { $ } = await page({ record: on, answer: { on: false, state: "signed_out", detail: { reason: "server" } } });
  $("agentDelete").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "Couldn't delete your account: this Chrome was signed out. Turn on again, then delete.");
  assert.equal($("agentLine").textContent, words({ state: "signed_out" }));
}
// The server's own reason for refusing a library isn't a failed delete.
{
  const { $ } = await page({ record: { ...on, state: "invalid", detail: { reason: "server" } } });
  assert.equal($("agentMsg").textContent, "");
}
{
  const { $ } = await page({ record: on, answer: { on: false, state: "off" } });
  $("agentDelete").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "");
  assert.equal($("agentOff").hidden, false);
}

// The worker's own refusal shows as the status line; the section stays as it was.
{
  const { $ } = await page({ record: on, answer: { error: "Sending to your agent can only be changed from Sieve's settings." } });
  $("agentSend").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "Sending to your agent can only be changed from Sieve's settings.");
  assert.equal($("agentOnBox").hidden, false);
}

// Focus re-reads the status, so a send by the alarm shows.
{
  const { $, sent, window } = await page({ record: on });
  assert.equal(typeof window.onfocus, "function");
  window.onfocus();
  await tick(); await tick();
  assert.equal(sent.filter((m) => m.do === "status").length, 2);
  assert.equal($("agentLine").textContent, words(on));
}

// Ended: only Turn off and Delete.
{
  const { $ } = await page({ record: { ...on, state: "ended", detail: { endedOn: "10 November" } } });
  assert.equal($("agentLine").textContent, "Your invite ended on 10 November. Your agent no longer reads this library.");
  assert.equal($("agentSend").hidden, true);
  assert.equal($("agentReplace").hidden, true);
  assert.equal($("agentShrink").hidden, true);
  assert.equal($("agentOffBtn").hidden, false);
  assert.equal($("agentDelete").hidden, false);
  assert.equal($("agentWhere").hidden, true, "no agent address once the invite ended");
  assert.equal($("agentHow").hidden, true, "no Claude Code line once the invite ended");
}
{
  const { $ } = await page({ record: on });
  assert.equal($("agentSend").hidden, false, "Send now is back once not ended");
  assert.equal($("agentWhere").hidden, false);
  assert.equal($("agentHow").hidden, false);
}

// While a request runs: every button in the section is disabled and a progress line shows.
for (const [id, line, record] of [["agentOn", "Signing in…", { on: false, state: "off" }], ["agentEmail", "Signing in…", { on: false, state: "off" }],
  ["agentSend", "Sending…", on], ["agentReplace", "Sending…", { ...on, state: "other_device" }], ["agentShrink", "Sending…", { ...on, state: "shrunk" }],
  ["agentOffBtn", "Turning off…", on], ["agentDelete", "Deleting…", on]]) {
  let release;
  const { $ } = await page({ record, answer: () => new Promise((r) => { release = r; }) });
  const buttons = $("agentSection").querySelectorAll("button");
  assert.ok(buttons.length >= 7);
  $(id).click();
  await tick(); await tick();
  assert.ok(buttons.every((b) => b.disabled), `all disabled during ${id}`);
  assert.equal($("agentMsg").textContent, line, id);
  release(on);
  await tick(); await tick();
  assert.ok(buttons.every((b) => !b.disabled), `all enabled after ${id}`);
  assert.equal($("agentMsg").textContent, "", `progress cleared after ${id}`);
}

// Focus: a focused button that the answer hides hands focus to the first visible button.
{
  const { $ } = await page({ record: on, answer: { on: false, state: "off" } });
  $("agentOffBtn").focus();
  $("agentOffBtn").click();
  await tick(); await tick();
  assert.equal(document.activeElement, $("agentOn"));
}
{
  const { $ } = await page({ record: { on: false, state: "off" }, answer: on });
  $("agentOn").focus();
  $("agentOn").click();
  await tick(); await tick();
  assert.equal(document.activeElement, $("agentSend"));
}
{
  // Chrome drops focus from a button while it is disabled: it comes back after the answer.
  let release;
  const { $ } = await page({ record: on, answer: () => new Promise((r) => { release = r; }) });
  $("agentSend").focus();
  $("agentSend").click();
  await tick();
  document.activeElement = document.body;
  release(on);
  await tick(); await tick();
  assert.equal(document.activeElement, $("agentSend"));
}
{
  // A button that stays visible keeps focus.
  const { $ } = await page({ record: on, answer: on });
  $("agentSend").focus();
  $("agentSend").click();
  await tick(); await tick();
  assert.equal(document.activeElement, $("agentSend"));
}

// The page: the section sits after Briefs and digests, before Daily reminder; the line is announced;
// Use email instead is a button; Delete has its own row, away from Send now.
{
  const at = (t) => html.indexOf(t);
  assert.ok(at("<h2>Briefs and digests</h2>") < at('id="agentSection"') && at('id="agentSection"') < at("<h2>Daily reminder</h2>"));
  assert.match(html, /<p class="hint" id="agentLine" aria-live="polite">/);
  assert.match(html, /<button type="button" class="link" id="agentEmail">Use email instead<\/button>/);
  const { $ } = await page({ record: on });
  assert.notEqual($("agentDelete").parentNode, $("agentSend").parentNode);
}

console.log("agent_sync_options_test: ok");
