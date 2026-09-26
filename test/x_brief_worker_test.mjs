// Offline: brief() in the real worker for X threads and pictures. In-memory chrome.storage, a stubbed
// OpenRouter: no keys, no network.
import assert from "node:assert/strict";
import { DEFAULT_VIDEO_MODEL } from "../watch-prompt.js";
import { DEFAULT_MODEL } from "../models.js";

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

// A page message with an enormous "posts" array is bounded to 50 entries before anything (the backstop
// or the prompt) reads it: answered normally, and the request never carries more than 50 posts.
reset();
requests.length = 0;
const huge = Array.from({ length: 10000 }, (_, i) => ({ text: `post ${i}` }));
r = await send({ type: "brief", post: post({ key: "99999", posts: huge }) });
assert.equal(r.error, undefined, r.error);
const hugeSent = postJson(requests[0].messages[1].content);
assert.ok(hugeSent.posts.length <= 50, "at most 50 posts sent, even from 10,000");

console.log("x_brief_worker_test: ok");
