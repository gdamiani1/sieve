// Jev, TypeSafe's decision model: which key scores, and one call to it. Through OpenRouter with the
// person's OpenRouter key (one key does everything), or directly at TypeSafe for someone who only has a
// TypeSafe key. The body is the same at both.
export const JEV_OPENROUTER = "https://openrouter.ai/api/v1/systemone";
export const JEV_TYPESAFE = "https://api.typesafe.ai/v1/systemone";

// Tests shorten these; nothing else changes them.
export const limits = { timeoutMs: 10_000, maxWaitS: 10 };

// An OpenRouter key wins when both are saved: one bill, and a TypeSafe key whose credit is used up
// doesn't stop scoring. The TypeSafe key is only for someone who has no OpenRouter key.
export function scoringKey({ orKey, apiKey } = {}) {
  if (orKey) return { via: "openrouter", key: orKey };
  if (apiKey) return { via: "typesafe", key: apiKey };
  return null;
}

// Retry-After in seconds, 2 when it's missing or a date, never more than maxWaitS.
function retryWait(res) {
  const h = res.headers?.get?.("retry-after");
  const n = h == null || String(h).trim() === "" ? NaN : Number(h);
  return Math.min(Number.isFinite(n) && n >= 0 ? n : 2, limits.maxWaitS);
}

// { answers, cost, tokens } or { error, fallback }. `fallback` is true only on OpenRouter, and only when
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
        if (ctrl.signal.aborted) return or ? { error: "timeout", fallback: true } : { error: "network", fallback: false };
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
      if (!body?.answers || typeof body.answers !== "object") {
        if (ctrl.signal.aborted) return or ? { error: "timeout", fallback: true } : { error: "network", fallback: false };
        return { error: "unreadable", fallback: or };
      }
      return { answers: body.answers, cost: or ? body.usage?.cost || 0 : 0, tokens: body.usage?.input_tokens || 0 };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "rate_limited", fallback: false };
}
