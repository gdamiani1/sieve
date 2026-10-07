// Offline: the Daily learnings page (pinboard version 2). Runs the real digest.js against a fake DOM
// built from digest.html, with chrome stubbed. The header and the one primary, each section's heading
// and card of rows, titles as ink links with blue text actions, the folded Saved posts row with its
// count, empty sections, a failed summary and Export library. No keys, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "./fake-dom.mjs";

const html = readFileSync(new URL("../digest.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../digest.js", import.meta.url), "utf8");
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
    el.open = /\sopen(\s|$|\/|=)/.test(attrs);
    for (const [, k, v] of attrs.matchAll(/\s([\w-]+)="([^"]*)"/g)) el.attrs[k] = v;
    stack.at(-1).append(el);
    if (!VOID.has(tag) && !attrs.trim().endsWith("/")) stack.push(el);
  }
  return doc;
}

const all = (root) => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root, cls) => all(root).filter((e) => e.classList.contains(cls));
const byTag = (root, tag) => all(root).filter((e) => e.tagName === tag.toUpperCase());

async function page({ store = {}, answer = () => ({}) } = {}) {
  const doc = build();
  const sent = [];
  globalThis.document = doc;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const list = [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
      },
    },
    runtime: { sendMessage: async (msg) => { sent.push(msg); return answer(msg); } },
  };
  await import(`../digest.js?page=${++loads}`);
  for (let i = 0; i < 5; i++) await tick();
  return { $: (id) => doc.getElementById(id), doc, sent, store };
}

const now = Date.now();
const STORE = {
  saved: [
    { key: "r1", platform: "reddit", authorName: "r/LocalLLaMA", authorUrl: "https://www.reddit.com/r/LocalLLaMA/comments/1", title: "How do you keep evals honest?", text: "How do you keep evals honest?\nWe tried golden sets.", createdAt: now - 3 * 36e5, comments: 14, kind: "question", worth: 0.81, savedAt: now - 2 * 36e5 },
    { key: "l1", platform: "linkedin", authorName: "Jane Doe", authorUrl: "https://www.linkedin.com/in/jane", text: "Run a golden set of 20 cases on every prompt change.", kind: "technique", topic: "evals", worth: 0.92, savedAt: now - 5 * 36e5 },
    { key: "y1", platform: "youtube", authorName: "Sam Lee", authorUrl: "", text: "A video about agents.", kind: "video", savedAt: now - 6 * 36e5 },
  ],
  briefs: {
    "x:1": { key: "1", platform: "x", title: "Evals with golden sets", author: "Jane Doe", url: "https://x.com/a/status/1", at: now - 1000, what: "Keep a golden set of cases.", warning: "AI-directed text.", try: ["Keep a golden set"], leftOut: ["snapdiff"] },
    "x:2": { key: "2", platform: "x", title: "Plain brief", author: "Sam Lee", url: "https://x.com/b/status/2", at: now - 2000, what: "Write the plan first.", warning: "", try: ["Write the plan"] },
  },
  watched: {
    v1: { url: "https://www.youtube.com/watch?v=1", platform: "youtube", title: "Agents in practice", channel: "Sam Lee", verdict: "watch", at: now - 864e5, learnings: ["Plan first", "Test small"], summary: "" },
  },
  digests: [{ at: now - 864e5, count: 4, cost: 0.0012, text: "## Evals\n- Golden sets of 20 cases (Jane Doe)\n## Agents\n- Plan before code (Sam Lee)" }],
};

// The page itself: header, the one primary, the actions, the folded Saved posts row. Read from the DOM
// built from digest.html; the CSS rules it depends on are checked in the style.
{
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const doc = build();
  const $ = (id) => doc.getElementById(id);
  assert.equal(byTag(doc.body, "h1")[0]?.textContent, "Daily learnings");
  const nib = byClass(doc.body, "nib")[0];
  assert.equal(nib?.tagName, "SVG", "the blue nib under the screen name");
  assert.equal(nib.getAttribute("aria-hidden"), "true");
  assert.equal(byClass(doc.body, "sub")[0]?.textContent, "What Sieve kept from your feeds. What people posted, not verified facts.");
  const buttons = byTag(doc.body, "button");
  assert.deepEqual(buttons.filter((b) => b.classList.contains("primary")).map((b) => b.id), ["today"], "one primary on the page");
  for (const [id, cls, label] of [["today", "primary", "Summarise since last digest"], ["day", "secondary", "Last 24 hours"], ["week", "secondary", "Last 7 days"], ["export", "text", "Export library"]]) {
    assert.ok($(id).classList.contains("btn") && $(id).classList.contains(cls), `#${id} is a ${cls} button`);
    assert.equal($(id).textContent, label);
    assert.equal($(id).getAttribute("type"), "button");
  }
  assert.equal($("msg").getAttribute("role"), "status", "the message line is announced");
  // An empty message line is hidden from sight only: display:none would take it out of the
  // accessibility tree, and the next message might not be read.
  const msgEmpty = style.match(/#msg:empty\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(msgEmpty, /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(msgEmpty, /clip-path:\s*inset\(50%\)/);
  // The folded list: a <details> that starts closed, its summary a row with the count and a chevron.
  const details = byTag(doc.body, "details")[0];
  assert.ok(details, "Saved posts is a <details>");
  assert.equal(details.open, false, "it starts folded");
  const summary = details.children[0];
  assert.equal(summary.tagName, "SUMMARY", "it opens on its summary");
  assert.ok(summary.classList.contains("row"), "its summary is a row");
  assert.equal(summary.children[0], $("savedSum"));
  assert.equal($("savedSum").textContent, "Saved posts");
  const chev = byClass(summary, "chev")[0];
  assert.equal(chev?.tagName, "SVG", "with a chevron");
  assert.equal(chev.getAttribute("aria-hidden"), "true");
  assert.equal(details.children[1], $("saved"), "the list sits inside the fold");
  assert.match(style, /details\[open\]\s*>\s*summary\s+\.chev\s*\{[^}]*transform:\s*rotate\(/, "the chevron turns when open");
  assert.match(style, /summary::-webkit-details-marker\s*\{[^}]*display:\s*none/, "no second, native marker");
  // Titles are ink until hovered or focused; one blue for actions. Long names in a meta line wrap.
  assert.match(style, /\.title\s*\{[^}]*color:\s*var\(--ink\)[^}]*font-weight:\s*600/);
  assert.match(style, /\.title:hover\s*,\s*\.title:focus-visible\s*\{[^}]*color:\s*var\(--blue\)/);
  assert.match(style, /\.item \.m\s*\{[^}]*overflow-wrap:\s*anywhere/);
  for (const [name, src] of [["digest.html", html], ["digest.js", js]]) {
    assert.doesNotMatch(src, /\u2014/, `${name}: no em dashes`);
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/, `${name}: builds with textContent`);
  }
  assert.doesNotMatch(html, /box-shadow/, "no shadows");
}

// A full page: every section a heading and a card of rows; the Saved posts row shows its count.
{
  const { $, doc } = await page({ store: structuredClone(STORE) });
  assert.equal($("savedSum").textContent, "Saved posts (3)");
  const savedRows = byClass($("saved"), "item");
  assert.equal(savedRows.length, 3, "one row per saved post, inside the fold");
  assert.equal(savedRows[0].parentNode.className, "group");
  assert.match(savedRows[1].children[1].textContent, /technique · evals · Sieve 0\.92$/);
  assert.equal(savedRows[2].children[0].tagName, "SPAN", "no link without a URL");

  for (const [id, heading] of [["reddit", "Reddit threads you could answer (last 24 hours)"], ["briefs", "Technique briefs (last 30 days)"], ["videos", "Videos watched for you (last 7 days)"], ["digests", "Digests"]]) {
    const [h, body] = $(id).children;
    assert.equal(h.tagName, "H2", `${id}: a section heading`);
    assert.equal(h.textContent, heading);
    assert.ok(body.className === "group" || body.classList.contains("digest"), `${id}: then its card`);
  }

  // A brief row: the title an ink link, the meta, the warning a failure note, the left-out line an
  // info note, what it is, Copy as prompt a blue text button, the read-first line.
  const briefs = byClass($("briefs"), "item");
  assert.equal(briefs.length, 2);
  const [warned, plain] = briefs;
  const kids = warned.children;
  assert.equal(kids[0].tagName, "A");
  assert.equal(kids[0].className, "title");
  assert.equal(kids[0].href, "https://x.com/a/status/1");
  assert.equal(kids[0].textContent, "Evals with golden sets");
  assert.equal(kids[1].className, "m");
  assert.deepEqual(kids.slice(2).map((k) => k.className), ["warn", "note", "w", "acts", "foot"]);
  const copy = byTag(warned, "button")[0];
  assert.equal(copy.className, "btn text");
  assert.equal(copy.textContent, "Copy as prompt");
  assert.deepEqual(plain.children.map((k) => k.className), ["title", "m", "w", "acts"], "no notes on a clean brief");

  // Reddit and videos: ink title links, meta, the learnings.
  const thread = byClass($("reddit"), "item")[0];
  assert.equal(thread.children[0].className, "title");
  assert.match(thread.children[1].textContent, /^r\/LocalLLaMA · 3h old · 14 comments when seen · still fresh$/);
  const video = byClass($("videos"), "item")[0];
  assert.equal(video.children[0].className, "title");
  assert.equal(video.children[2].textContent, "• Plan first\n• Test small");

  // A digest: a card with its date and count in meta, its headings, its bullets with author names.
  const card = byClass($("digests"), "digest")[0];
  assert.equal(card.children[0].className, "meta");
  assert.match(card.children[0].textContent, / · 4 posts · \$0\.00120$/);
  assert.deepEqual(byTag(card, "h3").map((h) => h.textContent), ["Evals", "Agents"]);
  assert.deepEqual(byTag(card, "li").map((l) => l.textContent), ["Golden sets of 20 cases (Jane Doe)", "Plan before code (Sam Lee)"]);
  assert.equal(byClass(doc.body, "btn").filter((b) => b.classList.contains("primary")).length, 1, "still one primary once rendered");
}

// Empty: briefs and digests say so in meta, with no empty card; Reddit and videos show nothing.
{
  const { $ } = await page();
  assert.equal($("savedSum").textContent, "Saved posts (0)");
  assert.equal($("reddit").children.length, 0);
  assert.equal($("videos").children.length, 0);
  for (const id of ["briefs", "digests"]) {
    const [h, p] = $(id).children;
    assert.equal(h.tagName, "H2");
    assert.equal(p.className, "empty", `${id}: an empty line in meta`);
    assert.equal($(id).children.length, 2, `${id}: no empty card`);
  }
  assert.equal($("digests").children[1].textContent, "No digests yet.");
  const [none] = $("saved").children;
  assert.equal($("saved").children.length, 1);
  assert.equal(none.className, "empty");
  assert.equal(none.textContent, "Nothing saved in the last 30 days.", "an opened, empty fold says so");
}

// A web address that isn't http(s) never becomes a link: a javascript: brief or Reddit row is plain text.
{
  const store = structuredClone(STORE);
  store.briefs["x:1"].url = "javascript:alert(1)";
  store.briefs["x:2"].url = "chrome://settings";
  store.saved[0].authorUrl = "javascript:alert(1)";
  store.saved[2].authorUrl = "data:text/html,hi";
  const { $ } = await page({ store });
  for (const row of byClass($("briefs"), "item")) {
    assert.equal(row.children[0].tagName, "SPAN", "a brief without an http(s) address is plain text");
    assert.equal(row.children[0].className, "title");
    assert.equal(row.children[0].href, "");
  }
  const thread = byClass($("reddit"), "item")[0];
  assert.equal(thread.children[0].tagName, "SPAN", "so is a Reddit row");
  assert.equal(thread.children[0].textContent, "How do you keep evals honest?");
  assert.equal(byClass($("saved"), "item")[0].children[0].tagName, "SPAN", "and a saved post");
  assert.equal(byTag($("saved"), "a").length, 1, "only the saved post with an https address links");
}

// Copy as prompt when the clipboard and execCommand both fail: a failure line and a selected, read-only
// textarea with the prompt appear after the button's row; a second click reuses them.
{
  const { Element } = await import("./fake-dom.mjs");
  const shims = { select: Element.prototype.select, after: Element.prototype.after, querySelector: Element.prototype.querySelector };
  const selected = [];
  Element.prototype.select = function () { selected.push(this); };
  Element.prototype.after = function (...nodes) {
    const parent = this.parentNode;
    const i = parent.childNodes.indexOf(this);
    for (const n of nodes) n.parentNode?.removeChild(n);
    for (const n of nodes) n.parentNode = parent;
    parent.childNodes.splice(i + 1, 0, ...nodes);
  };
  Element.prototype.querySelector = function (sel) { return all(this).find((e) => e.classList.contains(sel.slice(1))) || null; };
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("blocked"); } } } });
  try {
    const { $, doc, sent } = await page({ store: structuredClone(STORE) });
    doc.execCommand = () => false;
    doc.activeElement = null;
    const plain = byClass($("briefs"), "item")[1];
    const copy = byTag(plain, "button")[0];
    copy.click();
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(plain.children.map((k) => k.className), ["title", "m", "w", "acts", "fail", "fallback"]);
    const [fail, area] = plain.children.slice(4);
    assert.equal(fail.textContent, "The browser blocked copying. The prompt is selected below: copy it with your keyboard.");
    assert.equal(area.tagName, "TEXTAREA");
    assert.equal(area.readOnly, true);
    assert.match(area.value, /Write the plan first\./, "the textarea holds the prompt");
    assert.equal(area.getAttribute("aria-describedby"), fail.id, "the textarea points at the failure line");
    assert.equal(selected.at(-1), area, "and is selected");
    assert.equal(copy.textContent, "Copy as prompt", "the button doesn't claim it copied");
    assert.ok(!sent.some((m) => m.type === "count" && m.name === "prompt_copied"), "nothing copied, nothing counted");
    selected.length = 0;
    copy.click();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(byClass(plain, "fallback").length, 1, "a second click reuses the textarea");
    assert.equal(byClass(plain, "fail").length, 1, "and the failure line");
    assert.equal(selected.at(-1), area, "and selects it again");
  } finally {
    Object.assign(Element.prototype, shims);
    for (const [k, v] of Object.entries(shims)) if (v === undefined) delete Element.prototype[k];
    if (nav) Object.defineProperty(globalThis, "navigator", nav); else delete globalThis.navigator;
  }
}

// A section that can't render is a failure note under its heading; the others still show.
{
  const { $ } = await page({ store: { ...structuredClone(STORE), watched: { bad: { at: now, learnings: null, platform: "youtube" } } } });
  assert.equal($("videos").children[0].tagName, "H2");
  assert.equal($("videos").children[1].className, "sect-err");
  assert.match($("videos").children[1].textContent, /^Couldn't show watched videos\./);
  assert.equal(byClass($("briefs"), "item").length, 2);
}

// Summarise: the message line while it works, then alert words for a failure.
{
  const { $, sent } = await page({ answer: (m) => (m.type === "digest" ? { error: "No posts saved in that window." } : {}) });
  $("week").click();
  assert.equal($("msg").textContent, "Summarising…");
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(sent.at(-1).type, "digest");
  assert.ok($("msg").classList.contains("alert"));
  assert.equal($("msg").textContent, "No posts saved in that window.");
}

// Export library: starts a download, says so, and counts it.
{
  const { $, sent } = await page({ store: structuredClone(STORE) });
  $("export").click();
  for (let i = 0; i < 5; i++) await tick();
  assert.match($("msg").textContent, /^Export started: .+\.json\.$/);
  assert.ok(!$("msg").classList.contains("alert"));
  assert.ok(sent.some((m) => m.type === "count" && m.name === "library_exported"));
}

console.log("digest page: all checks passed");
