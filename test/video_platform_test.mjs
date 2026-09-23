// Offline: Watch it for me on a platform other than YouTube. The platform helpers in brief.js, and (Task
// 3) the watch prompt. Uses the invented platform "example"; no keys, no network.
import assert from "node:assert/strict";
import { platformName, videoPlatform, videoRecordKey, watchedKey, videoBriefRecord, safetyHeader } from "../brief.js";

// A platform's name: the known ones as they spell themselves, any other plain key with a capital.
assert.equal(platformName("youtube"), "YouTube");
assert.equal(platformName("x"), "X");
assert.equal(platformName("example"), "Example");
for (const bad of ["Not A Key", "ex ample", "", undefined, null, 42, "a".repeat(21)]) assert.equal(platformName(bad), "", `no name for ${JSON.stringify(bad)}`);

// Which platform a watch request is for: missing or "youtube" is YouTube; any plain word is itself.
for (const yt of [undefined, null, "", "youtube"]) assert.equal(videoPlatform(yt), "youtube");
assert.equal(videoPlatform("example"), "example");
for (const bad of ["Example", "ex ample", "a".repeat(21), 42, {}]) assert.equal(videoPlatform(bad), null, `refused: ${JSON.stringify(bad)}`);

// Keys: YouTube keeps its own; another platform's can never meet a YouTube id of the same length.
assert.equal(videoRecordKey("youtube", "Abc_1234567"), "yt-Abc_1234567");
assert.equal(videoRecordKey("example", "Abc_1234567"), "Abc_1234567");
assert.equal(watchedKey("youtube", "Abc_1234567"), "Abc_1234567");
assert.equal(watchedKey("example", "Abc_1234567"), "example:Abc_1234567");

// A YouTube answer's brief record is what it always was.
const yt = videoBriefRecord({ id: "abc", url: "https://www.youtube.com/watch?v=abc", title: "T", channel: "C", at: 5, cost: 0.01, brief: { what: "W", try: ["t"] } });
assert.equal(yt.key, "yt-abc");
assert.equal(yt.platform, "youtube");
assert.equal(yt.author, "C");
assert.equal(yt.url, "https://www.youtube.com/watch?v=abc");
assert.equal(yt.at, 5);
assert.equal(yt.cost, 0.01);
// Another platform's: keyed by the id, carrying its platform, linking to the page.
const ex = videoBriefRecord({ platform: "example", id: "Abc_1234567", url: "https://example.com/reel/Abc_1234567/", title: "T", channel: "@ana", at: 5, brief: { what: "W", try: ["t"] } });
assert.equal(ex.key, "Abc_1234567");
assert.equal(ex.platform, "example");
assert.equal(ex.url, "https://example.com/reel/Abc_1234567/");
assert.equal(ex.author, "@ana");
assert.equal(videoBriefRecord({ platform: "Not Valid", id: "x", brief: { what: "W" } }), null, "no record for a platform that isn't a plain word");

// A brief's source line names the platform, known or not, and nothing for garbage.
assert.match(safetyHeader({ author: "@ana", platform: "example" }), /\nSource: @ana \(Example\)$/);
assert.match(safetyHeader({ author: "Ana", platform: "youtube" }), /\nSource: Ana \(YouTube\)$/);
assert.match(safetyHeader({ author: "Ana", platform: "Not Valid" }), /\nSource: Ana$/);
assert.match(safetyHeader({}), /\nSource: unknown$/);

console.log("video platforms: all checks passed");
