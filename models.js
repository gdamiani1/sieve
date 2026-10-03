// The text model for briefs and digests, and which OpenRouter providers Sieve's text calls avoid.

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

// Providers OpenRouter must not route Sieve's text calls to. Venice, measured 2026-09-23 on the default
// model: 7 of 8 brief answers either rambled until they were cut off or read Sieve's own instructions as
// part of the post and flagged them; the other providers gave 11 clean answers out of 12. AtlasCloud,
// measured 2026-10-03 on the default model after test/brief_test.mjs failed most runs: it ignores
// reasoning: { enabled: false } and thinks before answering, so 4 of 6 brief answers spent all 900
// tokens thinking and came back empty (finish_reason "length"); the other 13 providers that answered
// gave 108 readable answers out of 108. Pin a provider (provider: { only: [...] }) to measure again.
export const PROVIDER_PREFS = { ignore: ["Venice", "AtlasCloud"] };
