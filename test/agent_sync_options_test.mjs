// Offline: the "Your agent" section of the settings page (extension settings pinboard spec 4). Runs the
// real options.js against a fake DOM built from options.html, with chrome stubbed: what each stored
// record shows (Off, On, the failure and info notes, the paper note), that Turn on asks for the optional
// permissions before it messages the worker (and not at all when refused), the messages each button
// sends, one request at a time, and focus. No keys, no network.
import assert from "node:assert/strict";
import { AGENTS, words } from "../agent-sync.js";
import { fire, html, page, tick, visible } from "./options-page.mjs";

const on = { on: true, state: "on", email: "dev@example.com", lastAt: Date.UTC(2026, 9, 6, 9), lastItems: 12, device: "d" };
const shows = ($, id) => visible($(id));

// Off: the invite-only sentence and the two providers; nothing of the on group; no Delete.
{
  const { $, sent } = await page({ record: { on: false, state: "off" } });
  assert.deepEqual(sent, [{ type: "agentSync", do: "status" }]);
  assert.equal($("agentLine").textContent, "Your coding agent can read what you save here and on iPhone. Invite-only for now.");
  assert.ok(shows($, "agentOff"));
  assert.equal($("agentOn").textContent, "Continue with Google");
  assert.equal($("agentEmail").textContent, "Continue with email");
  assert.ok($("agentOn").classList.contains("secondary") && $("agentEmail").classList.contains("secondary"));
  assert.ok(shows($, "agentFootOff"));
  assert.match($("agentFootOff").textContent, /^Chrome asks first for a sign-in window and access to mcp\.divergada\.com\. Sieve works as before without it\.$/);
  for (const id of ["agentOnBox", "agentFootOn", "agentNote", "agentFail", "agentInfo", "agentDelete"]) assert.ok(!shows($, id), `${id} hidden when off`);
  assert.equal($("agentMsg").textContent, "");
  assert.equal($("sub").textContent, "Sieve works in your browser with your own key.");
}

// No record yet (a fresh install): the same off sentence.
{
  const { $ } = await page({ record: {} });
  assert.equal($("agentLine").textContent, words({ state: "off" }));
  assert.ok(shows($, "agentOff"));
}

// On: rows, action rows, footnote, the paper note with Claude Code chosen, and Delete at the bottom.
{
  const { $ } = await page({ record: on });
  assert.ok(!shows($, "agentOff"));
  assert.ok(shows($, "agentOnBox"));
  assert.equal($("agentWho").textContent, "dev@example.com");
  assert.match($("agentReads").textContent, /^12 pins from Chrome, sent .+$/);
  assert.equal($("agentSend").textContent, "Send now");
  assert.equal($("agentOffBtn").textContent, "Turn off");
  assert.ok($("agentSend").classList.contains("action") && $("agentOffBtn").classList.contains("action"));
  assert.ok(shows($, "agentFootOn"));
  assert.equal($("agentFootOn").textContent, "Sieve sends within 15 minutes of a change, only if something changed. Turn off deletes this Chrome's copy from Sieve's server.");
  assert.ok(!shows($, "agentFail") && !shows($, "agentInfo"));
  assert.ok(shows($, "agentNote"));
  assert.equal($("agentChips").getAttribute("role"), "radiogroup");
  const chips = $("agentChips").children;
  assert.deepEqual(chips.map((c) => c.textContent), AGENTS.map((a) => a.name));
  assert.deepEqual(chips.map((c) => c.getAttribute("aria-checked")), ["true", "false", "false", "false", "false"]);
  assert.equal($("agentCode").textContent, AGENTS[0].code);
  assert.equal($("agentMeta").textContent, AGENTS[0].meta(undefined));
  assert.equal($("agentMeta").textContent, "Then /mcp › sieve › Authenticate, signed in the same way as here.", "a record from before the method was kept names none");
  assert.ok(shows($, "agentDelete"));
  assert.equal($("agentMsg").textContent, "");
  assert.equal($("sub").textContent, "Your library goes to your agent when it changes.");
}

// A known method is named.
{
  const { $ } = await page({ record: { ...on, method: "email" } });
  assert.equal($("agentMeta").textContent, "Then /mcp › sieve › Authenticate, signed in with email.");
}

// Not sent yet, no email, a Google account; one pin.
{
  const { $ } = await page({ record: { on: true, state: "on", method: "google" } });
  assert.equal($("agentWho").textContent, "");
  assert.equal($("agentReads").textContent, "Not sent yet");
  assert.equal($("agentMeta").textContent, "Then /mcp › sieve › Authenticate, signed in with Google.");
  const { $: $1 } = await page({ record: { ...on, lastItems: 1 } });
  assert.match($1("agentReads").textContent, /^1 pin from Chrome, sent /);
}

// Each chip shows its code and meta line, says so to a screen reader, and is remembered as agentChoice.
for (const [i, a] of AGENTS.entries()) {
  const { $, store } = await page({ record: { ...on, method: "google" } });
  $("agentChips").children[i].click();
  await tick();
  assert.equal($("agentCode").textContent, a.code, a.id);
  assert.equal($("agentMeta").textContent, a.meta("google"), a.id);
  assert.deepEqual($("agentChips").children.map((c) => c.getAttribute("aria-checked") === "true"), AGENTS.map((_, j) => j === i));
  assert.equal(store.agentChoice, a.id);
}
// A remembered choice comes back; an unknown one falls back to Claude Code.
{
  const { $ } = await page({ record: on, store: { agentChoice: "codex" } });
  assert.equal($("agentCode").textContent, AGENTS.find((a) => a.id === "codex").code);
  const { $: $2 } = await page({ record: on, store: { agentChoice: "nope" } });
  assert.equal($2("agentCode").textContent, AGENTS[0].code);
}
// Arrow keys move the choice, as a radio group does.
{
  const { $, doc } = await page({ record: on });
  fire($("agentChips").children[0], "keydown", { key: "ArrowRight" });
  await tick();
  assert.equal($("agentCode").textContent, AGENTS[1].code);
  assert.equal(doc.activeElement, $("agentChips").children[1]);
}

// Copy puts the code on the clipboard and says Copied for 2 seconds.
{
  const { $, copied } = await page({ record: on });
  assert.equal($("agentCopy").textContent, "Copy");
  $("agentCopy").click();
  await tick(); await tick();
  assert.deepEqual(copied, [AGENTS[0].code]);
  assert.equal($("agentCopy").textContent, "Copied");
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal($("agentCopy").textContent, "Copy");
}

// On with state "off" (shouldn't happen): on, no failure.
{
  const { $ } = await page({ record: { ...on, state: "off" } });
  assert.ok(shows($, "agentOnBox"));
  assert.ok(!shows($, "agentFail"));
}

// Failing states: the words in a failure note, with the right button or none; the paper note stays.
const FAIL = [
  [{ ...on, state: "other_device" }, "agentReplace", "Use this Chrome's library instead"],
  [{ ...on, state: "shrunk", detail: { stored: 40, count: 3 } }, "agentShrink", "Send anyway"],
  [{ ...on, state: "busy" }, "agentRetry", "Try again"],
  [{ ...on, state: "on", detail: { reason: "error" } }, "agentRetry", "Try again"],
  [{ ...on, state: "limit" }, null],
  [{ ...on, state: "older" }, null],
  [{ ...on, state: "too_big", detail: { bytes: 9e6 } }, null],
  [{ ...on, state: "invalid", detail: { reason: "bad item" } }, null],
];
for (const [rec, button, label] of FAIL) {
  const { $ } = await page({ record: rec });
  const name = rec.detail?.reason === "error" ? "error" : rec.state;
  assert.ok(shows($, "agentFail"), name);
  assert.equal($("agentFailText").textContent, words(rec), name);
  assert.ok($("agentFailText").textContent, `words for ${name}`);
  for (const id of ["agentReplace", "agentShrink", "agentRetry"]) assert.equal(shows($, id), id === button, `${id} for ${name}`);
  if (button) {
    assert.equal($(button).textContent, label);
    assert.ok($(button).classList.contains("secondary"), "secondary: Check and save keys is the one primary");
  }
  assert.ok(shows($, "agentSend"), `Send now stays for ${name}`);
  assert.ok(shows($, "agentNote"), `the paper note stays for ${name}`);
  assert.ok(!shows($, "agentInfo"));
  assert.doesNotMatch($("agentFailText").textContent, /\u2014/);
}
// A failing state with no words (one this page doesn't know) shows no empty note.
{
  const { $ } = await page({ record: { ...on, state: "nonsense" } });
  assert.ok(!shows($, "agentFail"));
}
// Copy is at least 44 px tall (a .btn.text, whose min-height is 44).
assert.match(html, /\.btn\.text\{[^}]*min-height:44px/);
assert.match(html, /class="btn text" id="agentCopy"/);
// The focus outline isn't clipped by the group's rounded edge.
assert.match(html, /\.row:focus-visible\{outline-offset:-4px\}/);

// The buttons send.
for (const [rec, id, msg] of [
  [{ ...on, state: "other_device" }, "agentReplace", { type: "agentSync", do: "send", replace: true }],
  [{ ...on, state: "shrunk", detail: { stored: 40, count: 3 } }, "agentShrink", { type: "agentSync", do: "send", allowShrink: true }],
  [{ ...on, state: "busy" }, "agentRetry", { type: "agentSync", do: "send" }],
]) {
  const { $, sent } = await page({ record: rec, answer: on });
  $(id).click();
  assert.equal($(id).disabled, true, "disabled while the request runs");
  await tick(); await tick();
  assert.deepEqual(sent.at(-1), msg);
  assert.equal($(id).disabled, false);
  assert.ok(!shows($, "agentFail"), "the answer redraws the section");
}

// Ended: an info note, no Send now, no paper note; Turn off and Delete stay.
{
  const rec = { ...on, state: "ended", detail: { endedOn: "10 November" } };
  const { $ } = await page({ record: rec });
  assert.ok(shows($, "agentInfo"));
  assert.equal($("agentInfoText").textContent, "Your invite ended on 10 November. Your agent no longer reads this library.");
  assert.ok(!shows($, "agentFail"));
  assert.ok(!shows($, "agentSend"));
  assert.ok(!shows($, "agentNote"), "no agent setup once the invite ended");
  assert.ok(shows($, "agentOffBtn"));
  assert.ok(shows($, "agentDelete"));
}
{
  const { $ } = await page({ record: on });
  assert.ok(shows($, "agentSend"), "Send now is back once not ended");
  assert.ok(shows($, "agentNote"));
}

// Off states show their own sentence and the two providers.
for (const rec of [
  { on: false, state: "not_invited" }, { on: false, state: "signed_out" }, { on: false, state: "no_permission" },
  { on: false, state: "off", detail: { reason: "offline" } }, { on: false, state: "off", detail: { reason: "error" } },
]) {
  const { $ } = await page({ record: rec });
  assert.equal($("agentLine").textContent, words(rec), rec.state);
  assert.ok(shows($, "agentOff"));
  assert.ok(!shows($, "agentOnBox") && !shows($, "agentDelete"));
}

// Turn on: the permissions first, from the click, then the worker with Google; email uses email.
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
  assert.ok(shows($, "agentOnBox"));
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
  assert.ok(shows($, "agentOff"));
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
  assert.ok(shows($, "agentOff"));
  assert.equal($("agentLine").textContent, words({ state: "off" }));
  assert.ok(!shows($, "agentDelete"));
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
  assert.ok(shows($, "agentOnBox"));
}
{
  const { $ } = await page({ record: on, answer: { on: false, state: "signed_out", detail: { reason: "server" } } });
  $("agentDelete").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "Couldn't delete your account: this Chrome was signed out. Turn on again, then delete.");
  assert.equal($("agentLine").textContent, words({ state: "signed_out" }));
}
{
  const { $ } = await page({ record: { ...on, state: "invalid", detail: { reason: "server" } } });
  assert.equal($("agentMsg").textContent, "", "the server's reason for refusing a library isn't a failed delete");
}
{
  const { $ } = await page({ record: on, answer: { on: false, state: "off" } });
  $("agentDelete").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "");
  assert.ok(shows($, "agentOff"));
}

// The worker's own refusal shows as the status line; the section stays as it was.
{
  const { $ } = await page({ record: on, answer: { error: "Sending to your agent can only be changed from Sieve's settings." } });
  $("agentSend").click();
  await tick(); await tick();
  assert.equal($("agentMsg").textContent, "Sending to your agent can only be changed from Sieve's settings.");
  assert.ok(shows($, "agentOnBox"));
}

// Focus re-reads the status, so a send by the alarm shows.
{
  const { $, sent, window } = await page({ record: on });
  assert.equal(typeof window.onfocus, "function");
  window.onfocus();
  await tick(); await tick();
  assert.equal(sent.filter((m) => m.do === "status").length, 2);
  assert.match($("agentReads").textContent, /^12 pins/);
}

// While a request runs: every button in the section, and Delete, is disabled and a progress line shows.
for (const [id, line, record] of [["agentOn", "Signing in…", { on: false, state: "off" }], ["agentEmail", "Signing in…", { on: false, state: "off" }],
  ["agentSend", "Sending…", on], ["agentReplace", "Sending…", { ...on, state: "other_device" }], ["agentShrink", "Sending…", { ...on, state: "shrunk" }],
  ["agentRetry", "Sending…", { ...on, state: "busy" }], ["agentOffBtn", "Turning off…", on], ["agentDelete", "Deleting…", on]]) {
  let release;
  const { $ } = await page({ record, answer: () => new Promise((r) => { release = r; }) });
  const buttons = [...$("agentSection").querySelectorAll("button"), $("agentDelete")];
  assert.ok(buttons.length >= 10);
  $(id).click();
  await tick(); await tick();
  assert.ok(buttons.every((b) => b.disabled), `all disabled during ${id}`);
  assert.equal($("agentMsg").textContent, line, id);
  // A second click while it runs does nothing.
  $("agentOffBtn").disabled = false;
  $("agentOffBtn").click();
  release(on);
  await tick(); await tick();
  assert.ok(buttons.every((b) => !b.disabled), `all enabled after ${id}`);
  assert.equal($("agentMsg").textContent, "", `progress cleared after ${id}`);
}

// Focus: a focused button that the answer hides hands focus to the first visible button.
{
  const { $, doc } = await page({ record: on, answer: { on: false, state: "off" } });
  $("agentOffBtn").focus();
  $("agentOffBtn").click();
  await tick(); await tick();
  assert.equal(doc.activeElement, $("agentOn"));
}
{
  const { $, doc } = await page({ record: { on: false, state: "off" }, answer: on });
  $("agentOn").focus();
  $("agentOn").click();
  await tick(); await tick();
  assert.equal(doc.activeElement, $("agentSend"));
}
{
  // Chrome drops focus from a button while it is disabled: it comes back after the answer.
  let release;
  const { $, doc } = await page({ record: on, answer: () => new Promise((r) => { release = r; }) });
  $("agentSend").focus();
  $("agentSend").click();
  await tick();
  doc.activeElement = doc.body;
  release(on);
  await tick(); await tick();
  assert.equal(doc.activeElement, $("agentSend"));
}
{
  const { $, doc } = await page({ record: on, answer: on });
  $("agentSend").focus();
  $("agentSend").click();
  await tick(); await tick();
  assert.equal(doc.activeElement, $("agentSend"), "a button that stays visible keeps focus");
}

// The page: Your agent comes first (after Start here), before Keys; the sentence is announced; the
// failure note's words come before its buttons; Delete sits alone at the very bottom.
{
  const at = (t) => html.indexOf(t);
  assert.ok(at('id="start"') < at('id="agentSection"') && at('id="agentSection"') < at("<h2>Keys</h2>"));
  assert.match(html, /<p [^>]*id="agentLine"[^>]*aria-live="polite"/);
  assert.ok(at('id="agentFailText"') < at('id="agentReplace"'));
  assert.ok(at('id="agentDelete"') > at("<h2>About Sieve</h2>"), "Delete is the last thing on the page");
  assert.ok(at('id="agentDelete"') > at('id="statsSection"'));
  assert.match(html, /<img [^>]*src="icons\/icon48\.png"/);
}

console.log("agent_sync_options_test: ok");
