// Offline: which of the reader's facts reaches the angle prompt. No keys, no network.
// Jev rates each fact against the post; plain code keeps only the best one at FACT_MIN or above.
import assert from "node:assert/strict";
import { FACT_MIN, factQuestions, pickFact, buildMessages, parseAngles } from "../draft.js";

const list = ["I tested a classifier on 200 support emails.", "I run a two-person agency.", "I wrote an essay on small models."];

// One yes/no question per fact, numbered like the prompt's F1, F2, F3, with the fact word for word.
const q = factQuestions(list);
assert.deepEqual(Object.keys(q), ["f1", "f2", "f3"]);
for (const [i, f] of list.entries()) {
  assert.equal(q[`f${i + 1}`].type, "noul");
  assert.ok(q[`f${i + 1}`].instructions.includes(f), "the fact itself is in the question");
}
assert.deepEqual(factQuestions([]), {});

const ans = (...ps) => Object.fromEntries(ps.map((p, i) => [`f${i + 1}`, { noul: p }]));
assert.equal(FACT_MIN, 0.7);
assert.equal(pickFact(ans(0.1, 0.2, 0.05), 3), -1, "nothing relevant: no fact");
assert.equal(pickFact(ans(0.69, 0.2, 0.05), 3), -1, "just under the line: no fact");
assert.equal(pickFact(ans(0.7, 0.2, 0.05), 3), 0, "at the line counts");
assert.equal(pickFact(ans(0.75, 0.9, 0.8), 3), 1, "the highest one wins");
assert.equal(pickFact(ans(0.8, 0.8), 2), 0, "a tie keeps the first");
assert.equal(pickFact({ f2: { noul: 0.9 } }, 3), 1, "a missing answer is skipped");
assert.equal(pickFact({ f1: { noul: "0.9" }, f2: { noul: NaN } }, 2), -1, "only real numbers count");
assert.equal(pickFact(undefined, 3), -1, "no answers at all: no fact");
assert.equal(pickFact(ans(0.95), 0), -1, "no facts: nothing to pick");
assert.equal(pickFact(ans(0.2, 0.6), 2, 0.5), 1, "the line can be set");

// No fact passed: the prompt says so, and a Jev move that asks for a result falls back to a question.
const post = { author: "Ana", post: "Our agent turned off its own sandbox to reach a server.", angle: "share_result" };
const none = buildMessages(post, "")[1].content;
assert.match(none, /MY FACTS: none apply to this post/);
assert.doesNotMatch(none, /first-hand result/, "no nudge to share a result there is no fact for");
assert.match(none, /Ask one specific, genuine question about the post/);
// One fact passed: it is F1 and the result move stays.
const one = buildMessages(post, "- I tested a classifier on 200 support emails.")[1].content;
assert.match(one, /F1: I tested a classifier on 200 support emails\./);
assert.match(one, /first-hand result/);

// Whatever the model writes, a "Your angle" line can only point at a fact that was passed.
const out = "Ask: How did it reach the server?\nPush back: Was the flag allowed?\nYour angle (F1): Thresholds matter here.";
assert.deepEqual(parseAngles(out, "").map((a) => a.label), ["Ask", "Push back"]);
assert.equal(parseAngles(out, "- I tested a classifier on 200 support emails.")[2].fact, "I tested a classifier on 200 support emails.");

console.log("facts: all checks passed");
