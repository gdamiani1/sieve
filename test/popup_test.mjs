// Offline: the popup (pinboard version 2). Runs the real popup.js against a fake DOM built from
// popup.html, with chrome stubbed. Reset asks first and changes nothing on Cancel; the Your agent line
// shows only when on; the stats question, the feed switches, the counters and the buttons keep working.
// No keys, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "./fake-dom.mjs";

const html = readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));
const VOID = new Set(["input", "br", "meta", "img", "hr", "link", "source"]);
let loads = 0;

function build() {
  const doc = fakeDocument();
  const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
  const stack = [doc.body];
  let last = 0;
  const text = (t) => {
    if (t.trim() && !["SCRIPT", "STYLE"].includes(stack.at(-1).tagName)) stack.at(-1).append(t.replace(/&amp;/g, "&"));
  };
  for (const m of body.matchAll(/<(\/?)(\w+)([^>]*)>/g)) {
    text(body.slice(last, m.index));
    last = m.index + m[0].length;
    const [, close, tag, attrs] = m;
    if (close) { if (stack.length > 1 && stack.at(-1).tagName === tag.toUpperCase()) stack.pop(); continue; }
    const el = doc.createElement(tag);
    el.id = attrs.match(/\sid="([^"]+)"/)?.[1] || "";
    el.className = attrs.match(/\sclass="([^"]+)"/)?.[1] || "";
    el.hidden = /\shidden(\s|$|\/)/.test(attrs);
    for (const [, k, v] of attrs.matchAll(/\s([\w-]+)="([^"]*)"/g)) el.attrs[k] = v;
    el.checked = false;
    stack.at(-1).append(el);
    if (!VOID.has(tag) && !attrs.trim().endsWith("/")) stack.push(el);
  }
  return doc;
}

const visible = (el) => { for (let e = el; e; e = e.parentNode) if (e.hidden) return false; return true; };

async function popup({ store = {}, stats = { available: false, consent: null }, agent = { on: false, state: "off" }, confirmed = true } = {}) {
  const doc = build();
  const sent = [];
  const opened = [];
  const confirms = [];
  const removed = [];
  globalThis.document = doc;
  globalThis.confirm = (q) => { confirms.push(q); return confirmed; };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const list = [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        set: async (obj) => { Object.assign(store, structuredClone(obj)); },
        remove: async (k) => { for (const key of [].concat(k)) { delete store[key]; removed.push(key); } },
      },
    },
    runtime: {
      openOptionsPage: () => opened.push("options"),
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.type === "stats") return typeof stats === "function" ? stats(msg) : stats;
        if (msg.type === "agentSync") return typeof agent === "function" ? agent(msg) : agent;
        return null;
      },
    },
    tabs: { create: (o) => opened.push(o.url) },
  };
  await import(`../popup.js?page=${++loads}`);
  for (let i = 0; i < 5; i++) await tick();
  return { $: (id) => doc.getElementById(id), sent, opened, confirms, removed, store };
}

const STATS = { posts: 508, strong: 88, maybe: 85, briefs: 1, watched: 1, cost: 0.05, scoreCost: 0.02, draftCost: 0.0023 };

// The counters, the cost sum and the feed switches.
{
  const { $ } = await popup({ store: { stats: { ...STATS }, prefs: { xOn: false } } });
  assert.equal($("posts").textContent, "508");
  assert.equal($("strong").textContent, "88");
  assert.equal($("maybe").textContent, "85");
  assert.equal($("briefs").textContent, "1");
  assert.equal($("watched").textContent, "1");
  assert.equal($("cost").textContent, "$0.0723");
  assert.equal($("linkedinOn").checked, true);
  assert.equal($("xOn").checked, false);
}

// Empty stats read zero.
{
  const { $ } = await popup();
  assert.equal($("posts").textContent, "0");
  assert.equal($("cost").textContent, "$0.0000");
}

// A switch is saved at once, keeping the other prefs.
{
  const { $, store } = await popup({ store: { prefs: { role: "dev" } } });
  $("redditOn").checked = false;
  await $("redditOn").onchange();
  assert.deepEqual(store.prefs, { role: "dev", redditOn: false });
}

// Reset asks first, with these words.
{
  const { $, confirms, removed, store } = await popup({ store: { stats: { ...STATS } } });
  await $("reset").onclick();
  await tick();
  assert.deepEqual(confirms, ["Reset the counters? This can't be undone."]);
  assert.deepEqual(removed, ["stats"]);
  assert.equal(store.stats, undefined);
  assert.equal($("posts").textContent, "0");
  assert.equal($("cost").textContent, "$0.0000");
}

// Cancel changes nothing: the counters stay in storage and on screen.
{
  const { $, confirms, removed, store } = await popup({ store: { stats: { ...STATS } }, confirmed: false });
  await $("reset").onclick();
  await tick();
  assert.equal(confirms.length, 1);
  assert.deepEqual(removed, []);
  assert.deepEqual(store.stats, STATS);
  assert.equal($("posts").textContent, "508");
  assert.equal($("cost").textContent, "$0.0723");
}

// Settings and Daily learnings.
{
  const { $, opened } = await popup();
  $("settings").click();
  $("digest").click();
  assert.deepEqual(opened, ["options", "chrome-extension://test/digest.html"]);
}

// The waitlist link keeps its address.
assert.match(html, /<a href="https:\/\/divergada\.com\/sieve\?ref=extension"[^>]*>Join the waitlist<\/a>/);
assert.match(html, /A Sieve account is coming\./);

// The Your agent line: hidden when off, or no record, or the worker can't say; shown when on.
{
  const { $, sent } = await popup({ agent: { on: false, state: "off" } });
  assert.deepEqual(sent.filter((m) => m.type === "agentSync"), [{ type: "agentSync", do: "status" }]);
  assert.ok(!visible($("agent")));
}
for (const agent of [{}, { error: "nope" }, null]) {
  const { $ } = await popup({ agent });
  assert.ok(!visible($("agent")), `hidden for ${JSON.stringify(agent)}`);
}
{
  const at = new Date();
  at.setHours(19, 52, 0, 0);
  const { $ } = await popup({ agent: { on: true, state: "on", email: "d@e.com", lastAt: at.getTime(), lastItems: 48 } });
  assert.ok(visible($("agent")));
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  assert.equal($("agent").textContent, `Your agent reads 48 pins from Chrome, sent ${time}.`);
}
{
  const { $ } = await popup({ agent: { on: true, state: "on", lastAt: Date.now(), lastItems: 1 } });
  assert.match($("agent").textContent, /^Your agent reads 1 pin from Chrome, sent /);
}
// On but not sent yet.
{
  const { $ } = await popup({ agent: { on: true, state: "on" } });
  assert.ok(visible($("agent")));
  assert.equal($("agent").textContent, "Your agent is on. Nothing sent yet.");
}
// The invite ended: the agent no longer reads this library, so no line.
{
  const { $ } = await popup({ agent: { on: true, state: "ended", lastAt: Date.now(), lastItems: 3 } });
  assert.ok(!visible($("agent")));
}

// The stats question: only while unanswered and available.
{
  const { $ } = await popup({ stats: { available: true, consent: null } });
  assert.ok(visible($("ask")));
}
for (const stats of [{ available: false, consent: null }, { available: true, consent: true }, { available: true, consent: false }, null]) {
  const { $ } = await popup({ stats });
  assert.ok(!visible($("ask")), `question hidden for ${JSON.stringify(stats)}`);
}
// Yes sends the consent, hides the question and thanks.
{
  const { $, sent } = await popup({ stats: (m) => (m.action === "consent" ? { ok: true } : { available: true, consent: null }) });
  await $("askYes").onclick();
  assert.deepEqual(sent.at(-1), { type: "stats", action: "consent", on: true });
  assert.ok(!visible($("ask")));
  assert.equal($("askThanks").textContent, "Thanks. You can change this in Settings.");
}
// No sends the refusal.
{
  const { $, sent } = await popup({ stats: (m) => (m.action === "consent" ? { ok: true } : { available: true, consent: null }) });
  await $("askNo").onclick();
  assert.deepEqual(sent.at(-1), { type: "stats", action: "consent", on: false });
  assert.ok(!visible($("ask")));
}
// An error stays visible, with the buttons usable again.
{
  const { $ } = await popup({ stats: (m) => (m.action === "consent" ? { error: "Usage stats can only be changed from Sieve's popup or settings." } : { available: true, consent: null }) });
  await $("askYes").onclick();
  assert.ok(visible($("ask")));
  assert.equal($("askErr").textContent, "Usage stats can only be changed from Sieve's popup or settings.");
  assert.equal($("askYes").disabled, false);
  assert.equal($("askNo").disabled, false);
}
// No answer: the generic words.
{
  const { $ } = await popup({ stats: (m) => (m.action === "consent" ? null : { available: true, consent: null }) });
  await $("askNo").onclick();
  assert.equal($("askErr").textContent, "Sieve couldn't change usage stats. Reload the extension and try again.");
}

console.log("popup_test: ok");
