// Runs the extension's LinkedIn questions through Jev on sample.json (invented posts).
// PREFS=path/to/prefs.json scores them for a different reader.
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS, linkedinQuestions, verdict } from "../prefs.js";
import { typesafeKey } from "./keys.mjs";
const key = typesafeKey();
const prefs = process.env.PREFS ? { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(process.env.PREFS, "utf8")) } : DEFAULT_PREFS;
const QUESTIONS = linkedinQuestions(prefs);
console.log(`Reader: ${prefs.role}\nTopics: ${prefs.topics.join(" | ")}\n`);
let tokens = 0;
for (const p of JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)))) {
  const t = Date.now();
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "jev-latest", state: { author: p.author, post: p.post }, questions: QUESTIONS }) });
  const b = await r.json();
  if (!r.ok) { console.log(p.id, r.status, JSON.stringify(b).slice(0, 200)); continue; }
  tokens += b.usage?.input_tokens || 0;
  const v = verdict(b.answers, prefs, "linkedin", `${p.author}\n${p.post}`);
  const tier = { strong: "high", maybe: "maybe", low: "low" }[v.tier];
  const mark = process.env.PREFS ? "   " : tier === p.want ? "ok " : "   ";
  console.log(`${mark}${p.id.padEnd(10)} ${process.env.PREFS ? "" : `want ${p.want.padEnd(5)} `}got ${tier.padEnd(5)} ${v.worth.toFixed(2)}  ${v.kind.padEnd(15)} ${(v.topic || "-").padEnd(34)} ${v.reason}`);
}
console.log(`\n${tokens.toLocaleString()} input tokens, $${(tokens * 0.042 / 1e6).toFixed(5)}`);
