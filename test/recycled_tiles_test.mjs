// Offline: YouTube and X reuse a page element for another video or post (YouTube when the feed refreshes,
// X as its timeline recycles cells). What Sieve drew there for the old one has to go, and the new one has
// to be scored: on 3 Oct a YouTube tile showed another video's 0.79 with the new video's length and price.
// Runs the real youtube.js, and x.js with the scripts loaded before it, in node:vm against the fake DOM,
// with the worker stubbed. youtube-text.js isn't loaded: without it no description is asked for.
//
// The fake DOM has no selector engine, so this file adds a small one (tags, #id, .class, [attr], [attr="v"],
// [attr*="v"], [attr^="v"], :scope, descendant and child combinators, comma lists), on its own copy of the
// Element class, plus the few element helpers the two scripts reach for.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { Element, fakeDocument } from "./fake-dom.mjs";

// ---- a small selector engine, for this test only ----
const attrOf = (el, k) => {
  if (k === "class") return el.className || null;
  if (k === "id") return el.id || null;
  const v = el.getAttribute(k);
  if (v !== null) return v;
  if (k.startsWith("data-")) {
    const d = el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    return d === undefined ? null : String(d);
  }
  return null;
};
function compound(s) {
  const head = /^(\*|[a-z][\w-]*)?/i.exec(s);
  const tag = head[1] && head[1] !== "*" ? head[1].toUpperCase() : null;
  const ids = [], classes = [], attrs = [];
  let scope = false;
  for (let rest = s.slice(head[0].length), m; rest; rest = rest.slice(m[0].length)) {
    if ((m = /^#([\w-]+)/.exec(rest))) ids.push(m[1]);
    else if ((m = /^\.([\w-]+)/.exec(rest))) classes.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:([*^]?=)(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest))) attrs.push({ k: m[1], op: m[2], v: m[3] ?? m[4] });
    else if ((m = /^:scope/.exec(rest))) scope = true;
    else throw new Error(`test selector engine can't read ${s}`);
  }
  return (el, root) => (!tag || el.tagName === tag) && (!scope || el === root)
    && ids.every((i) => el.id === i) && classes.every((c) => el.classList.contains(c))
    && attrs.every(({ k, op, v }) => {
      const a = attrOf(el, k);
      if (a === null) return false;
      return !op || (op === "=" ? a === v : op === "*=" ? a.includes(v) : a.startsWith(v));
    });
}
function complex(sel) {
  const tokens = sel.trim().replace(/\s*>\s*/g, " > ").split(/\s+/);
  const parts = [];
  let comb = " ";
  for (const t of tokens) { if (t === ">") { comb = ">"; continue; } parts.push({ comb, test: compound(t) }); comb = " "; }
  const from = (el, i, root) => {
    if (!parts[i].test(el, root)) return false;
    if (i === 0) return true;
    if (parts[i].comb === ">") return el.parentNode instanceof Element && from(el.parentNode, i - 1, root);
    for (let p = el.parentNode; p instanceof Element; p = p.parentNode) if (from(p, i - 1, root)) return true;
    return false;
  };
  return (el, root) => from(el, parts.length - 1, root);
}
const selector = (sel) => { const list = sel.split(",").map(complex); return (el, root) => list.some((f) => f(el, root)); };
const descendants = (root) => root.children.flatMap((c) => [c, ...descendants(c)]);
Object.defineProperties(Element.prototype, {
  innerText: { get() { return this.textContent; } },
  parentElement: { get() { return this.parentNode instanceof Element ? this.parentNode : null; } },
  previousElementSibling: { get() { const s = this.parentNode?.children || []; return s[s.indexOf(this) - 1] || null; } },
});
Object.assign(Element.prototype, {
  querySelectorAll(sel) { const m = selector(sel); return descendants(this).filter((e) => m(e, this)); },
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  closest(sel) { const m = selector(sel); for (let p = this; p instanceof Element; p = p.parentNode) if (m(p, null)) return p; return null; },
  hasAttribute(k) { return this.getAttribute(k) !== null; },
  removeAttribute(k) { delete this.attrs[k]; },
  before(node) {
    const p = this.parentNode;
    node.parentNode?.removeChild(node);
    node.parentNode = p;
    p.childNodes.splice(p.childNodes.indexOf(this), 0, node);
  },
  dispatchEvent(e) { e.target = this; for (const fn of this.ownerDocument.captures[e.type] || []) fn(e); return true; },
  focus() {},
});

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const flush = () => new Promise((r) => setImmediate(r));

// Loads `scripts` on a page holding `items`, with the worker answering classify from `scores` (by the
// title or post text it was sent), or holding the answer back when `hold` is set.
function load({ scripts, origin, items, scores, hold = false }) {
  const document = fakeDocument();
  document.captures = {};
  document.addEventListener = (type, fn) => { (document.captures[type] ||= []).push(fn); };
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  document.querySelector = (sel) => document.body.querySelector(sel);
  document.scripts = [];
  const feed = document.createElement("div");
  document.body.append(feed);
  const els = items.map((make) => { const e = make(document); feed.append(e); return e; });
  const classified = [];
  const held = [];
  let seenCb = null;
  let scanCb = null;
  const sandbox = {
    document,
    location: { origin, href: `${origin}/`, pathname: "/" },
    URL,
    innerHeight: 800,
    getComputedStyle: () => ({ backgroundColor: "rgb(255, 255, 255)", position: "relative" }),
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; } },
    IntersectionObserver: class { constructor(cb) { seenCb = cb; } observe() {} },
    MutationObserver: class { constructor(cb) { scanCb = cb; } observe() {} },
    navigator: {},
    chrome: {
      runtime: {
        id: "test",
        lastError: undefined,
        sendMessage: (msg, cb) => {
          if (msg.type !== "classify") return cb?.({ ok: true });
          const what = msg.state.title ?? msg.state.post;
          classified.push(what);
          const answer = () => cb(scores[what] || { error: "unexpected" });
          if (hold) held.push({ what, answer }); else answer();
        },
      },
      storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } },
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of scripts) vm.runInContext(read(f), ctx, { filename: f });
  return {
    document, els, classified, held,
    see: (el) => seenCb([{ isIntersecting: true, target: el }]), // on screen and stays (the dwell runs at once)
    leave: (el) => seenCb([{ isIntersecting: false, target: el }]),
    scan: () => scanCb(), // the page changed
    release: (what) => { const i = held.findIndex((h) => h.what === what); held.splice(i, 1)[0].answer(); },
  };
}

// ======== YouTube ========
const LAKERS = { id: "ajtJvlVCq_U", title: "My Lakers Teammates Weren't Ready for Slovenia", channel: "Luka", length: "24:44" };
const EVALS = { id: "evalsInCI01", title: "Evals in CI, step by step", channel: "Ana", length: "12:00" };
const CACHE = { id: "promptCache", title: "Prompt caching that actually pays off", channel: "Ben", length: "8:30" };
const YT_SCORES = {
  [EVALS.title]: { tier: "strong", kind: "talk", worth: 0.79, topic: "evals", reason: "a real setup" },
  [LAKERS.title]: { tier: "low", lowMode: "fade", kind: "entertainment", worth: 0.04, topic: "", reason: "" },
  [CACHE.title]: { tier: "maybe", kind: "tutorial", worth: 0.55, topic: "caching", reason: "" },
};

// A home tile, shaped like ytd-rich-item-renderer as far as youtube.js reads it.
function tile(v) {
  return (doc) => {
    const t = doc.createElement("ytd-rich-item-renderer");
    const thumb = doc.createElement("ytd-thumbnail");
    const a = doc.createElement("a");
    a.id = "thumbnail";
    const badge = doc.createElement("badge-shape");
    thumb.append(a, badge);
    const h3 = doc.createElement("h3");
    const title = doc.createElement("a");
    title.id = "video-title";
    h3.append(title);
    const chan = doc.createElement("ytd-channel-name");
    const ca = doc.createElement("a");
    chan.append(ca);
    t.append(thumb, h3, chan);
    show(t, v);
    return t;
  };
}
// YouTube puts another video in the same tile: same elements, new link, title, channel and length.
function show(t, v) {
  const [a, badge] = t.querySelector("ytd-thumbnail").children;
  const title = t.querySelector("#video-title");
  a.setAttribute("href", `/watch?v=${v.id}`);
  title.setAttribute("href", `/watch?v=${v.id}`);
  title.setAttribute("title", v.title);
  title.textContent = v.title;
  const ca = t.querySelector("ytd-channel-name a");
  ca.setAttribute("href", `/@${v.channel}`);
  ca.textContent = v.channel;
  badge.textContent = v.length;
}
const YT = { scripts: ["watch-drawer.js", "youtube.js"], origin: "https://www.youtube.com", scores: YT_SCORES };
const chips = (t) => t.querySelectorAll(".sieve-yt-chip");
const chipText = (t) => chips(t).map((c) => c.textContent);

// 1. The 3 Oct bug: a tile scored for one video gets another. The old chip and classes go, the new video
// is scored without scrolling away and back, and its own verdict is drawn, with its own length.
{
  const p = load({ ...YT, items: [tile(EVALS)] });
  const [t] = p.els;
  p.see(t);
  await flush();
  assert.deepEqual(chipText(t), ["Sieve 0.79 · talkWatch it for me · ~3¢"]);
  assert.equal(chips(t)[0].dataset.key, EVALS.id, "the chip says which video it was drawn for");
  assert.ok(t.classList.contains("sieve-yt-strong"));

  show(t, LAKERS);
  p.scan();
  await flush();
  assert.deepEqual(p.classified, [EVALS.title, LAKERS.title], "the new video is scored, once");
  assert.deepEqual(chipText(t), ["Sieve 0.04 · entertainment"], "one chip, the new video's own");
  assert.equal(chips(t)[0].dataset.key, LAKERS.id);
  assert.equal(t.dataset.jevKey, LAKERS.id);
  assert.ok(!t.classList.contains("sieve-yt-strong"), "the old video's strong class is gone");
  assert.ok(t.classList.contains("jev-low"), "the new video's own fade");
}

// 2. Nothing changed: the chip stays, and the video isn't scored again. Then the tile leaves the screen
// and YouTube swaps its video: the old verdict goes, and nothing is scored until the tile is seen again.
{
  const p = load({ ...YT, items: [tile(EVALS)] });
  const [t] = p.els;
  p.see(t);
  await flush();
  p.scan();
  p.see(t);
  await flush();
  assert.equal(chips(t).length, 1);
  assert.deepEqual(p.classified, [EVALS.title]);

  p.leave(t);
  show(t, LAKERS);
  p.scan();
  await flush();
  assert.equal(chips(t).length, 0, "the old chip is gone");
  assert.ok(!t.classList.contains("sieve-yt-strong"));
  assert.equal(t.dataset.jevKey, undefined);
  assert.deepEqual(p.classified, [EVALS.title], "not on screen: nothing scored yet");
  p.see(t);
  await flush();
  assert.deepEqual(p.classified, [EVALS.title, LAKERS.title]);
  assert.deepEqual(chipText(t), ["Sieve 0.04 · entertainment"]);
}

// 3. The answer for the old video arrives after YouTube swapped the video, before scan() ran: it isn't
// drawn on the tile. The new video's answer is.
{
  const p = load({ ...YT, items: [tile(EVALS)], hold: true });
  const [t] = p.els;
  p.see(t);
  await flush();
  assert.deepEqual(p.held.map((h) => h.what), [EVALS.title]);
  show(t, LAKERS);
  p.release(EVALS.title);
  assert.equal(chips(t).length, 0, "the old answer isn't drawn on the new video");
  p.scan();
  await flush();
  assert.deepEqual(p.held.map((h) => h.what), [LAKERS.title]);
  p.release(LAKERS.title);
  assert.deepEqual(chipText(t), ["Sieve 0.04 · entertainment"]);
}

// 4. A tile swapped to a video already scored on this page is drawn from the result, not scored again;
// and a chip for another video left on a tile (whatever put it there) is replaced on the next scan.
{
  const p = load({ ...YT, items: [tile(EVALS), tile(CACHE)] });
  const [a, b] = p.els;
  p.see(a);
  p.see(b);
  await flush();
  show(b, EVALS);
  p.scan();
  await flush();
  assert.deepEqual(p.classified, [EVALS.title, CACHE.title], "EVALS was scored already");
  assert.deepEqual(chipText(b), ["Sieve 0.79 · talkWatch it for me · ~3¢"]);
  assert.ok(b.classList.contains("sieve-yt-strong"));

  chips(a)[0].dataset.key = CACHE.id;
  p.scan();
  assert.equal(chips(a).length, 1);
  assert.equal(chips(a)[0].dataset.key, EVALS.id, "a chip drawn for another video is replaced");
}

// ======== X ========
const ID_A = "2017742741636321619";
const ID_B = "2017742743125299476";
const TEXT_A = "Run your evals in CI on every pull request and pin the model version so the scores stay comparable.";
const TEXT_B = "Hot take: nobody reads release notes and that is fine, honestly, it has always been this way for me.";
const X_SCORES = {
  [TEXT_A]: { tier: "strong", kind: "technique", worth: 0.91, topic: "evals", reason: "a concrete setup" },
  [TEXT_B]: { tier: "low", lowMode: "fade", kind: "opinion", worth: 0.12, topic: "", reason: "" },
};
// One X post, shaped like X's markup as far as x.js reads it.
function article({ handle, id, text }) {
  return (doc) => {
    const a = doc.createElement("article");
    a.setAttribute("data-testid", "tweet");
    const user = doc.createElement("div");
    user.setAttribute("data-testid", "User-Name");
    const link = doc.createElement("a");
    link.append(doc.createElement("time"));
    const t = doc.createElement("div");
    t.setAttribute("data-testid", "tweetText");
    a.append(user, link, t);
    post(a, { handle, id, text });
    return a;
  };
}
// X draws another post in the same article element.
function post(a, { handle, id, text }) {
  a.querySelector('[data-testid="User-Name"]').textContent = `${handle} @${handle}`;
  a.querySelector("a").setAttribute("href", `/${handle}/status/${id}`);
  a.querySelector('[data-testid="tweetText"]').textContent = text;
}
const X = { scripts: ["brief-panel.js", "watch-drawer.js", "x-thread.js", "x.js"], origin: "https://x.com", scores: X_SCORES };
const badge = (a) => { const w = a.previousElementSibling; return w?.classList.contains("sieve-x-wrap") ? w.textContent : null; };

// 5. The same on X: a post scored strong, then X draws another post in its element.
{
  const p = load({ ...X, items: [article({ handle: "alice", id: ID_A, text: TEXT_A })] });
  const [a] = p.els;
  p.see(a);
  assert.match(badge(a), /^Sieve 0\.91 · technique to try/);
  assert.ok(a.classList.contains("sieve-x-strong"));

  post(a, { handle: "bob", id: ID_B, text: TEXT_B });
  p.scan();
  assert.deepEqual(p.classified, [TEXT_A, TEXT_B], "the new post is scored, without scrolling away and back");
  assert.match(badge(a), /^Sieve 0\.12 · opinion/);
  assert.equal(p.document.querySelectorAll(".sieve-x-wrap").length, 1, "one wrap, the new post's");
  assert.ok(!a.classList.contains("sieve-x-strong"), "the old post's class is gone");
  assert.ok(a.classList.contains("jev-low"));
}

// 6. X draws a short post (nothing to score) in the element: the old badge goes and nothing replaces it.
{
  const p = load({ ...X, items: [article({ handle: "alice", id: ID_A, text: TEXT_A })] });
  const [a] = p.els;
  p.see(a);
  post(a, { handle: "bob", id: ID_B, text: "gm" });
  p.scan();
  assert.equal(badge(a), null);
  assert.equal(a.dataset.jevKey, undefined);
  assert.ok(!a.classList.contains("sieve-x-strong"));
  assert.deepEqual(p.classified, [TEXT_A]);
}

// 7. The old post's answer arrives after X swapped the post, before scan() ran: it isn't drawn.
{
  const p = load({ ...X, items: [article({ handle: "alice", id: ID_A, text: TEXT_A })], hold: true });
  const [a] = p.els;
  p.see(a);
  post(a, { handle: "bob", id: ID_B, text: TEXT_B });
  p.release(TEXT_A);
  assert.equal(badge(a), null, "the old answer isn't drawn on the new post");
  p.scan();
  p.release(TEXT_B);
  assert.match(badge(a), /^Sieve 0\.12 · opinion/);
}

console.log("recycled tiles: all checks passed");
