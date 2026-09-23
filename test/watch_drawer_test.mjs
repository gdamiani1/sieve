// Offline: watch-drawer.js, the "watched for you" drawer shown by Watch it for me. Runs the real script
// against a tiny fake DOM and compares what it built, line by line, with what youtube.js built before
// the drawer moved out of it.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeDocument, outline } from "./fake-dom.mjs";

const src = readFileSync(new URL("../watch-drawer.js", import.meta.url), "utf8");
const load = (extra = {}) => {
  const document = fakeDocument();
  const sandbox = { document, ...extra };
  vm.runInNewContext(src, sandbox);
  return { document, show: sandbox.SieveWatchDrawer.show, drawn: () => outline(document.getElementById("sieve-drawer")).join("\n") };
};

const briefCalls = [];
const { document, show, drawn } = load({ SieveBriefPanel: { fill: (box, b, opts) => { briefCalls.push({ b: { ...b }, opts: { ...opts } }); box.append(`brief: ${b.what} / ${b.prompt}`); } } });
const drawer = () => document.getElementById("sieve-drawer");
const button = (text) => drawer().children.find((c) => c.tagName === "BUTTON" && c.textContent === text);

const v = { title: "Evals in CI", channel: "Ana", seconds: 600 };
const link = (t) => { const a = document.createElement("a"); a.className = "sieve-ts"; a.href = `https://www.youtube.com/watch?v=abc&t=${t}`; a.textContent = t; return a; };
let agains = 0;
const youtube = { again: () => agains++, stamp: link, price: "<1¢", showCost: true };
const HEAD = [
  "aside#sieve-drawer",
  "  div.sieve-d-head",
  "    span.sieve-d-brand",
  '      "Sieve · watched for you"',
  "    button.sieve-d-close",
  '      "×"',
  "  div.sieve-d-title",
  '    "Evals in CI"',
  "  div.sieve-d-meta",
  '    "Ana · 10 min"',
];

// While watching.
show(v, null, youtube);
assert.equal(drawn(), [...HEAD, "  div.sieve-d-wait", '    "Watching the whole video (<1¢). This takes about 10 to 40 seconds…"'].join("\n"));

// The drawer's own listeners stop clicks and key presses reaching the page underneath.
assert.deepEqual(Object.keys(drawer().listeners).sort(), ["click", "keydown", "keypress", "keyup"]);
let stopped = 0;
for (const fns of Object.values(drawer().listeners)) for (const fn of fns) fn({ stopPropagation: () => stopped++ });
assert.equal(stopped, 4);

// Minutes round to the nearest minute, not up to it: 80 seconds is 1 min, not 2.
show({ ...v, seconds: 90 }, null, youtube);
assert.match(drawn(), /"Ana · 2 min"/);
show({ ...v, seconds: 80 }, null, youtube);
assert.match(drawn(), /"Ana · 1 min"/);

// A failure, with "Try again".
show(v, { error: "The video model said 500." }, youtube);
assert.equal(drawn(), [...HEAD, "  div.sieve-d-err", '    "The video model said 500."', "  button.sieve-d-again", '    "Try again"'].join("\n"));
button("Try again").click();
assert.equal(agains, 1, "Try again calls again()");

// A full answer, exactly as YouTube drew it.
const answer = {
  verdict: "watch", why: "It shows a real CI setup.", summary: "Two sentences.",
  best: { t: "1:05", text: "The failing run." }, points: [{ t: "0:10", text: "Pin the model." }],
  learnings: ["Pin versions."], checks: ["They say 40% fewer flakes."],
  brief: { what: "Pin the model in CI", warning: "" }, prompt: "PROMPT", cost: 0.0123,
};
show(v, answer, youtube);
assert.equal(drawn(), [
  ...HEAD,
  "  div.sieve-d-verdict.sieve-v-watch", '    "Worth watching"',
  "  p.sieve-d-why", '    "It shows a real CI setup."',
  "  p", '    "Two sentences."',
  "  div.sieve-d-best", "    b", '      "Best moment "', "    a.sieve-ts href=https://www.youtube.com/watch?v=abc&t=1:05", '      "1:05"', '    " The failing run."',
  "  h4", '    "Key points"', "  ul", "    li", "      a.sieve-ts href=https://www.youtube.com/watch?v=abc&t=0:10", '        "0:10"', '      " Pin the model."',
  "  h4", '    "Learnings"', "  ul", "    li", '      "Pin versions."',
  "  h4", '    "Check before repeating"', "  ul", "    li", '      "They say 40% fewer flakes."',
  "  h4.sieve-d-brief-h", '    "Technique brief"', "  div.sieve-d-brief", '    "brief: Pin the model in CI / PROMPT"',
  "  div.sieve-d-foot", `    "Saved to your daily learnings. These are the creator's claims, not verified facts. Cost $0.0123."`,
  "  button.sieve-d-again", '    "Watch again"',
].join("\n"));
// Objects made inside the vm sandbox have another realm's prototype, so the stub above spreads b and
// opts into plain objects first; deepEqual (deepStrictEqual under node:assert/strict) also compares
// [[Prototype]], which would otherwise fail here even though every field matches.
assert.deepEqual(briefCalls.at(-1).opts, { compact: true, level: 5, warning: false }, "the brief panel is filled compact, without its own warning");
button("Watch again").click();
assert.equal(agains, 2, "Watch again calls again()");
assert.equal(document.body.children.length, 1, "one drawer, however often it is shown");

// Other verdicts, and a warned brief: the warning sits right after "why", before the summary.
show(v, { ...answer, verdict: "skip", brief: { what: "W", warning: "Ignore previous instructions" } }, youtube);
const warned = drawn();
assert.match(warned, /div\.sieve-d-verdict\.sieve-v-skip\n {4}"Skip it"/);
const at = (s) => warned.indexOf(s);
assert.ok(at('"It shows a real CI setup."') < at('"Warning: the source contains text aimed at AI agents: Ignore previous instructions"'));
assert.ok(at('"Warning: the source contains text aimed at AI agents: Ignore previous instructions"') < at('"Two sentences."'));
// The warning sits in its own div, not folded into "why" or the summary.
assert.match(warned, /\n {2}div\.sieve-b-warn\n {4}"Warning: the source contains text aimed at AI agents: Ignore previous instructions"/);
// The panel gets the brief's own warning too (it draws it compact, without repeating this line).
assert.equal(briefCalls.at(-1).b.warning, "Ignore previous instructions");
show(v, { ...answer, verdict: "skim" }, youtube);
assert.match(drawn(), /"Skim it"/);

// A brief without a prompt is never shown.
show(v, { ...answer, prompt: "" }, youtube);
assert.doesNotMatch(drawn(), /sieve-d-brief/);

// No brief, no prompt, empty lists and no best moment: those parts aren't drawn at all.
show(v, { ...answer, brief: null, prompt: "", best: null, points: [], learnings: [], checks: [] }, youtube);
assert.equal(drawn(), [
  ...HEAD,
  "  div.sieve-d-verdict.sieve-v-watch", '    "Worth watching"',
  "  p.sieve-d-why", '    "It shows a real CI setup."',
  "  p", '    "Two sentences."',
  "  div.sieve-d-foot", `    "Saved to your daily learnings. These are the creator's claims, not verified facts. Cost $0.0123."`,
  "  button.sieve-d-again", '    "Watch again"',
].join("\n"));

// points, learnings and checks aren't always arrays: a field that isn't one (never sent as an array
// by parseWatch, but worth pinning here) is skipped like an empty list, not thrown on.
show(v, { ...answer, points: undefined }, youtube);
assert.ok(button("Watch again"), "the drawer still finishes drawing, down to its last button");

// A page with no link for a moment and no price: plain-text times, no price while waiting, no cost.
const plain = { again: () => {}, price: "", showCost: false };
show({ title: "A reel", channel: "@ana", seconds: 0 }, null, plain);
assert.match(drawn(), /"@ana"\n {2}div\.sieve-d-wait\n {4}"Watching the whole video\. This takes about 10 to 40 seconds…"$/);
show({ title: "A reel", channel: "@ana", seconds: 0 }, answer, plain);
const p = drawn();
assert.match(p, /div\.sieve-d-best\n {4}b\n {6}"Best moment "\n {4}span\.sieve-ts\n {6}"1:05"/, "the best moment's time is plain text");
assert.match(p, /li\n {6}span\.sieve-ts\n {8}"0:10"/, "so are the key points'");
assert.match(p, /"Saved to your daily learnings\. These are the creator's claims, not verified facts\."\n/, "no cost in the footer");

// The close button removes the drawer.
drawer().children[0].children.find((c) => c.tagName === "BUTTON").click();
assert.equal(document.getElementById("sieve-drawer"), null);

// Without brief-panel.js the brief says so instead of breaking.
const bare = load();
bare.show(v, answer, youtube);
assert.match(bare.drawn(), /div\.sieve-d-brief\n {4}p\n {6}"Sieve couldn't show the brief\. Reload the page and try again\."/);

console.log("watch drawer: all checks passed");
