// Live: Jev decides which of the reader's facts, if any, may reach the angle prompt (draft.js pickFact).
// Invented facts and posts. Posts that only share a broad field with a fact must get no fact.
//   node test/facts_live_test.mjs
//   SCORER=openrouter node test/facts_live_test.mjs   (the same cases through the OpenRouter path, for
//                                                     people without a TypeSafe key: score-prompt.js)
import { factQuestions, pickFact, FACT_MIN, DEFAULT_MODEL, PROVIDER_PREFS } from "../draft.js";
import { scoreMessages, parseScore } from "../score-prompt.js";
import { typesafeKey, openrouterKey } from "./keys.mjs";

const FACTS = [
  "I run a two-person agency that builds internal tools for accountants.",
  "I tested a classifier on 200 of our support emails and it matched our labels on 180.",
  "I built a browser extension that hides job-ad posts from my LinkedIn feed.",
  "I plan our cafe's staff rota with a constraint solver instead of a spreadsheet.",
  "I wrote a guide arguing that small models plus plain code beat one big LLM for most back-office tasks.",
];
// want: the fact number (1-based) that fits, or 0 for none.
const CASES = [
  [0, "My coding agent switched off its own sandbox so it could use my SSH key on our staging server, then ran sudo commands there. The vendor says this is working as designed."],
  [0, "A new agents SDK just shipped with handoffs, guardrails and tracing built in. Here is a quick tour of the five building blocks."],
  [0, "Every small business needs an AI strategy this year. Three questions to ask before you buy any tool."],
  [0, "10 prompts I use every morning to plan my day and prepare for meetings. Save this post for later."],
  [0, "Thrilled to announce our seed round! We are building AI receptionists for dental clinics and hiring engineers."],
  [2, "We moved support ticket triage to a classifier. It sorts tickets into billing, bugs and account, and unsure ones go to a person. How do others pick the confidence cut-off?"],
  [4, "Rostering nurses by hand took our manager two days a month. A constraint solver now does it in a minute and never breaks a rest-time rule."],
  [3, "I made a Chrome extension that reads my LinkedIn feed as I scroll and hides recruiter spam and engagement bait."],
  [5, "Teams reach for a frontier LLM at every step when a small classifier and plain code would be cheaper and easier to test. We cut our invoice pipeline's cost by 90 percent."],
  [1, "Accountants: which internal tools did you have built for your firm, and which ones does the team still use a year later?"],
];

const viaOpenRouter = process.env.SCORER === "openrouter";
const key = viaOpenRouter ? openrouterKey() : typesafeKey();
let failed = 0;
for (const [want, post] of CASES) {
  let answers;
  if (viaOpenRouter) {
    const questions = factQuestions(FACTS);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Title": "Sieve" },
      body: JSON.stringify({ model: DEFAULT_MODEL, provider: PROVIDER_PREFS, messages: scoreMessages(questions, { post }), max_tokens: 300, reasoning: { enabled: false }, temperature: 0, response_format: { type: "json_object" } }),
    });
    if (!res.ok) { console.log(`OpenRouter said ${res.status}`); process.exit(1); }
    answers = parseScore((await res.json()).choices[0].message.content, questions, { post }).answers;
  } else {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "jev-latest", state: { post }, questions: factQuestions(FACTS) }),
    });
    if (!res.ok) { console.log(`Jev said ${res.status}`); process.exit(1); }
    ({ answers } = await res.json());
  }
  const got = pickFact(answers, FACTS.length) + 1;
  const ps = FACTS.map((_, i) => answers[`f${i + 1}`].noul.toFixed(2)).join(" ");
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} want ${want ? "F" + want : "none"}, got ${got ? "F" + got : "none"}   [${ps}]  ${post.slice(0, 60)}`);
}
console.log(failed ? `\nfacts live: ${failed} of ${CASES.length} wrong at FACT_MIN ${FACT_MIN}` : `\nfacts live: all ${CASES.length} right at FACT_MIN ${FACT_MIN}`);
process.exit(failed ? 1 : 0);
