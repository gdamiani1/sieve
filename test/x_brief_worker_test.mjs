// Offline: brief() in the real worker for X threads and pictures. In-memory chrome.storage, a stubbed
// OpenRouter: no keys, no network.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { DEFAULT_VIDEO_MODEL } from "../watch-prompt.js";
import { DEFAULT_MODEL } from "../models.js";
import { threadLength } from "../brief-prompt.js";

// x-thread.js, loaded the same way x_thread_test.mjs does, to build a real briefRequest() for the
// picture-only-post case below rather than hand-typing a "posts" array that might not match what the
// page actually sends.
const xtCtx = { URL };
vm.runInNewContext(readFileSync(new URL("../x-thread.js", import.meta.url), "utf8"), xtCtx);
const XT = xtCtx.SieveXThread;

const store = {};
const reset = (data = {}) => { for (const k of Object.keys(store)) delete store[k]; Object.assign(store, structuredClone({ orKey: "stub", ...data })); };
let listener;
const event = { addListener: () => {} };
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => Object.hasOwn(store, k)).map((k) => [k, store[k]]))),
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
  }, onChanged: event },
  runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, onInstalled: event, onStartup: event },
  alarms: { onAlarm: event, clear: async () => {}, create: () => {} },
  notifications: { onClicked: event, create: () => {} },
};
const requests = [];
const BRIEF = JSON.stringify({ technique: true, what: "Run 3 to 5 git worktrees in parallel.", says: [], checks: [], needs: ["git"], try: ["Make two worktrees"], success: "Two sessions run at once.", skill: { worth: true, why: "Daily." }, warning: "" });
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(init.body));
  return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: BRIEF }, finish_reason: "stop" }], usage: { cost: 0.0002 } }) };
};
await import("../background.js");
const send = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
const post = (extra = {}) => ({ key: "12345", platform: "x", authorName: "Boris Cherny", authorUrl: "https://x.com/bcherny/status/100", text: "Tips thread\n\n1. Parallel", topic: "", kind: "technique", worth: 0.8, ...extra });
// A request's user text carries "THE POST (JSON)\n<one line of JSON>" and, only sometimes, a cut-line
// after it on its own line -- so parsing only up to the first newline after the JSON keeps this test
// robust to that line's presence or wording.
const postJson = (text) => JSON.parse(text.slice(text.indexOf("\n") + 1).split("\n")[0]);

// No pictures: the text model, a plain string message, as before.
reset();
requests.length = 0;
let r = await send({ type: "brief", post: post() });
assert.equal(r.error, undefined, r.error);
assert.equal(requests[0].model, DEFAULT_MODEL);
assert.equal(typeof requests[0].messages[1].content, "string");

// Pictures on X: the vision model (the video model setting), image parts, http and other hosts dropped.
reset({ videoModel: "google/gemini-2.5-flash" });
requests.length = 0;
r = await send({ type: "brief", post: post({ photos: ["https://pbs.twimg.com/media/A.jpg", "http://pbs.twimg.com/media/B.jpg", "https://evil.example/C.jpg", "https://pbs.twimg.com/media/D.jpg"], photoCount: 4 }) });
assert.equal(r.error, undefined, r.error);
assert.equal(requests[0].model, "google/gemini-2.5-flash");
const parts = requests[0].messages[1].content;
assert.deepEqual(parts.slice(1).map((p) => p.image_url.url), ["https://pbs.twimg.com/media/A.jpg", "https://pbs.twimg.com/media/D.jpg"]);
assert.match(parts[0].text, /has 4 pictures; the first 2 are here/);

// With no videoModel stored, the default video model.
reset();
requests.length = 0;
await send({ type: "brief", post: post({ photos: ["https://pbs.twimg.com/media/A.jpg"] }) });
assert.equal(requests[0].model, DEFAULT_VIDEO_MODEL);

// Pictures are X's only: another platform's photos field is ignored.
reset();
requests.length = 0;
await send({ type: "brief", post: post({ platform: "linkedin", photos: ["https://pbs.twimg.com/media/A.jpg"] }) });
assert.equal(requests[0].model, DEFAULT_MODEL);

// A thread: posts in the JSON; the saved post keeps no posts or photos arrays.
reset();
requests.length = 0;
r = await send({ type: "brief", post: post({ posts: [{ text: "Tips thread" }, { text: "1. Parallel" }], photos: ["https://pbs.twimg.com/media/A.jpg"], postUrl: "https://x.com/bcherny/status/100" }) });
assert.equal(r.error, undefined, r.error);
const userText = requests[0].messages[1].content[0].text;
assert.deepEqual(postJson(userText).posts, [{ text: "Tips thread" }, { text: "1. Parallel" }]);
const saved = store.saved[0];
assert.equal(saved.posts, undefined);
assert.equal(saved.photos, undefined);
assert.equal(saved.photoCount, undefined);
assert.equal(saved.text, "Tips thread\n\n1. Parallel");

// The cache: the same thread is answered from storage; a longer thread (more posts read) is briefed again.
requests.length = 0;
await send({ type: "brief", post: post({ posts: [{ text: "Tips thread" }, { text: "1. Parallel" }] }) });
assert.equal(requests.length, 0, "same thread, cached");
await send({ type: "brief", post: post({ posts: [{ text: "Tips thread" }, { text: "1. Parallel" }, { text: "2. Plan" }] }) });
assert.equal(requests.length, 1, "three posts now: briefed again");

// A feed click sends no "posts" at all. The same post, briefed as a 3-post thread and then clicked
// again from the feed (or anywhere else that can't see the thread), is still served the thread's
// brief rather than paying again and replacing it with a shorter one.
reset();
requests.length = 0;
r = await send({ type: "brief", post: post({ key: "44444", posts: [{ text: "Tips thread" }, { text: "1. Parallel" }, { text: "2. Plan" }] }) });
assert.equal(r.error, undefined, r.error);
assert.equal(requests.length, 1);
assert.equal(r.threadPosts, 3);
requests.length = 0;
r = await send({ type: "brief", post: post({ key: "44444" }) });
assert.equal(requests.length, 0, "a single-post (feed) request is served from the longer cached thread brief");
assert.equal(r.threadPosts, 3, "the stored record is still the thread's, not overwritten by the shorter request");

// A page message with an enormous "posts" array is bounded to 50 entries before anything (the backstop
// or the prompt) reads it: answered normally, and the request never carries more than 50 posts. The
// bound never mutates the caller's own request: its "posts" array, and the post object itself, are
// untouched afterwards.
reset();
requests.length = 0;
const huge = Array.from({ length: 10000 }, (_, i) => ({ text: `post ${i}` }));
const hugeMsg = { type: "brief", post: post({ key: "99999", posts: huge }) };
r = await send(hugeMsg);
assert.equal(r.error, undefined, r.error);
const hugeSent = postJson(requests[0].messages[1].content);
assert.ok(hugeSent.posts.length <= 50, "at most 50 posts sent, even from 10,000");
assert.equal(huge.length, 10000, "the caller's own posts array is never mutated");
assert.equal(hugeMsg.post.posts.length, 10000, "the caller's own post object is never mutated either");

// threadLength counts a thread the same way the prompt does: posts whose second entry is blank aren't
// a real thread, so the cache and the once() queue must treat this as a single post (length 1), not 2.
assert.equal(threadLength({ posts: [{ text: "Tips" }, { text: "  " }] }), 1);
assert.equal(threadLength({ posts: [{ text: "Tips" }, { text: "1. Parallel" }] }), 2);
assert.equal(threadLength({ text: "just a post" }), 1);

// A thread with a picture-only middle post ("text", picture, "text"): x-thread.js's briefRequest leaves
// that post out of "posts" (its own text is blank), but the other two still make it a real thread, so
// threadLength reads 2, not 1 or 3 -- and the worker records threadPosts: 2 for it, the same as any
// other 2-post thread.
{
  const readRec = (id, extra) => XT.readRecord(JSON.stringify({ id, author: "bcherny", ...(id !== "100" ? { replyTo: String(Number(id) - 1) } : {}), text: "post", ...extra }));
  const records = new Map([
    ["100", readRec("100", { text: "text" })],
    ["101", readRec("101", { text: "", photos: ["https://pbs.twimg.com/media/mid.jpg"] })],
    ["102", readRec("102", { text: "text" })],
  ]);
  const built = XT.briefRequest(post({ posts: undefined }), records, "101", { feed: false });
  assert.equal(threadLength(built.post), 2, "the picture-only post doesn't count, but the thread is still real");

  reset();
  requests.length = 0;
  r = await send({ type: "brief", post: { ...built.post, key: "77777" } });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.threadPosts, 2);
}

// Picture-path errors name the video model in use, not "the model"; a 4xx on that path usually means
// an expired pbs.twimg.com link, so it isn't told to switch models -- it's told to reload the page.
// reasoning is left off the request body entirely when photos are sent (some vision models reject
// trying to disable it); the text path still asks for it to stay off.
{
  const realFetch = globalThis.fetch;
  reset({ videoModel: "google/gemini-2.5-flash" });
  requests.length = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { status: 400, ok: false, json: async () => ({ error: { message: "expired" } }) };
  };
  r = await send({ type: "brief", post: post({ key: "33333", photos: ["https://pbs.twimg.com/media/A.jpg"] }) });
  assert.match(r.error, /Check the video model in Sieve's settings, or reload the page: picture links expire\./);
  assert.equal(Object.hasOwn(requests[0], "reasoning"), false, "no reasoning field on the picture path");

  // A retryable status (5xx) on the picture path keeps the ordinary retry wording, not the "expired
  // link" message: only a genuine 4xx points at the link.
  requests.length = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { status: 500, ok: false, json: async () => ({}) };
  };
  r = await send({ type: "brief", post: post({ key: "66666", photos: ["https://pbs.twimg.com/media/A.jpg"] }) });
  assert.match(r.error, /Try again in a minute\./);

  globalThis.fetch = realFetch;
  reset();
  requests.length = 0;
  await send({ type: "brief", post: post({ key: "88888" }) });
  assert.deepEqual(requests[0].reasoning, { enabled: false }, "the text path still turns reasoning off");
}

// photoCount is capped at 1000 before it reaches the prompt, so a bogus count from the page can't make
// its way into the sentence the model reads.
reset();
requests.length = 0;
r = await send({ type: "brief", post: post({ key: "11111", photos: ["https://pbs.twimg.com/media/A.jpg"], photoCount: 5000 }) });
assert.equal(r.error, undefined, r.error);
assert.match(requests[0].messages[1].content[0].text, /has 1000 pictures; the first 1 is here/);

// A post saved at scoring time (the "save" message, sent with only the visible text) and then briefed
// as a thread: brief()'s save(plain, { replace: true }) updates that entry in place with the thread's
// joined words and its postUrl, rather than save()'s ordinary early return leaving the first, thinner
// save untouched. Still exactly one entry for the key: this is an update, not a second save.
reset();
requests.length = 0;
await send({ type: "save", post: { key: "22222", platform: "x", text: "visible text from the page", worth: 0.8 } });
const savedAt = store.saved[0].savedAt;
r = await send({ type: "brief", post: post({ key: "22222", posts: [{ text: "Tips thread" }, { text: "1. Parallel" }], postUrl: "https://x.com/bcherny/status/100" }) });
assert.equal(r.error, undefined, r.error);
assert.equal(store.saved.length, 1, "still one entry for the key, not a second save");
assert.equal(store.saved[0].text, "Tips thread\n\n1. Parallel");
assert.equal(store.saved[0].postUrl, "https://x.com/bcherny/status/100");
assert.equal(store.saved[0].savedAt, savedAt, "the earlier savedAt is kept, not reset");

// once()'s queue key includes the thread length: a single-post brief and a thread brief of the same
// post, sent together (as when a feed click and a thread click on the same post race each other),
// don't share one fetch or one answer.
reset();
requests.length = 0;
const [rSingle, rThread] = await Promise.all([
  send({ type: "brief", post: post({ key: "55555" }) }),
  send({ type: "brief", post: post({ key: "55555", posts: [{ text: "Tips thread" }, { text: "1. Parallel" }] }) }),
]);
assert.equal(rSingle.error, undefined, rSingle.error);
assert.equal(rThread.error, undefined, rThread.error);
assert.equal(requests.length, 2, "a single-post and a thread brief of the same post each get their own request, in flight together");

console.log("x_brief_worker_test: ok");
