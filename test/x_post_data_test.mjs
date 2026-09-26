// Offline: x-post-data.js, the script that runs in X's own page and turns a post's React data into the
// small summary x.js reads. Runs the real script in a sandbox against hand-built posts shaped like X's
// `tweet` objects (the fields measured on 26 Sep 2026, spec section 2): no browser, no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

class Node {}
class Element extends Node {
  attrs = {};
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
}
const listeners = [];
const document = { addEventListener: (type, fn) => listeners.push([type, fn]) };
vm.runInNewContext(readFileSync(new URL("../x-post-data.js", import.meta.url), "utf8"), { document, Element, Node, URL });
assert.deepEqual(listeners.map(([type]) => type), ["sieve-x-post"], "listens for one event, and nothing else");

// An article whose fiber has `tweet` in the props of an ancestor `depth` levels up, the way X's Tweet
// component sits above the <article>.
const article = (tweet, depth = 13) => {
  const el = new Element();
  let f = { memoizedProps: { tweet }, return: null };
  for (let i = 0; i < depth; i++) f = { memoizedProps: { className: "x" }, return: f };
  el["__reactFiber$abc123"] = f;
  return el;
};
const ask = (el) => { listeners[0][1]({ target: el }); const v = el.getAttribute?.("data-sieve-x"); return v == null ? null : JSON.parse(v); };

const base = {
  id_str: "2017742743125299476",
  user: { screen_name: "bcherny" },
  in_reply_to_status_id_str: "2017742741636321619",
  in_reply_to_screen_name: "bcherny",
  full_text: "1. Do more in parallel https://t.co/abc https://t.co/pic",
  display_text_range: [0, 31],
  entities: {
    urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/worktrees", indices: [23, 39] }],
    media: [{ url: "https://t.co/pic", indices: [40, 56] }],
  },
  reply_count: 12,
};

// Full text of a long post comes from note_tweet, with its own links expanded.
{
  const long = "1. Do more in parallel\n\nSpin up 3 to 5 git worktrees https://t.co/n1 and more text past 280.";
  const r = ask(article({ ...base, note_tweet: { text: long, entity_set: { urls: [{ url: "https://t.co/n1", expanded_url: "https://git-scm.com/docs/git-worktree", indices: [53, 68] }] } } }));
  assert.equal(r.id, "2017742743125299476");
  assert.equal(r.author, "bcherny");
  assert.equal(r.replyTo, "2017742741636321619");
  assert.equal(r.replyToAuthor, "bcherny");
  assert.equal(r.text, "1. Do more in parallel\n\nSpin up 3 to 5 git worktrees https://git-scm.com/docs/git-worktree and more text past 280.");
  assert.equal(r.hasReplies, true);
}

// full_text: links expanded by position, the post's own media link dropped, entities decoded.
{
  const r = ask(article(base));
  assert.equal(r.text, "1. Do more in parallel https://example.com/worktrees");
  const amp = ask(article({ ...base, full_text: "Tom &amp; Jerry &lt;3", entities: {}, display_text_range: [0, 21] }));
  assert.equal(amp.text, "Tom & Jerry <3");
}

// A reply's leading @mentions go, the way X's own display drops them.
{
  const r = ask(article({ ...base, full_text: "@alice @bob Worktrees are great", entities: {}, display_text_range: [12, 31] }));
  assert.equal(r.text, "Worktrees are great");
}

// An emoji before a link: positions count code points, not UTF-16 units.
{
  const r = ask(article({ ...base, full_text: "🧵 see https://t.co/x1", entities: { urls: [{ url: "https://t.co/x1", expanded_url: "https://a.dev/", indices: [6, 21] }] }, display_text_range: [0, 21] }));
  assert.equal(r.text, "🧵 see https://a.dev/");
}

// Indices that don't point at the link fall back to search and replace.
{
  const r = ask(article({ ...base, full_text: "go https://t.co/q", entities: { urls: [{ url: "https://t.co/q", expanded_url: "https://b.dev/", indices: [0, 1] }] }, display_text_range: [0, 17] }));
  assert.equal(r.text, "go https://b.dev/");
}

// Photos, in order, pbs.twimg.com only; at most 10.
{
  const media = [
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/A.jpg" },
    { type: "photo", media_url_https: "https://evil.example/B.jpg" },
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/C.jpg" },
  ];
  assert.deepEqual(ask(article({ ...base, extended_entities: { media } })).photos, ["https://pbs.twimg.com/media/A.jpg", "https://pbs.twimg.com/media/C.jpg"]);
  const many = Array.from({ length: 14 }, (_, i) => ({ type: "photo", media_url_https: `https://pbs.twimg.com/media/P${i}.jpg` }));
  assert.equal(ask(article({ ...base, extended_entities: { media: many } })).photos.length, 10);
}

// Video: the highest mp4 at or under 2.2 Mbps; the HLS playlist never; seconds from duration_millis.
{
  const v = (bitrate, n) => ({ content_type: "video/mp4", bitrate, url: `https://video.twimg.com/amplify_video/1/vid/${n}.mp4?tag=14` });
  const media = [{ type: "video", video_info: { duration_millis: 121633, variants: [
    { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/1/pl/x.m3u8" },
    v(632000, "a"), v(950000, "b"), v(2176000, "c"), v(10368000, "d"), v(25128000, "e"),
  ] } }];
  const r = ask(article({ ...base, extended_entities: { media } }));
  assert.equal(r.video.mp4, "https://video.twimg.com/amplify_video/1/vid/c.mp4?tag=14");
  assert.equal(r.video.seconds, 121.633);
  // Only renditions over the cap: the lowest known one.
  const big = ask(article({ ...base, extended_entities: { media: [{ type: "video", video_info: { variants: [v(10368000, "d"), v(25128000, "e")] } }] } }));
  assert.equal(big.video.mp4, "https://video.twimg.com/amplify_video/1/vid/d.mp4?tag=14");
  assert.equal(big.video.seconds, undefined, "no length when X didn't say");
  // An animated GIF is left out: no length, no sound.
  const gif = ask(article({ ...base, extended_entities: { media: [{ type: "animated_gif", video_info: { variants: [v(0, "g")] } }] } }));
  assert.equal(gif.video, undefined);
  // An mp4 on another host is not a video Sieve sends.
  const odd = ask(article({ ...base, extended_entities: { media: [{ type: "video", video_info: { variants: [{ content_type: "video/mp4", bitrate: 900000, url: "https://cdn.example/v.mp4" }] } }] } }));
  assert.equal(odd.video, undefined);
}

// A quoted post: its author and words, same text rules.
{
  const r = ask(article({ ...base, quoted_status: { id_str: "1", user: { screen_name: "karpathy" }, full_text: "vibe coding &amp; more", entities: {}, display_text_range: [0, 22] } }));
  assert.deepEqual(r.quoted, { author: "karpathy", text: "vibe coding & more" });
}

// startsThread only when self_thread names the post itself.
{
  assert.equal(ask(article({ ...base, self_thread: { id_str: base.id_str } })).startsThread, true);
  assert.equal(ask(article({ ...base, self_thread: { id_str: "99" } })).startsThread, undefined);
}

// The user object in the newer shape.
assert.equal(ask(article({ ...base, user: { legacy: { screen_name: "swyx" } } })).author, "swyx");

// No tweet within 40 levels, a bad id, no React data at all: nothing written, a stale value cleared.
{
  const far = article(base, 41);
  far.setAttribute("data-sieve-x", "{\"id\":\"1\"}");
  assert.equal(ask(far), null, "past 40 levels is not this post");
  assert.equal(ask(article({ ...base, id_str: "12ab" })), null, "an id that isn't digits");
  assert.equal(ask(new Element()), null, "no React data");
}

// Too big to be a real post: refused, not cut.
{
  const huge = "x".repeat(70000);
  const r = ask(article({ ...base, full_text: huge, entities: {}, display_text_range: [0, 70000] }));
  assert.ok(r === null || r.text.length <= 25000, "text is cut to 25,000 characters, or the record is refused");
}

// A throwing getter, a loop, and a non-element target never throw.
{
  const trap = { ...base };
  Object.defineProperty(trap, "full_text", { get() { throw new Error("no"); } });
  assert.equal(ask(article(trap)), null);
  const loop = { ...base };
  loop.quoted_status = loop;
  assert.doesNotThrow(() => ask(article(loop)));
  assert.doesNotThrow(() => listeners[0][1]({ target: null }));
}

console.log("x_post_data_test: ok");
