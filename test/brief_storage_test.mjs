// Offline: background.js stores briefs from different platforms apart, even when two posts share a
// key (LinkedIn and X both key a post by a hash of its text, so a cross-posted post has the same key
// on each). Runs the real worker against an in-memory chrome.storage and a stubbed OpenRouter: no
// keys, no network.
import assert from "node:assert/strict";

const store = {};
const reset = (data = {}) => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, structuredClone({ orKey: "stub", ...data }));
};
let listener;
const event = { addListener: () => {} };
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => Object.hasOwn(store, k)).map((k) => [k, store[k]]))),
      set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    },
    onChanged: event,
  },
  runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, onInstalled: event, onStartup: event },
  alarms: { onAlarm: event },
  notifications: { onClicked: event },
};

// By default the stubbed model briefs whatever platform the post came from, so a reply shows which
// post it's for. The Watch it for me checks swap in a video answer.
let calls = 0;
const postAnswer = (body) => {
  const user = body.messages.at(-1).content;
  const post = JSON.parse(user.slice(user.indexOf("\n") + 1));
  return { technique: true, what: `${post.platform} technique`, try: ["Try it"], skill: { worth: false, why: "" }, warning: "" };
};
let answer = postAnswer;
globalThis.fetch = async (_url, init) => {
  calls++;
  const content = JSON.stringify(answer(JSON.parse(init.body)));
  return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { cost: 0 } }) };
};

await import("../background.js");
const send = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
const post = (platform, key) => ({ key, platform, authorName: `${platform} author`, text: `A post about evals, on ${platform}.` });
const brief = (platform, key) => send({ type: "brief", post: post(platform, key) });

// Two posts, same key, different platforms: both briefs survive in storage, each under its own id.
reset();
assert.equal((await brief("linkedin", "42")).what, "LinkedIn technique");
assert.equal((await brief("x", "42")).what, "X technique");
{
  const stored = Object.values(store.briefs).filter((r) => r.key === "42");
  assert.deepEqual(stored.map((r) => [r.platform, r.what]).sort(), [["linkedin", "LinkedIn technique"], ["x", "X technique"]], "the X brief doesn't replace the LinkedIn one");
}

// Asking again for either post hands back its own cached brief, without paying for a new one.
calls = 0;
assert.equal((await brief("linkedin", "42")).what, "LinkedIn technique", "the LinkedIn post still gets the LinkedIn brief");
assert.equal((await brief("x", "42")).what, "X technique", "the X post still gets the X brief");
assert.equal(calls, 0, "both came from storage");

// Both at once: two requests in flight for the same key on different platforms don't share an answer.
reset();
const [li, x] = await Promise.all([brief("linkedin", "7"), brief("x", "7")]);
assert.equal(li.what, "LinkedIn technique", "the LinkedIn request gets the LinkedIn brief");
assert.equal(x.what, "X technique", "the X request gets the X brief");
assert.equal(Object.values(store.briefs).length, 2, "both are stored");

// A brief an older Sieve stored under the bare post key is still found for its own platform, and moves
// to its own id the next time briefs are written, rather than being left behind as a duplicate.
reset({ briefs: { 42: { key: "42", platform: "linkedin", at: 1, what: "Old LinkedIn technique" } } });
calls = 0;
assert.equal((await brief("linkedin", "42")).what, "Old LinkedIn technique", "the old record still counts as cached");
assert.equal(calls, 0);
assert.equal((await brief("x", "42")).what, "X technique", "the old LinkedIn record isn't handed to the X post");
assert.deepEqual(
  Object.values(store.briefs).map((r) => [r.platform, r.what]).sort(),
  [["linkedin", "Old LinkedIn technique"], ["x", "X technique"]],
  "the old record survives the X brief, once, next to it",
);
assert.equal((await send({ type: "brief", post: post("linkedin", "42"), again: true })).what, "LinkedIn technique");
assert.equal(Object.values(store.briefs).filter((r) => r.platform === "linkedin").length, 1, "briefing it again replaces the old record, no duplicate");

// Watch it for me: watching again replaces the video's brief, or removes it when there is none this
// time, including one an older Sieve stored under the bare "yt-" key. A post's brief is never touched.
{
  const li = { key: "42", platform: "linkedin", at: 2, what: "LinkedIn technique" };
  const video = (technique) => () => ({ verdict: "watch", why: "w", summary: "s", learnings: ["l"], technique, brief: { what: "New video technique", try: ["t"] } });
  const watch = () => send({ type: "watch", id: "abc", url: "https://www.youtube.com/watch?v=abc", title: "T", channel: "C", seconds: 60, again: true });

  reset({ briefs: { "yt-abc": { key: "yt-abc", platform: "youtube", at: 1, what: "Old video technique" }, "linkedin:42": li } });
  answer = video(true);
  await watch();
  assert.deepEqual(Object.keys(store.briefs).sort(), ["linkedin:42", "youtube:yt-abc"], "the old video record is replaced, not duplicated");
  assert.equal(store.briefs["youtube:yt-abc"].what, "New video technique");
  answer = video(false);
  await watch();
  assert.deepEqual(Object.keys(store.briefs), ["linkedin:42"], "no brief this time removes the video's");

  reset({ briefs: { "yt-abc": { key: "yt-abc", platform: "youtube", at: 1, what: "Old video technique" }, "linkedin:42": li } });
  await watch();
  assert.deepEqual(Object.keys(store.briefs).sort(), ["linkedin:42"], "an old video record is removed too");
  answer = postAnswer;
}

console.log("brief storage: ok");
