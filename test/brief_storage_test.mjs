// Offline: background.js stores briefs and saved posts from different platforms apart, even when two
// posts share a key (LinkedIn and X both key a post by a hash of its text, so a cross-posted post has
// the same key on each). Runs the real worker against an in-memory chrome.storage and a stubbed
// OpenRouter: no keys, no network.
import assert from "node:assert/strict";

const store = {};
const reset = (data = {}) => {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, structuredClone({ orKey: "stub", ...data }));
};
let listener, alarm;
const notes = [];
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
  alarms: { onAlarm: { addListener: (fn) => { alarm = fn; } }, clear: async () => {}, create: () => {} },
  notifications: { onClicked: event, create: (_id, opts) => { notes.push(opts); } },
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
let lastBody = null;
globalThis.fetch = async (_url, init) => {
  calls++;
  lastBody = JSON.parse(init.body);
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
  assert.deepEqual(store.saved.filter((p) => p.key === "42").map((p) => p.platform).sort(), ["linkedin", "x"], "briefing both saves both posts");
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

// Saved posts are kept apart by platform too: the X copy of a cross-posted post is saved next to the
// LinkedIn one, and the other way round, while the same post on the same platform is saved once.
{
  const save = (p) => send({ type: "save", post: p });
  const savedFor = (key) => store.saved.filter((p) => p.key === key).map((p) => [p.platform, p.text]).sort();

  reset();
  await save(post("linkedin", "42"));
  await save(post("x", "42"));
  await save(post("x", "42"));
  assert.deepEqual(savedFor("42"), [["linkedin", "A post about evals, on linkedin."], ["x", "A post about evals, on x."]], "the X copy is saved next to the LinkedIn one, once");

  reset();
  await save(post("x", "43"));
  await save(post("linkedin", "43"));
  assert.deepEqual(savedFor("43").map(([platform]) => platform), ["linkedin", "x"], "and the LinkedIn copy next to the X one");

  // An older Sieve saved LinkedIn posts without a platform: that post is still the LinkedIn copy.
  reset({ saved: [{ key: "44", authorName: "Old", text: "Old LinkedIn post", worth: 1, savedAt: Date.now() }] });
  await save(post("linkedin", "44"));
  assert.equal(store.saved.length, 1, "an old platform-less post counts as the LinkedIn copy");
  await save(post("x", "44"));
  assert.deepEqual(store.saved.map((p) => p.platform ?? "none").sort(), ["none", "x"], "but not as the X copy");

  // A platform that isn't a plain lowercase word is LinkedIn here too, as brief() treats it, so a brief
  // and its saved post copy always agree on which post they are.
  reset();
  await save({ ...post("linkedin", "45"), platform: "LinkedIn\n" });
  await save(post("linkedin", "45"));
  await save({ ...post("linkedin", "45"), platform: "" });
  assert.deepEqual(store.saved.map((p) => p.platform), ["linkedin"], "saved once, as LinkedIn");

  // A saved entry that isn't a post (a null, a stray number) doesn't stop every later save: the worker
  // skips it, as the export does, and the next save drops it.
  const kept = { key: "47", platform: "linkedin", authorName: "Kim", text: "Kept post", worth: 1, savedAt: Date.now() };
  reset({ saved: [null, 7, kept] });
  assert.deepEqual(await save(post("linkedin", "48")), { ok: true }, "the save goes through");
  assert.deepEqual(store.saved.map((p) => p.key), ["48", "47"], "the new post is saved and the real one kept, the junk dropped");
  reset({ saved: [null, kept] });
  await save({ ...kept, text: "Kept post again" });
  assert.deepEqual(store.saved, [null, kept], "a post already saved behind the junk is still found, not saved twice");

  // Both copies of a cross-posted post are saved, but it's one post for the daily digest and the
  // daily reminder: the same text isn't summarised twice or counted twice.
  const crossPosted = () => reset({ saved: [
    { key: "46", platform: "x", authorName: "Sam", text: "Same text", worth: 1, savedAt: Date.now() },
    { key: "46", platform: "linkedin", authorName: "Sam", text: "Same text", worth: 1, savedAt: Date.now() - 1000 },
  ] });
  crossPosted();
  answer = () => "## Built\n- x";
  assert.equal((await send({ type: "digest", since: 0 })).count, 1, "the digest reads it once");
  answer = postAnswer;
  crossPosted();
  notes.length = 0;
  await alarm({ name: "daily-digest" });
  assert.equal(notes[0]?.title, "1 post worth reading today", "the reminder counts it once");

  // The digest and the reminder skip a saved entry that isn't a post, too.
  answer = () => "## Built\n- x";
  reset({ saved: [null, 7, kept] });
  assert.equal((await send({ type: "digest", since: 0 })).count, 1, "the digest reads the real post");
  answer = postAnswer;
  reset({ saved: [null, 7, kept] });
  notes.length = 0;
  await alarm({ name: "daily-digest" });
  assert.equal(notes[0]?.title, "1 post worth reading today", "the reminder counts the real post");
  assert.equal(notes[0]?.message, "Including Kim. Click to open your daily learnings.");
}

// A brief links to the post itself, not to the author's profile. A LinkedIn post supplies its own link
// (postUrl), which the brief and the saved post keep; without one, or with one that isn't a web link,
// the brief falls back to the author's link, as before. A post with no title of its own (LinkedIn, X)
// gets its first line as the title, so the copied prompt's source line says which post it was.
{
  const profile = "https://www.linkedin.com/in/ana/";
  const postLink = "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/";
  const liPost = (key, extra = {}) => ({ key, platform: "linkedin", authorName: "Ana Horvat", authorUrl: profile, text: "Pin your model version in CI.\nThen run evals on every change.", ...extra });

  reset();
  const got = await send({ type: "brief", post: liPost("50", { postUrl: postLink }) });
  assert.equal(store.briefs["linkedin:50"].url, postLink, "the brief keeps the post's own link");
  assert.equal(store.briefs["linkedin:50"].title, "Pin your model version in CI.", "and the post's first line as its title");
  assert.ok(got.prompt.includes(`\nSource: Ana Horvat, "Pin your model version in CI.", ${postLink} (LinkedIn)\n`), "the copied prompt's source line names the post and links to it");
  assert.equal(store.saved[0].postUrl, postLink, "the saved post keeps the post's link");
  assert.equal(store.saved[0].authorUrl, profile, "next to the author's");

  reset();
  await send({ type: "brief", post: liPost("51") });
  assert.equal(store.briefs["linkedin:51"].url, profile, "no post link: the brief falls back to the author's");

  reset();
  await send({ type: "brief", post: liPost("52", { postUrl: "javascript:alert(1)" }) });
  assert.equal(store.briefs["linkedin:52"].url, profile, "a post link that isn't a web link is dropped for the author's");
  assert.equal(store.saved[0].postUrl, "", "and never stored with the saved post");

  reset();
  await send({ type: "brief", post: { key: "53", platform: "reddit", authorName: "u/a (r/b)", authorUrl: "https://www.reddit.com/r/b/comments/1/x/", title: "Evals in CI", text: "First line.\nMore." } });
  assert.equal(store.briefs["reddit:53"].title, "Evals in CI", "a post with a title of its own keeps it");
  assert.equal(store.briefs["reddit:53"].url, "https://www.reddit.com/r/b/comments/1/x/", "and its link");
}

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

// Watch it for me from another platform: the model gets the video link, Sieve keeps the page link, and
// every record carries the platform, so a reel code can't meet a YouTube id of the same 11 characters.
{
  const reelAnswer = () => ({ verdict: "skim", why: "w", summary: "s", learnings: ["l"], technique: true, brief: { what: "Reel technique", try: ["t"] } });
  const reel = (extra = {}) => send({ type: "watch", platform: "example", id: "Abc_1234567", url: "https://example.com/reel/Abc_1234567/", video: "https://cdn.example.com/v.mp4?sig=1", title: "T", channel: "@ana", caption: "A caption.", ...extra });
  reset();
  answer = reelAnswer;
  const got = await reel();
  assert.equal(got.verdict, "skim");
  assert.equal(lastBody.messages[1].content[1].video_url.url, "https://cdn.example.com/v.mp4?sig=1", "the model gets the video link");
  assert.match(lastBody.messages[0].content, /a video from a social feed/);
  assert.deepEqual(Object.keys(store.watched), ["example:Abc_1234567"]);
  const w = store.watched["example:Abc_1234567"];
  assert.equal(w.platform, "example");
  assert.equal(w.url, "https://example.com/reel/Abc_1234567/");
  assert.ok(!JSON.stringify(store).includes("cdn.example.com"), "the signed video link is never stored");
  assert.equal(store.briefs["example:Abc_1234567"].key, "Abc_1234567");
  assert.equal(store.briefs["example:Abc_1234567"].platform, "example");
  assert.deepEqual(store.saved.map((p) => [p.platform, p.key]), [["example", "Abc_1234567"]]);
  assert.ok(got.prompt.includes("(Example)"), "the copied prompt names the platform");

  // The same 11 characters as a YouTube id: two videos, two records, and YouTube's stored as before.
  answer = () => ({ verdict: "watch", why: "w", summary: "s", learnings: ["l"], technique: false });
  await send({ type: "watch", id: "Abc_1234567", url: "https://www.youtube.com/watch?v=Abc_1234567", title: "YT", channel: "C", seconds: 60 });
  assert.deepEqual(Object.keys(store.watched).sort(), ["Abc_1234567", "example:Abc_1234567"]);
  assert.equal(store.watched.Abc_1234567.platform, undefined, "a YouTube record has no platform field, as before");
  assert.ok(store.briefs["example:Abc_1234567"], "the YouTube watch left the reel's brief alone");

  // Asked again without "again": from storage, no new call.
  calls = 0;
  assert.equal((await reel()).verdict, "skim");
  assert.equal(calls, 0);

  // Refused before any call: a platform that isn't a plain word (an empty one too), no video link, an
  // http video link, an id that isn't a plain code, a page link that isn't a web link.
  for (const bad of [{ platform: "Not Valid" }, { platform: "" }, { video: "" }, { video: "http://cdn.example.com/v.mp4" }, { id: "../x" }, { url: "javascript:alert(1)" }]) {
    const r = await reel({ ...bad, again: true });
    assert.ok(r.error, `refused: ${JSON.stringify(bad)}`);
  }
  // A YouTube id is checked too: one carrying ":" could otherwise meet another platform's key.
  const yt = await send({ type: "watch", id: "example:Abc_1234567", url: "https://www.youtube.com/watch?v=x", title: "T", channel: "C", seconds: 60, again: true });
  assert.ok(yt.error, "a YouTube id that isn't a plain code is refused");
  assert.equal(store.watched["example:Abc_1234567"].platform, "example", "and the reel's record is untouched");
  assert.equal(calls, 0, "nothing refused reached the model");
  answer = postAnswer;
}

console.log("brief storage: ok");
