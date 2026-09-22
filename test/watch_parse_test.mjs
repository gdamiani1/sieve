// Offline: the video answer parser survives what models actually send back.
import assert from "node:assert/strict";
import { parseWatch } from "../watch-prompt.js";
const good = { verdict: "watch", why: "w", summary: "s", points: [{ t: "1:00", text: "p" }], best_moment: { t: "2:00", text: "b" }, learnings: ["l"], claims_to_check: [] };
const j = JSON.stringify(good, null, 2);
assert.equal(parseWatch(j).verdict, "watch");
assert.equal(parseWatch("```json\n" + j + "\n```").verdict, "watch", "code fences");
assert.equal(parseWatch("Here you go:\n" + j).points.length, 1, "leading text");
assert.equal(parseWatch(j.replace('"learnings": [\n    "l"\n  ]', '"learnings": ["l",]')).learnings[0], "l", "trailing comma");
const cut = j.slice(0, j.indexOf('"learnings"') + 20); // cut off mid-array
const r = parseWatch(cut);
assert.equal(r.verdict, "watch", "cut off: keeps what arrived");
assert.equal(r.points.length, 1);
assert.throws(() => parseWatch("sorry, I can't watch this video"), "no JSON at all still fails");
// Cut at a token boundary: keep every field that arrived whole.
const t1 = parseWatch('{"why": "w", "summary": "s", "points": [{"text": "p"}], "learnings": ["a"], "claims_to_check": [');
assert.equal(t1.summary, "s", "cut after an open array");
assert.equal(t1.points.length, 1);
assert.equal(t1.learnings[0], "a");
assert.equal(parseWatch('{"why": "w", "summary":').why, "w", "cut after a key");
assert.equal(parseWatch('{"why": "w", "learnings": ["a"], "extra": 4.').learnings[0], "a", "cut mid-number");
assert.equal(parseWatch('{"why": "w", "learnings": ["a"], "ok": tru').learnings[0], "a", "cut mid-literal");
assert.equal(parseWatch('{"why": "they said \\"fast\\"", "summary": "cut here').why, 'they said "fast"', "escaped quotes");
assert.equal(parseWatch('{"points": [{"t": "1:00", "text": "one"}, {"t": "2:0').points.length, 1, "cut inside the second point");
console.log("watch parser: all 13 checks passed");
