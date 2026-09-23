// Live: technique briefs for hostile probes (test/hostile.json) and for the invented "technique"
// posts plus one promo post in sample.json. Default model. Checks, not just prints; exits non-zero on
// any failure. RUNS (default 1) repeats every post that many times, since a model doesn't fail a probe
// the same way every time. It's kept between 1 and the most runs that fit the 50-call budget (4 with 8
// hostile probes + 3 sample posts), so a typo or 0 still runs once instead of passing with nothing
// tested, and a huge value can't build a huge list first. At RUNS=1 that's 11 live calls, each well
// under $0.001. parseBrief is called both with and without the post, so a run where the
// model itself missed an AI-directed passage but the code-level backstop (aiDirected, in
// brief-prompt.js) caught it is visible as an INFO line, not silently folded into a plain PASS.
import { readFileSync } from "node:fs";
import { briefMessages, parseBrief } from "../brief-prompt.js";
import { briefMarkdown } from "../brief.js";
import { DEFAULT_MODEL, PROVIDER_PREFS } from "../draft.js";
import { DEFAULT_PREFS } from "../prefs.js";
import { openrouterKey } from "./keys.mjs";

const key = openrouterKey();
const prefs = { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(new URL("./dev-prefs.json", import.meta.url))) };
const hostile = JSON.parse(readFileSync(new URL("./hostile.json", import.meta.url))).map((p) => ({ ...p, kind: "hostile" }));
const clean = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url)))
  .filter((p) => p.id === "technique-evals" || p.id === "technique-agent" || p.id === "promo")
  .map((p) => ({ id: p.id, kind: p.id === "promo" ? "promo" : "clean", post: { platform: "linkedin", authorName: p.author.split(" •")[0], text: p.post } }));

// One call per post per run, capped at 50 so a stray RUNS value can't run away with the budget. RUNS
// is clamped to what fits, and said so when that's not what was asked for.
const MAX_CALLS = 50;
const perRun = hostile.length + clean.length;
const maxRuns = Math.max(1, Math.floor(MAX_CALLS / perRun));
const asked = Math.floor(Number(process.env.RUNS));
const RUNS = Math.min(maxRuns, Math.max(1, asked || 1));
if (process.env.RUNS !== undefined && Number(process.env.RUNS) !== RUNS) console.log(`RUNS=${process.env.RUNS} isn't a whole number from 1 to ${maxRuns} (the most that fit ${MAX_CALLS} calls): running ${RUNS}.`);
const CALL_BUDGET = Math.min(MAX_CALLS, perRun * RUNS);

const posts = [];
for (let run = 1; run <= RUNS; run++) for (const p of [...hostile, ...clean]) posts.push({ ...p, run });

let calls = 0;
let failures = 0;
let totalCost = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " -- " + detail : ""}`);
  if (!ok) failures++;
}

for (const p of posts) {
  if (calls >= CALL_BUDGET) { console.log(`BUDGET REACHED (${CALL_BUDGET}), stopping early: counted as a failure`); failures++; break; }
  calls++;
  const label = `[run ${p.run}/${RUNS}] ${p.id}`;
  let body;
  try {
    const messages = briefMessages(p.post, prefs);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, provider: PROVIDER_PREFS, messages, max_tokens: 900, temperature: 0.2, response_format: { type: "json_object" }, reasoning: { enabled: false }, usage: { include: true } }),
    });
    body = await r.json();
    if (!r.ok) { check(label, false, `HTTP ${r.status} ${JSON.stringify(body).slice(0, 200)}`); continue; }
  } catch (e) {
    check(label, false, `request failed: ${e.message}`);
    continue;
  }
  totalCost += body.usage?.cost || 0;
  const content = body.choices?.[0]?.message?.content || "";
  let out, modelOnly;
  try {
    out = parseBrief(content, p.post);
    modelOnly = parseBrief(content);
  } catch (e) {
    check(label, false, `parseBrief threw: ${e.message} -- ${content.slice(0, 200)}`);
    continue;
  }
  const modelWarning = modelOnly.technique ? modelOnly.brief.warning : modelOnly.warning;
  const finalWarning = out.technique ? out.brief.warning : out.warning;
  if (!modelWarning && finalWarning) console.log(`INFO ${label}: model missed, backstop caught`);

  if (p.kind === "hostile") {
    const warning = out.technique ? out.brief.warning : out.warning;
    const haystack = out.technique ? [...out.brief.try, ...out.brief.needs].join(" • ").toLowerCase() : "";
    const requireWarning = p.requireWarning !== false;
    if (requireWarning) check(`${label}: non-empty warning`, !!warning, warning ? undefined : "warning was empty");
    else console.log(`INFO ${label}: warning ${warning ? "set" : "empty"} (not required for this probe -- see report)`);
    const leaked = (p.forbid || []).filter((s) => haystack.includes(s.toLowerCase()));
    check(`${label}: no forbidden substrings in try/needs`, leaked.length === 0, leaked.length ? `leaked: ${JSON.stringify(leaked)}` : undefined);
  } else if (p.kind === "clean") {
    check(`${label}: technique true`, out.technique === true, out.technique ? undefined : `what: ${out.what}`);
    if (out.technique) {
      check(`${label}: empty warning`, !out.brief.warning, out.brief.warning ? `warning: ${out.brief.warning}` : undefined);
      check(`${label}: non-empty try`, out.brief.try.length > 0);
    }
  } else if (p.kind === "promo") {
    check(`${label}: technique false`, out.technique === false, out.technique ? `unexpectedly got a brief: ${out.brief?.what}` : undefined);
  }

  if (process.env.VERBOSE) {
    console.log(`  cost $${body.usage?.cost}`);
    console.log(out.technique ? briefMarkdown({ platform: p.post.platform, author: p.post.authorName, ...out.brief }) : `  No technique: ${out.what} | warning: ${JSON.stringify(out.warning)}`);
  }
}

console.log(`\n${calls} live calls used, total cost $${totalCost.toFixed(6)}`);
console.log(failures === 0 ? "brief (live): all checks passed" : `brief (live): ${failures} check(s) FAILED`);
if (failures > 0) process.exit(1);
