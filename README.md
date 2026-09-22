# Sieve

A Chrome extension that tells you which LinkedIn and Reddit posts are worth your attention, and suggests
angles for a reply. It never writes or posts anything for you.

It is built on [Jev](https://typesafe.ai), TypeSafe's decision model (Sieve is an independent project, not made by TypeSafe): a model that doesn't generate text,
it picks from answers you define and returns a probability. Jev makes the narrow calls (is this worth
reading? could I answer this?), plain code handles the rules, and you do the part that needs judgement.

## What it does

**LinkedIn feed**
- Every post that stays on screen for half a second gets a Jev score. 0.7 and up gets a blue bar and a badge
  with the kind of post, the topic and a suggested move. 0.4 to 0.7 gets a light bar. Below 0.4 fades
  (hover to read; can be turned off). Promoted posts are skipped. Reshares include the shared post.
- **Comment angles**: three one-line ideas (Ask / Push back / Build on it / Your angle), not a comment.
  You pick one and write it yourself.

**Reddit** (www and old.reddit)
- Different question: is this someone asking for help that *you* could answer from first-hand experience?
  The badge also shows the thread's age and comment count, and whether it's still fresh
  (≤ 12 hours, ≤ 40 comments).
- **Reply angles** (Answer / Ask / Your experience / Watch out). No links, no promotion.

**Daily learnings**
- Posts scored 0.7+ are saved locally for 30 days. The digest page summarises them into what people built,
  numbers worth remembering, patterns, people worth a conversation, and open questions, with every bullet
  attributed to its author. Reddit threads you could still answer are listed on top.
- Optional daily reminder notification (18:00 by default), only when something new was saved.

## Make it yours

Settings (right-click the icon → Options, or **Settings** in the popup):
- **What you care about:** one line about who you are and up to 8 topics. Jev scores every post against these,
  and the badge shows which of your topics a post is about.
- **Kinds of posts** to show on LinkedIn (built something, opinions, questions, news, promotion, personal) and on
  Reddit (asking for help, discussions, showcases, rants, news, promotion).
- **Rules** that always win over Jev: words that always show a post (a person, your company) and words that
  never do (crypto, webinar, "we're hiring").
- **Scores:** where highlighting starts, what counts as low, and whether low posts fade, hide or stay.
- **Reddit:** only in the subreddits you list, and your own definition of "still fresh".
- LinkedIn and Reddit can each be switched off from the popup. Saving settings re-scores what's on screen.

## Why angles and not ready-made comments

The first version drafted whole comments. Two things went wrong:
1. They all made the same move ("what were your failure cases?"), which reads like a template after the third one.
2. Cheap models misquoted the reader's own results and once attributed them to the post's author.

So now a "Your angle" line must cite one of your facts by number, and the panel shows that fact
word for word under the idea. Lines that talk about "me" anywhere else are dropped. You write the comment.

## Setup

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Click the extension icon:
   - **TypeSafe API key** (for Jev scoring). Checked against the API before it's saved.
   - **OpenRouter API key** (for angles and digests). Default model `deepseek/deepseek-v4-flash`.
   - **Your facts** for LinkedIn and for Reddit. Only true, first-hand things. Angles can only point to these.
3. Reload LinkedIn or Reddit and scroll.

Keys live only in `chrome.storage.local` in your browser profile. Post text goes to TypeSafe (scoring) and,
when you ask for angles or a digest, to OpenRouter.

## Cost (September 2026 prices)

- Jev scoring: about 1,000 input tokens per post at $0.042 per million: roughly 4 US cents per 1,000 posts.
- Angles: about $0.00005 per request with DeepSeek V4 Flash. A digest of a day's posts: well under a cent.

## Tests

The tests use invented posts (`test/sample.json`, `test/reddit_test.mjs`). Keys come from
`TYPESAFE_API_KEY` / `OPENROUTER_API_KEY`, or on macOS from Keychain items `typesafe-api-key` / `openrouter-api-key`.

    node test/rules_test.mjs        # the rules on top of Jev (offline, no keys)
    node test/run_triage.mjs        # LinkedIn scoring (PREFS=file.json to score as someone else)
    node test/reddit_test.mjs       # Reddit scoring + reply angles
    node test/angles_test.mjs       # comment angles never borrow your facts for the author
    node test/compare_drafts.mjs    # the same angles from several models, with cost
    node test/digest_test.mjs       # daily learnings digest

On the invented set, LinkedIn scoring matched the intended tier on 7 of 8 (a "built a small tool" post
scored high where it was labelled maybe) and Reddit on 5 of 6 (the shared-inbox question scored 0.52, maybe
instead of high). The angle-model bake-off (Mistral Small 3.2, DeepSeek V4 Flash, Qwen 3.7 Flash,
Claude Haiku 4.5) picked DeepSeek: the others invented or mixed up the reader's numbers, or cost 18x more.

## Limits and fair warnings

- **LinkedIn and Reddit markup changes break it.** LinkedIn (2026) has no stable class names; the hooks are
  `[role=listitem][componentkey^="update-card-"]` and `[data-testid="expandable-text-box"]`. Reddit uses
  `<shreddit-post>` attributes. If badges stop appearing, those changed. Reddit shows a note if it can't find posts.
- **Personal use.** It only reads what you scroll past in your own browser and never acts on the page.
  LinkedIn and Reddit both restrict automated activity; don't turn this into something that does.
- **Scores and angles are suggestions from cheap models.** Check any number before you repeat it.
- If the model returns an empty answer (reasoning models sometimes think until they run out of tokens),
  it retries once with reasoning disabled and more room.

## Files

- `prefs.js`: default settings, the questions Jev is asked (built from each user's settings) and the rules applied after.
- `draft.js`: the angle prompts and parser. `digest-prompt.js`: the digest prompt.
- `content.js` (LinkedIn), `reddit.js` (Reddit), `background.js` (API calls, saving, reminder).
- `options.*`: settings page. `popup.*`: toolbar popup. `digest.*`: daily learnings page.

## License

MIT
