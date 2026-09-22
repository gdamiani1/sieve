// Builds a digest from the invented posts in sample.json.
import { readFileSync } from "node:fs";
import { digestMessages } from "../digest-prompt.js";
import { DEFAULT_MODEL } from "../draft.js";
import { openrouterKey } from "./keys.mjs";
const key = openrouterKey();
const posts = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)))
  .filter((p) => p.want !== "low")
  .map((p) => ({ authorName: p.author.split(" •")[0], author: p.author, text: p.post, topic: "decision_models", kind: "built_something" }));
const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model: DEFAULT_MODEL, messages: digestMessages(posts), max_tokens: 1000, temperature: 0.3, reasoning: { enabled: false }, usage: { include: true } }) });
const b = await r.json();
console.log(b.choices?.[0]?.message?.content || JSON.stringify(b).slice(0, 300));
console.log(`\n${posts.length} posts, ${b.usage?.prompt_tokens} in / ${b.usage?.completion_tokens} out, $${b.usage?.cost}`);
