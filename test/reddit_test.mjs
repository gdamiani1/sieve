// Synthetic Reddit-style posts (written for testing, not real). Runs Jev with REDDIT_QUESTIONS, then angles for the top one.
import { REDDIT_QUESTIONS } from "../reddit-questions.js";
import { DEFAULT_REDDIT_ABOUT, DEFAULT_MODEL, buildRedditMessages, parseAngles } from "../draft.js";
import { typesafeKey, openrouterKey } from "./keys.mjs";
const ts = typesafeKey();
const or = openrouterKey();
const POSTS = [
  { want: "high", subreddit: "r/smallbusiness", title: "How do you catch wrong customer tax IDs before invoicing?", body: "Twice this year I sent invoices with a typo in the client's VAT number and had to cancel and reissue. Is there a simple way to validate these before sending? I'm a one person shop, no accounting software yet." },
  { want: "high", subreddit: "r/automation", title: "Sorting a shared inbox automatically, is an LLM overkill?", body: "We get ~300 emails a day into info@. I want to auto-tag them as order, complaint, invoice, spam. GPT works but it's slow and I worry about cost. Anyone done this with something lighter?" },
  { want: "high", subreddit: "r/croatia", title: "Paušalni obrt: tko vodi evidenciju sam?", body: "Otvaram paušalni obrt i pitam se isplati li se knjigovođa ili mogu sam voditi KPR i izdavati račune. Kakva su vaša iskustva?" },
  { want: "low", subreddit: "r/Entrepreneur", title: "I made $40k in 30 days with this one trick", body: "DM me for my course. Link in bio." },
  { want: "low", subreddit: "r/LocalLLaMA", title: "New 400B model weights leaked?", body: "Anyone seen the torrent going around?" },
  { want: "low", subreddit: "r/smallbusiness", title: "Just hit 10 years in business!", body: "Wanted to share this milestone with you all. Thanks for the support." },
];
for (const p of POSTS) {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ts}` },
    body: JSON.stringify({ model: "jev-latest", state: { subreddit: p.subreddit, title: p.title, body: p.body, reader_experience: DEFAULT_REDDIT_ABOUT }, questions: REDDIT_QUESTIONS }) });
  const b = await r.json();
  if (!r.ok) { console.log(r.status, JSON.stringify(b).slice(0, 200)); continue; }
  const w = b.answers.answerable.noul, tier = w >= 0.7 ? "high" : w >= 0.4 ? "maybe" : "low";
  console.log(`${tier === p.want ? "ok " : "   "}${p.want.padEnd(5)} got ${tier.padEnd(5)} ${w.toFixed(2)}  ${b.answers.kind.choice.padEnd(12)} ${b.answers.topic.choice.padEnd(15)} ${b.answers.angle.choice.padEnd(22)} ${p.title.slice(0, 50)}`);
  p.angle = b.answers.angle.choice; p.tier = tier;
}
for (const p of POSTS.filter((x) => x.tier === "high").slice(0, 2)) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${or}` },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: buildRedditMessages({ author: `u/someone in ${p.subreddit}`, post: `${p.title}\n\n${p.body}`, angle: p.angle }, DEFAULT_REDDIT_ABOUT), max_tokens: 200, temperature: 0.5, reasoning: { enabled: false } }) });
  const b = await r.json();
  console.log(`\n${p.title}`);
  for (const a of parseAngles(b.choices[0].message.content, DEFAULT_REDDIT_ABOUT)) console.log(`  ${a.label}: ${a.text}${a.fact ? `\n      [fact] ${a.fact.slice(0, 80)}` : ""}`);
}
