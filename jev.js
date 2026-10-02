// Jev, TypeSafe's decision model: which key scores, and one call to it. Through OpenRouter with the
// person's OpenRouter key (one key does everything), or directly at TypeSafe for someone who only has a
// TypeSafe key. The body is the same at both.
export const JEV_OPENROUTER = "https://openrouter.ai/api/v1/systemone";
export const JEV_TYPESAFE = "https://api.typesafe.ai/v1/systemone";

// Tests shorten these; nothing else changes them.
export const limits = { timeoutMs: 10_000, maxWaitS: 10 };

export const PRICE_PER_MTOK = 0.042; // USD per million input tokens, output free

// An OpenRouter key wins when both are saved: one bill, and a TypeSafe key whose credit is used up
// doesn't stop scoring. The TypeSafe key is only for someone who has no OpenRouter key.
export function scoringKey({ orKey, apiKey } = {}) {
  if (orKey) return { via: "openrouter", key: orKey };
  if (apiKey) return { via: "typesafe", key: apiKey };
  return null;
}

// Retry-After in seconds, 2 when it's missing or a date, never more than maxWaitS.
export function retryWait(res) {
  const h = res.headers?.get?.("retry-after");
  const n = h == null || String(h).trim() === "" ? NaN : Number(h);
  return Math.min(Number.isFinite(n) && n >= 0 ? n : 2, limits.maxWaitS);
}

// Jev's answers checked the way parseScore checks a chat model's (score-prompt.js), or null. verdict()
// throws on a missing kind or topic, and a probability sent as a string would slip past the hostile
// zeroing, so only finite numbers count (clamped to 0..1) and only known choices; a topic Jev made up is
// "other", which topicLabel can read.
export function cleanAnswers(raw, questions) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const v = raw[id];
    if (q.type === "noul") {
      if (typeof v?.noul !== "number" || !Number.isFinite(v.noul)) return null;
      answers[id] = { noul: Math.min(1, Math.max(0, v.noul)) };
    } else {
      const key = typeof v?.choice === "string" ? v.choice : "";
      if (Object.hasOwn(q.criteria, key)) answers[id] = { choice: key };
      else if (id === "topic" && Object.hasOwn(q.criteria, "other")) answers[id] = { choice: "other" };
      else return null;
    }
  }
  return answers;
}

// What a 200 cost: OpenRouter's own dollars when it says, otherwise the input tokens at Jev's price.
const billed = (usage) => {
  const tokens = usage?.input_tokens || 0;
  return { cost: typeof usage?.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : (tokens * PRICE_PER_MTOK) / 1e6, tokens };
};

// { answers, cost, tokens } or { error, fallback } (with cost and tokens when a billed 200 couldn't be read). `fallback` is true only on OpenRouter, and only when
// Jev itself couldn't answer (no provider, a guardrail, a timeout, an answer without answers): Jev there
// has one provider, so the caller can try a chat model with the same key. Never on 401, 402 or 429: the
// same key would fail the same way.
export async function askJev(use, state, questions) {
  const or = use.via === "openrouter";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${use.key}` };
  if (or) headers["X-Title"] = "Sieve";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
    try {
      let res;
      try {
        res = await fetch(or ? JEV_OPENROUTER : JEV_TYPESAFE, { method: "POST", headers, signal: ctrl.signal, body: JSON.stringify({ model: "jev-latest", state, questions }) });
      } catch {
        if (ctrl.signal.aborted) return { error: "timeout", fallback: or };
        return { error: "network", fallback: false };
      }
      if (res.status === 429) {
        if (attempt === 0) {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, retryWait(res) * 1000));
          continue;
        }
        return { error: "rate_limited", fallback: false };
      }
      if (or) {
        if (res.status === 401) return { error: "or_key_rejected", fallback: false };
        if (res.status === 402) return { error: "or_no_credit", fallback: false };
        if (!res.ok) return { error: `http_${res.status}`, fallback: [400, 403, 404, 408].includes(res.status) || res.status >= 500 };
      } else {
        if (res.status === 401) return { error: "key_rejected", fallback: false };
        if (res.status === 402 || res.status === 403) return { error: "no_credit", fallback: false };
        if (!res.ok) return { error: `http_${res.status}`, fallback: false };
      }
      const body = await res.json().catch(() => null);
      if (!body && ctrl.signal.aborted) return { error: "timeout", fallback: or };
      const answers = cleanAnswers(body?.answers, questions);
      if (!answers) return { error: "unreadable", fallback: or, ...billed(body?.usage) };
      return { answers, ...billed(body.usage) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "rate_limited", fallback: false };
}
