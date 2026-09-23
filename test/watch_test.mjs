// "Watch it for me" on one public YouTube video. VIDEO=url to try another. Costs about 0.2 cents per minute.
import { watchMessages, parseWatch, DEFAULT_VIDEO_MODEL } from "../watch-prompt.js";
import { DEFAULT_PREFS } from "../prefs.js";
import { openrouterKey } from "./keys.mjs";
const url = process.env.VIDEO || "https://www.youtube.com/watch?v=XUYvDbAv1IA";
const prefs = { ...DEFAULT_PREFS, role: process.env.ROLE || DEFAULT_PREFS.role };
const t = Date.now();
const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey()}` },
  body: JSON.stringify({ model: DEFAULT_VIDEO_MODEL, messages: watchMessages({ url, title: process.env.TITLE || "video", channel: process.env.CHANNEL || "creator" }, prefs),
    max_tokens: 2000, temperature: 0.2, response_format: { type: "json_object" }, usage: { include: true } }) });
const b = await r.json();
if (!r.ok) { console.log(r.status, JSON.stringify(b).slice(0, 400)); process.exit(1); }
console.log(JSON.stringify(parseWatch(b.choices[0].message.content), null, 2));
console.log(`\n${Date.now() - t} ms, ${b.usage?.prompt_tokens} tokens in, $${b.usage?.cost}`);
