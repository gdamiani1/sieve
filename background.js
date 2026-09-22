import { QUESTIONS } from "./questions.js";
import { DEFAULT_MODEL, DEFAULT_ABOUT, DEFAULT_REDDIT_ABOUT, buildMessages, buildRedditMessages, parseAngles } from "./draft.js";
import { REDDIT_QUESTIONS } from "./reddit-questions.js";
import { digestMessages } from "./digest-prompt.js";

const API = "https://api.typesafe.ai/v1/systemone";
const PRICE_PER_MTOK = 0.042; // USD per million input tokens, output free

async function stats(update) {
  const { stats = { posts: 0, tokens: 0, strong: 0, maybe: 0 } } = await chrome.storage.local.get("stats");
  update(stats);
  stats.cost = (stats.tokens * PRICE_PER_MTOK) / 1e6;
  await chrome.storage.local.set({ stats });
}

async function classify(state, platform) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) return { error: "no_key" };
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "jev-latest", state: platform === "reddit" ? { ...state, reader_experience: (await chrome.storage.local.get("redditAbout")).redditAbout || DEFAULT_REDDIT_ABOUT } : state, questions: platform === "reddit" ? REDDIT_QUESTIONS : QUESTIONS }),
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
    const a = body.answers;
    const out = {
      worth: (a.worth || a.answerable).noul,
      topic: a.topic.choice,
      kind: a.kind.choice,
      angle: a.angle.choice,
      angleConfidence: a.angle.confidence,
    };
    await stats((s) => {
      s.posts += 1;
      s.tokens += body.usage?.input_tokens || 0;
      if (out.worth >= 0.7) s.strong += 1;
      else if (out.worth >= 0.4) s.maybe += 1;
    });
    return out;
  }
  return { error: "rate_limited" };
}

async function draft(req) {
  const { orKey, model = DEFAULT_MODEL, about: liAbout = DEFAULT_ABOUT, redditAbout = DEFAULT_REDDIT_ABOUT } = await chrome.storage.local.get(["orKey", "model", "about", "redditAbout"]);
  const reddit = req.platform === "reddit";
  const about = reddit ? redditAbout : liAbout;
  const build = reddit ? buildRedditMessages : buildMessages;
  if (!orKey) return { error: "Add an OpenRouter key in the extension options to get comment angles." };
  // Reasoning is switched off; if a provider thinks anyway and runs out of room, retry once with more.
  for (const maxTokens of [200, 800]) {
    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
        body: JSON.stringify({ model, messages: build(req, about), max_tokens: maxTokens, usage: { include: true }, reasoning: { enabled: false }, temperature: req.again ? 0.9 : 0.5 }),
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
    const angles = text ? parseAngles(text, about) : [];
    if (angles.length) {
      await stats((s) => { s.drafts = (s.drafts || 0) + 1; });
      return { angles };
    }
  }
  return { error: "The model returned no angles twice. Try Another, or switch model in options." };
}

const KEEP_DAYS = 30;
const MAX_SAVED = 400;

async function save(post) {
  const { saved = [] } = await chrome.storage.local.get("saved");
  if (saved.some((p) => p.key === post.key)) return;
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const next = [{ ...post, savedAt: Date.now() }, ...saved.filter((p) => p.savedAt > cutoff)].slice(0, MAX_SAVED);
  await chrome.storage.local.set({ saved: next });
}

async function openrouter(messages, maxTokens) {
  const { orKey, model = DEFAULT_MODEL } = await chrome.storage.local.get(["orKey", "model"]);
  if (!orKey) return { error: "Add an OpenRouter key in the extension options." };
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${orKey}`, "X-Title": "Sieve" },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, usage: { include: true }, reasoning: { enabled: false }, temperature: 0.3 }),
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

async function digest(since) {
  const { saved = [], digests = [] } = await chrome.storage.local.get(["saved", "digests"]);
  const posts = saved.filter((p) => p.savedAt >= since && p.platform !== "reddit").slice(0, 40);
  if (!posts.length) return { error: "No saved LinkedIn posts in that window yet. Scroll your feed first." };
  const r = await openrouter(digestMessages(posts), 1000);
  if (r.error) return r;
  if (!r.text.trim()) return { error: "The model returned an empty digest. Try again." };
  const d = { at: Date.now(), since, count: posts.length, text: r.text.replace(/\s*[—–]\s*/g, ", "), cost: r.cost };
  await chrome.storage.local.set({ digests: [d, ...digests].slice(0, 60), lastDigestAt: d.at });
  return d;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "save") {
    save(msg.post).then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "digest") {
    digest(msg.since).then(reply);
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
  const { saved = [], lastDigestAt = 0 } = await chrome.storage.local.get(["saved", "lastDigestAt"]);
  const since = Math.max(lastDigestAt, Date.now() - 864e5);
  const fresh = saved.filter((p) => p.savedAt > since);
  if (!fresh.length) return; // nothing new, stay quiet
  const people = [...new Set(fresh.map((p) => p.authorName).filter(Boolean))].slice(0, 3).join(", ");
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
