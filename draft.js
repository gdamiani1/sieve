// Comment angles. Suggest only: three one-line ideas for what you could say. You pick one,
// write the comment yourself and paste it into LinkedIn. Nothing here touches the LinkedIn page.

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

// Providers OpenRouter must not route Sieve's text calls to. Venice, measured 2026-09-23 on the default
// model: 7 of 8 brief answers either rambled until they were cut off or read Sieve's own instructions as
// part of the post and flagged them; the other providers gave 11 clean answers out of 12.
export const PROVIDER_PREFS = { ignore: ["Venice"] };

// Facts the draft may use about you. Everything here must be true and first-hand.
// Edit in the extension options. The model is told never to claim anything not on this list.
export const DEFAULT_ABOUT = `- Replace these with true, first-hand facts about you. The angles may only point to facts listed here.
- Example: I tested a classifier on 200 of our support emails and it matched our labels on 180.
- Example: I run a two-person agency that builds internal tools for accountants.`;

// Reddit is pseudonymous: no business name, no site, nothing that reads as promotion.
export const DEFAULT_REDDIT_ABOUT = `- Replace these with true, first-hand facts about you, written for Reddit (no business names or links).
- Example: I've done my own bookkeeping as a sole trader for three years.
- Example: I built a script that validates customer tax IDs before invoices go out.`;

const ANGLES = {
  ask_failures: "Ask about error rates, failure cases or limits they didn't mention.",
  ask_how: "Ask one specific question about how it works.",
  share_result: "Add one related first-hand result from the facts list, briefly, then ask a question.",
  answer_question: "Answer the question they asked, using the facts list if relevant.",
  disagree: "Offer one respectful, specific counterpoint.",
  none: "Ask one specific, genuine question about the post.",
  answer_from_experience: "Answer directly from one relevant fact.",
  clarifying_question: "Ask for the missing detail that changes the answer.",
  approach: "Say how you would approach the problem.",
  share_mistake: "Warn about a pitfall, ideally one you hit yourself.",
};

export function facts(about) {
  return about.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
}

// Which fact may reach the angle prompt is Jev's call, not the drafting model's. Given every fact,
// a cheap model stretches one that only shares a broad field (AI, agents) onto any post. Jev rates
// each fact against the post; plain code keeps the best one at FACT_MIN or above, or none.
// FACT_MIN came from 27 invented posts: unrelated ones scored 0.56 at most, real matches 0.71 or more.
export const FACT_MIN = 0.7;

export function factQuestions(list) {
  return Object.fromEntries(list.map((f, i) => [`f${i + 1}`, {
    type: "noul",
    instructions: `The reader may reply to this post and mention this first-hand fact of theirs. Would the post's author see the fact as directly about what they wrote? Fact: ${f}`,
    criteria: {
      true: "Directly about what the author wrote: the same kind of task, tool, method or problem, so it adds a real data point to their post.",
      false: "Only shares a broad topic with the post (AI, automation, LLMs, agents, email, small business), or is about something else.",
    },
  }]));
}

// Index of the fact Jev rates highest, if it reaches min; -1 when none does. A tie keeps the first.
export function pickFact(answers, count, min = FACT_MIN) {
  let best = -1;
  for (let i = 0; i < count; i++) {
    const p = answers?.[`f${i + 1}`]?.noul;
    if (typeof p !== "number" || Number.isNaN(p) || p < min) continue;
    if (best < 0 || p > answers[`f${best + 1}`].noul) best = i;
  }
  return best;
}

export function buildMessages({ author, post, angle }, about) {
  const list = facts(about).map((f, i) => `F${i + 1}: ${f}`).join("\n");
  const system = `You suggest angles for a LinkedIn comment. You do NOT write the comment. The commenter ("me") writes it himself.

Two sources, never mix them up:
1. THE POST: written by the post author. The angles are about it.
2. MY FACTS: numbered facts about me, the commenter. The post author did not write these.

Give exactly 3 angles, each a different move, one per line:
- Ask: <a concrete question about a specific detail in the post>
- <Label>: <angle>
- <Label>: <angle>

Labels: Ask, Push back, Build on it, Your angle.
Rules:
- Every line names a specific detail from THE POST and is under 25 words.
- Only a line labelled "Your angle" may relate to me. Write it as "Your angle (F<n>): <a note to me on how to use that fact here>", starting with a verb, for example "Mention your rota built with a solver, then ask how they handle sick days." In that line "you" and "your" mean me, and the post author is "they". It is a note, not the comment: no "I", and no number or detail the fact does not have, because I can see the fact under the line. Use it only if one fact is truly relevant; otherwise give three lines without it.
- The other lines say nothing about me: no "I", "my" or "me".
- Do not make all three about failures or error rates. Vary the move.
- English only. No praise, no selling, no emojis, no em dashes.
- Output only the 3 lines.`;
  // No fact passed Jev's check: say so, and don't ask for a result there is no fact for.
  const mine = list ? `MY FACTS (mine, not the author's)\n${list}` : `MY FACTS: none apply to this post. Give three lines without "Your angle".`;
  const move = !list && angle === "share_result" ? ANGLES.none : ANGLES[angle] || ANGLES.none;
  const user = `THE POST
Author: ${author}

${post}

${mine}

The scorer's suggested move, as one of the three if it fits: ${move}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

// Returns [{label, text, fact}] where fact is the verbatim fact text for "Your angle" lines.
export function buildRedditMessages({ author, post, angle }, about) {
  const list = facts(about).map((f, i) => `F${i + 1}: ${f}`).join("\n");
  const system = `You suggest angles for a Reddit reply. You do NOT write the reply. The replier ("me") writes it himself.

Two sources, never mix them up:
1. THE POST: written by the poster, usually asking for help.
2. MY FACTS: numbered facts about me. The poster did not write these.

Give exactly 3 angles, each a different move, one per line:
- <Label>: <angle>
Labels: Answer, Ask, Your experience, Watch out.
Rules:
- Every line addresses a specific detail from THE POST and is under 25 words.
- Only a line labelled "Your experience" may relate to me. Write it as "Your experience (F<n>): <a note to me on how that fact helps this poster>", starting with a verb, for example "Suggest splitting the rota by skill, from your own time running a cafe." In that line "you" and "your" mean me, and the poster is "they". It is a note, not the reply: no "I", and no number or detail the fact does not have, because I can see the fact under the line. Skip it if no fact truly applies.
- Other lines say nothing about me: no "I", "my" or "me".
- The goal is to actually help the poster. No links, no product or service mentions, nothing that reads as promotion.
- Reddit voice: plain, practical, specific. No praise, no emojis, no em dashes.
- Output only the 3 lines.`;
  const user = `THE POST
${author}

${post}

MY FACTS (mine, not the poster's)
${list}

The scorer's suggested move, as one of the three if it fits: ${ANGLES[angle] || ANGLES.none}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

const LABEL = /^(Ask|Push back|Build on it|Your angle|Answer|Your experience|Watch out)\s*(?:\((F\d+)\))?\s*:\s*/i;
const FIRST_PERSON = /\b(I|I'm|I've|I'd|[Mm]y|[Mm]e|[Mm]ine)\b/;
const numbers = (s) => s.match(/\d+(?:[.,]\d+)?/g) || [];

// post: the post's text. A fact line may use numbers from its fact or the post, never one worked out or invented.
export function parseAngles(text, about, post = "") {
  const known = facts(about);
  const inPost = numbers(post);
  const out = [];
  for (const raw of text.split("\n")) {
    const line = clean(raw.replace(/^\s*[-*•\d.)]+\s*/, ""));
    const m = line.match(new RegExp(LABEL.source + "(.+)$", "i"));
    if (!m) continue;
    const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const n = m[2] ? Number(m[2].slice(1)) - 1 : -1;
    const body = m[3].replace(LABEL, ""); // the model sometimes writes the label twice
    if (!body) continue;
    if (/^your (angle|experience)$/i.test(m[1])) {
      if (!known[n]) continue; // no valid fact reference, drop it
      // A note to the reader, not the comment: first person means the model wrote the comment and
      // may have added what the fact doesn't say; a number the post lacks came from the fact or was worked out.
      if (FIRST_PERSON.test(body)) continue;
      const allowed = new Set([...inPost, ...numbers(known[n])]);
      if (numbers(body).some((x) => !allowed.has(x))) continue;
      out.push({ label, text: body, fact: known[n] });
    } else {
      if (FIRST_PERSON.test(body)) continue; // talks about me outside "Your angle"
      out.push({ label, text: body });
    }
  }
  // Three lines. The model sometimes writes four: the fact line is the one Jev checked, so it stays.
  const hasFact = out.some((a) => a.fact);
  let spare = hasFact ? 2 : 3;
  let factKept = false;
  return out.filter((a) => (a.fact ? !factKept && (factKept = true) : spare-- > 0));
}

export function clean(text) {
  return text.trim().replace(/^["']|["']$/g, "").replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, ", ");
}
