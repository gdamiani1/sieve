// Offline: the extension pages' colours in light and dark. No keys, no network.
// Each page's <style> opens with a :root token block (light) and a prefers-color-scheme: dark block.
// The settings page, the popup and Daily learnings are pinboard version 2 from 1.5.0 (design.md, Palette
// (version 2); extension settings pinboard spec 6, 9 and 10). The quiet material's tokens stay checked
// below for the next page that uses them; no extension page does today.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = [];

const LIGHT = {
  paper: "#ece7de", ink: "#14120e", muted: "#6b655b", accent: "#2433f5", "on-accent": "#fff",
  card: "#fff", panel: "#f6f3ee", field: "#fff", line: "#d6cebf", "field-edge": "#c9c1b3",
  "ink-soft": "#3a362f", alert: "#9a2a00", "alert-tint": "#fff0ea",
};
const DARK = {
  paper: "#14120e", ink: "#ece7de", muted: "#a9a296", accent: "#7b87ff", "on-accent": "#14120e",
  card: "#1d1a15", panel: "#1d1a15", field: "#252119", line: "#3a362f", "field-edge": "#6b655b",
  "ink-soft": "#c9c1b3", alert: "#ffb59b", "alert-tint": "#3a1a0e",
};

// Pinboard version 2, exactly design.md's values.
const V2_LIGHT = {
  canvas: "#fbfaf7", card: "#ffffff", tint: "#f0ece5", ink: "#1d1b17", "on-ink": "#ffffff", "ink-muted": "#77706a",
  line: "#ebe6dc", "bar-edge": "#e4ded2", blue: "#2433f5", "on-blue": "#ffffff", alert: "#9a2a00", "alert-tint": "#fff0ea",
  note: "#f7ecd0", "note-tape": "#cdbfa5",
};
const V2_DARK = {
  canvas: "#171511", card: "#221f1a", tint: "#2a2620", ink: "#ece6dc", "on-ink": "#171511", "ink-muted": "#a39b8f",
  line: "#322e27", "bar-edge": "#3a352d", blue: "#7b87ff", "on-blue": "#14120e", alert: "#ffb59b", "alert-tint": "#3a1a0e",
  note: "#302819", "note-tape": "#5a4f3d",
};
// The pairs the settings page uses: spec 6's list, then the ones it adds (the scoring value and a bad
// key check in alert on a card, Delete in alert on the canvas, the paper note's words, Start here's links
// on the tint, the switch's knob on its track).
const V2_TEXT = [
  ["ink", "canvas"], ["ink", "card"], ["ink", "tint"], ["ink-muted", "canvas"], ["ink-muted", "card"],
  ["blue", "canvas"], ["blue", "card"], ["blue", "note"], ["on-blue", "blue"], ["alert", "alert-tint"], ["on-ink", "ink"],
  ["alert", "card"], ["alert", "canvas"], ["ink", "note"], ["blue", "tint"],
];
// Daily learnings adds none: its titles and bullets are ink on a card, meta ink-muted on a card or the
// canvas, row actions blue on a card or the canvas, the warning alert on alert-tint, the left-out line
// ink on the tint, the copy fallback ink on the canvas, the secondary buttons ink on the tint.
const V2_EDGE = [["canvas", "blue"], ["canvas", "ink-muted"], ["ink-muted", "card"], ["blue", "card"]];

// Text pairs (foreground, background) that must reach 4.5 in both schemes.
const TEXT = [
  ["ink", "paper"], ["ink", "card"], ["ink", "field"], ["ink", "panel"],
  ["muted", "paper"], ["muted", "card"], ["muted", "panel"],
  ["accent", "paper"], ["accent", "card"], ["accent", "panel"],
  ["on-accent", "accent"], ["ink-soft", "card"], ["ink-soft", "paper"],
  ["alert", "alert-tint"], ["alert", "card"], ["alert", "paper"], ["alert", "panel"],
];

function rgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tokens(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+)\s*:\s*([^;}]+)/g)) out[name] = value.trim().toLowerCase();
  return out;
}

// The helper itself, on known values from design.md.
assert.ok(Math.abs(contrast("#14120e", "#ece7de") - 15.19) < 0.01);
assert.ok(Math.abs(contrast("#fff", "#2433f5") - 7.32) < 0.01);

for (const [scheme, t] of [["light", LIGHT], ["dark", DARK]]) {
  for (const [fg, bg] of TEXT) {
    const c = contrast(t[fg], t[bg]);
    assert.ok(c >= 4.5, `${scheme}: ${fg} on ${bg} is ${c.toFixed(2)}, under 4.5`);
  }
}
assert.notEqual(DARK["on-accent"], "#fff", "dark mode never puts white on the light blue");
// A field's edge is how someone finds it. Light keeps today's edge until the redesign.
for (const bg of ["card", "panel", "paper"]) {
  const c = contrast(DARK["field-edge"], DARK[bg]);
  assert.ok(c >= 3, `dark: field-edge on ${bg} is ${c.toFixed(2)}, under 3`);
}

for (const [scheme, t] of [["light", V2_LIGHT], ["dark", V2_DARK]]) {
  for (const [fg, bg] of V2_TEXT) {
    const c = contrast(t[fg], t[bg]);
    assert.ok(c >= 4.5, `version 2 ${scheme}: ${fg} on ${bg} is ${c.toFixed(2)}, under 4.5`);
  }
  for (const [fg, bg] of V2_EDGE) {
    const c = contrast(t[fg], t[bg]);
    assert.ok(c >= 3, `version 2 ${scheme}: ${fg} on ${bg} is ${c.toFixed(2)}, under 3`);
  }
}

const COLOUR = /(?<!&)#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b(?!-)/gi;
// The regex itself. str.match with /g is stateless, unlike COLOUR.test.
for (const yes of ["#fff8", "#fff", "#c9c1b3", "#c9c1b3cc", "oklch(", "color(", "lab(", "hwb(", "rgb(", "hsla(", "white;", "color:black"]) {
  assert.ok(yes.match(COLOUR), `COLOUR should match ${yes}`);
}
for (const no of ["white-space", "&#10;", "#msg{", "#export{", "#today{", "#day", "#week"]) {
  assert.equal(no.match(COLOUR), null, `COLOUR should not match ${no}`);
}

const SETS = [...PAGES.map((p) => [p, LIGHT, DARK]), ["options.html", V2_LIGHT, V2_DARK], ["popup.html", V2_LIGHT, V2_DARK], ["digest.html", V2_LIGHT, V2_DARK]];
for (const [page, LIGHT, DARK] of SETS) {
  const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style, `${page}: has a <style>`);
  const light = style.match(/^\s*:root\s*\{([^}]*)\}/);
  assert.ok(light, `${page}: the style opens with the :root token block`);
  assert.match(light[1], /color-scheme\s*:\s*light dark/, `${page}: native controls follow the scheme`);
  const dark = style.match(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/);
  assert.ok(dark, `${page}: has a prefers-color-scheme: dark block`);
  assert.deepEqual(tokens(light[1]), LIGHT, `${page}: light tokens`);
  assert.deepEqual(tokens(dark[1]), DARK, `${page}: dark tokens`);

  for (const [, name] of html.matchAll(/var\(\s*--([a-z-]+)/g)) {
    assert.ok(name in LIGHT, `${page}: var(--${name}) is not a token`);
  }

  // No colour outside the two token blocks: not in the rest of the style, not in an inline style=""/''.
  const rest = style.replace(light[0], "").replace(dark[0], "");
  const inline = [...html.matchAll(/style=(["'])(.*?)\1/gs)].map((m) => m[2]).join("\n");
  const stray = [...`${rest}\n${inline}`.matchAll(COLOUR)].map((m) => m[0]);
  assert.deepEqual(stray, [], `${page}: colours outside the token blocks: ${stray.join(", ")}`);
}

console.log("theme_contrast_test: ok");
