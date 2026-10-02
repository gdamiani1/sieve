// Times each scorer on the same invented Reddit posts (compare_scorers.mjs's SET=reddit): Jev direct,
// Jev through OpenRouter, and OpenRouter chat models through score-prompt.js. Prints seconds per post,
// the provider that served it, and the worth, so speed and answers can be compared. Live: costs a cent or so.
//   node test/score_latency.mjs [model ...]
import { DEFAULT_PREFS, redditQuestions, DEFAULT_REDDIT_ABOUT } from "../prefs.js";
import { scoreMessages, parseScore } from "../score-prompt.js";
import { PROVIDER_PREFS } from "../models.js";
import { typesafeKey, openrouterKey } from "./keys.mjs";

const questions = redditQuestions(DEFAULT_PREFS);
const posts = [
  { id: "vat-ids", s: { subreddit: "r/smallbusiness", title: "How do you catch wrong customer tax IDs before invoicing?", body: "Twice this year I sent invoices with a typo in the client's VAT number and had to redo them. Is there a cheap way to check before sending?" } },
  { id: "inbox", s: { subreddit: "r/automation", title: "Sorting a shared inbox automatically, is an LLM overkill?", body: "We get ~300 emails a day into info@. I want to auto-tag them by type. GPT for each one feels expensive." } },
  { id: "tests", s: { subreddit: "r/ClaudeCode", title: "Claude keeps rewriting my tests instead of fixing the code", body: "Every time a test fails it edits the assertion. How do you stop that?" } },
  { id: "40k", s: { subreddit: "r/Entrepreneur", title: "I made $40k in 30 days with this one trick", body: "DM me for my course. Link in bio." } },
  { id: "10-years", s: { subreddit: "r/smallbusiness", title: "Just hit 10 years in business!", body: "Wanted to share this milestone with you all." } },
].map((p) => ({ id: p.id, state: { ...p.s, reader_experience: DEFAULT_REDDIT_ABOUT } }));

const time = async (fn) => { const t = performance.now(); try { const r = await fn(); return { ...r, s: (performance.now() - t) / 1000 }; } catch (e) { return { err: e.message.slice(0, 80), s: (performance.now() - t) / 1000 }; } };

const jevAt = (url, key) => async (p) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` }, body: JSON.stringify({ model: "jev-latest", state: p.state, questions }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b.error || b).slice(0, 60)}`);
  return { worth: b.answers.answerable.noul, via: b.provider || "TypeSafe" };
};
const chat = (model) => async (p) => {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey()}` },
    body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages: scoreMessages(questions, p.state), max_tokens: 300, usage: { include: true }, reasoning: { enabled: false }, temperature: 0, response_format: { type: "json_object" } }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(b.error || b).slice(0, 60)}`);
  return { worth: parseScore(b.choices[0].message.content, questions, p.state).answers.answerable.noul, via: b.provider };
};

const models = process.argv.slice(2).length ? process.argv.slice(2) : ["deepseek/deepseek-v4-flash"];
const scorers = [["jev direct", jevAt("https://api.typesafe.ai/v1/systemone", typesafeKey)], ["jev via OpenRouter", jevAt("https://openrouter.ai/api/v1/systemone", openrouterKey)], ...models.map((m) => [m, chat(m)])];
for (const [name, fn] of scorers) {
  const rows = [];
  for (const p of posts) rows.push(await time(() => fn(p)));
  const ok = rows.filter((r) => !r.err).map((r) => r.s).sort((a, b) => a - b);
  const med = ok.length ? ok[Math.floor(ok.length / 2)].toFixed(1) : "-";
  console.log(`${name.padEnd(34)} median ${med}s  ` + rows.map((r, i) => `${posts[i].id}:${r.err ? "ERR " + r.err : r.s.toFixed(1) + "s " + r.worth.toFixed(2) + " " + (r.via || "")}`).join(" | "));
}
