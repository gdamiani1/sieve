// Offline: the extension pages' colours in light and dark. No keys, no network.
// Each page's <style> opens with a :root token block (light) and a prefers-color-scheme: dark block.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["popup.html", "options.html", "digest.html"];

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

// Text pairs (foreground, background) that must reach 4.5 in both schemes.
const TEXT = [
  ["ink", "paper"], ["ink", "card"], ["ink", "field"], ["ink", "panel"],
  ["muted", "paper"], ["muted", "card"], ["muted", "panel"],
  ["accent", "paper"], ["accent", "card"], ["accent", "panel"],
  ["on-accent", "accent"], ["ink-soft", "card"],
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

const COLOUR = /(?<!&)#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b|\b(?:rgba?|hsla?)\(|\b(?:white|black)\b/gi;

for (const page of PAGES) {
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

  // No colour outside the two token blocks: not in the rest of the style, not in an inline style="".
  const rest = style.replace(light[0], "").replace(dark[0], "");
  const inline = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join("\n");
  const stray = [...`${rest}\n${inline}`.matchAll(COLOUR)].map((m) => m[0]);
  assert.deepEqual(stray, [], `${page}: colours outside the token blocks: ${stray.join(", ")}`);
}

console.log("theme_contrast_test: ok");
