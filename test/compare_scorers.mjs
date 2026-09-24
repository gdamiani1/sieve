// Scores test/sample.json (invented posts, each labelled with the tier it should get) with Jev and with
// OpenRouter models through score-prompt.js, and prints each scorer's raw "worth" per post, the cost,
// and how many labels each gets right at the thresholds that suit it best.
//
// It exists to set the OpenRouter path's thresholds from evidence (Jev's 0.7 and 0.4 were set against
// Jev's calibrated probabilities, and a general model's are not calibrated the same way) and to measure
// the cost per post. It spends real money on both keys: a few cents.
//
//   node test/compare_scorers.mjs [model ...]
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS, linkedinQuestions } from "../prefs.js";
import { scoreMessages, parseScore } from "../score-prompt.js";
import { DEFAULT_MODEL, PROVIDER_PREFS } from "../draft.js";
import { typesafeKey, openrouterKey } from "./keys.mjs";

const models = process.argv.slice(2).length ? process.argv.slice(2) : [DEFAULT_MODEL, "google/gemini-2.5-flash-lite"];
const prefs = DEFAULT_PREFS;
const questions = linkedinQuestions(prefs);
const posts = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)));
const TIERS = ["low", "maybe", "high"];

async function jev(p) {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${typesafeKey()}` },
    body: JSON.stringify({ model: "jev-latest", state: { author: p.author, post: p.post }, questions }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`Jev ${r.status}`);
  return { worth: b.answers.worth.noul, kind: b.answers.kind.choice, cost: ((b.usage?.input_tokens || 0) * 0.042) / 1e6 };
}

async function openrouter(model, p) {
  const state = { author: p.author, post: p.post };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey()}`, "X-Title": "Sieve" },
    body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages: scoreMessages(questions, state), max_tokens: 300, usage: { include: true }, reasoning: { enabled: false }, temperature: 0, response_format: { type: "json_object" } }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status} ${JSON.stringify(b).slice(0, 160)}`);
  const { answers } = parseScore(b.choices[0].message.content, questions, state);
  return { worth: answers.worth.noul, kind: answers.kind.choice, cost: b.usage?.cost || 0 };
}

// The pair of thresholds (high, low) that gets the most labels right, searched on a 0.05 grid.
function best(rows) {
  let top = { hits: -1 };
  for (let hi = 0.3; hi <= 0.96; hi += 0.05)
    for (let lo = 0.05; lo < hi; lo += 0.05) {
      const hits = rows.filter((x) => (x.worth >= hi ? "high" : x.worth >= lo ? "maybe" : "low") === x.want).length;
      if (hits > top.hits) top = { hits, hi: +hi.toFixed(2), lo: +lo.toFixed(2) };
    }
  return top;
}

const scorers = [["jev", jev], ...models.map((m) => [m, (p) => openrouter(m, p)])];
const results = {};
for (const [name, fn] of scorers) {
  results[name] = [];
  for (const p of posts) {
    try {
      const r = await fn(p);
      results[name].push({ id: p.id, want: p.want, ...r });
    } catch (e) {
      results[name].push({ id: p.id, want: p.want, worth: NaN, kind: "error", cost: 0, error: e.message });
    }
  }
}

console.log(`post        want   ${scorers.map(([n]) => n.slice(0, 22).padEnd(24)).join("")}`);
for (let i = 0; i < posts.length; i++) {
  const cells = scorers.map(([n]) => { const r = results[n][i]; return `${Number.isFinite(r.worth) ? r.worth.toFixed(2) : " err"} ${r.kind.slice(0, 16).padEnd(16)}  `; });
  console.log(`${posts[i].id.padEnd(11)} ${posts[i].want.padEnd(6)} ${cells.join("")}`);
}
console.log("");
for (const [n] of scorers) {
  const rows = results[n].filter((r) => Number.isFinite(r.worth));
  const at = (hi, lo) => rows.filter((x) => (x.worth >= hi ? "high" : x.worth >= lo ? "maybe" : "low") === x.want).length;
  const b = best(rows);
  const cost = results[n].reduce((a, r) => a + r.cost, 0);
  console.log(`${n.padEnd(34)} at 0.70/0.40: ${at(0.7, 0.4)}/${posts.length}   best ${b.hits}/${posts.length} at ${b.hi}/${b.lo}   $${(cost / posts.length).toFixed(6)} per post, $${((cost / posts.length) * 1000).toFixed(2)} per 1,000${rows.length < posts.length ? `   ${posts.length - rows.length} errors: ${results[n].find((r) => r.error)?.error}` : ""}`);
}
