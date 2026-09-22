// "Watch it for me": a video model watches a public YouTube video (picture and sound)
// and says whether it's worth this viewer's time, with timestamps and takeaways.

export const DEFAULT_VIDEO_MODEL = "google/gemini-2.5-flash-lite";

// Measured 2026-09-22 on Gemini 2.5 Flash-Lite via OpenRouter: ~296 input tokens per second
// of video (frames + audio), $0.0007 for a 19 s clip. About $0.0022 per minute.
export const USD_PER_MINUTE = 0.0022;
export const MAX_MINUTES = 55; // an hour of video is ~1.07M tokens, past a 1M context

export const estimateUsd = (seconds) => (seconds / 60) * USD_PER_MINUTE;
export const formatUsd = (usd) => (usd < 0.01 ? "<1¢" : `~${Math.round(usd * 100)}¢`);

export function watchMessages({ url, title, channel }, prefs) {
  const system = `You watch a YouTube video (picture and sound) for a busy viewer and report back as JSON.

The viewer is ${prefs.role}. Their topics: ${prefs.topics.join("; ")}.

Return only this JSON object:
{
  "verdict": "watch" | "skim" | "skip",
  "why": "one sentence: why this verdict, for this viewer's topics",
  "summary": "two sentences on what the video actually covers",
  "points": [{"t": "m:ss", "text": "a key point, as the creator makes it"}],
  "best_moment": {"t": "m:ss", "text": "the one part worth jumping to, and why"},
  "learnings": ["a concrete, reusable takeaway the viewer could apply to their topics"],
  "claims_to_check": ["a specific claim or number the creator states that the viewer should verify before repeating"]
}

Rules:
- Only report what is actually in the video. Timestamps must come from the video. Never invent numbers.
- These are the creator's claims: write "they say", "the creator claims" where it matters.
- "watch": worth the full time for these topics. "skim": jump to the best moment. "skip": not worth it for these topics, or mostly promotion.
- At most 5 points, 3 learnings, 3 claims_to_check. Use [] when there are none.
- English. Plain and specific. No hype, no emojis, no em dashes.`;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: `Video: "${title}" by ${channel}. Watch it and return the JSON.` },
        { type: "video_url", video_url: { url } },
      ],
    },
  ];
}

// Models occasionally wrap JSON in code fences, leave trailing commas, or get cut off.
// Try the text as is, then repaired, then closed off where it stopped. Throws if nothing works.
export function looseJson(text) {
  let t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  t = t.slice(t.indexOf("{"));
  const attempts = [t.slice(0, t.lastIndexOf("}") + 1), t];
  for (const a of attempts) {
    for (const candidate of [a, a.replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(candidate); } catch {}
    }
  }
  // Cut off mid-answer: drop the unfinished tail, then close whatever is still open.
  let cut = t.replace(/,?\s*"[^"]*$/, "").replace(/,?\s*\{[^{}]*$/, "").replace(/,\s*$/, "");
  const stack = [];
  let inStr = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  return JSON.parse(cut + stack.reverse().join(""));
}

export function parseWatch(text) {
  const r = looseJson(text);
  const clean = (s) => String(s || "").replace(/\s*[—–]\s*/g, ", ").trim();
  return {
    verdict: ["watch", "skim", "skip"].includes(r.verdict) ? r.verdict : "skim",
    why: clean(r.why),
    summary: clean(r.summary),
    points: (r.points || []).slice(0, 5).map((p) => ({ t: clean(p.t), text: clean(p.text) })),
    best: r.best_moment ? { t: clean(r.best_moment.t), text: clean(r.best_moment.text) } : null,
    learnings: (r.learnings || []).slice(0, 3).map(clean),
    checks: (r.claims_to_check || []).slice(0, 3).map(clean),
  };
}

export function toSeconds(t) {
  const parts = String(t).split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
