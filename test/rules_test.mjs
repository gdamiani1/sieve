// Offline: the plain rules on top of Jev's answers. No keys, no network.
import assert from "node:assert/strict";
import { DEFAULT_PREFS, verdict, linkedinQuestions, youtubeQuestions, KINDS, YOUTUBE_KINDS } from "../prefs.js";
const ans = (worth, kind = "built_something", topic = "t0") => ({ worth: { noul: worth }, kind: { choice: kind }, topic: { choice: topic }, angle: { choice: "ask_how" } });
const P = (o = {}) => ({ ...DEFAULT_PREFS, ...o });
assert.equal(verdict(ans(0.8), P(), "linkedin", "x").tier, "strong");
assert.equal(verdict(ans(0.5), P(), "linkedin", "x").tier, "maybe");
assert.equal(verdict(ans(0.2), P(), "linkedin", "x").tier, "low");
assert.equal(verdict(ans(0.8), P({ highAt: 0.9 }), "linkedin", "x").tier, "maybe", "custom threshold");
assert.equal(verdict(ans(0.95, "promo"), P(), "linkedin", "x").tier, "low", "promo off by default");
assert.equal(verdict(ans(0.95), P({ muteWords: ["Crypto"] }), "linkedin", "big CRYPTO news").tier, "low", "mute, case-insensitive");
assert.equal(verdict(ans(0.1, "promo"), P({ boostWords: ["Ana Horvat"] }), "linkedin", "post by ana horvat").tier, "strong", "boost beats everything");
assert.equal(verdict(ans(0.9, "rant"), P(), "reddit", "x").tier, "low", "reddit rants off by default");
assert.equal(verdict(ans(0.8, "built_something", "t1"), P(), "linkedin", "x").topic, DEFAULT_PREFS.topics[1]);
assert.equal(verdict(ans(0.8, "built_something", "other"), P(), "linkedin", "x").topic, "");
const q = linkedinQuestions(P({ role: "a nurse", topics: ["Patient safety"] }));
assert.match(q.worth.instructions, /a nurse/);
assert.deepEqual(Object.keys(q.topic.criteria), ["t0", "other"]);
// The technique kind: shown by default, can be turned off, asked about on LinkedIn/X and YouTube.
assert.equal(DEFAULT_PREFS.kinds.technique, true, "techniques shown by default");
assert.equal(DEFAULT_PREFS.youtubeKinds.technique, true);
assert.equal(KINDS.technique, "A technique or tool you could try");
assert.equal(YOUTUBE_KINDS.technique, "A technique or tool you could try");
assert.equal(verdict(ans(0.8, "technique"), P(), "linkedin", "x").kind, "technique");
assert.equal(verdict(ans(0.8, "technique"), P({ kinds: { ...DEFAULT_PREFS.kinds, technique: false } }), "linkedin", "x").tier, "low", "can be turned off");
assert.ok("technique" in linkedinQuestions(P()).kind.criteria);
assert.ok("technique" in youtubeQuestions(P()).kind.criteria);
// Every kind a user can switch off is one Jev can choose, and the other way round.
assert.deepEqual(Object.keys(linkedinQuestions(P()).kind.criteria).sort(), Object.keys(KINDS).sort());
assert.deepEqual(Object.keys(youtubeQuestions(P()).kind.criteria).sort(), Object.keys(YOUTUBE_KINDS).sort());
assert.equal(verdict(ans(0.8, "technique"), P({ youtubeKinds: { ...DEFAULT_PREFS.youtubeKinds, technique: false } }), "youtube", "x").tier, "low", "YouTube technique can be turned off");
console.log("rules: all checks passed");
