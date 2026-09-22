// Checks that angles never attribute the reader's facts to the post author. Invented posts, default model.
import { readFileSync } from "node:fs";
import { buildMessages, parseAngles, DEFAULT_ABOUT, DEFAULT_MODEL } from "../draft.js";
import { openrouterKey } from "./keys.mjs";
const key = openrouterKey();
const about = process.env.ABOUT_FILE ? readFileSync(process.env.ABOUT_FILE, "utf8") : DEFAULT_ABOUT;
const posts = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url))).filter((p) => p.want === "high");
for (const p of posts) for (let i = 0; i < 2; i++) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: buildMessages({ ...p, angle: "ask_failures" }, about), max_tokens: 200, temperature: 0.7, reasoning: { enabled: false } }) });
  const t = (await r.json()).choices?.[0]?.message?.content;
  console.log(`\n[${p.id} ${i + 1}]\n  ` + (t ? parseAngles(t, about).map((a) => `${a.label}: ${a.text}` + (a.fact ? `\n      [fact] ${a.fact}` : "")).join("\n  ") : "(empty)"));
}
