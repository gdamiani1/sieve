// Runs the extension's LinkedIn questions (questions.js) through Jev on sample.json (invented posts).
import { readFileSync } from "node:fs";
import { QUESTIONS } from "../questions.js";
import { typesafeKey } from "./keys.mjs";
const key = typesafeKey();
let tokens = 0;
for (const p of JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)))) {
  const t = Date.now();
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "jev-latest", state: { author: p.author, post: p.post }, questions: QUESTIONS }) });
  const b = await r.json();
  if (!r.ok) { console.log(p.id, r.status, JSON.stringify(b).slice(0, 200)); continue; }
  tokens += b.usage?.input_tokens || 0;
  const w = b.answers.worth.noul, tier = w >= 0.7 ? "high" : w >= 0.4 ? "maybe" : "low";
  console.log(`${tier === p.want ? "ok " : "   "}${p.id.padEnd(10)} want ${p.want.padEnd(5)} got ${tier.padEnd(5)} ${w.toFixed(2)}  ${b.answers.kind.choice.padEnd(15)} ${b.answers.topic.choice.padEnd(15)} ${b.answers.angle.choice}  ${Date.now() - t}ms`);
}
console.log(`\n${tokens.toLocaleString()} input tokens, $${(tokens * 0.042 / 1e6).toFixed(5)}`);
