// Offline: x-thread.js, the pure part of X threads, pictures and video. Runs the real classic script in
// a sandbox and tests the global it defines. No browser, no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const ctx = { URL };
vm.runInNewContext(readFileSync(new URL("../x-thread.js", import.meta.url), "utf8"), ctx);
const X = ctx.SieveXThread;
assert.ok(X, "defines SieveXThread");
const plain = (v) => JSON.parse(JSON.stringify(v)); // across the vm boundary, compare as plain data

// ---- readRecord: only the exact shape passes ----
const good = { id: "2017742743125299476", author: "bcherny", replyTo: "2017742741636321619", text: "1. Do more in parallel", photos: ["https://pbs.twimg.com/media/A.jpg"], video: { mp4: "https://video.twimg.com/v/c.mp4?tag=14", seconds: 121.633 }, hasReplies: true };
const r0 = X.readRecord(JSON.stringify(good));
assert.equal(r0.id, good.id);
assert.equal(r0.author, "bcherny");
assert.deepEqual(plain(r0.photos), good.photos);
assert.equal(r0.video.mp4, good.video.mp4);
assert.equal(r0.hasReplies, true);
const bad = (patch, why) => assert.equal(X.readRecord(JSON.stringify({ ...good, ...patch })), null, why);
bad({ id: "12a" }, "an id that isn't digits");
bad({ id: 12 }, "an id that isn't a string");
bad({ author: "not a handle!" }, "an author that isn't a handle");
bad({ replyTo: "x" }, "a replyTo that isn't an id");
bad({ text: 5 }, "text that isn't a string");
bad({ text: "x".repeat(25001) }, "text over 25,000");
bad({ photos: ["http://pbs.twimg.com/media/A.jpg"] }, "an http picture");
bad({ photos: ["https://pbs.twimg.com.evil.example/A.jpg"] }, "another host");
bad({ photos: ["https://user:pw@pbs.twimg.com/A.jpg"] }, "credentials in a picture link");
bad({ photos: Array(11).fill("https://pbs.twimg.com/media/A.jpg") }, "more than 10 pictures");
bad({ video: { mp4: "https://evil.example/v.mp4" } }, "a video on another host");
bad({ video: { mp4: good.video.mp4, seconds: -1 } }, "a negative length");
bad({ quoted: { author: "a", text: 3 } }, "a quoted post with no words");
bad({ hasReplies: "yes" }, "a flag that isn't a boolean");
assert.equal(X.readRecord(null), null);
assert.equal(X.readRecord("not json"), null);
assert.equal(X.readRecord("[]"), null);
assert.equal(X.readRecord("x".repeat(70000)), null, "over 64 KB");
assert.equal(X.readRecord(JSON.stringify({ id: "5" })).text, "", "only the id is required");

// ---- threadOf ----
const rec = (id, author, replyTo, extra = {}) => X.readRecord(JSON.stringify({ id, author, ...(replyTo ? { replyTo } : {}), text: `post ${id}`, ...extra }));
const map = (...rs) => new Map(rs.map((r) => [r.id, r]));
// t.map(...) here would return an array built with the vm sandbox's own Array constructor (records were
// read inside the vm), which node:assert/strict's deepEqual treats as unequal to a plain array of the
// same values even though every element matches. Round-tripping through JSON gives a real, comparable array.
const ids = (t) => plain(t.map((r) => r.id));
{
  // A 12-post chain; clicking the first, a middle or the last post gives the whole chain, in order.
  const chain = Array.from({ length: 12 }, (_, i) => rec(String(100 + i), "bcherny", i ? String(99 + i) : undefined));
  const m = map(...chain);
  const all = chain.map((r) => r.id);
  assert.deepEqual(ids(X.threadOf(m, "100")), all);
  assert.deepEqual(ids(X.threadOf(m, "105")), all);
  assert.deepEqual(ids(X.threadOf(m, "111")), all);
}
{
  // Another author's reply ends the chain; the author answering them is not the thread.
  const m = map(rec("1", "a"), rec("2", "a", "1"), rec("3", "b", "2"), rec("4", "a", "3"));
  assert.deepEqual(ids(X.threadOf(m, "1")), ["1", "2"]);
}
{
  // Two same-author replies to one post: the earlier id continues the thread.
  const m = map(rec("10", "a"), rec("12", "a", "10"), rec("11", "a", "10"));
  assert.deepEqual(ids(X.threadOf(m, "10")), ["10", "11"]);
  assert.deepEqual(ids(X.threadOf(map(rec("9", "a"), rec("100", "a", "9"), rec("99", "a", "9")), "9")), ["9", "99"], "ids compare as numbers, not strings");
}
{
  // A cycle in bad data ends; no author means no thread; an unknown id gives nothing.
  const m = map(rec("1", "a", "2"), rec("2", "a", "1"));
  assert.ok(X.threadOf(m, "1").length <= 2);
  assert.deepEqual(ids(X.threadOf(map(rec("1", ""), rec("2", "", "1")), "1")), ["1"]);
  assert.deepEqual(ids(X.threadOf(new Map(), "1")), []);
}
{
  // At most 50 posts.
  const long = Array.from({ length: 80 }, (_, i) => rec(String(1000 + i), "a", i ? String(999 + i) : undefined));
  assert.equal(X.threadOf(map(...long), "1000").length, 50);
}

// ---- briefRequest ----
const baseRec = { key: "12345", platform: "x", authorName: "Boris Cherny", authorUrl: "https://x.com/bcherny/status/100", text: "visible text from the page", topic: "", kind: "technique", worth: 0.8 };
{
  // No record: exactly today's post, no note.
  const r = X.briefRequest(baseRec, new Map(), "", { feed: true });
  assert.deepEqual(plain(r), { post: baseRec, note: "" });
}
{
  // One post with its full text and pictures.
  const m = map(rec("100", "bcherny", undefined, { text: "Full text, longer than what the page showed.", photos: ["https://pbs.twimg.com/media/A.jpg"] }));
  const r = X.briefRequest(baseRec, m, "100", { feed: true });
  assert.equal(r.post.text, "Full text, longer than what the page showed.");
  assert.deepEqual(plain(r.post.photos), ["https://pbs.twimg.com/media/A.jpg"]);
  assert.equal(r.post.photoCount, 1);
  assert.equal(r.post.posts, undefined, "one post is not a thread");
  assert.equal(r.note, "");
}
{
  // A thread: posts in order, the joined text, the first post's link, every picture counted, the note.
  const m = map(
    rec("100", "bcherny", undefined, { text: "Tips thread", photos: Array.from({ length: 6 }, (_, i) => `https://pbs.twimg.com/media/a${i}.jpg`) }),
    rec("101", "bcherny", "100", { text: "1. Parallel", photos: Array.from({ length: 6 }, (_, i) => `https://pbs.twimg.com/media/b${i}.jpg`), quoted: { author: "karpathy", text: "vibe coding" } }),
    rec("102", "bcherny", "101", { text: "2. Plan mode", video: { mp4: "https://video.twimg.com/v/c.mp4", seconds: 30 }, hasReplies: true }),
  );
  const r = X.briefRequest(baseRec, m, "101", { feed: false });
  assert.deepEqual(plain(r.post.posts), [{ text: "Tips thread" }, { text: "1. Parallel", quoted: { author: "karpathy", text: "vibe coding" } }, { text: "2. Plan mode" }]);
  assert.equal(r.post.text, "Tips thread\n\n1. Parallel\n\n[quoted post] @karpathy: vibe coding\n\n2. Plan mode");
  assert.equal(r.post.postUrl, "https://x.com/bcherny/status/100");
  assert.equal(r.post.photos.length, 10, "at most 10 pictures sent");
  assert.equal(r.post.photoCount, 12, "but all 12 counted");
  assert.equal(r.post.key, "12345", "stored under the clicked post's key, as today");
  assert.equal(r.note, "Read 3 posts by @bcherny. If the thread goes on below, scroll down and press Write it again. Post 3 has a video: use Watch it for me on it.");
}
{
  // On a post's page, before the replies have loaded.
  const m = map(rec("100", "bcherny", undefined, { hasReplies: true }));
  assert.equal(X.briefRequest(baseRec, m, "100", { feed: false }).note, "If the author continues this in a thread, scroll down to load it and press Write it again.");
  // In the feed, a post X marks as starting a thread.
  const f = map(rec("100", "bcherny", undefined, { startsThread: true, hasReplies: true }));
  assert.equal(X.briefRequest(baseRec, f, "100", { feed: true }).note, "This post starts a thread. Open it to brief the whole thread.");
}
{
  // A picture-only post keeps the page's text rather than sending nothing.
  const m = map(rec("100", "a", undefined, { text: "", photos: ["https://pbs.twimg.com/media/A.jpg"] }));
  assert.equal(X.briefRequest(baseRec, m, "100", { feed: true }).post.text, "visible text from the page");
}

// ---- watchRequest ----
{
  const v = rec("1945976064758730965", "mckaywrigley", undefined, { text: "Claudeputer\nmore", video: { mp4: "https://video.twimg.com/v/c.mp4?tag=14", seconds: 121.633 } });
  const w = X.watchRequest(v);
  assert.deepEqual(plain(w.msg), { type: "watch", platform: "x", id: "1945976064758730965", url: "https://x.com/mckaywrigley/status/1945976064758730965", video: "https://video.twimg.com/v/c.mp4?tag=14", title: "Claudeputer", channel: "@mckaywrigley", caption: "Claudeputer\nmore", seconds: 121.633 });
  assert.equal(w.label, "Watch it for me · <1¢");
  assert.equal(w.price, "<1¢");
  assert.equal(w.tooLong, false);
  const long = X.watchRequest(rec("1945976064758730966", "a", undefined, { video: { mp4: "https://video.twimg.com/v/c.mp4", seconds: 60 * 56 } }));
  assert.equal(long.tooLong, true);
  assert.equal(long.label, "too long to watch");
  assert.equal(X.watchRequest(rec("1945976064758730967", "a", undefined, { text: "" , video: { mp4: "https://video.twimg.com/v/c.mp4" } })).msg.title, "Video by @a", "a video with no words still has a title");
  assert.equal(X.watchRequest(rec("1945976064758730968", "a", undefined, { video: { mp4: "https://video.twimg.com/v/c.mp4" } })).msg.seconds, 0);
  assert.equal(X.watchRequest(rec("1945976064758730965", "a")), null, "no video");
  assert.equal(X.watchRequest(rec("1234567890", "a", undefined, { video: { mp4: "https://video.twimg.com/v/c.mp4" } })), null, "an id of 10 digits could meet a post's text-hash key");
  assert.equal(X.watchRequest(rec("1945976064758730965", "", undefined, { video: { mp4: "https://video.twimg.com/v/c.mp4" } })), null, "no author, no page link");
  assert.equal(X.watchRequest(null), null);
}

// ---- firstLine ----
assert.equal(X.firstLine("\n\n  First line  \nsecond"), "First line");
assert.equal(X.firstLine("a".repeat(100)), `${"a".repeat(80)}...`);
assert.equal(X.firstLine(""), "");
assert.equal(X.firstLine("One\u2028Two"), "One", "splits on a line separator too, not just a plain space");

console.log("x_thread_test: ok");
