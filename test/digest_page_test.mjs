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

// The page itself: header, the one primary, the actions, the folded Saved posts row.
{
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(html, /<h1>Daily learnings<\/h1>/);
  assert.match(html, /<svg class="nib"[^>]*aria-hidden="true"/, "the blue nib under the screen name");
  assert.match(html, /<p class="sub">What Sieve kept from your feeds\. What people posted, not verified facts\.<\/p>/);
  assert.equal(html.match(/class="btn primary"/g)?.length, 1, "one primary on the page");
  assert.match(html, /<button type="button" class="btn primary" id="today">Summarise since last digest<\/button>/);
  assert.match(html, /<button type="button" class="btn secondary" id="day">Last 24 hours<\/button>/);
  assert.match(html, /<button type="button" class="btn secondary" id="week">Last 7 days<\/button>/);
  assert.match(html, /<button type="button" class="btn text" id="export">Export library<\/button>/);
  assert.match(html, /id="msg"[^>]*role="status"/, "the message line is announced");
  // The folded list: a <details> that starts closed, its summary a row with the count and a chevron.
  const details = html.match(/<details([^>]*)>\s*<summary([^>]*)>([\s\S]*?)<\/summary>/);
  assert.ok(details, "Saved posts is a <details> that opens on its summary");
  assert.doesNotMatch(details[1], /\sopen/, "it starts folded");
  assert.match(details[2], /class="row"/, "its summary is a row");
  assert.match(details[3], /<span id="savedSum">Saved posts<\/span>/);
  assert.match(details[3], /<svg class="chev"[^>]*aria-hidden="true"/, "with a chevron");
  assert.match(style, /details\[open\]\s*>\s*summary\s+\.chev\s*\{[^}]*transform:\s*rotate\(/, "the chevron turns when open");
  assert.match(style, /summary::-webkit-details-marker\s*\{[^}]*display:\s*none/, "no second, native marker");
  // Titles are ink until hovered or focused; one blue for actions.
  assert.match(style, /\.title\s*\{[^}]*color:\s*var\(--ink\)[^}]*font-weight:\s*600/);
  assert.match(style, /\.title:hover\s*,\s*\.title:focus-visible\s*\{[^}]*color:\s*var\(--blue\)/);
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
