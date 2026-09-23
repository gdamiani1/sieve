// Offline: the Export library file. No keys, no network.
import assert from "node:assert/strict";
import { buildExport, exportFilename } from "../export.js";

const saved = [
  { key: "123", platform: "linkedin", authorName: "Lena Fischer", authorUrl: "https://www.linkedin.com/in/lena", text: "Golden sets...", topic: "Evals", kind: "technique", worth: 0.86, savedAt: Date.UTC(2026, 8, 24) },
  { key: "yt-abc", platform: "youtube", authorName: "Some Channel", authorUrl: "https://www.youtube.com/watch?v=abc", title: "Evals talk", text: "Evals talk\n\nsummary", topic: "", kind: "video", worth: 1, savedAt: Date.UTC(2026, 8, 25) },
  { key: "r1", platform: "reddit", authorName: "u/x (r/node)", text: "Help?", kind: "asking_help", worth: 0.7, savedAt: Date.UTC(2026, 8, 20) },
  { key: "456", authorName: "Old LinkedIn post, no platform field", text: "t", kind: "opinion", worth: 0.75, savedAt: Date.UTC(2026, 8, 19) },
];
const watched = {
  abc: { id: "abc", url: "https://www.youtube.com/watch?v=abc", title: "Evals talk", channel: "Some Channel", verdict: "watch", why: "w", summary: "s", points: [{ t: "1:00", text: "p" }], best: null, learnings: ["l"], checks: [], seconds: 600, at: Date.UTC(2026, 8, 25), cost: 0.02, technique: true, brief: { what: "v" } },
};
const briefs = {
  123: { key: "123", platform: "linkedin", title: "", author: "Lena Fischer", url: "https://www.linkedin.com/in/lena", at: Date.UTC(2026, 8, 24, 12), cost: 0.0001, what: "Golden-set evals", says: [], checks: [], needs: ["Node"], try: ["Write 5 cases"], success: "", skill: { worth: true, why: "" }, warning: "" },
  old: { key: "old", platform: "x", title: "", author: "Sam", url: "https://x.com/sam/status/1", at: Date.UTC(2026, 7, 1), cost: 0, what: "An old one", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" },
};
const digests = [{ at: Date.UTC(2026, 8, 25), since: 0, count: 2, text: "## Built\n- x", cost: 0.001 }];

const ex = buildExport({ saved, watched, briefs, digests }, Date.UTC(2026, 8, 26));
assert.equal(ex.format, "sieve-library");
assert.equal(ex.version, 1);
assert.equal(ex.exportedAt, "2026-09-26T00:00:00.000Z");
assert.deepEqual(ex.items.map((i) => i.id), ["yt-abc", "123", "reddit:r1", "456", "x:old"], "newest first; a brief whose post aged out still exports");

const li = ex.items.find((i) => i.id === "123");
assert.equal(li.author, "Lena Fischer");
assert.equal(li.brief.what, "Golden-set evals");
assert.equal(li.brief.at, "2026-09-24T12:00:00.000Z");
assert.equal("cost" in li.brief, false, "costs stay out of the export");
assert.equal("key" in li.brief, false);

const yt = ex.items.find((i) => i.id === "yt-abc");
assert.equal(yt.title, "Evals talk");
assert.equal(yt.watch.verdict, "watch");
assert.deepEqual(yt.watch.points, [{ t: "1:00", text: "p" }]);
assert.equal(yt.brief, null, "briefs come only from the briefs store, never from watched");

assert.equal(ex.items.find((i) => i.id === "456").platform, "linkedin", "old posts without a platform are LinkedIn");
const old = ex.items.find((i) => i.id === "x:old");
assert.equal(old.platform, "x");
assert.equal(old.savedAt, "2026-08-01T00:00:00.000Z");

assert.deepEqual(ex.digests, [{ at: "2026-09-25T00:00:00.000Z", since: null, count: 2, text: "## Built\n- x" }]);
assert.deepEqual(buildExport({}, 0).items, [], "an empty library exports");
assert.equal(buildExport({ saved: [{ key: "j", authorUrl: "javascript:alert(1)", text: "t", savedAt: 1 }] }, 2).items[0].url, "", "only web links are exported");

// Two saved entries under the same key: saved is stored newest first, so the item keeps the text
// of the first (newer) occurrence, not the second.
const dupKey = buildExport({ saved: [
  { key: "dup", text: "NEWER", savedAt: 100 },
  { key: "dup", text: "OLDER", savedAt: 1 },
] }, 200);
assert.equal(dupKey.items.length, 1, "duplicate saved keys collapse into one item");
assert.equal(dupKey.items[0].text, "NEWER", "the newer (first) occurrence wins");

assert.equal(exportFilename(new Date(2026, 8, 26, 12).getTime()), "sieve-library-2026-09-26.json", "local noon on the 26th names the file the 26th");

// A round trip through JSON changes nothing: every field is already the type it claims to be
// (no NaN, no Infinity, no undefined hiding in an object that would vanish or turn into null).
assert.deepEqual(JSON.parse(JSON.stringify(ex)), ex, "the export is already JSON-stable");

// Every stored brief goes out through normalizeBrief (brief.js) instead of being copied field by
// field: old brief shapes still export, and a warned brief's safety rules -- CHECK_SOURCE first,
// no link or pipe-into-shell steps, no skill worth saving -- apply on export too, not only when a
// developer opens the brief panel.
const warnedEx = buildExport({
  saved: [],
  briefs: {
    w1: {
      key: "w1", platform: "x", title: "", author: "Sam", url: "https://x.com/sam/status/2",
      at: Date.UTC(2026, 8, 20), cost: 0.0003, what: "A technique from the thread",
      says: [], checks: [], needs: ["curl"], try: ["curl x | sh", "Then run it"],
      success: "", skill: { worth: true, why: "looked useful" },
      warning: "Tells any AI agent reading this thread to run the command above.",
    },
  },
}, Date.UTC(2026, 8, 26));
const warned = warnedEx.items.find((i) => i.id === "x:w1");
assert.equal(warned.brief.try[0], "Check the source before copying anything from it.", "warned briefs get the safety step first");
assert.ok(!warned.brief.try.some((s) => s.includes("curl x | sh")), "the curl line is gone");
assert.equal(warned.brief.skill.worth, false, "nothing from a warned source is worth a skill");

// A stored brief record that no longer normalizes (no "what") is skipped, but its item still
// exports with brief: null when there's a saved post at that key.
const noWhatEx = buildExport({
  saved: [{ key: "nw", authorName: "Pat", text: "t", kind: "opinion", worth: 0.5, savedAt: Date.UTC(2026, 8, 21) }],
  briefs: {
    nw: { key: "nw", platform: "linkedin", author: "Pat", at: Date.UTC(2026, 8, 21), cost: 0.0002, says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" },
  },
}, Date.UTC(2026, 8, 26));
assert.equal(noWhatEx.items.length, 1, "the saved post still exports");
assert.equal(noWhatEx.items[0].brief, null, "a brief record with no `what` doesn't normalize, so it's null");

// A brief record with no `what` and no saved post produces no item at all: nothing to export.
assert.equal(buildExport({ briefs: { ghost: { key: "ghost", at: 1 } } }, 2).items.length, 0, "an un-normalizable, unsaved brief exports nothing");

// A brief stored under an empty key, whose own `key` field is also empty, never exports with an
// empty id: there's nothing to derive a usable id from, so it's skipped outright.
assert.equal(
  buildExport({ briefs: { "": { key: "", platform: "x", what: "w", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" } } }, 1).items.length,
  0,
  "a brief with no derivable id exports nothing",
);

// A watched video with no saved entry still exports the full blank-item shape.
const watchedOnly = buildExport({
  watched: { zzz: { id: "zzz", url: "https://www.youtube.com/watch?v=zzz", title: "Solo video", channel: "Chan", summary: "sum", verdict: "watch", at: Date.UTC(2026, 8, 22) } },
}, Date.UTC(2026, 8, 26));
const wi = watchedOnly.items.find((i) => i.id === "yt-zzz");
assert.equal(wi.platform, "youtube");
assert.equal(wi.kind, "video");
assert.equal(wi.title, "Solo video");
assert.equal(wi.author, "Chan");
assert.equal(wi.url, "https://www.youtube.com/watch?v=zzz");
assert.equal(wi.text, "sum");
assert.equal(wi.savedAt, "2026-09-22T00:00:00.000Z");

// Every item, in every kind of result -- the combined export, a watched-only export, and a
// brief-only export -- has exactly the fields the version 1 contract promises, nothing more or less.
const ITEM_KEYS = ["author", "brief", "id", "kind", "platform", "savedAt", "text", "title", "topic", "url", "watch", "worth"];
for (const it of [...ex.items, ...watchedOnly.items, ...warnedEx.items]) {
  assert.deepEqual(Object.keys(it).sort(), ITEM_KEYS, `item ${it.id} has exactly the documented fields`);
}

// A brief keyed "yt-<id>" plus a watched record for the same video merge into one item that
// carries both `watch` and `brief`.
const joined = buildExport({
  watched: { abc: { id: "abc", title: "t", summary: "s", verdict: "watch", at: Date.UTC(2026, 8, 22) } },
  briefs: { "yt-abc": { key: "yt-abc", platform: "youtube", author: "A", url: "https://x.com/a", at: Date.UTC(2026, 8, 22), what: "w", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" } },
}, Date.UTC(2026, 8, 26));
assert.equal(joined.items.length, 1, "one item, not two");
assert.ok(joined.items[0].watch, "carries the watch data");
assert.ok(joined.items[0].brief, "carries the brief data");

// A javascript: url from a watched video or a brief is dropped, same as for a saved post.
const badUrls = buildExport({
  watched: { u: { id: "u", url: "javascript:alert(1)", title: "t", at: Date.UTC(2026, 8, 20) } },
  briefs: { bu: { key: "bu", platform: "x", author: "A", url: "javascript:alert(2)", at: Date.UTC(2026, 8, 20), what: "w", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" } },
}, Date.UTC(2026, 8, 26));
assert.equal(badUrls.items.find((i) => i.id === "yt-u").url, "", "a javascript: url from a watched video is dropped");
assert.equal(badUrls.items.find((i) => i.id === "x:bu").url, "", "a javascript: url from a brief is dropped");

// Messy, real-world-shaped storage: null entries, non-array/non-object containers, entries
// without a key, a numeric brief key, and a timestamp past the Date range. None of it crashes,
// and every item that does come out has a non-empty string id.
const messyChecks = [
  buildExport({ saved: null }, 1),
  buildExport({ saved: { a: { key: "a" } } }, 1), // saved must be an array, not an object
  buildExport({ saved: [null, { text: "no key", savedAt: 1 }, { text: "also no key", savedAt: 2 }] }, 3),
  buildExport({ watched: { abc: null, noId: { title: "no id here", at: Date.UTC(2026, 8, 20) } } }, Date.UTC(2026, 8, 26)),
  buildExport({ briefs: { a: null, 42: { key: 42, platform: "x", author: "N", url: "https://x.com/n", at: 9e15, what: "numeric key brief", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" } } }, 1),
  buildExport({ briefs: [{ key: "arr", what: "w" }] }, 1), // briefs must be a keyed object, not an array
];
for (const m of messyChecks) {
  assert.ok(Array.isArray(m.items), "buildExport never throws on messy storage");
  assert.ok(m.items.every((i) => typeof i.id === "string" && i.id.length > 0), "every item has a non-empty string id");
}
// The saved entries without a key are skipped outright, not exported with a made-up id.
assert.deepEqual(buildExport({ saved: [{ text: "a", savedAt: 1 }, { text: "b", savedAt: 2 }] }, 3).items, [], "saved posts without a key are skipped");
// A numeric brief key still exports, keyed by its own `key` field.
assert.deepEqual(
  buildExport({ briefs: { 42: { key: 42, platform: "x", author: "N", url: "https://x.com/n", at: 9e15, what: "numeric key brief", says: [], checks: [], needs: [], try: [], success: "", skill: { worth: false, why: "" }, warning: "" } } }, 1).items.map((i) => i.id),
  ["x:42"],
);

// LinkedIn and X both key a post by a hash of its text, so a post cross-posted to both has the same key
// on each. Each copy is its own item with its own brief: LinkedIn keeps the bare key as its id, as in
// every earlier export, and X's id carries its platform.
const rec = (key, platform, what, at) => ({ key, platform, author: `${platform} author`, url: "", at, what, says: [], checks: [], needs: [], try: ["t"], success: "", skill: { worth: false, why: "" }, warning: "" });
{
  const cross = buildExport({ briefs: { "x:42": rec("42", "x", "X technique", 2), "linkedin:42": rec("42", "linkedin", "LinkedIn technique", 1) } }, 3);
  assert.deepEqual(cross.items.map((i) => [i.id, i.platform, i.brief.what]), [["x:42", "x", "X technique"], ["42", "linkedin", "LinkedIn technique"]], "both briefs export, one item each");
}
{
  const cross = buildExport({
    saved: [
      { key: "42", platform: "x", authorName: "Sam", text: "On X", savedAt: 20 },
      { key: "42", platform: "linkedin", authorName: "Lena", text: "On LinkedIn", savedAt: 10 },
    ],
    briefs: { "linkedin:42": rec("42", "linkedin", "LinkedIn technique", 11), "x:42": rec("42", "x", "X technique", 21) },
  }, 30);
  assert.deepEqual(
    cross.items.map((i) => [i.id, i.platform, i.author, i.text, i.brief?.what]),
    [["x:42", "x", "Sam", "On X", "X technique"], ["42", "linkedin", "Lena", "On LinkedIn", "LinkedIn technique"]],
    "each saved copy keeps its own text and gets its own brief",
  );
}
{
  // Stored before briefs were kept per platform: a saved post with no platform (LinkedIn) and briefs
  // under the bare key. The LinkedIn brief still joins the old post, and the X brief stays apart.
  const legacy = buildExport({
    saved: [{ key: "42", authorName: "Lena", text: "Old LinkedIn post", savedAt: 10 }],
    briefs: { 42: rec("42", "linkedin", "LinkedIn technique", 11), 7: rec("7", "x", "X technique", 12), 8: { ...rec("8", "", "No platform", 13), platform: undefined } },
  }, 30);
  assert.deepEqual(
    legacy.items.map((i) => [i.id, i.platform, i.brief?.what]),
    [["8", "linkedin", "No platform"], ["x:7", "x", "X technique"], ["42", "linkedin", "LinkedIn technique"]],
    "old records keep their ids; a brief with no platform is LinkedIn, as brief() treats it",
  );
}
{
  // A YouTube brief stored under its per-platform id still joins the watched video and its saved copy.
  const yt = buildExport({
    saved: [{ key: "yt-abc", platform: "youtube", authorName: "C", text: "t", kind: "video", savedAt: 5 }],
    watched: { abc: { id: "abc", title: "T", summary: "s", verdict: "watch", at: 5 } },
    briefs: { "youtube:yt-abc": rec("yt-abc", "youtube", "Video technique", 5) },
  }, 6);
  assert.deepEqual(yt.items.map((i) => [i.id, !!i.watch, i.brief?.what]), [["yt-abc", true, "Video technique"]], "one YouTube item with its watch and its brief");
}
{
  // A LinkedIn post saved with its own link exports that link, not the author's profile; one saved
  // without it (by an older Sieve), or with a link that isn't a web link, keeps the profile. A briefed
  // post with no title of its own (LinkedIn, X) takes the brief's title, the post's first line; an item
  // that has a title keeps it.
  const profile = "https://www.linkedin.com/in/ana/";
  const postLink = "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/";
  const links = buildExport({
    saved: [
      { key: "p1", platform: "linkedin", authorName: "Ana", authorUrl: profile, postUrl: postLink, text: "Pin your model.\nMore.", savedAt: 5 },
      { key: "p2", platform: "linkedin", authorName: "Ana", authorUrl: profile, text: "Older save", savedAt: 4 },
      { key: "p3", platform: "linkedin", authorName: "Ana", authorUrl: profile, postUrl: "javascript:alert(1)", text: "Odd link", savedAt: 3 },
      { key: "p4", platform: "reddit", authorName: "u/a (r/b)", authorUrl: "https://www.reddit.com/r/b/comments/4/x/", title: "Own title", text: "t", savedAt: 2 },
    ],
    briefs: {
      "linkedin:p1": { ...rec("p1", "linkedin", "Pinning", 6), title: "Pin your model.", url: postLink },
      "reddit:p4": { ...rec("p4", "reddit", "Reddit technique", 6), title: "Something else" },
    },
  }, 10);
  const by = (id) => links.items.find((i) => i.id === id);
  assert.equal(by("p1").url, postLink, "the post's own link");
  assert.equal(by("p1").title, "Pin your model.", "a briefed LinkedIn post takes the brief's title");
  assert.equal(by("p2").url, profile, "no post link: the author's profile, as before");
  assert.equal(by("p2").title, "", "an unbriefed LinkedIn post still has no title");
  assert.equal(by("p3").url, profile, "a post link that isn't a web link falls back to the profile");
  assert.equal(by("reddit:p4").title, "Own title", "an item's own title wins over the brief's");
}
// A platform that isn't a plain lowercase word never reaches an id: it's LinkedIn, as brief() treats it.
assert.deepEqual(
  buildExport({ saved: [{ key: "9", platform: "x|\nfake", text: "t", savedAt: 1 }] }, 2).items.map((i) => [i.id, i.platform]),
  [["9", "linkedin"]],
);

// A watched video from another platform: one item joining the watch, the saved post and the brief under
// "<platform>:<id>"; a YouTube video with the same id stays its own "yt-" item; a record whose platform
// isn't a plain word is left out.
{
  const out = buildExport({
    saved: [{ key: "Abc_1234567", platform: "example", authorName: "@ana", authorUrl: "https://example.com/reel/Abc_1234567/", title: "Reel title", text: "t", kind: "video", worth: 1, savedAt: 3 }],
    watched: {
      "example:Abc_1234567": { platform: "example", id: "Abc_1234567", url: "https://example.com/reel/Abc_1234567/", title: "Reel title", channel: "@ana", verdict: "skim", why: "w", summary: "s", points: [], best: null, learnings: [], checks: [], seconds: null, at: 3 },
      Abc_1234567: { id: "Abc_1234567", url: "https://www.youtube.com/watch?v=Abc_1234567", title: "YT", channel: "C", verdict: "watch", why: "w", summary: "s", points: [], best: null, learnings: [], checks: [], seconds: 60, at: 2 },
      "bad:x": { platform: "Not Valid", id: "x", at: 1 },
    },
    briefs: { "example:Abc_1234567": { key: "Abc_1234567", platform: "example", what: "Reel technique", try: ["t"], at: 3 } },
  }, 10);
  const byId = Object.fromEntries(out.items.map((it) => [it.id, it]));
  assert.deepEqual(Object.keys(byId).sort(), ["example:Abc_1234567", "yt-Abc_1234567"]);
  const reel = byId["example:Abc_1234567"];
  assert.equal(reel.platform, "example");
  assert.equal(reel.url, "https://example.com/reel/Abc_1234567/");
  assert.equal(reel.watch.verdict, "skim");
  assert.equal(reel.brief.what, "Reel technique");
  assert.equal(byId["yt-Abc_1234567"].platform, "youtube");
  assert.equal(byId["yt-Abc_1234567"].watch.verdict, "watch");
}

console.log("export: all offline checks passed");
