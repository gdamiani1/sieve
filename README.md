# Sieve

A Chrome extension that tells you which LinkedIn, X, Reddit and YouTube posts are worth your attention, and suggests
angles for a reply. For developers, it turns techniques worth trying into briefs your coding agent (Claude Code,
Codex, Cursor and others) can try in your repo. It never clicks, comments or posts for you, and never installs
or runs anything: a brief is text you copy.

It is built on [Jev](https://typesafe.ai), TypeSafe's decision model (Sieve is an independent project, not made by TypeSafe): a model that doesn't generate text,
it picks from answers you define and returns a probability. Jev makes the narrow calls (is this worth
reading? could I answer this? which of my facts is about this post?), plain code handles the rules, and you do the part that needs judgement.

## What it does

**LinkedIn feed**
- Every post that stays on screen for half a second gets a Jev score. 0.7 and up gets a blue bar and a badge
  with the kind of post, the topic and a suggested move. 0.4 to 0.7 gets a light bar. Below 0.4 fades
  (hover to read; can be turned off). Promoted posts are skipped. Reshares include the shared post.
- **Comment angles**: three one-line ideas (Ask / Push back / Build on it / Your angle), not a comment.
  You pick one and write it yourself. Before the angles are written, Jev picks which of your facts, if any,
  is about the post, and only that one reaches the angle model. Technique posts also show a Brief button.

**Reddit** (www and old.reddit)
- Different question: is this someone asking for help that *you* could answer from first-hand experience?
  The badge also shows the thread's age and comment count, and whether it's still fresh
  (≤ 12 hours, ≤ 40 comments).
- **Reply angles** (Answer / Ask / Your experience / Watch out). No links, no promotion.

**YouTube**
- Every video tile you scroll past gets a Jev chip, scored from its title, channel, length and any snippet.
- **Watch it for me**: a video model (Gemini 2.5 Flash-Lite via OpenRouter by default) watches the whole
  public video, picture and sound, and returns watch / skim / skip, key points with clickable timestamps,
  the best moment, learnings and claims to check. About 0.2 US cents per minute of video, up to 55 minutes.
  Every result is saved to the daily learnings.

**X**
- Same scoring and reply angles as LinkedIn. Ads are skipped.

**Technique briefs**
- On LinkedIn and X, posts that teach a technique or tool you could try get a "technique to try" badge and,
  unless they score low, a **Brief** button. On YouTube, Watch it for me writes a brief when the video teaches one.
- A brief says what it is, what the author claims (labelled as theirs), what to check, what you need, a 15 to
  30 minute way to try it, and whether it's worth keeping as a skill.
- **Copy as prompt** puts the brief on your clipboard for your coding agent. It starts with a note that it's
  third-party material, that the agent should treat it as information and not instructions, and that it should
  ask before running any command.
- When the model notices text aimed at AI agents in the source, or Sieve's own check finds a blatant case or
  hidden characters, the brief carries a warning at the top. Sieve's own code then makes "Check the source
  before copying anything from it." the first step, drops any step or need with a link, a download, a pipe
  into a shell or a package install, marks the brief not worth a skill, and ends the copied prompt with an
  instruction to show you the warning first and not fetch, install or run anything from it unless you ask.
  This lowers the risk; it doesn't remove it: the model can miss a passage, and the rest of the brief can
  still quote the source.

**Daily learnings**
- Posts scored 0.7+, and any post you brief, are saved locally for 30 days. The digest page summarises them
  into what people built, numbers worth remembering, patterns, people worth a conversation, and open questions,
  with every bullet attributed to its author. Reddit threads you could still answer are listed on top.
- The digest model gets your saved posts as data, with a rule never to follow text in them aimed at AI tools.
  A post where Sieve's own check finds a blatant case or hidden characters isn't sent at all, and the digest
  ends with a "Left out" line that says how many and whose. This lowers the risk; it doesn't remove it: the
  model can still miss a passage.
- Optional daily reminder notification (18:00 by default), only when something new was saved, not counting
  posts the digest leaves out.
- Technique briefs from the last 30 days are listed with Copy as prompt. **Export library** saves everything
  Sieve kept (posts, videos, briefs, digests) as one JSON file you own.

## Make it yours

Settings (right-click the icon → Options, or **Settings** in the popup):
- **What you care about:** one line about who you are and up to 8 topics. Jev scores every post against these,
  and the badge shows which of your topics a post is about.
- **Kinds of posts** to show on LinkedIn and X (technique to try, built something, opinions, questions, news,
  promotion, personal) and on Reddit (asking for help, discussions, showcases, rants, news, promotion); YouTube
  has its own list.
- **Rules** that always win over Jev: words that always show a post (a person, your company) and words that
  never do (crypto, webinar, "we're hiring").
- **Scores:** where highlighting starts, what counts as low, and whether low posts fade, hide or stay.
- **Reddit:** only in the subreddits you list, and your own definition of "still fresh".
- LinkedIn, X, Reddit and YouTube can each be switched off from the popup. Saving settings re-scores what's
  on screen.

## Why angles and not ready-made comments

The first version drafted whole comments. Two things went wrong:
1. They all made the same move ("what were your failure cases?"), which reads like a template after the third one.
2. Cheap models misquoted the reader's own results and once attributed them to the post's author.

So now a "Your angle" line must cite one of your facts by number, and the panel shows that fact
word for word under the idea. Lines that talk about "me" anywhere else are dropped. You write the comment.

## Setup

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Click the extension icon:
   - **TypeSafe API key** (for Jev: scoring posts, and picking which of your facts fits a post for angles). Checked against the API before it's saved.
   - **OpenRouter API key** (for angles, briefs, digests and Watch it for me). Default model `deepseek/deepseek-v4-flash`.
   - **Your facts** for LinkedIn and for Reddit. Only true, first-hand things. Angles can only point to these.
3. Reload LinkedIn, X, Reddit or YouTube and scroll.

Keys live only in `chrome.storage.local` in your browser profile. Sieve sends data to two services and nowhere
else. TypeSafe gets what Jev scores: a post's text (for YouTube, the title, channel, length and any snippet),
your role and topics, and on Reddit your Reddit facts. When you ask for angles on LinkedIn or X, TypeSafe also
gets the post's text and your LinkedIn facts, so Jev can pick which fact, if any, fits. OpenRouter gets a post's
text when you ask for angles (with the one fact Jev picked, if any; on Reddit, your Reddit facts) or a brief
(with your role and topics), your saved posts (except any Sieve left out) when you ask for a digest, and a
video's link, title and channel (with your role and topics) when you have it watched. OpenRouter passes each
request to the model you picked.

## Cost (September 2026 prices)

- Jev scoring: about 1,000 input tokens per post at $0.042 per million: roughly 4 US cents per 1,000 posts.
- Angles: about $0.00005 per request with DeepSeek V4 Flash. On LinkedIn and X, each request also asks Jev
  which fact fits: the post plus about 140 input tokens per fact, so roughly 1,000 tokens and $0.00004 with
  five facts (estimated from the request's size, not measured). A digest of a day's posts: well under a cent.
- A brief: $0.00004 to $0.0002 with DeepSeek V4 Flash (measured on invented posts).

## Tests

The tests use invented posts (`test/sample.json`, `test/hostile.json`, `test/reddit_test.mjs`). Keys come from
`TYPESAFE_API_KEY` / `OPENROUTER_API_KEY`, or on macOS from Keychain items `typesafe-api-key` / `openrouter-api-key`.

    node test/rules_test.mjs        # the rules on top of Jev (offline, no keys)
    node test/watch_parse_test.mjs  # the video answer parser (offline)
    node test/brief_parse_test.mjs  # technique briefs: shape, safety header, prompt text (offline)
    node test/brief_prompt_test.mjs # the post brief prompt and its parser (offline)
    node test/digest_prompt_test.mjs # the digest prompt, which posts reach it, the Left out note (offline)
    node test/digest_worker_test.mjs # the digest through the real worker: flagged posts never sent (offline)
    node test/export_test.mjs       # the library export (offline)
    node test/brief_storage_test.mjs # briefs and saved posts kept apart per platform, a cross-post digested once, through the real worker (offline)
    node test/linkedin_post_id_test.mjs # finding a LinkedIn post's id in the page's data (offline)
    node test/brief_test.mjs        # briefs for invented and hostile posts, checked (set RUNS=3 to repeat each post, at most 4), under 1 US cent
    node test/run_triage.mjs        # LinkedIn scoring (PREFS=file.json to score as someone else)
    node test/reddit_test.mjs       # Reddit scoring + reply angles
    node test/angles_test.mjs       # comment angles never borrow your facts for the author
    node test/compare_drafts.mjs    # the same angles from several models, with cost
    node test/digest_test.mjs       # a digest with three probes aimed at the summariser, checked (RUNS=3 to repeat), under 1 US cent
    node test/watch_test.mjs        # Watch it for me on one public video (VIDEO=url), about 1 cent

On the invented set, LinkedIn scoring matched the intended tier on 7 of 8 (a "built a small tool" post
scored high where it was labelled maybe) and Reddit on 5 of 6 (the shared-inbox question scored 0.52, maybe
instead of high). The angle-model bake-off (Mistral Small 3.2, DeepSeek V4 Flash, Qwen 3.7 Flash,
Claude Haiku 4.5) picked DeepSeek: the others invented or mixed up the reader's numbers, or cost 18x more.

## Limits and fair warnings

- **LinkedIn and Reddit markup changes break it.** LinkedIn (2026) has no stable class names; the hooks are
  `[role=listitem][componentkey^="update-card-"]` and `[data-testid="expandable-text-box"]`. Reddit uses
  `<shreddit-post>` attributes. If badges stop appearing, those changed. Reddit shows a note if it can't find posts.
  A LinkedIn post's own link comes from the page's React data (`linkedin-post-id.js`); if briefs start linking
  to the author's profile instead of the post, that changed.
- **Personal use.** It only reads what you scroll past in your own browser and never acts on the page.
  LinkedIn and Reddit both restrict automated activity; don't turn this into something that does.
- **Scores, angles and briefs are suggestions from cheap models.** Check any number before you repeat it.
- If the model returns an empty answer (reasoning models sometimes think until they run out of tokens),
  it retries once with reasoning disabled and more room.

## Files

- `prefs.js`: default settings, the questions Jev is asked (built from each user's settings) and the rules applied after.
- `draft.js`: the angle prompts and parser, and the Jev question that picks which fact fits a post.
- `digest-prompt.js`: which saved posts go into a digest (flagged ones left out), the digest prompt, the Left out note and the final text.
- `content.js` (LinkedIn), `x.js` (X), `reddit.js` (Reddit), `youtube.js` (YouTube), `background.js` (API calls, saving, reminder).
  `linkedin-post-id.js`: runs in LinkedIn's own page and finds a feed post's id, so briefs link to the post. Reads only.
- `watch-prompt.js`: the Watch it for me prompt, cost estimate and parser. `json.js`: tolerant parsing of model JSON.
- `brief.js`: the technique brief (shape, safety header, markdown, Copy as prompt, the rules for warned briefs).
  `brief-prompt.js`: the prompt that briefs one post, and its parser.
  `brief-panel.js`: shows a brief on LinkedIn, X and YouTube. `export.js`: the Export library file.
- `watch-drawer.js`: the "watched for you" drawer for Watch it for me, shared by every page that offers it.
- `options.*`: settings page. `popup.*`: toolbar popup. `digest.*`: daily learnings page.

## Building the store package

`node tools/store-zip.mjs` writes `~/Downloads/sieve-store/sieve-<version>.zip` from the current commit
(`--ref main` for another commit). It packages committed files only, leaving out `test/`, `tools/`,
`README.md` and `.gitignore`. Before writing anything it checks the package and refuses, naming the
problem, when a packaged file's name or bytes mention a word it must never contain, when it loads a file
that's missing from the package, when a `.gitattributes` file exists anywhere the commit or the repo could
apply one, or when `manifest.json` uses a key store-zip doesn't check yet. The word check is a tripwire
against committing the owner's personal copy by mistake, not a guarantee. Commit first, then build.

## License

MIT
