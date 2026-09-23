// Daily learnings digest from saved posts. Every claim stays attributed to its author,
// because these are what people posted, not verified facts.

export function digestMessages(posts) {
  const body = posts
    .map((p, i) => `POST ${i + 1}\nAuthor: ${p.authorName || p.author}\nTopic: ${p.topic}, ${p.kind}\n${p.text.slice(0, 1500)}`)
    .join("\n\n---\n\n");
  const system = `You write a short daily learnings digest for a freelance builder of practical AI automation, from LinkedIn posts they flagged as worth reading.

Sections, in this order, each as a heading line starting with "## " followed by "- " bullets:
## What people built or tested
## Numbers worth remembering
## Patterns
## Worth a conversation
## Open questions

Rules:
- Use only what is in the posts. Every bullet names its author in brackets at the end, e.g. [Jane Doe].
- These are the authors' claims, not facts: write "reports", "claims", "says" where it matters. Never present a claim as verified.
- "Numbers worth remembering": only numbers stated in the posts, copied exactly, with what they measure.
- "Patterns": only if two or more posts point the same way; name both authors. Skip the section if there is none.
- "Worth a conversation": at most 3 authors, each with one concrete reason tied to their post.
- "Open questions": what the posts leave unanswered (failure rates, costs, methods). No author needed.
- Keep the author's own hedges: if they wrote "I think", "estimated" or "extrapolated", say so.
- Separate what someone did from what they say it could enable; ideas are not results.
- Refer to authors by name. Never guess pronouns: no he, she, his or her; use the name or "they".
- Skip any section with nothing real to say. Under 350 words total. English. No em dashes, no emojis, no hype.
- Output only the digest.`;
  return [
    { role: "system", content: system },
    { role: "user", content: `${posts.length} posts:\n\n${body}` },
  ];
}
