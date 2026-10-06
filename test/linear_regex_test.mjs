// Offline: two patterns that were quadratic on text from strangers (brief.js, DASH and the bare
// domain in LINKISH), and their linear rewrites. The rewrites must find exactly what the old patterns
// found, so the old ones are kept here, spelled as they were, and compared on random and hostile text.
// The phone's LinearPatternTests.swift does the same, with the same generator and inputs.
import assert from "node:assert/strict";
import { DASH, BARE_DOMAIN, LINKISH, cleanText } from "../brief.js";

const TLD = "com|net|org|io|dev|sh|ai|app|co|xyz|me|gg|hr|de|uk|us|info|tech|site|cloud|run|page|ps1";
// DASH before 6 Oct 2026.
const OLD_DASH = /\s*[\u2014\u2013]\s*/g;
// The bare-domain part of LINKISH before 6 Oct 2026.
const OLD_BARE_DOMAIN = String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:${TLD})\b(?!\.)`;
// LINKISH before 6 Oct 2026.
const OLD_LINKISH = new RegExp([
  String.raw`https?:\/\/|\bwww\.`,
  OLD_BARE_DOMAIN,
  String.raw`\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|<\(`,
  String.raw`\b(?:curl|wget|iwr|iex|Invoke-WebRequest|Invoke-Expression|sudo|npx|bunx|pnpx|uvx|pipx|chmod\s+\+x)\b`,
  String.raw`\b(?:pip3?|npm|pnpm|yarn|bun|brew|gem|cargo|go|apt(?:-get)?)\s+(?:i|install|add|get)\b`,
].join("|"), "i");
const oldDomain = new RegExp(OLD_BARE_DOMAIN, "gi");
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
  "foo.com", "-foo.com", "--.foo.com", "-.-.foo.io", "a..foo.com", ".foo.com", "foo.com.", "foo.com.de",
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
  assert.equal(LINKISH.test(s), OLD_LINKISH.test(s), `LINKISH ${at}`);
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

console.log(`linear_regex_test: ok (${compared} inputs compared, hostile 100k in ${ms.toFixed(1)} ms)`);
