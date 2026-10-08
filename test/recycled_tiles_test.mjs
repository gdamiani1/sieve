// Offline: YouTube and X reuse a page element for another video or post (YouTube when the feed refreshes
// and on its watch page, X as its timeline recycles cells). What Sieve drew there for the old one has to go, and the new one has
// to be scored: on 3 Oct a YouTube tile showed another video's 0.79 with the new video's length and price.
// Runs the real youtube.js, and x.js with the scripts loaded before it, in node:vm against the fake DOM,
// with the worker stubbed. youtube-text.js isn't loaded: without it no description is asked for.
//
// The fake DOM has no selector engine, so this file adds a small one (tags, #id, .class, [attr], [attr="v"],
// [attr*="v"], [attr^="v"], :scope, descendant and child combinators, comma lists), patched onto fake-dom's
// Element prototype as x_page_test does, plus the few element helpers the two scripts reach for.
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
  after(node) {
    const p = this.parentNode;
    node.parentNode?.removeChild(node);
    node.parentNode = p;
    p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, node);
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
  const sent = []; // every other message to the worker; a watch request is never answered
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
          if (msg.type !== "classify") { sent.push(msg); return msg.type === "watch" ? undefined : cb?.({ ok: true }); }
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
    document, els, classified, held, sent, location: sandbox.location,
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

// 4b. A tile that stops linking to a video (here a Short): the old chip and classes go, nothing is scored.
// When the same video's link comes back, it's drawn from the result already in hand, without a new call.
const toShort = (t) => { t.querySelector("ytd-thumbnail").children[0].setAttribute("href", "/shorts/abc"); t.querySelector("#video-title").setAttribute("href", "/shorts/abc"); };
{
  const p = load({ ...YT, items: [tile(EVALS)] });
  const [t] = p.els;
  p.see(t);
  await flush();
  toShort(t);
  p.scan();
  await flush();
  assert.equal(chips(t).length, 0, "no chip, and no Watch button for the old video");
  assert.ok(!t.classList.contains("sieve-yt-strong"));
  assert.deepEqual(p.classified, [EVALS.title], "a Short isn't scored");

  show(t, EVALS);
  p.scan();
  await flush();
  assert.deepEqual(chipText(t), ["Sieve 0.79 · talkWatch it for me · ~3¢"]);
  assert.ok(t.classList.contains("sieve-yt-strong"));
  assert.deepEqual(p.classified, [EVALS.title], "redrawn from the result, no new call");
}

// 4c. A hidden low tile becomes a Short: it isn't left hidden.
{
  const p = load({ ...YT, items: [tile(LAKERS)], scores: { ...YT_SCORES, [LAKERS.title]: { ...YT_SCORES[LAKERS.title], lowMode: "hide" } } });
  const [t] = p.els;
  p.see(t);
  await flush();
  assert.ok(t.classList.contains("jev-hidden"));
  toShort(t);
  p.scan();
  assert.ok(!t.classList.contains("jev-hidden"));
  assert.deepEqual(p.classified, [LAKERS.title]);
}

// 4d. A, then B, then A again while A's answer is still out: A is drawn once, on this tile, and B's late
// answer draws nothing.
{
  const p = load({ ...YT, items: [tile(EVALS), tile(CACHE)], hold: true });
  const [t, other] = p.els;
  p.see(t);
  await flush();
  show(t, LAKERS);
  p.scan();
  await flush();
  show(t, EVALS);
  p.scan();
  await flush();
  assert.deepEqual(p.held.map((h) => h.what), [EVALS.title, LAKERS.title], "A isn't asked for twice");
  p.release(EVALS.title);
  assert.deepEqual(chipText(t), ["Sieve 0.79 · talkWatch it for me · ~3¢"]);
  p.release(LAKERS.title);
  assert.equal(chips(t).length, 1);
  assert.equal(chips(t)[0].dataset.key, EVALS.id);
  assert.equal(chips(other).length, 0, "the other tile, never seen, has nothing");
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

// 8. A post first checked before X drew its link: the link appearing later isn't a reuse, and an open
// Brief stays.
{
  const p = load({ ...X, items: [article({ handle: "alice", id: ID_A, text: TEXT_A })] });
  const [a] = p.els;
  const link = a.querySelector("a");
  link.removeAttribute("href");
  p.see(a);
  const wrap = a.previousElementSibling;
  assert.match(badge(a), /^Sieve 0\.91/);
  link.setAttribute("href", `/alice/status/${ID_A}`);
  p.scan();
  assert.equal(a.previousElementSibling, wrap, "the same wrap, not redrawn");
  assert.ok(a.classList.contains("sieve-x-strong"));
  assert.deepEqual(p.classified, [TEXT_A]);
}

// ======== YouTube's watch page ========
// 9. The watch page after moving to another video inside the page (8 Oct: the drawer for a 49-minute
// video showed the title, channel and length of the video watched before it). YouTube changes the address
// first and the title, channel and video-id a moment later, and its duration meta tag keeps the first
// video's length for good. The button waits until the page describes the video in the address, then reads
// the title, channel and length from the player's JSON-LD, which names its own video.
const SUPERBACKED = { id: "0rEqaUnWoD0", title: "Superbacked 2 is open source", channel: "Sun Knudsen", duration: "PT2934S" };
const EVALS_PAGE = { id: EVALS.id, title: EVALS.title, channel: EVALS.channel, duration: "PT720S" };
function watchPage(v) {
  return (doc) => {
    const page = doc.createElement("div");
    const meta = doc.createElement("ytd-watch-metadata");
    const host = doc.createElement("div");
    host.id = "title";
    host.append(doc.createElement("h1"));
    const chan = doc.createElement("ytd-channel-name");
    chan.append(doc.createElement("a"));
    meta.append(host, chan);
    const micro = doc.createElement("player-microformat-renderer");
    const ld = doc.createElement("script");
    ld.setAttribute("type", "application/ld+json");
    micro.append(ld);
    const tag = doc.createElement("meta"); // what YouTube served with the first page: never updated
    tag.setAttribute("itemprop", "duration");
    tag.setAttribute("content", "PT12M0S");
    tag.content = "PT12M0S"; // the DOM's own property for the attribute
    page.append(meta, micro, tag);
    describe(page, v);
    return page;
  };
}
// YouTube fills the page in for another video: video-id, title, channel and the player's JSON-LD.
function describe(page, v, { ld = true } = {}) {
  page.querySelector("ytd-watch-metadata").setAttribute("video-id", v.id);
  page.querySelector("h1").textContent = v.title;
  page.querySelector("ytd-channel-name a").textContent = v.channel;
  page.querySelector("script").textContent = ld
    ? JSON.stringify({ "@context": "https://schema.org", "@type": "VideoObject", "@id": `https://www.youtube.com/watch?v=${v.id}`, embedUrl: `https://www.youtube.com/embed/${v.id}`, name: v.title, author: v.channel, duration: v.duration })
    : "";
}
const bars = (p) => p.document.querySelectorAll(".sieve-yt-bar");
const go = (p, id) => { p.location.href = `https://www.youtube.com/watch?v=${id}`; };
{
  const p = load({ ...YT, items: [watchPage(EVALS_PAGE)] });
  go(p, EVALS.id);
  p.scan();
  assert.deepEqual(bars(p).map((b) => [b.dataset.id, b.textContent]), [[EVALS.id, "SieveWatch it for me · ~3¢"]], "a page loaded on its own video");

  // Moved to another video: the address changed, the page still describes the old one.
  go(p, SUPERBACKED.id);
  p.scan();
  assert.equal(bars(p).length, 0, "no button while the page still describes the previous video");

  describe(p.els[0], SUPERBACKED);
  p.scan();
  assert.deepEqual(bars(p).map((b) => [b.dataset.id, b.textContent]), [[SUPERBACKED.id, "SieveWatch it for me · ~11¢"]], "the new video's own length, not the meta tag's 12 minutes");
  bars(p)[0].querySelector("button").click();
  const [w] = p.sent.filter((m) => m.type === "watch");
  assert.deepEqual([w.id, w.title, w.channel, w.seconds], [SUPERBACKED.id, SUPERBACKED.title, SUPERBACKED.channel, 2934]);
}
// The JSON-LD alone moved on first: still another video's page, so still no button.
{
  const p = load({ ...YT, items: [watchPage(EVALS_PAGE)] });
  go(p, SUPERBACKED.id);
  p.els[0].querySelector("script").textContent = JSON.stringify({ "@id": `https://www.youtube.com/watch?v=${SUPERBACKED.id}`, embedUrl: `https://www.youtube.com/embed/${SUPERBACKED.id}`, name: SUPERBACKED.title, author: SUPERBACKED.channel, duration: SUPERBACKED.duration });
  p.scan();
  assert.equal(bars(p).length, 0, "the title and channel shown are still the old video's");
}
// Without the player's JSON-LD (YouTube could drop it), the button reads the title and channel shown once
// video-id names the video, and offers no price rather than the stale meta tag's.
{
  const p = load({ ...YT, items: [watchPage(EVALS_PAGE)] });
  describe(p.els[0], SUPERBACKED, { ld: false });
  go(p, SUPERBACKED.id);
  p.scan();
  assert.deepEqual(bars(p).map((b) => b.textContent), ["SieveWatch it for me"]);
  bars(p)[0].querySelector("button").click();
  const [w] = p.sent.filter((m) => m.type === "watch");
  assert.deepEqual([w.title, w.channel, w.seconds], [SUPERBACKED.title, SUPERBACKED.channel, 0]);

  // The JSON-LD arrives after the button was built: the button is built again, with the length.
  describe(p.els[0], SUPERBACKED);
  p.scan();
  assert.deepEqual(bars(p).map((b) => b.textContent), ["SieveWatch it for me · ~11¢"]);
  const again = bars(p)[0];
  p.scan();
  assert.equal(bars(p)[0], again, "nothing changed: the same button, not rebuilt");
}

console.log("recycled tiles: all checks passed");
