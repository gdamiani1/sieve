// Offline: analytics.js, the opt-in usage stats. Copies the real module into a temp folder beside a
// config with made-up IDs, then runs it against an in-memory chrome.storage and a stubbed fetch: no
// network, nothing reaches Google.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const store = {};
const alarms = new Map();
let alarmListener;
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => structuredClone(Object.fromEntries([keys].flat().filter((k) => Object.hasOwn(store, k)).map((k) => [k, store[k]]))),
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    remove: async (keys) => { for (const k of [keys].flat()) delete store[k]; },
  } },
  alarms: {
    create: (name, info) => { alarms.set(name, info); },
    clear: async (name) => alarms.delete(name),
    onAlarm: { addListener: (fn) => { alarmListener = fn; } },
  },
  runtime: { getManifest: () => ({ version: "1.4.1" }) },
};
const posts = [];
let answer = () => new Response(null, { status: 204 });
globalThis.fetch = async (url, init) => { posts.push({ url, init, body: JSON.parse(init.body) }); return answer(); };

const dir = mkdtempSync(join(tmpdir(), "sieve-analytics-"));
const real = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
copyFileSync(real("analytics.js"), join(dir, "analytics.js"));
writeFileSync(join(dir, "analytics-config.js"), 'export const MEASUREMENT_ID = "G-TEST123";\nexport const API_SECRET = "secret-test";\n');
const a = await import(pathToFileURL(join(dir, "analytics.js")).href);

const at = (iso) => () => new Date(iso).getTime(); // local time
const reset = () => { for (const k of Object.keys(store)) delete store[k]; alarms.clear(); posts.length = 0; answer = () => new Response(null, { status: 204 }); };

try {
  // Before consent: nothing counted, nothing stored, no card answer yet.
  reset();
  a.setClockForTests(at("2026-10-03T10:00:00"));
  await a.count("brief_made", { platform: "x" });
  assert.deepEqual(store, {}, "no storage before consent");
  assert.deepEqual(await a.status(), { available: true, consent: null, installCode: "" });

  // Saying no: remembered, nothing else stored.
  await a.setConsent(false);
  assert.equal(store.statsConsent, false);
  assert.equal(store.statsClientId, undefined);
  await a.count("brief_made", { platform: "x" });
  assert.equal(store.statsDays, undefined);

  // Saying yes: an ID, an alarm, a 6-character code from the ID.
  await a.setConsent(true);
  assert.match(store.statsClientId, /^[0-9a-f-]{36}$/);
  assert.ok(alarms.has(a.STATS_ALARM));
  const st = await a.status();
  assert.equal(st.consent, true);
  assert.equal(st.installCode, store.statsClientId.replace(/-/g, "").slice(0, 6).toUpperCase());

  // Counting: per day and breakdown; unknown values become "other"; unknown names are ignored.
  await Promise.all([
    a.count("brief_made", { platform: "x" }),
    a.count("brief_made", { platform: "x" }),
    a.count("posts_scored", { platform: "linkedin", scorer: "jev" }),
    a.count("video_watched", { platform: "tiktok" }),
    a.count("digest_made"),
    a.count("made_up", { platform: "x" }),
    a.count("prompt_copied", { where: "https://example.com/secret" }),
  ]);
  assert.deepEqual(store.statsDays, { "2026-10-03": {
    "brief_made|x": 2, "posts_scored|linkedin|jev": 1, "video_watched|other": 1, "digest_made": 1, "prompt_copied|other": 1,
  } });

  // Today is never sent.
  await a.sendDue();
  assert.equal(posts.length, 0, "today stays");

  // Next day: yesterday goes as one text/plain POST with the right body; then it's gone.
  a.setClockForTests(at("2026-10-04T09:00:00"));
  await a.count("post_saved", { platform: "reddit" });
  await a.sendDue();
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.url, "https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=secret-test");
  assert.equal(p.init.method, "POST");
  assert.equal(p.init.headers["Content-Type"], "text/plain");
  assert.equal(p.body.client_id, store.statsClientId);
  assert.equal(p.body.timestamp_micros, new Date("2026-10-03T12:00:00").getTime() * 1000);
  const ev = Object.fromEntries(p.body.events.map((e) => [e.name + "|" + (e.params.platform || e.params.where || ""), e.params]));
  assert.deepEqual(ev["brief_made|x"], { platform: "x", count: 2, version: "1.4.1", install: st.installCode, session_id: 20261003, engagement_time_msec: 1 });
  assert.equal(ev["posts_scored|linkedin"].scorer, "jev");
  assert.deepEqual(Object.keys(store.statsDays), ["2026-10-04"], "sent day removed, today kept");

  // Nothing in the body is a string outside the allowed values (plus version, install, ids).
  const allowed = new Set(["x", "linkedin", "reddit", "youtube", "other", "jev", "fallback", "brief", "digest", "1.4.1", st.installCode,
    "brief_made", "posts_scored", "video_watched", "digest_made", "prompt_copied", "post_saved", "library_exported", store.statsClientId]);
  JSON.stringify(p.body, (_k, v) => { if (typeof v === "string") assert.ok(allowed.has(v), `unexpected string ${v}`); return v; });

  // A failed POST keeps the day for the next try.
  a.setClockForTests(at("2026-10-05T09:00:00"));
  answer = () => new Response(null, { status: 500 });
  await a.sendDue();
  assert.ok(store.statsDays["2026-10-04"], "kept after a 500");
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await a.sendDue();
  assert.ok(store.statsDays["2026-10-04"], "kept after a network error");
  globalThis.fetch = async (url, init) => { posts.push({ url, init, body: JSON.parse(init.body) }); return answer(); };
  answer = () => new Response(null, { status: 204 });
  await a.sendDue();
  assert.equal(store.statsDays["2026-10-04"], undefined, "sent on the retry");

  // More than 25 events: two requests. (Fill a day by hand with 30 keys; analytics drops unknown names,
  // so use real names with different "other"-mapped keys stored directly.)
  reset();
  a.setClockForTests(at("2026-10-03T10:00:00"));
  await a.setConsent(true);
  const many = {};
  for (let i = 0; i < 30; i++) many[`brief_made|p${i}`] = 1;
  store.statsDays = { "2026-10-02": many };
  await a.sendDue();
  assert.deepEqual(posts.map((q) => q.body.events.length), [25, 5]);
  posts.length = 0;

  // Days too old for GA (over 71 hours past their noon) are dropped unsent.
  store.statsDays = { "2026-09-29": { "digest_made": 3 } };
  await a.sendDue();
  assert.equal(posts.length, 0);
  assert.deepEqual(store.statsDays, {});

  // Stored rubbish is skipped, not sent.
  store.statsDays = { "2026-10-02": { "evil|<script>": 4, "digest_made": "lots", "library_exported": 1 } };
  await a.sendDue();
  assert.deepEqual(posts[0].body.events.map((e) => e.name), ["library_exported"]);
  posts.length = 0;

  // Turning off deletes the ID, counts and alarm; a send then does nothing.
  store.statsDays = { "2026-10-02": { "digest_made": 1 } };
  await a.setConsent(false);
  assert.equal(store.statsConsent, false);
  assert.equal(store.statsClientId, undefined);
  assert.equal(store.statsDays, undefined);
  assert.ok(!alarms.has(a.STATS_ALARM));
  await a.sendDue();
  assert.equal(posts.length, 0);

  // Turning on again: a new ID.
  await a.setConsent(true);
  const first = store.statsClientId;
  await a.setConsent(false);
  await a.setConsent(true);
  assert.notEqual(store.statsClientId, first);

  // Consent switched off while a send is running: the next request doesn't go.
  reset();
  a.setClockForTests(at("2026-10-03T10:00:00"));
  await a.setConsent(true);
  const big = {};
  for (let i = 0; i < 30; i++) big[`brief_made|p${i}`] = 1;
  store.statsDays = { "2026-10-02": big };
  answer = () => { store.statsConsent = false; return new Response(null, { status: 204 }); };
  await a.sendDue();
  assert.equal(posts.length, 1, "second batch not sent after consent went off");

  // startStats: the alarm listener sends; the alarm is made again for an install that said yes.
  reset();
  await a.setConsent(true);
  alarms.clear();
  a.startStats();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(alarms.has(a.STATS_ALARM), "alarm restored on start");
  store.statsDays = { "2026-10-02": { "digest_made": 1 } };
  await alarmListener({ name: a.STATS_ALARM });
  assert.equal(posts.length, 1);

  console.log("analytics_test: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
