// Offline: x.js wired to x-thread.js, x-post-data.js's page summaries and the watch drawer. Runs the real
// brief-panel.js, watch-drawer.js, x-thread.js and x.js in node:vm against the fake DOM, with the worker
// stubbed. x-post-data.js itself isn't run here (it needs X's React data; x_post_data_test covers it): a
// listener on the document plays its part, writing data-sieve-x synchronously when x.js asks.
//
// The fake DOM has no selector engine, so this file adds, on its own copy of the Element class, just what
// x.js reaches for: querySelector(All) for the handful of selectors it uses, innerHTML for the brief
// panel's fixed template, sibling and event helpers.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { Element, fakeDocument } from "./fake-dom.mjs";

// ---- the few DOM features x.js needs, added for this test only ----
const attrOf = (el, k) => {
  const v = el.getAttribute(k);
  if (v !== null) return v;
  if (k.startsWith("data-")) {
    const d = el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    return d === undefined ? null : String(d);
  }
  return null;
};
const compound = (sel) => {
  const m = sel.match(/^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) throw new Error(`test selector engine can't read ${sel}`);
  const classes = m[2].split(".").filter(Boolean);
  const attrs = [...m[3].matchAll(/\[([\w-]+)(?:(\*?=)"([^"]*)")?\]/g)].map(([, k, op, v]) => ({ k, op, v }));
  return (el) => (!m[1] || el.tagName === m[1].toUpperCase())
    && classes.every((c) => el.classList.contains(c))
    && attrs.every(({ k, op, v }) => { const a = attrOf(el, k); return a !== null && (!op || (op === "=" ? a === v : a.includes(v))); });
};
const matches = (el, sel) => {
  const parts = sel.trim().split(/\s+/).map(compound);
  if (!parts.at(-1)(el)) return false;
  let i = parts.length - 2;
  for (let p = el.parentNode; p && i >= 0; p = p.parentNode) if (p instanceof Element && parts[i](p)) i--;
  return i < 0;
};
const descendants = (root) => root.children.flatMap((c) => [c, ...descendants(c)]);
Object.defineProperties(Element.prototype, {
  innerText: { get() { return this.textContent; } },
  parentElement: { get() { return this.parentNode instanceof Element ? this.parentNode : null; } },
  previousElementSibling: { get() { const s = this.parentNode?.children || []; return s[s.indexOf(this) - 1] || null; } },
  innerHTML: {
    set(html) {
      this.replaceChildren();
      const stack = [this];
      for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
        if (text !== undefined) { if (text.trim()) stack.at(-1).append(text); continue; }
        if (close) { stack.pop(); continue; }
        const n = this.ownerDocument.createElement(tag);
        for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) { if (k === "class") n.className = v; else n.setAttribute(k, v); }
        stack.at(-1).append(n);
        stack.push(n);
      }
    },
  },
});
Object.assign(Element.prototype, {
  querySelectorAll(sel) { return descendants(this).filter((e) => matches(e, sel)); },
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  removeAttribute(k) { delete this.attrs[k]; },
  before(node) {
    const p = this.parentNode;
    node.parentNode?.removeChild(node);
    node.parentNode = p;
    p.childNodes.splice(p.childNodes.indexOf(this), 0, node);
  },
  dispatchEvent(e) {
    e.target = this;
    const doc = this.ownerDocument;
    for (const fn of doc.captures[e.type] || []) fn(e);
    return true;
  },
  focus() {},
});

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const SCRIPTS = ["brief-panel.js", "watch-drawer.js", "x-thread.js", "x.js"].map((f) => [f, read(f)]);

const ID_A = "2017742741636321619";
const ID_B = "2017742743125299476";
const ID_C = "2017742749999999999";
const PHOTO_A = "https://pbs.twimg.com/media/A.jpg";
const PHOTO_B = "https://pbs.twimg.com/media/B.jpg";
const MP4 = "https://video.twimg.com/v/c.mp4?tag=14";
const LONG = "Run your evals in CI on every pull request and pin the model version so the scores stay comparable.";
const SCORE = { tier: "strong", kind: "technique", worth: 0.91, topic: "evals", reason: "a concrete setup", scorer: "openrouter" };

// One X post, shaped like X's markup as far as x.js reads it.
function article(doc, { handle, id, text, name = "Alice" }) {
  const a = doc.createElement("article");
  a.setAttribute("data-testid", "tweet");
  const user = doc.createElement("div");
  user.setAttribute("data-testid", "User-Name");
  user.append(`${name} @${handle}`);
  const link = doc.createElement("a");
  link.setAttribute("href", `/${handle}/status/${id}`);
  link.append(doc.createElement("time"));
  a.append(user, link);
  if (text) {
    const t = doc.createElement("div");
    t.setAttribute("data-testid", "tweetText");
    t.append(text);
    a.append(t);
  }
  return a;
}

// Loads the four scripts with `posts` already on the page. `summaries` maps a post element to the JSON
// x-post-data.js would write for it; a post that isn't in it gets nothing, as when the reader finds none.
function load({ path = "/home", posts = [], summaries = new Map(), score = SCORE }) {
  const document = fakeDocument();
  document.captures = {};
  document.addEventListener = (type, fn) => { (document.captures[type] ||= []).push(fn); };
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  document.addEventListener("sieve-x-post", (e) => { const j = summaries.get(e.target); if (j) e.target.setAttribute("data-sieve-x", j); });
  const feed = document.createElement("div");
  document.body.append(feed);
  for (const p of posts) feed.append(p(document));
  const sent = [];
  let seenCb = null;
  const sandbox = {
    document,
    location: { pathname: path },
    URL,
    innerHeight: 800,
    getComputedStyle: () => ({ backgroundColor: "rgb(255, 255, 255)" }),
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; } },
    IntersectionObserver: class { constructor(cb) { seenCb = cb; } observe() {} },
    MutationObserver: class { observe() {} },
    navigator: {},
    chrome: {
      runtime: {
        id: "test",
        lastError: undefined,
        sendMessage: (msg, cb) => {
          sent.push(msg);
          if (msg.type === "classify") cb(score);
          else if (msg.type === "brief") cb({ error: "stubbed" });
          else cb({ ok: true });
        },
      },
      storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const [f, src] of SCRIPTS) vm.runInContext(src, ctx, { filename: f });
  const all = () => document.querySelectorAll('article[data-testid="tweet"]');
  // The post comes into view and stays: x.js checks it (the dwell timer runs at once here).
  const see = (post) => seenCb([{ isIntersecting: true, target: post }]);
  const wrapOf = (post) => post.previousElementSibling;
  const buttons = (post) => wrapOf(post).querySelectorAll("button");
  const button = (post, re) => buttons(post).find((b) => re.test(b.textContent));
  return { document, sandbox, sent, all, see, wrapOf, buttons, button };
}
const summary = (o) => JSON.stringify(o);
const plain = (v) => JSON.parse(JSON.stringify(v));
const lastBrief = (sent) => plain(sent.filter((m) => m.type === "brief").at(-1));

// 1. A two-post thread on a post's page: both posts are read as they appear, the short second post
// included (it's never scored), and Brief on the first sends the thread and both pictures.
{
  const summaries = new Map();
  const A = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG, photos: [PHOTO_A], hasReplies: true, startsThread: true })); return a; };
  const B = (d) => { const b = article(d, { handle: "alice", id: ID_B, text: "2/ and cache it." }); summaries.set(b, summary({ id: ID_B, author: "alice", replyTo: ID_A, replyToAuthor: "alice", text: "2/ and cache it.", photos: [PHOTO_B] })); return b; };
  const t = load({ path: `/alice/status/${ID_A}`, posts: [A, B], summaries });
  const [a, b] = t.all();
  t.see(a); // b is never checked: on a post's page, it was read when it appeared on the page
  assert.equal(t.sent.filter((m) => m.type === "classify").length, 1, "only the long post is scored");
  assert.equal(b.previousElementSibling?.classList.contains("sieve-x-wrap") ?? false, false, "no badge on a short post without a video");
  assert.deepEqual(t.buttons(a).map((x) => x.textContent), ["Brief"], "no video, no Watch it for me");
  t.button(a, /^Brief$/).click();
  const m = lastBrief(t.sent);
  assert.equal(m.type, "brief");
  assert.equal(m.again, false);
  assert.deepEqual(m.post.posts, [{ text: LONG }, { text: "2/ and cache it." }]);
  assert.deepEqual(m.post.photos, [PHOTO_A, PHOTO_B]);
  assert.equal(m.post.photoCount, 2);
  assert.equal(m.post.text, `${LONG}\n\n2/ and cache it.`);
  assert.equal(m.post.postUrl, `https://x.com/alice/status/${ID_A}`);
  assert.equal(m.post.platform, "x");
  assert.equal(m.post.key, a.dataset.jevKey, "the key stays the clicked post's");
  const note = t.wrapOf(a).querySelector(".jev-draft-note").textContent;
  assert.equal(note, "A brief for your coding agent. Read 2 posts by @alice.");
}

// 1b. In the feed, posts aren't read as they appear, only when checked; a short post that is checked is
// still read, though it's never scored, so the thread holds together.
{
  const summaries = new Map();
  const A = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG, hasReplies: true })); return a; };
  const B = (d) => { const b = article(d, { handle: "alice", id: ID_B, text: "2/ and cache it." }); summaries.set(b, summary({ id: ID_B, author: "alice", replyTo: ID_A, replyToAuthor: "alice", text: "2/ and cache it." })); return b; };
  const t = load({ path: "/home", posts: [A, B], summaries });
  const [a, b] = t.all();
  t.see(a);
  t.button(a, /^Brief$/).click();
  assert.equal(lastBrief(t.sent).post.posts, undefined, "b wasn't read yet");
  t.see(b);
  assert.equal(t.sent.filter((m) => m.type === "classify").length, 1, "b is too short to score");
  t.wrapOf(a).querySelector('[data-a="again"]').click();
  const m = lastBrief(t.sent);
  assert.equal(m.again, true);
  assert.deepEqual(m.post.posts, [{ text: LONG }, { text: "2/ and cache it." }]);
}

// 2. A post with a video gets Watch it for me next to Brief; pressing it opens the drawer and asks the
// worker to watch the X video.
{
  const summaries = new Map();
  const V = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG, video: { mp4: MP4, seconds: 120 } })); return a; };
  const t = load({ posts: [V], summaries });
  const [a] = t.all();
  t.see(a);
  assert.deepEqual(t.buttons(a).map((x) => x.textContent), ["Brief", "Watch it for me · <1¢"]);
  t.button(a, /^Watch it for me/).click();
  const w = plain(t.sent.at(-1));
  assert.deepEqual(w, { type: "watch", platform: "x", id: ID_A, url: `https://x.com/alice/status/${ID_A}`, video: MP4, title: LONG.slice(0, 80).trimEnd() + "...", channel: "@alice", caption: LONG, seconds: 120, again: false });
  const drawer = t.document.getElementById("sieve-drawer");
  assert.ok(drawer, "the drawer opened");
  assert.ok(drawer.textContent.includes("@alice"), "the drawer names the author");
  // Brief in the feed sends the full text and no thread fields for a single post.
  t.button(a, /^Brief$/).click();
  const m = lastBrief(t.sent);
  assert.equal(m.post.posts, undefined);
  assert.deepEqual(m.post.photos, []);
  assert.equal(m.post.photoCount, 0);
}

// 3. A low post with a video: the quiet badge, no Brief, but Watch it for me. A hidden one: nothing.
{
  for (const [lowMode, want] of [["fade", ["Watch it for me · <1¢"]], ["hide", null]]) {
    const summaries = new Map();
    const V = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG, video: { mp4: MP4, seconds: 120 } })); return a; };
    const t = load({ posts: [V], summaries, score: { ...SCORE, tier: "low", lowMode } });
    const [a] = t.all();
    t.see(a);
    if (want) {
      assert.deepEqual(t.buttons(a).map((x) => x.textContent), want);
      assert.ok(t.wrapOf(a).querySelector(".jev-badge").classList.contains("jev-quiet"));
    } else {
      assert.ok(a.classList.contains("jev-hidden"));
      assert.deepEqual(t.buttons(a), []);
    }
  }
}

// 4. A video post with too few words to score still gets Watch it for me, on a quiet "Sieve" badge.
{
  const summaries = new Map();
  const S = (d) => { const a = article(d, { handle: "alice", id: ID_C, text: "look" }); summaries.set(a, summary({ id: ID_C, author: "alice", text: "look", video: { mp4: MP4, seconds: 30 } })); return a; };
  const t = load({ posts: [S], summaries });
  const [a] = t.all();
  t.see(a);
  assert.equal(t.sent.filter((m) => m.type === "classify").length, 0);
  assert.equal(t.wrapOf(a).querySelector(".jev-badge").textContent, "Sieve" + "Watch it for me · <1¢");
  t.see(a); // seen again: drawn once, not twice
  assert.equal(t.wrapOf(a).querySelectorAll(".jev-badge").length, 1);
  t.button(a, /^Watch it for me/).click();
  assert.equal(t.sent.at(-1).type, "watch");
  assert.equal(t.sent.at(-1).id, ID_C);
}

// Today's brief message for a post, as x.js sent it before page summaries existed.
const todays = (a, text) => ({ key: a.dataset.jevKey, platform: "x", authorName: "Alice", authorUrl: `https://x.com/alice/status/${ID_A}`, text, topic: SCORE.topic, kind: SCORE.kind, worth: SCORE.worth, scorer: SCORE.scorer });

// 5. A summary whose id isn't the post's own link (the reader landed on another post) is ignored: Brief
// sends today's post, and its video gets no button.
{
  const summaries = new Map();
  const A = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_B, author: "alice", text: "someone else's words", photos: [PHOTO_B], video: { mp4: MP4, seconds: 60 } })); return a; };
  const t = load({ path: `/alice/status/${ID_A}`, posts: [A], summaries });
  const [a] = t.all();
  t.see(a);
  assert.deepEqual(t.buttons(a).map((x) => x.textContent), ["Brief"]);
  t.button(a, /^Brief$/).click();
  assert.deepEqual(lastBrief(t.sent), { type: "brief", post: todays(a, LONG), again: false });
  assert.equal(a.dataset.sieveXId, undefined);
  assert.equal(t.wrapOf(a).querySelector(".jev-draft-note").textContent, "A brief for your coding agent.");
}

// 6. No summary at all (x-post-data.js missing, or X changed): exactly today's message.
{
  const A = (d) => article(d, { handle: "alice", id: ID_A, text: LONG });
  const t = load({ posts: [A] });
  const [a] = t.all();
  t.see(a);
  assert.deepEqual(t.buttons(a).map((x) => x.textContent), ["Brief"]);
  t.button(a, /^Brief$/).click();
  assert.deepEqual(lastBrief(t.sent), { type: "brief", post: todays(a, LONG), again: false });
  // A summary that fails x-thread.js's checks counts as none.
  const summaries = new Map();
  const bad = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG, photos: ["http://pbs.twimg.com/media/A.jpg"] })); return a; };
  const u = load({ posts: [bad], summaries });
  const [b] = u.all();
  u.see(b);
  u.button(b, /^Brief$/).click();
  assert.deepEqual(lastBrief(u.sent), { type: "brief", post: todays(b, LONG), again: false });
}

// 7. The attribute is read and cleared in the same step: nothing is left on the post for X to see.
{
  const summaries = new Map();
  const A = (d) => { const a = article(d, { handle: "alice", id: ID_A, text: LONG }); summaries.set(a, summary({ id: ID_A, author: "alice", text: LONG })); return a; };
  const t = load({ posts: [A], summaries });
  const [a] = t.all();
  t.see(a);
  assert.equal(a.getAttribute("data-sieve-x"), null);
  assert.equal(a.dataset.sieveXId, ID_A);
}

console.log("x page: all checks passed");
