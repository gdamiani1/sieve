import { loadPrefs, linkedinQuestions, redditQuestions, youtubeQuestions, verdict } from "./prefs.js";
import { DEFAULT_VIDEO_MODEL, MAX_MINUTES, watchMessages, parseWatch } from "./watch-prompt.js";
import { DEFAULT_MODEL, PROVIDER_PREFS, DEFAULT_ABOUT, DEFAULT_REDDIT_ABOUT, buildMessages, buildRedditMessages, parseAngles, facts, factQuestions, pickFact } from "./draft.js";
import { digestMessages, pickDigestPosts, digestText, allLeftOutError, onePerKey, leftOutOfDigest, noteName } from "./digest-prompt.js";
import { briefPrompt, addBrief, findBrief, removeBrief, videoBriefRecord, normalizeBrief, cleanText, platformOf, firstLine, videoPlatform, videoRecordKey, watchedKey } from "./brief.js";
import { briefMessages, parseBrief } from "./brief-prompt.js";
import { scoreMessages, parseScore } from "./score-prompt.js";

// A stored brief record with the ready-to-copy prompt, normalized again on the way out so the panel
// always shows what the prompt says, even for a record an older Sieve wrote. Null when it holds no brief.
function briefReply(rec) {
  const b = normalizeBrief(rec);
  return b ? { ...rec, ...b, prompt: briefPrompt(rec) } : null;
}

// A watched video with a brief also carries the ready-to-copy prompt, and the same normalized brief.
const withPrompt = (w) => {
  const rec = videoBriefRecord(w);
  return rec ? { ...w, brief: normalizeBrief(w.brief), prompt: briefPrompt(rec) } : w;
};

// Read-modify-write on storage, one at a time. Only this worker writes these keys, so a queue here
// stops two replies that land together from dropping each other's record or count.
let queue = Promise.resolve();
// fn must be synchronous: it runs between the get() and the set() as one atomic step.
function update(keys, fn) {
  const run = queue.then(async () => {
    const next = fn(await chrome.storage.local.get(keys));
    if (typeof next?.then === "function") throw new Error("update() callbacks must be synchronous");
    if (next) await chrome.storage.local.set(next);
  });
  queue = run.catch(() => {});
  return run;
}

// One request per post or video at a time: a second click while the first is out joins it instead
// of paying again. Memory only: if Chrome stops the worker, the map goes too and the next click starts fresh.
const inflight = new Map();
function once(id, fn) {
  if (!inflight.has(id)) inflight.set(id, fn().finally(() => inflight.delete(id)));
  return inflight.get(id);
}

const API = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_MTOK = 0.042; // USD per million input tokens, output free

function stats(change) {
  return update("stats", ({ stats = { posts: 0, tokens: 0, strong: 0, maybe: 0 } }) => {
    change(stats);
    stats.cost = (stats.tokens * PRICE_PER_MTOK) / 1e6;
    return { stats };
  });
}

// Which scorer answers: Jev when the person switched it on and saved a TypeSafe key, otherwise their
// OpenRouter key. `useJev` is unset for everyone who installed before the switch existed, and for them a
// saved TypeSafe key means on, so nobody who already scores with Jev is moved off it by an update.
async function scorer() {
  const { apiKey, orKey, useJev } = await chrome.storage.local.get(["apiKey", "orKey", "useJev"]);
  const jevOn = useJev ?? Boolean(apiKey);
  if (jevOn && apiKey) return { jev: apiKey };
  if (orKey) return { orKey };
  return {};
}

// Scoring always uses the default model, not the one chosen for briefs and angles: a feed is hundreds
// of posts a day, and an expensive briefs model would be billed for every one of them. Measured on the
// labelled sample (test/compare_scorers.mjs, 24 Sep 2026): 10 of 11 at Jev's own 0.7/0.4 thresholds,
// the same as Jev, at about 6 US cents per 1,000 posts against Jev's 4.
const SCORE_MODEL = DEFAULT_MODEL;

// One scoring call through OpenRouter, answering `questions` in Jev's shape (score-prompt.js).
async function scoreViaOpenRouter(orKey, questions, state) {
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
      body: JSON.stringify({ model: SCORE_MODEL, provider: PROVIDER_PREFS, messages: scoreMessages(questions, state), max_tokens: 300, usage: { include: true }, reasoning: { enabled: false }, temperature: 0, response_format: { type: "json_object" } }),
    });
  } catch {
    return { error: "network" };
  }
  if (res.status === 401) return { error: "or_key_rejected" };
  if (res.status === 402) return { error: "or_no_credit" };
  if (res.status === 429) return { error: "rate_limited" };
  if (!res.ok) return { error: `http_${res.status}` };
  const body = await res.json();
  const cost = body.usage?.cost || 0;
  try {
    return { ...parseScore(body.choices?.[0]?.message?.content || "", questions, state), cost };
  } catch {
    return { error: "unreadable", cost };
  }
}

async function classify(state, platform) {
  const { redditAbout = DEFAULT_REDDIT_ABOUT } = await chrome.storage.local.get("redditAbout");
  const use = await scorer();
  if (!use.jev && !use.orKey) return { error: "no_key" };
  const prefs = await loadPrefs();
  const reddit = platform === "reddit";
  const questions = reddit ? redditQuestions(prefs) : platform === "youtube" ? youtubeQuestions(prefs) : linkedinQuestions(prefs, platform === "x" ? "X (Twitter)" : "LinkedIn");
  const jevState = reddit ? { ...state, reader_experience: redditAbout } : state;
  const text = [state.author, state.subreddit, state.title, state.body, state.post].filter(Boolean).join("\n");
  if (!use.jev) {
    const r = await scoreViaOpenRouter(use.orKey, questions, jevState);
    if (r.cost) await stats((s) => { s.scoreCost = (s.scoreCost || 0) + r.cost; });
    if (r.error) return { error: r.error };
    // The badge names who scored, so a post Jev never saw is never labelled "Jev".
    const out = { ...verdict(r.answers, prefs, platform, text), scorer: "openrouter" };
    // Sieve's own check found text aimed at AI tools: parseScore already set "worth" to 0, and this says
    // why, unless the person's own always-show word put it there.
    if (r.hostile && out.tier === "low" && !out.reason) out.reason = "text aimed at AI tools";
    await stats((s) => {
      s.posts += 1;
      if (out.tier === "strong") s.strong += 1;
      else if (out.tier === "maybe") s.maybe += 1;
    });
    return out;
  }
  const apiKey = use.jev;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "jev-latest", state: jevState, questions }),
      });
    } catch {
      return { error: "network" };
    }
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 401) return { error: "key_rejected" };
    if (res.status === 402 || res.status === 403) return { error: "no_credit" };
    if (!res.ok) return { error: `http_${res.status}` };
    const body = await res.json();
    const out = { ...verdict(body.answers, prefs, platform, text), scorer: "jev" };
    await stats((s) => {
      s.posts += 1;
      s.tokens += body.usage?.input_tokens || 0;
      if (out.tier === "strong") s.strong += 1;
      else if (out.tier === "maybe") s.maybe += 1;
    });
    return out;
  }
  return { error: "rate_limited" };
}

// LinkedIn and X: only the fact Jev rates as about this post reaches the angle prompt (see pickFact).
// If Jev can't be asked, no fact goes: an unrelated fact is worse than none.
async function relevantFact(post, list) {
  if (!list.length) return "";
  const use = await scorer();
  if (!use.jev && !use.orKey) return "";
  if (!use.jev) {
    const r = await scoreViaOpenRouter(use.orKey, factQuestions(list), { post });
    if (r.cost) await stats((s) => { s.scoreCost = (s.scoreCost || 0) + r.cost; });
    if (r.error) return "";
    const i = pickFact(r.answers, list.length);
    return i < 0 ? "" : `- ${list[i]}`;
  }
  const apiKey = use.jev;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "jev-latest", state: { post }, questions: factQuestions(list) }),
    });
    if (!res.ok) return "";
    const body = await res.json();
    await stats((s) => { s.tokens += body.usage?.input_tokens || 0; });
    const i = pickFact(body.answers, list.length);
    return i < 0 ? "" : `- ${list[i]}`;
  } catch {
    return "";
  }
}

async function draft(req) {
  const { orKey, model = DEFAULT_MODEL, about: liAbout = DEFAULT_ABOUT, redditAbout = DEFAULT_REDDIT_ABOUT } = await chrome.storage.local.get(["orKey", "model", "about", "redditAbout"]);
  const reddit = req.platform === "reddit";
  const build = reddit ? buildRedditMessages : buildMessages;
  if (!orKey) return { error: "Add an OpenRouter key in the extension options to get comment angles." };
  const about = reddit ? redditAbout : await relevantFact(req.post || "", facts(liAbout));
  // Reasoning is switched off; if a provider thinks anyway and runs out of room, retry once with more.
  for (const maxTokens of [200, 800]) {
    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
        body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages: build(req, about), max_tokens: maxTokens, usage: { include: true }, reasoning: { enabled: false }, temperature: req.again ? 0.9 : 0.5 }),
      });
    } catch {
      return { error: "Network error reaching OpenRouter." };
    }
    if (res.status === 401) return { error: "OpenRouter rejected the key." };
    if (res.status === 402) return { error: "OpenRouter is out of credit." };
    if (!res.ok) return { error: `OpenRouter said ${res.status}.` };
    const body = await res.json();
    await stats((s) => { s.draftCost = (s.draftCost || 0) + (body.usage?.cost || 0); });
    const text = body.choices?.[0]?.message?.content;
    const angles = text ? parseAngles(text, about, req.post || "") : [];
    if (angles.length) {
      await stats((s) => { s.drafts = (s.drafts || 0) + 1; });
      return { angles };
    }
  }
  return { error: "The model returned no angles twice. Try Another, or switch model in options." };
}

// "Watch it for me": the video model watches the whole video, the result is kept for the digest.
// When the video teaches a technique, its brief is kept with the other briefs.
// Any platform the request names (videoPlatform in brief.js). YouTube keeps its keys and records exactly
// as before. Every id must be a plain code (a YouTube id always is), so no id can carry the ":" that other
// platforms' keys use (watchedKey). Another platform's video must also come with its page link (`url`,
// stored and shown) and its video link (`video`, https, for the model only: it's signed and expires, so
// it's never stored).
async function watch(req) {
  // Written once: both the id check and the non-YouTube link checks below refuse with this same text.
  const LINK_ERROR = "Sieve couldn't read this video's link. Reload the page and try again.";
  const platform = videoPlatform(req.platform);
  if (!platform) return { error: "Sieve can't watch videos from this page." };
  if (typeof req.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(req.id)) return { error: LINK_ERROR };
  // Computed once and reused below (the message sent to the model, the stored record, the brief, the
  // saved post): a page or video link is checked here and only here, so everything downstream uses the
  // same, already-validated value rather than the request's raw fields.
  let page = "", video = "";
  if (platform !== "youtube") {
    page = webUrl(req.url);
    video = webUrl(req.video);
    if (!page || !video.startsWith("https://")) return { error: LINK_ERROR };
    // Refused, not truncated: a cut signed link is broken, not merely long.
    if (page.length > 2048 || video.length > 8192) return { error: LINK_ERROR };
    if (hasCredentials(page) || hasCredentials(video)) return { error: LINK_ERROR };
  }
  const key = watchedKey(platform, req.id);
  const { orKey, videoModel = DEFAULT_VIDEO_MODEL, watched = {} } = await chrome.storage.local.get(["orKey", "videoModel", "watched"]);
  // A null or otherwise broken entry (an old bug, corrupted storage) counts as absent, not as a cached
  // answer: withPrompt(null) would hand the page back a bare null, which reads as no reply at all.
  const cached = watched && typeof watched === "object" && Object.hasOwn(watched, key) ? watched[key] : null;
  if (cached && typeof cached === "object" && !Array.isArray(cached) && !req.again) return withPrompt(cached);
  if (!orKey) return { error: "Add an OpenRouter key in Sieve's settings." };
  if (req.seconds && req.seconds / 60 > MAX_MINUTES) return { error: `Videos over ${MAX_MINUTES} minutes are too long to watch in one go.` };
  const prefs = await loadPrefs();
  // Built once, outside the fetch try, so a mistake in building it can't be reported as a network error.
  // The checks above mean that can't happen for a valid request.
  const messages = watchMessages(platform === "youtube" ? req : { ...req, url: page, video }, prefs);
  // One retry with more room: an unreadable answer is usually a cut-off or a stray quote. The whole
  // attempt loop runs inside try/finally, so a mid-loop return (a 401, a 402, a bad status) still
  // records whatever was spent before it, exactly once.
  let out = null, cost = 0, lastError = "";
  try {
    const attempts = [2000, 4000];
    for (const [i, maxTokens] of attempts.entries()) {
      let res;
      try {
        res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
          body: JSON.stringify({ model: videoModel, messages, max_tokens: maxTokens, temperature: 0.2, response_format: { type: "json_object" }, usage: { include: true } }),
        });
      } catch {
        return { error: "Network error reaching OpenRouter." };
      }
      if (res.status === 401) return { error: "OpenRouter rejected the key." };
      if (res.status === 402) return { error: "OpenRouter is out of credit." };
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { error: `The video model said ${res.status}. ${platform === "youtube" ? "Private, members-only or age-restricted videos can't be watched." : "Private or removed videos can't be watched."}` };
      cost += body.usage?.cost || 0;
      const cutOff = body.choices?.[0]?.finish_reason === "length";
      try {
        const parsedOut = parseWatch(body.choices?.[0]?.message?.content || "", req);
        // A cut-off answer can still parse (a partial JSON object often reads fine), so a truncated
        // first attempt is retried for a full answer rather than kept as if it were complete. The
        // last attempt is accepted regardless: it's the best answer available.
        if (cutOff && i < attempts.length - 1) { lastError = "cut off"; continue; }
        out = parsedOut;
        break;
      } catch {
        lastError = cutOff ? "cut off" : "unreadable";
      }
    }
  } finally {
    if (cost) await stats((s) => { s.draftCost = (s.draftCost || 0) + cost; });
  }
  if (!out) {
    return { error: `The video model's answer was ${lastError} twice. Try again, or try a shorter video.` };
  }
  // YouTube's own url is stored as given, as before; another platform's is the checked, cleaned page
  // link (page), never the request's raw one.
  const url = platform === "youtube" ? req.url : page;
  out = { ...out, ...(platform === "youtube" ? {} : { platform }), id: req.id, url, title: req.title, channel: req.channel, seconds: req.seconds || null, cost, at: Date.now() };
  await stats((s) => { s.watched = (s.watched || 0) + 1; });
  // The newest 300, same as before, now on the queue: two videos landing together can no longer drop
  // each other's record. A non-object entry already in storage (an old bug, corrupted data) is dropped
  // first, the way savedPosts drops junk: sorting by its .at would otherwise throw.
  await update("watched", ({ watched: w = {} }) => ({
    watched: Object.fromEntries(
      Object.entries({ ...w, [key]: out })
        .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, 300),
    ),
  }));
  // Watching again replaces the video's brief, or removes it if this time there is none.
  const vr = videoBriefRecord(out);
  const recKey = videoRecordKey(platform, req.id);
  await update("briefs", ({ briefs = {} }) => {
    if (vr) return { briefs: addBrief(briefs, vr) };
    if (!findBrief(briefs, platform, recKey)) return null; // nothing to remove
    return { briefs: removeBrief(briefs, platform, recKey) };
  });
  if (vr) await stats((s) => { s.briefs = (s.briefs || 0) + 1; });
  await save({
    key: recKey, platform, authorName: req.channel, authorUrl: url, title: req.title,
    text: `${req.title}\n\n${out.summary}\n\nLearnings:\n${out.learnings.map((l) => "- " + l).join("\n")}`,
    topic: "", kind: "video", worth: 1,
  });
  return withPrompt(out);
}

// A URL, but only when it is actually a web link: javascript:, data: and other odd schemes a post
// could put in its author link never reach storage or the brief header.
const webUrl = (u) => {
  try {
    const x = new URL(String(u));
    return /^https?:$/.test(x.protocol) ? x.href : "";
  } catch {
    return "";
  }
};

// A web link that carries a username or password (https://user:pass@host/...): watch() refuses one
// rather than store or send it, even when the rest of the link is a valid https URL.
const hasCredentials = (u) => {
  try {
    const x = new URL(u);
    return !!(x.username || x.password);
  } catch {
    return true;
  }
};

// A technique brief for one post the user clicked "Brief" on. The brief is kept (and the post saved)
// for the digest page and the export. Cached per post unless asked again.
async function brief(req) {
  const p = req.post || {};
  if (!p.key || !p.text) return { error: "Sieve couldn't read this post. Reload the page and try again." };
  // A watched video's own "yt-" record belongs to Watch it for me, not to this flow: briefing it here
  // by mistake would overwrite the video's brief with a LinkedIn/X-shaped prompt.
  if (String(p.key).startsWith("yt-")) return { error: "YouTube videos get their brief from Watch it for me." };
  const platform = platformOf(p.platform);
  const { orKey, model = DEFAULT_MODEL, briefs = {} } = await chrome.storage.local.get(["orKey", "model", "briefs"]);
  // A record already in storage but that no longer normalizes (an older shape, or corrupted) doesn't
  // count as cached: fall through and brief the post again rather than hand back nothing useful.
  // Looked up by platform as well as key: a post cross-posted to LinkedIn and X has the same key on both.
  const cachedRaw = findBrief(briefs, platform, p.key);
  const cached = cachedRaw ? briefReply(cachedRaw) : null;
  if (cached && !req.again) return cached;
  if (!orKey) return { error: "Briefs need an OpenRouter key. Add one in Sieve's settings." };
  const prefs = await loadPrefs();
  // One retry with more room: an unreadable answer is usually a cut-off. The whole attempt loop runs
  // inside try/finally, so a mid-loop return (a 401, a 402, a bad status) still records whatever was
  // spent before it, exactly once -- and never writes stats at all when nothing was spent.
  let parsed = null, cost = 0, lastError = "";
  try {
    const attempts = [900, 1800];
    for (const [i, maxTokens] of attempts.entries()) {
      let res;
      try {
        res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
          body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages: briefMessages(p, prefs), max_tokens: maxTokens, temperature: req.again ? 0.5 : 0.2, response_format: { type: "json_object" }, reasoning: { enabled: false }, usage: { include: true } }),
        });
      } catch {
        return { error: "Network error reaching OpenRouter. Check your connection, then try again." };
      }
      if (res.status === 401) return { error: "OpenRouter rejected the key. Paste a new one in Sieve's settings." };
      if (res.status === 402) return { error: "OpenRouter is out of credit. Add credit at openrouter.ai, then try again." };
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Code-point sliced, so a 160-char cut never splits a surrogate pair in half; the trailing
        // punctuation strip stops OpenRouter's own "." from turning into a "..".
        const why = Array.from(cleanText(body.error?.message)).slice(0, 160).join("").replace(/[.\s]+$/, "");
        const retry = res.status === 408 || res.status === 429 || res.status >= 500;
        return { error: `OpenRouter said ${res.status}${why ? `: ${why}` : ""}. ${retry ? "Try again in a minute." : "Check the model in Sieve's settings, or pick another one."}` };
      }
      cost += body.usage?.cost || 0;
      const cutOff = body.choices?.[0]?.finish_reason === "length";
      try {
        const parsedAnswer = parseBrief(body.choices?.[0]?.message?.content || "", p); // p: Sieve's own check backs up the model's warning
        // A cut-off answer can still parse (a partial JSON object often reads fine), so a truncated
        // first attempt is retried for a full answer rather than kept as if it were complete. The
        // last attempt is accepted regardless: it's the best answer available.
        if (cutOff && i < attempts.length - 1) { lastError = "cut off"; continue; }
        parsed = parsedAnswer;
        break;
      } catch {
        lastError = cutOff ? "cut off" : "unreadable";
      }
    }
  } finally {
    if (cost) await stats((s) => { s.draftCost = (s.draftCost || 0) + cost; });
  }
  if (!parsed) return { error: `The model's brief was ${lastError} twice. Try again, or switch model in settings.` };
  if (!parsed.technique) {
    const cap200 = (s) => Array.from(cleanText(s)).slice(0, 200).join("");
    const parts = ["No technique to try in this post, so no brief was written."];
    if (parsed.what) parts.push(`The model read it as: ${cap200(parsed.what)}`);
    if (parsed.warning) parts.push(`Warning: the post contains text aimed at AI agents: ${cap200(parsed.warning)}`);
    return { error: parts.join(" ") };
  }
  // The post's own link when the page gave one (LinkedIn's postUrl; on X and Reddit authorUrl already is
  // the post), the author's otherwise. A post with no title of its own is named by its first line, so
  // the brief's source line says which post it was, not only who wrote it.
  const rec = { key: p.key, platform, title: p.title || firstLine(p.text), author: p.authorName || "", url: webUrl(p.postUrl) || webUrl(p.authorUrl), at: Date.now(), cost, ...parsed.brief };
  await update("briefs", ({ briefs: latest = {} }) => ({ briefs: addBrief(latest, rec) }));
  // The brief is what the user asked for; a storage hiccup on the post copy shouldn't lose it. save()
  // does its own field cleanup now, the same for every route that calls it.
  try {
    await save(p);
  } catch {}
  await stats((s) => { s.briefs = (s.briefs || 0) + 1; });
  return briefReply(rec);
}

const KEEP_DAYS = 30;
const MAX_SAVED = 400;

// The stored saved posts, skipping any entry that isn't one (a null, a stray value), as export.js does:
// one bad entry mustn't break every later save, the digest and the reminder.
const savedPosts = (saved) => (Array.isArray(saved) ? saved : []).filter((p) => !!p && typeof p === "object" && !Array.isArray(p));

// Same race as classify()'s saves and everything else here: read-modify-write goes through the queue.
// The field cleanup lives here, not in brief(), so every route that saves a post gets it: the old
// "save" message from the content scripts, watch()'s video record, and brief()'s post copy alike.
// A post is the same post only on the same platform: LinkedIn and X both key a post by a hash of its
// text, so a cross-posted post has the same key on each.
function save(post) {
  const clean = { ...post, platform: platformOf(post.platform), authorUrl: webUrl(post.authorUrl), postUrl: webUrl(post.postUrl), text: String(post.text ?? "").slice(0, 4000), worth: typeof post.worth === "number" ? post.worth : 0 };
  return update("saved", ({ saved: stored }) => {
    const saved = savedPosts(stored);
    if (saved.some((p) => p.key === clean.key && platformOf(p.platform) === clean.platform)) return null;
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    const next = [{ ...clean, savedAt: Date.now() }, ...saved.filter((p) => p.savedAt > cutoff)].slice(0, MAX_SAVED);
    return { saved: next };
  });
}

async function openrouter(messages, maxTokens) {
  const { orKey, model = DEFAULT_MODEL } = await chrome.storage.local.get(["orKey", "model"]);
  if (!orKey) return { error: "Add an OpenRouter key in the extension options." };
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
      body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages, max_tokens: maxTokens, usage: { include: true }, reasoning: { enabled: false }, temperature: 0.3 }),
    });
  } catch {
    return { error: "Network error reaching OpenRouter." };
  }
  if (res.status === 401) return { error: "OpenRouter rejected the key." };
  if (res.status === 402) return { error: "OpenRouter is out of credit." };
  if (!res.ok) return { error: `OpenRouter said ${res.status}.` };
  const body = await res.json();
  await stats((s) => { s.draftCost = (s.draftCost || 0) + (body.usage?.cost || 0); });
  return { text: body.choices?.[0]?.message?.content || "", cost: body.usage?.cost || 0 };
}

// The daily digest. Which posts go in (one copy of a cross-posted post), how they're sent and the "Left
// out" note all live in digest-prompt.js; a post Sieve's own check flags never reaches the model, and
// when every post in the window is flagged there is no call and no charge.
async function digest(since) {
  const startedAt = Date.now();
  const { saved } = await chrome.storage.local.get("saved");
  const { posts, left } = pickDigestPosts(savedPosts(saved), since);
  if (!posts.length) return { error: left.length ? allLeftOutError(left.length) : "No saved posts in that window yet. Scroll your feed first." };
  const r = await openrouter(digestMessages(posts), 1000);
  if (r.error) return r;
  const text = digestText(r.text, left);
  if (!text) return { error: "The model returned an empty digest. Try again." };
  const d = { at: Date.now(), since, count: posts.length, text, cost: r.cost };
  // Through the queue, so two digests that finish together both survive. The next "since last digest"
  // starts from when this one read the saved posts, so a post saved while the model was writing isn't
  // skipped.
  await update(["digests", "lastDigestAt"], ({ digests, lastDigestAt }) => ({
    digests: [d, ...(Array.isArray(digests) ? digests : [])].slice(0, 60),
    lastDigestAt: Math.max(Number(lastDigestAt) || 0, startedAt),
  }));
  return d;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "save") {
    if (!msg.post || typeof msg.post !== "object") {
      reply({ error: "No post to save." });
      return true;
    }
    save(msg.post).then(() => reply({ ok: true }), () => reply({ error: "Sieve couldn't save the post." }));
    return true;
  }
  if (msg.type === "watch") {
    // The platform is part of the key: a video on another platform and a YouTube video can share an
    // 11-character id.
    once(`watch:${videoPlatform(msg.platform)}:${msg.id}`, () => watch(msg)).then(reply, () => reply({ error: "Sieve couldn't store the video notes. Try again, and if it keeps failing, reload the extension." }));
    return true;
  }
  if (msg.type === "brief") {
    once(`brief:${msg.post?.platform}:${msg.post?.key}`, () => brief(msg)).then(reply, () => reply({ error: "Sieve couldn't store the brief. Try again, and if it keeps failing, reload the extension." }));
    return true;
  }
  if (msg.type === "digest") {
    // A second request for the exact same window while the first is still out (a second click on
    // "Summarise since last digest") joins it: one digest, one charge. The other two buttons compute a
    // fresh window on every click, so each click there is a digest of its own.
    once(`digest:${msg.since}`, () => digest(msg.since)).then(reply, () => reply({ error: "Sieve couldn't make the digest. Try again, and if it keeps failing, reload the extension." }));
    return true;
  }
  if (msg.type === "classify") {
    classify(msg.state, msg.platform).then(reply);
    return true; // async reply
  }
  if (msg.type === "draft") {
    draft(msg).then(reply);
    return true;
  }
});

// ---- daily reminder ----
// Re-scheduled after every firing (not a fixed 24 h period) so it stays on the clock time across DST.
const ALARM = "daily-digest";

async function scheduleReminder() {
  const { reminderOn = true, reminderTime = "18:00" } = await chrome.storage.local.get(["reminderOn", "reminderTime"]);
  await chrome.alarms.clear(ALARM);
  if (!reminderOn) return;
  const [h, m] = reminderTime.split(":").map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  chrome.alarms.create(ALARM, { when: next.getTime() });
}

chrome.runtime.onInstalled.addListener(scheduleReminder);
chrome.runtime.onStartup.addListener(scheduleReminder);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.reminderOn || changes.reminderTime) scheduleReminder();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await scheduleReminder();
  const { saved, lastDigestAt = 0 } = await chrome.storage.local.get(["saved", "lastDigestAt"]);
  const since = Math.max(lastDigestAt, Date.now() - 864e5);
  // What the page will show as worth reading: not a post a digest leaves out. Names follow the Left out
  // note's rules, so a name Sieve won't vouch for is counted but never shown.
  const fresh = onePerKey(savedPosts(saved).filter((p) => p.savedAt > since)).filter((p) => !leftOutOfDigest(p));
  if (!fresh.length) return; // nothing new worth reading, stay quiet
  const people = [...new Set(fresh.map((p) => noteName(p)).filter((n) => n.safe).map((n) => n.shown))].slice(0, 3).join(", ");
  chrome.notifications.create(ALARM, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `${fresh.length} post${fresh.length === 1 ? "" : "s"} worth reading today`,
    message: people ? `Including ${people}. Click to open your daily learnings.` : "Click to open your daily learnings.",
    priority: 0,
  });
});

chrome.notifications.onClicked.addListener((id) => {
  if (id !== ALARM) return;
  chrome.tabs.create({ url: chrome.runtime.getURL("digest.html") });
  chrome.notifications.clear(id);
});
