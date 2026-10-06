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

// A fresh page: every element with an id, `hidden` as the HTML has it. Returns the page and what it sent.
async function page({ record, granted = true, confirmed = true, answer } = {}) {
  const doc = fakeDocument();
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
    const el = doc.createElement(m[1]);
    el.id = m[3];
    el.hidden = /\shidden(\s|$|>)/.test(` ${m[2]} ${m[4]} `);
    el.querySelectorAll = () => [];
    doc.body.append(el);
  }
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
  assert.equal($("agentMsg").textContent, "Couldn't delete your account. Check your connection and try again.");
  assert.equal($("agentOnBox").hidden, false);
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

console.log("agent_sync_options_test: ok");
