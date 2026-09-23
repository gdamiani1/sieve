// Offline: what the angle parser keeps. No keys, no network.
// A "Your angle" / "Your experience" line is a note to the reader on how to use their fact, never the
// comment itself: plain code drops one in the first person, or with a number that is in neither the fact
// nor the post (worked out or invented). Numbers copied from the fact are fine: it is shown under the line.
import assert from "node:assert/strict";
import { parseAngles, buildMessages, buildRedditMessages } from "../draft.js";

const about = "- I tested a classifier on 42 emails: 5 of 42 went to a person between 0.3 and 0.7.";
const post = "Our support classifier is 94% accurate. How do you pick the cut-off?";
const mine = (line, p = post) => parseAngles(line, about, p).find((a) => a.fact);

// A label the model wrote twice shows once.
assert.equal(parseAngles("Your angle (F1): Your angle (F1): Mention your test, then ask about their cut-off.", about, post)[0].text, "Mention your test, then ask about their cut-off.");
assert.equal(parseAngles("Your angle (F1): Your angle: Mention your test.", about, post)[0].text, "Mention your test.");
assert.equal(parseAngles("Ask: Ask: How was the 94% measured?", about, post)[0].text, "How was the 94% measured?");
assert.equal(parseAngles("Push back: push back: One labelled set is thin.", about, post)[0].text, "One labelled set is thin.");
assert.equal(parseAngles("Your experience (F1): Your experience (F1): Say what the middle band caught.", about, post)[0].text, "Say what the middle band caught.");
// A label word that is just the start of a sentence stays.
assert.equal(parseAngles("Ask: Asking for the cut-off first would help.", about, post)[0].text, "Asking for the cut-off first would help.");

// The note to the reader is kept, with the fact attached.
assert.equal(mine("Your angle (F1): Mention your own test, then ask where they set the cut-off.").fact, about.slice(2));
// A number worked out from the fact (5 of 42 is 12%) or invented is dropped.
assert.equal(mine("Your angle (F1): Mention that your band sent only 12% to a person."), undefined);
assert.equal(mine("Your angle (F1): Mention your 100 test emails, then ask about their cut-off."), undefined);
// Numbers copied from the fact, or taken from the post, are fine.
assert.ok(mine("Your angle (F1): Mention that 5 of 42 went to a person in your 0.3 to 0.7 band."));
assert.ok(mine("Your angle (F1): Compare their 94% with your own test, then ask about the cut-off."));
// No post given: only the fact's numbers count.
assert.equal(parseAngles("Your angle (F1): Compare their 94% with your test.", about).find((a) => a.fact), undefined);
// First person means the model wrote the comment, and may have added what the fact doesn't say.
assert.equal(mine("Your angle (F1): When I built mine, the bottleneck was edge cases. How did you handle that?"), undefined);
assert.equal(mine("Your angle (F1): My test found the same thing."), undefined);
// Same rules for Reddit's line.
assert.equal(mine("Your experience (F1): I sent 5 of 42 to a person."), undefined);
assert.ok(mine("Your experience (F1): Suggest a middle band that goes to a person, from your own test."));
// Other lines are unchanged: they may quote the post's numbers, and never talk about the reader.
assert.equal(parseAngles("Ask: How was the 94% measured?", about, post).length, 1);
assert.equal(parseAngles("Ask: I wonder how the 94% was measured?", about, post).length, 0);

// The prompts give the line one voice: a note to the reader, the author is "they".
for (const build of [buildMessages, buildRedditMessages]) {
  const system = build({ author: "A", post, angle: "none" }, about)[0].content;
  assert.match(system, /starting with a verb/);
  assert.match(system, /"you" and "your" mean me/);
  assert.match(system, /no "I", and no number or detail the fact does not have/);
}

// The model sometimes writes four lines. The fact line is the one Jev checked, so it stays.
const four = "Ask: How is 94% measured?\nPush back: One set is thin.\nBuild on it: Track drift.\nYour angle (F1): Mention your own test.";
assert.deepEqual(parseAngles(four, about, post).map((a) => a.label), ["Ask", "Push back", "Your angle"]);
const early = "Your angle (F1): Mention your own test.\nAsk: How is 94% measured?\nPush back: One set is thin.\nBuild on it: Track drift.";
assert.deepEqual(parseAngles(early, about, post).map((a) => a.label), ["Your angle", "Ask", "Push back"], "order kept");
const twice = "Your angle (F1): Mention your test.\nYour angle (F1): Mention it again.\nAsk: How is 94% measured?\nPush back: One set is thin.";
assert.deepEqual(parseAngles(twice, about, post).map((a) => a.text), ["Mention your test.", "How is 94% measured?", "One set is thin."], "one fact line at most");
// Without a fact line, the first three as before.
assert.deepEqual(parseAngles("Ask: A?\nPush back: B.\nBuild on it: C.\nAsk: D?", "", post).map((a) => a.text), ["A?", "B.", "C."]);

console.log("angles parse: all checks passed");
