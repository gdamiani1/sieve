// Offline: linkedin-post-id.js, the script that runs in LinkedIn's own page and finds a feed card's
// post id in the page's React data. Runs the real script in a sandbox against a hand-built card: no
// browser, no keys, no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

class Node {}
class Element extends Node {
  attrs = {};
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
}
const listeners = [];
const document = { addEventListener: (type, fn) => listeners.push([type, fn]) };
vm.runInNewContext(readFileSync(new URL("../linkedin-post-id.js", import.meta.url), "utf8"), { document, Element, Node });
assert.deepEqual(listeners.map(([type]) => type), ["sieve-post-id"], "listens for one event, and nothing else");
const ask = (target) => { listeners[0][1]({ target }); return target.getAttribute?.("data-sieve-urn") ?? null; };

// A fiber: its props, then its children, linked the way React links them (child, then sibling).
const fiber = (props, ...children) => {
  const f = { memoizedProps: props, child: children[0] || null, sibling: null };
  children.forEach((c, i) => { c.sibling = children[i + 1] || null; });
  return f;
};
// A card element whose own fiber holds `root` as its first child. `next` stands for the next card:
// React links it as the card's sibling, and it must never be read as part of this card.
const card = (root, next = null) => {
  const el = new Element();
  el["__reactFiber$x1y2z3"] = { memoizedProps: {}, child: root, sibling: next };
  return el;
};

const ACT = "urn:li:activity:7300000000000000001";
const SHARE = "urn:li:share:7300000000000000999";
const UGC = "urn:li:ugcPost:7300000000000000002";
const counts = (urn, n) => fiber({}, ...Array.from({ length: n }, (_, i) => fiber({ stateKey: `reactionsCount-${urn}`, id: `displayReactionCount-ReactionType_${i}_${urn}` })));

// The post is the id the card mentions most: its reaction, comment and repost counts are keyed by it.
// A share card also names its share once (rootUrn); that one isn't the post's link.
assert.equal(ask(card(fiber({ rootUrn: SHARE }, counts(ACT, 3)))), ACT, "the activity the counts are keyed by, not the share");
assert.equal(ask(card(fiber({ rootUrn: UGC }, counts(UGC, 2)))), UGC, "a ugcPost card gives its ugcPost");
assert.equal(ask(card(fiber({ highlightedReactorName: `highlightedReactorName-${ACT}` }))), ACT, "an id inside a longer key counts");

// Ids nested inside React elements in props (children -> props -> children -> props) are found.
assert.equal(ask(card(fiber({ children: [{ props: { children: { props: { stateKey: ACT } } } }] }))), ACT, "nested props are read");

// The next card, linked as this card's sibling, is never read, however often it names its own post.
assert.equal(ask(card(fiber({ stateKey: ACT }), counts(UGC, 9))), ACT, "the next card's ids never count");
// Siblings inside the card do count.
assert.equal(ask(card(fiber({}, fiber({ a: 1 }), fiber({ b: 2 }), fiber({ stateKey: UGC })))), UGC, "a later child of the card is read");

// No id: nothing is written, and a stale id from an earlier look is cleared.
const empty = card(fiber({ title: "no ids here", n: 3, ok: true }));
empty.setAttribute("data-sieve-urn", ACT);
assert.equal(ask(empty), null, "no id, no attribute");

// Things in the page's data that must not trip it up: a loop, a DOM node (never walked into), a getter
// that throws, a string that only looks like an id, and a card with no React data at all.
const loop = { stateKey: UGC };
loop.self = loop;
assert.equal(ask(card(fiber(loop))), UGC, "a loop in props ends");
const node = new Element();
node.stateKey = ACT;
assert.equal(ask(card(fiber({ ref: node, stateKey: UGC }))), UGC, "a DOM node in props isn't read");
const trap = { get boom() { throw new Error("no"); }, stateKey: UGC };
assert.equal(ask(card(fiber(trap))), UGC, "a throwing getter is skipped");
assert.equal(ask(card(fiber({ a: "urn:li:activity:12", b: "urn:li:person:7300000000000000003" }))), null, "too short an id, or another kind of urn, isn't a post");
assert.equal(ask(new Element()), null, "a card with no React data gives nothing");

// Only an element is ever written to: anything else that raises the event is ignored.
assert.doesNotThrow(() => listeners[0][1]({ target: null }));
assert.doesNotThrow(() => listeners[0][1]({ target: { setAttribute() { throw new Error("not a card"); } } }));

// A card far bigger than any real one stops at the budget instead of freezing the page.
{
  let root = fiber({ stateKey: ACT });
  for (let i = 0; i < 60000; i++) root = fiber({ i }, root);
  const t = Date.now();
  ask(card(root));
  assert.ok(Date.now() - t < 1000, "a huge card is given up on quickly");
}

console.log("linkedin post id: all checks passed");
