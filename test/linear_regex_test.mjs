// Offline: two patterns that were quadratic on text from strangers (brief.js, DASH and the bare
// domain in LINKISH), and their linear rewrites. The rewrites must find exactly what the plain
// spellings find, so those are kept here and compared on random and hostile text.
// The phone's LinearPatternTests.swift does the same, with the same generator and inputs.
import assert from "node:assert/strict";
import { DASH, BARE_DOMAIN, LINKISH, cleanText, warnedView, redactWarned, normalizeBrief } from "../brief.js";

const TLD = "com|net|org|io|dev|sh|ai|app|co|xyz|me|gg|hr|de|uk|us|info|tech|site|cloud|run|page|ps1|ly|gl|gd|gy";
// DASH before 6 Oct 2026.
const OLD_DASH = /\s*[\u2014\u2013]\s*/g;
// The bare-domain part of LINKISH spelled the plain, quadratic way: the rule as it reads since the
// warned-brief filter gaps (6 Oct 2026: a country ending after a known one, a "." alone after a name no
// longer refusing it, the shorteners' endings).
const PLAIN_BARE_DOMAIN = String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:${TLD})(?:\.[a-z]{2})?\b(?!\.[\w-])`;
// LINKISH with that plain spelling in place of the linear one.
const PLAIN_LINKISH = new RegExp(LINKISH.source.replace(BARE_DOMAIN, PLAIN_BARE_DOMAIN), "i");
assert.notEqual(PLAIN_LINKISH.source, LINKISH.source, "the plain spelling replaced the linear one");
const oldDomain = new RegExp(PLAIN_BARE_DOMAIN, "gi");
const newDomain = new RegExp(BARE_DOMAIN, "gi");

const spans = (re, s) => [...s.matchAll(re)].map((m) => [m.index, m[0].length]);
// Where group 1 sits, for each match.
const groupSpans = (re, s) => [...s.matchAll(re)].map((m) => [m.index + m[0].length - m[1].length, m[1].length]);

// Small alphabets, so the corners (a dash right after a match, a domain after hyphens or dots, two
// dots in a row) come up often in short strings. Each string is drawn from one alphabet.
const ALPHABETS = [
  [" ", "\n", "\u2014", "\u2013", "a"],
  [" ", "\ufeff", "\u000b", "\u00a0", "\u2014", "x"],
  ["a", "-", ".", "com", " "],
  ["a", "-", ".", "co", "io", "_", "1"],
  ["x", "-", ".", "..", "Com", "ps1", "\u00e9", "/"],
  ["a", "b", "-", ".", "com", "org", "-com", ".com", "\n", "\u2014", "|", "sh", "npm i"],
];
let state = 20261006;
const next = (k) => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) % k;
const random = (count) => Array.from({ length: count }, () => {
  const alphabet = ALPHABETS[next(ALPHABETS.length)];
  return Array.from({ length: next(16) }, () => alphabet[next(alphabet.length)]).join("");
});

// Hand-picked corners, each one a place where a rewrite could have read differently.
const HOSTILE = [
  "", "\u2014", "a \u2014 \u2014 b", "a\u2014\u2014b", "  \u2014  \u2013  ", "\u2014 \n \u2013",
  "1 \u2013 2", " \ufeff\u2014\u000b x", "end \u2014",
  "foo.com", "-foo.com", "--.foo.com", "-.-.foo.io", "a..foo.com", ".foo.com", "foo.com.", "foo.com.de", "foo.com.au", "foo.com.a", "foo.com.abc", "foo.sh.", "foo.sh.bak", "bit.ly/x",
  "foo.com-bar.org", "a-b.co-x.com", "foo.co", "foo.comx", "x_y.ps1", "\u00e9foo.com", "caf\u00e9.com",
  "a-.com", "-.com", ".com", "foo..com", "foo.-.com", "see example.com/setup.sh", "a.b.c.d.e.app",
];

let compared = 0;
for (const s of [...HOSTILE, ...random(40000)]) {
  const at = JSON.stringify(s);
  // DASH: the same matches, so the same text after the replace
  assert.deepEqual(spans(DASH, s), spans(OLD_DASH, s), `DASH ${at}`);
  assert.equal(s.replace(DASH, ", "), s.replace(OLD_DASH, ", "), `DASH replace ${at}`);
  // LINKISH: the same verdict; and group 1 of the new bare domain holds exactly the old one's matches.
  // The new match itself starts earlier, at the start of the dotted name, which is what keeps it linear.
  assert.equal(LINKISH.test(s), PLAIN_LINKISH.test(s), `LINKISH ${at}`);
  assert.deepEqual(groupSpans(newDomain, s), spans(oldDomain, s), `BARE_DOMAIN ${at}`);
  compared++;
}
// A plain (?<!\s) in front would read into the match before: here the second dash sits right after
// the first match's trailing space, and would be left alone.
assert.equal("a \u2014 \u2014 b".replace(DASH, ", "), "a, , b");
assert.equal(cleanText("Run evals \u2014 every time \u2013 always"), "Run evals, every time, always", "cleanText still turns dashes into commas");

// Linear: every input is 100,000 characters. The old patterns took 2.7 s over 40,000 blank lines and
// then "x\u2014" (DASH) and 0.19 s over "a-" 5,000 times (LINKISH), quadratic, so 100,000 would take
// seconds to tens of seconds. The rewrites take about a millisecond each; the budget is loose for busy
// machines.
const size = 100000;
const hostileLong = [
  "\n".repeat(size - 2) + "x\u2014",
  " \ufeff".repeat(size / 2) + "x \u2014",
  "a-".repeat(size / 2),
  "a.".repeat(size / 2),
  "-.a".repeat(size / 3),
  ("-".repeat(40) + "a").repeat(size / 41),
  "\u00e9-".repeat(size / 2),
];
const started = performance.now();
for (const s of hostileLong) { s.replace(DASH, ", "); LINKISH.test(s); cleanText(s); }
const ms = performance.now() - started;
assert.ok(ms < 500, `DASH, LINKISH and cleanText over seven 100,000-character hostile inputs: ${ms.toFixed(1)} ms`);

// The warned-brief filters (6 Oct 2026): the shell-by-path pipe, the check view and the rewrite are
// linear on hostile text too.
const warnedLong = [
  "|" + "/a".repeat(size / 2),
  "| sudo".repeat(size / 6),
  "| sudo -a".repeat(size / 9),
  "| env A=1 B=2".repeat(size / 13),
  "| xargs -n 1".repeat(size / 12),
  "a dot ".repeat(size / 6),
  "[.]".repeat(size / 3),
  "a[.]".repeat(size / 4),
  "a [[ dot ]] ".repeat(size / 12),
  "a".repeat(size) + ".com",
  "curl ".repeat(size / 5),
  "`curl` ".repeat(size / 7),
  "a.com.".repeat(size / 6),
  " ".repeat(size) + "[",
  "\ufe58".repeat(size),
  "a" + "[".repeat(size / 2) + "." + "]".repeat(size / 2) + "b",
  "a" + "[ ".repeat(size / 4) + "dot" + " ]".repeat(size / 4) + "b",
  "hxxp" + "(".repeat(size / 2) + ":" + ")".repeat(size / 2),
  "`a ".repeat(size / 3),
  "[".repeat(size),
  "[ (".repeat(size / 3),
  "a" + "[".repeat(size),
  " [".repeat(size / 2),
  "\\[".repeat(size / 2),
  "\\".repeat(size) + "(",
  "\\".repeat(size),
  "| env -u".repeat(size / 8),
  "| xargs -n 1 -I x".repeat(size / 17),
  "bash" + " -x".repeat(size / 3),
  "| " + "env -u ".repeat(40) + "x",
  "| " + "nice -n ".repeat(40) + "x",
  "| " + "sudo -u ".repeat(40) + "x",
  "sh -a ".repeat(size / 6) + "x",
  "su -x ".repeat(size / 6) + "x",
  "sh -a x/sh ".repeat(size / 11),
];
warnedLong.push(
  "| node18".repeat(size / 8), "python -I".repeat(size / 9), "node -x ".repeat(size / 8) + "-pe", "cmd /q".repeat(size / 6),
  "node -a=b ".repeat(size / 10), "py -3.1 ".repeat(size / 8), "node -x=node ".repeat(size / 13), "python -m x ".repeat(size / 12) + "-c",
  "\u33c2".repeat(size / 4), "cmd/q".repeat(size / 5), "cmd /a:" + "/a:".repeat(size / 3), "cmd" + "//a".repeat(size / 3), "cmd" + " /a".repeat(size / 3) + " /", "cmd" + "/".repeat(size),
  "bash" + " +x -a".repeat(size / 6), "sh +a ".repeat(size / 6), "docker compose ".repeat(size / 15), "| . /proc/".repeat(size / 10) + "1/fd/0", "cmd" + "/a:x".repeat(size / 4), "| . //".repeat(size / 6),
  "\u3002".repeat(size), "a\u0338".repeat(size / 2), "| . /dev/x".repeat(size / 10), "| $BASH".repeat(size / 7),
);
// A warned field over 20,000 characters is not read at all ("too long to check"), so the rewrite and
// the whole brief are timed on each input cut to the cap; the view and LINKISH on all of it.
const CAP = 20000;
const warnedStarted = performance.now();
for (const s of warnedLong) {
  LINKISH.test(warnedView(s));
  const capped = s.slice(0, CAP);
  redactWarned(capped);
  normalizeBrief({ what: capped, warning: "x", try: [capped], says: [capped] });
}
const warnedMs = performance.now() - warnedStarted;
assert.ok(warnedMs < 3000, `the warned-brief view, LINKISH and the rewrite over the hostile hostile inputs: ${warnedMs.toFixed(1)} ms`);
console.log(`linear_regex_test: ok (${compared} inputs compared, hostile 100k in ${ms.toFixed(1)} ms, warned filters in ${warnedMs.toFixed(1)} ms)`);
