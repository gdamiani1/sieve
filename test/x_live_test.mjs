// Live, billed to the OpenRouter key: a picture brief on Flash-Lite and on Flash, and Watch it for me on
// an X video, through the same messages the extension sends. About 1 to 3 cents in all.
//   node test/x_live_test.mjs
// PHOTO=<pbs.twimg.com link> and VIDEO=<video.twimg.com mp4> try others. The defaults are from the Boris
// Cherny thread and the McKay Wrigley video measured on 26 Sep 2026 (spec section 2).
import { briefMessagesWithPictures, parseBrief } from "../brief-prompt.js";
import { watchMessages, parseWatch, DEFAULT_VIDEO_MODEL } from "../watch-prompt.js";
import { PROVIDER_PREFS } from "../models.js";
import { DEFAULT_PREFS } from "../prefs.js";
import { openrouterKey } from "./keys.mjs";

const photo = process.env.PHOTO || "https://pbs.twimg.com/media/HABmmP6bwAAWgUM.jpg";
const syn = await (await fetch("https://cdn.syndication.twimg.com/tweet-result?id=1945976064758730965&lang=en&token=a")).json();
const variants = syn.mediaDetails?.[0]?.video_info?.variants || [];
const video = process.env.VIDEO || variants.filter((v) => v.content_type === "video/mp4" && v.bitrate <= 2200000).sort((a, b) => b.bitrate - a.bitrate)[0]?.url;
const call = async (model, messages) => {
  const t = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey()}`, "X-Title": "Sieve" },
    body: JSON.stringify({ model, provider: PROVIDER_PREFS, messages, max_tokens: 2000, temperature: 0.2, response_format: { type: "json_object" }, usage: { include: true } }) });
  const b = await r.json();
  if (!r.ok) throw new Error(`${model}: ${r.status} ${JSON.stringify(b).slice(0, 300)}`);
  return { text: b.choices[0].message.content, ms: Date.now() - t, cost: b.usage?.cost ?? 0 };
};

const post = { platform: "x", authorName: "Boris Cherny", text: "1. Do more in parallel\n\nSpin up 3 to 5 git worktrees at once, each running its own Claude session in parallel. It's the single biggest productivity unlock." };
for (const model of [DEFAULT_VIDEO_MODEL, "google/gemini-2.5-flash"]) {
  const r = await call(model, briefMessagesWithPictures(post, [photo], DEFAULT_PREFS));
  const parsed = parseBrief(r.text, post);
  console.log(`\n== picture brief, ${model}: ${r.ms} ms, $${r.cost}`);
  console.log(JSON.stringify(parsed, null, 1).slice(0, 1500));
}
if (!video) throw new Error("No mp4 in X's embed data for the video post");
const w = await call(DEFAULT_VIDEO_MODEL, watchMessages({ platform: "x", url: "https://x.com/mckaywrigley/status/1945976064758730965", video, title: "Claudeputer", channel: "@mckaywrigley", caption: syn.text || "" }, DEFAULT_PREFS));
console.log(`\n== X video watch, ${DEFAULT_VIDEO_MODEL}: ${w.ms} ms, $${w.cost}`);
console.log(JSON.stringify(parseWatch(w.text, {}), null, 1).slice(0, 1500));
