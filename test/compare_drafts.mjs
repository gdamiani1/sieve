// Side-by-side comment angles from several OpenRouter models, using the extension's exact prompt.
//   node compare_drafts.mjs
import { readFileSync } from "node:fs";
import { buildMessages, parseAngles, DEFAULT_ABOUT } from "../draft.js";
import { openrouterKey } from "./keys.mjs";

const MODELS = process.env.MODELS ? process.env.MODELS.split(",") : [
  "mistralai/mistral-small-3.2-24b-instruct",
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3.7-flash",
  "anthropic/claude-haiku-4.5", // the expensive reference
];
const ANGLE = { traces: "ask_failures", benchmark: "ask_failures", question: "answer_question" };

const key = openrouterKey();
const posts = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url))).filter((p) => p.id in ANGLE);
const totals = {};

for (const p of posts) {
  console.log(`\n=== ${p.id} (angle: ${ANGLE[p.id]}) ===`);
  for (const model of MODELS) {
    const t = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: buildMessages({ ...p, angle: ANGLE[p.id] }, DEFAULT_ABOUT), max_tokens: 200, temperature: 0.5, usage: { include: true }, reasoning: { enabled: false } }),
    });
    const body = await res.json();
    if (!res.ok) { console.log(`\n[${model}] error ${res.status}: ${JSON.stringify(body).slice(0, 200)}`); continue; }
    const cost = body.usage?.cost || 0;
    totals[model] = (totals[model] || 0) + cost;
    console.log(`\n[${model}]  $${cost.toFixed(6)}  ${Date.now() - t} ms  ${body.usage?.completion_tokens} out-tokens`);
    const txt = body.choices[0].message.content;
    console.log(txt ? parseAngles(txt, DEFAULT_ABOUT).map((a) => `${a.label}: ${a.text}`).join("\n") : "(empty answer)");
  }
}
console.log("\nCost per draft (average):");
for (const [m, c] of Object.entries(totals)) console.log(`  $${(c / posts.length).toFixed(6)}  ${m}`);
