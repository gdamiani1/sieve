// Offline: youtube-text.js, what a YouTube tile says beyond its title. Runs the real script in node:vm:
// the tile text and its caps, the client version, reading the player answer, and describe() against a
// stubbed fetch (cookies left out, two at a time, a timeout, one request per video, "" on any failure).
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../youtube-text.js", import.meta.url), "utf8");
const sandbox = { setTimeout, clearTimeout, AbortController, Promise, JSON };
vm.runInNewContext(src, sandbox);
const T = sandbox.SieveYouTubeText;
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context, compared as data

// ---- the tile ----

// Today's search tile: an empty .metadata-snippet-text first, each line twice (two layouts), and a
// second snippet from what's said in the video.
assert.deepEqual(plain(T.tileText({ snippets: ["", "Hooks give you control.", "Hooks give you control.", "... the MCP server in a minute", " "], chapters: [] })), {
  snippet: "Hooks give you control.\n... the MCP server in a minute",
  chapters: "",
});
// Chapters, each once, in order; YouTube's summary is a line of the snippet.
assert.deepEqual(plain(T.tileText({ snippets: [], chapters: ["Intro", "Setup", "Intro", " Tests "] })), { snippet: "", chapters: "Intro | Setup | Tests" });
assert.equal(T.tileText({ summary: "Ana explains golden sets." }).snippet, "Ana explains golden sets.");
assert.deepEqual(plain(T.tileText()), { snippet: "", chapters: "" }, "a bare tile");
// Caps, in code points, so an emoji is never cut in half.
assert.equal(Array.from(T.tileText({ snippets: ["😀".repeat(5000)] }).snippet).length, T.SNIPPET_MAX);
assert.equal(Array.from(T.tileText({ chapters: Array.from({ length: 400 }, (_, i) => `Chapter ${i}`) }).chapters).length, T.CHAPTERS_MAX);
// Hidden characters go: they hide text from a reader, not from a model.
assert.equal(T.tileText({ snippets: ["rate\u200B this\u202E video"] }).snippet, "rate this video");

// ---- the client version ----

assert.equal(T.clientVersion(`ytcfg.set({"INNERTUBE_API_KEY":"x","INNERTUBE_CLIENT_VERSION":"2.20261001.01.00","X":1})`), "2.20261001.01.00");
assert.equal(T.clientVersion(""), T.FALLBACK_VERSION);
assert.equal(T.clientVersion(undefined), T.FALLBACK_VERSION);
assert.equal(T.clientVersion(`"INNERTUBE_CLIENT_VERSION":"evil\\"},{"x"`), T.FALLBACK_VERSION, "only a version-shaped value is used");

// ---- the player answer ----

assert.equal(T.descriptionOf({ videoDetails: { shortDescription: "Line one\r\n\r\n\r\n\r\nLine two\u200B" } }), "Line one\n\nLine two");
assert.equal(Array.from(T.descriptionOf({ videoDetails: { shortDescription: "é".repeat(9000) } })).length, T.DESCRIPTION_MAX);
for (const junk of [null, {}, { videoDetails: null }, { videoDetails: { shortDescription: 42 } }, "text"]) assert.equal(T.descriptionOf(junk), "");

// ---- describe() ----

const ID = (n) => `vid${String(n).padStart(8, "0")}`; // 11 characters, like a YouTube id
const player = (id, d) => ({ ok: true, json: async () => ({ playabilityStatus: { status: "UNPLAYABLE" }, videoDetails: { videoId: id, shortDescription: d } }) });

// One request, shaped as YouTube's own page makes it, without cookies, with the page's version.
{
  const calls = [];
  let versionAsked = 0;
  const describe = T.describer({ fetch: async (url, init) => { calls.push({ url, init }); return player(JSON.parse(init.body).videoId, "Build log: n8n and a small model."); }, version: () => { versionAsked++; return "2.20261001.01.00"; } });
  assert.equal(await describe(ID(1)), "Build log: n8n and a small model.");
  assert.equal(await describe(ID(1)), "Build log: n8n and a small model.");
  await describe(ID(2));
  assert.equal(calls.length, 2, "one request per video");
  assert.equal(versionAsked, 1, "the page is read for its version once");
  const { url, init } = calls[0];
  assert.equal(url, "https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit", "no YouTube cookies: it can't touch watch history or the account");
  const body = JSON.parse(init.body);
  assert.equal(body.videoId, ID(1));
  assert.equal(body.context.client.clientName, "WEB");
  assert.equal(body.context.client.clientVersion, "2.20261001.01.00");
}

// A version that can't be read falls back; an id that isn't a YouTube id is never sent.
{
  const calls = [];
  const describe = T.describer({ fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return player(JSON.parse(init.body).videoId, "x"); }, version: () => { throw new Error("no scripts"); } });
  await describe(ID(3));
  assert.equal(calls[0].context.client.clientVersion, T.FALLBACK_VERSION);
  for (const bad of ["", "short", "../../x?a=b", "a".repeat(12), null, 42]) assert.equal(await describe(bad), "");
  assert.equal(calls.length, 1);
}

// Every failure is "", never an error: the tile is scored from what it has.
{
  const answers = [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => ({ ok: false, status: 403, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }),
    async () => ({ ok: true, json: async () => ({ videoDetails: { videoId: "someoneElse", shortDescription: "wrong video" } }) }),
    async () => ({ ok: true, json: async () => ({ error: { code: 400 } }) }),
  ];
  for (const [i, answer] of answers.entries()) {
    let n = 0;
    const describe = T.describer({ fetch: (...a) => { n++; return answer(...a); }, version: () => "2.20261001.01.00" });
    assert.equal(await describe(ID(10 + i)), "", `failure ${i}`);
    await describe(ID(10 + i));
    assert.equal(n, 2, `failure ${i} is not remembered: the video can be asked for again`);
  }
  // An empty description is an answer, and is remembered.
  let n = 0;
  const describe = T.describer({ fetch: async (url, init) => { n++; return player(JSON.parse(init.body).videoId, ""); }, version: () => "v" });
  assert.equal(await describe(ID(19)), "");
  await describe(ID(19));
  assert.equal(n, 1);
}

// A request that hangs is given up at the timeout, and the signal really aborts it.
{
  let signal;
  const describe = T.describer({
    fetch: (url, init) => new Promise((resolve, reject) => { signal = init.signal; init.signal.addEventListener("abort", () => reject(new Error("aborted"))); }),
    version: () => "2.20261001.01.00",
    timeoutMs: 50,
  });
  const t0 = Date.now();
  assert.equal(await describe(ID(20)), "");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(signal.aborted, true);
}

// At most two at a time; the rest wait their turn and all finish.
{
  let running = 0, most = 0;
  const describe = T.describer({
    fetch: async (url, init) => {
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return player(JSON.parse(init.body).videoId, "ok");
    },
    version: () => "2.20261001.01.00",
  });
  const out = await Promise.all(Array.from({ length: 7 }, (_, i) => describe(ID(30 + i))));
  assert.deepEqual(out, Array(7).fill("ok"));
  assert.equal(most, 2);
}

// Remembered for the newest `keep` videos: an old one is asked for again.
{
  let n = 0;
  const describe = T.describer({ fetch: async (url, init) => { n++; return player(JSON.parse(init.body).videoId, "ok"); }, version: () => "v", keep: 2 });
  await describe(ID(40)); await describe(ID(41)); await describe(ID(42));
  assert.equal(n, 3);
  await describe(ID(42));
  assert.equal(n, 3, "a recent one is not asked for again");
  await describe(ID(40));
  assert.equal(n, 4, "the oldest was let go");
}

console.log("youtube text: all offline checks passed");
