// Scores test/sample.json (invented posts, each labelled with the tier it should get) with Jev and with
// OpenRouter models through score-prompt.js, and prints each scorer's raw "worth" per post, the cost,
// and how many labels each gets right at the thresholds that suit it best.
//
// It exists to set the OpenRouter path's thresholds from evidence (Jev's 0.7 and 0.4 were set against
// Jev's calibrated probabilities, and a general model's are not calibrated the same way) and to measure
// the cost per post. It spends real money on both keys: a few cents.
//
//   node test/compare_scorers.mjs [model ...]
//   SET=reddit node test/compare_scorers.mjs     (the invented Reddit posts from reddit_test.mjs)
//   SET=youtube node test/compare_scorers.mjs    (invented video tiles, labelled for the default reader)
//   SET=hostile node test/compare_scorers.mjs    (test/hostile.json: every one must land low, "!" marks
//                                                 a post the backstop or the model's own report caught)
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS, linkedinQuestions, redditQuestions, youtubeQuestions } from "../prefs.js";
import { scoreMessages, parseScore } from "../score-prompt.js";
import { DEFAULT_MODEL, PROVIDER_PREFS, DEFAULT_REDDIT_ABOUT } from "../draft.js";
import { typesafeKey, openrouterKey } from "./keys.mjs";

const models = process.argv.slice(2).length ? process.argv.slice(2) : [DEFAULT_MODEL, "google/gemini-2.5-flash-lite"];
const prefs = DEFAULT_PREFS;
const SET = process.env.SET || "linkedin";

// Invented, like everything in test/. Labelled for DEFAULT_PREFS: someone who uses AI and automation in
// their work, with topics AI in practice, automating everyday work, and running a small business.
// Invented, the Reddit posts are the same ones reddit_test.mjs uses (one of them) or in its style.
const REDDIT = [
  { id: "vat-ids", want: "high", state: { subreddit: "r/smallbusiness", title: "How do you catch wrong customer tax IDs before invoicing?", body: "Twice this year I sent invoices with a typo in the client's VAT number and had to cancel and reissue. Is there a simple way to validate these before sending? I'm a one person shop, no accounting software yet." } },
  { id: "inbox", want: "high", state: { subreddit: "r/automation", title: "Sorting a shared inbox automatically, is an LLM overkill?", body: "We get ~300 emails a day into info@. I want to auto-tag them as order, complaint, invoice, spam. GPT works but it's slow and I worry about cost. Anyone done this with something lighter?" } },
  { id: "pausal", want: "high", state: { subreddit: "r/croatia", title: "Paušalni obrt: tko vodi evidenciju sam?", body: "Otvaram paušalni obrt i pitam se isplati li se knjigovođa ili mogu sam voditi KPR i izdavati račune. Kakva su vaša iskustva?" } },
  { id: "40k", want: "low", state: { subreddit: "r/Entrepreneur", title: "I made $40k in 30 days with this one trick", body: "DM me for my course. Link in bio." } },
  { id: "leak", want: "low", state: { subreddit: "r/LocalLLaMA", title: "New 400B model weights leaked?", body: "Anyone seen the torrent going around?" } },
  { id: "10-years", want: "low", state: { subreddit: "r/smallbusiness", title: "Just hit 10 years in business!", body: "Wanted to share this milestone with you all. Thanks for the support." } },
].map((p) => ({ ...p, state: { ...p.state, reader_experience: DEFAULT_REDDIT_ABOUT } }));

const YOUTUBE = [
  { id: "n8n-inbox", want: "high", state: { title: "I automated my invoice inbox with n8n and a small model (full build, costs included)", channel: "Ops Notes", length: "18 min" } },
  { id: "evals", want: "high", state: { title: "How we test LLM prompts before shipping: golden sets in CI", channel: "Applied ML Weekly", length: "24 min" } },
  { id: "agent-demo", want: "high", state: { title: "Building a coding agent that fixes its own failing tests, step by step", channel: "Build With Agents", length: "31 min" } },
  { id: "reaction", want: "low", state: { title: "Reacting to the WILDEST AI news this week!!", channel: "Hype Central", length: "12 min" } },
  { id: "prank", want: "low", state: { title: "Funniest office pranks compilation 2026", channel: "LOL Daily", length: "9 min" } },
  { id: "course", want: "low", state: { title: "Get rich with AI: my $997 course is finally open", channel: "Passive Income Pro", length: "5 min" } },
];

const HOSTILE = JSON.parse(readFileSync(new URL("./hostile.json", import.meta.url))).map((f) => ({ id: f.id, want: "low", state: { author: f.post.authorName, title: f.post.title, post: f.post.text } }));
const questions = SET === "reddit" ? redditQuestions(prefs) : SET === "youtube" ? youtubeQuestions(prefs) : linkedinQuestions(prefs);
const posts = SET === "reddit" ? REDDIT : SET === "youtube" ? YOUTUBE : SET === "hostile" ? HOSTILE
  : JSON.parse(readFileSync(new URL("./sample.json", import.meta.url))).map((p) => ({ ...p, state: { author: p.author, post: p.post } }));
const WORTH = SET === "reddit" ? "answerable" : "worth";
const TIERS = ["low", "maybe", "high"];

async function jev(p) {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${typesafeKey()}` },
    body: JSON.stringify({ model: "jev-latest", state: p.state, questions }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`Jev ${r.status}`);
  return { worth: b.answers[WORTH].noul, kind: b.answers.kind.choice, cost: ((b.usage?.input_tokens || 0) * 0.042) / 1e6 };
}

async function openrouter(model, p) {
  const state = p.state;
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey()}`, "X-Title": "Sieve" },
    body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages: scoreMessages(questions, state), max_tokens: 300, usage: { include: true }, reasoning: { enabled: false }, temperature: 0, response_format: { type: "json_object" } }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status} ${JSON.stringify(b).slice(0, 160)}`);
  const { answers, hostile } = parseScore(b.choices[0].message.content, questions, state);
  return { worth: answers[WORTH].noul, kind: (hostile ? "!" : "") + answers.kind.choice, cost: b.usage?.cost || 0 };
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
