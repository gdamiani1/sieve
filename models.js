// The text model for briefs and digests, and which OpenRouter providers Sieve's text calls avoid.

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

// Providers OpenRouter must not route Sieve's text calls to. Venice, measured 2026-09-23 on the default
// model: 7 of 8 brief answers either rambled until they were cut off or read Sieve's own instructions as
// part of the post and flagged them; the other providers gave 11 clean answers out of 12.
export const PROVIDER_PREFS = { ignore: ["Venice"] };
