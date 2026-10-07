// Usage stats, opt-in. Off until the user says yes, in the popup's one question or under Usage stats in
// settings. Before that, nothing here counts, stores or sends anything.
//
// What is sent: once a day, for each finished day Sieve was used, how many posts were scored, saved,
// briefed, copied as a prompt, watched, put in a digest and exported, per platform, with the extension
// version, which scorer answered (Jev or the fallback model), and a random install ID made in this
// browser (and the 6-character install code shown in settings, which is the start of that ID), and
// whether sending to your agent is on ("on" or "off", as it is when the day is sent). Never post
// text, links, names, titles, facts, keys or anything typed.
// Where: Google Analytics 4, through its Measurement Protocol: a plain POST per day (two if a day has many
// kinds of counts) from this worker. No Google script is loaded, and no permission is needed (a
// text/plain POST is a simple request). Like any request, it shows Google the browser's IP address and
// user agent.
// Why: so the developer can see whether people keep using Sieve.
// Turning it off deletes the install ID and every count not yet sent.
//
// The API secret in analytics-config.js ships inside a public extension, so it isn't secret: anyone could
// send made-up counts with it. Nothing in the counts is trusted for more than rough usage, and the events
// are kept this narrow so made-up ones can do no more than inflate them. A build from GitHub has empty
// values and sends nothing (tools/store-zip.mjs puts the real ones into the store package).
import { MEASUREMENT_ID, API_SECRET } from "./analytics-config.js";

export const STATS_ALARM = "usage-stats";
const ENDPOINT = "https://www.google-analytics.com/mp/collect";
// Each event, and the breakdown it carries. Nothing else can be counted.
const EVENTS = {
  posts_scored: ["platform", "scorer"],
  post_saved: ["platform"],
  brief_made: ["platform"],
  prompt_copied: ["where"],
  video_watched: ["platform"],
  digest_made: [],
  library_exported: [],
};
// The only values a breakdown can hold; anything else is sent as "other".
const VALUES = { platform: ["linkedin", "x", "reddit", "youtube"], scorer: ["jev", "fallback"], where: ["brief", "digest"] };
const BATCH = 25; // events per request, GA's limit
const MAX_AGE = 71 * 3600e3; // GA takes events up to 72 hours back; a day is stamped at its noon
const KEYS = ["statsConsent", "statsClientId", "statsDays"];

let now = () => Date.now();
export function setClockForTests(fn) { now = fn; }

const available = () => !!(MEASUREMENT_ID && API_SECRET);
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const noonOf = (day) => new Date(`${day}T12:00:00`).getTime(); // local time
// Stored data may be anything after an upgrade or a hand edit; only a plain object counts as a map.
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const codeOf = (id) => String(id || "").replace(/-/g, "").slice(0, 6).toUpperCase();

// Storage changes here run one at a time, so two counts that land together both survive.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// Adds one to today's count for this event and breakdown. Never throws: counting must not break the
// action it counts.
export function count(name, detail) {
  if (!available() || !Object.hasOwn(EVENTS, name)) return Promise.resolve();
  const d = plain(detail);
  const key = [name, ...EVENTS[name].map((p) => (VALUES[p].includes(d[p]) ? d[p] : "other"))].join("|");
  const day = dayOf(now());
  return serial(async () => {
    const stored = await chrome.storage.local.get(["statsConsent", "statsDays"]);
    if (stored.statsConsent !== true) return;
    const days = plain(stored.statsDays);
    const counts = { ...plain(days[day]) };
    counts[key] = (Number.isInteger(counts[key]) ? counts[key] : 0) + 1;
    await chrome.storage.local.set({ statsDays: { ...days, [day]: counts } });
  }).catch(() => {});
}

// Yes makes a new install ID (a new one every time it's turned on). No deletes the ID and every count
// not yet sent, and remembers the answer so the popup doesn't ask again.
export function setConsent(on) {
  if (!available()) return Promise.resolve(); // a build without IDs has nothing to turn on
  return serial(async () => {
    const { statsConsent } = await chrome.storage.local.get("statsConsent");
    if (on) {
      if (statsConsent === true) return;
      await chrome.storage.local.set({ statsConsent: true, statsClientId: crypto.randomUUID(), statsDays: {} });
      chrome.alarms.create(STATS_ALARM, { delayInMinutes: 1, periodInMinutes: 180 });
    } else {
      await chrome.storage.local.remove(["statsClientId", "statsDays"]);
      await chrome.storage.local.set({ statsConsent: false });
      await chrome.alarms.clear(STATS_ALARM);
    }
  });
}

// For the popup and settings: whether stats can be turned on in this build, the answer so far (null
// when never asked), and the install code while it's on.
export async function status() {
  const { statsConsent, statsClientId } = await chrome.storage.local.get(KEYS);
  const consent = typeof statsConsent === "boolean" ? statsConsent : null;
  return { available: available(), consent, installCode: consent ? codeOf(statsClientId) : "" };
}

// Sends every finished day, oldest first, and removes each one only once GA has answered every request
// for it with a 2xx (which means received, not necessarily kept). A day too old for GA is dropped
// unsent. On any failure it stops; the next alarm tries again.
let sending = null;
export function sendDue() {
  sending ||= send().catch(() => {}).finally(() => { sending = null; });
  return sending;
}

// One stored key and its number as an event, or null for anything this module could not have stored.
function toEvent(key, n, shared) {
  const [name, ...values] = key.split("|");
  if (!Object.hasOwn(EVENTS, name)) return null;
  const params = EVENTS[name];
  if (values.length !== params.length || !Number.isInteger(n) || n < 1) return null;
  const breakdown = Object.fromEntries(params.map((p, i) => [p, VALUES[p].includes(values[i]) ? values[i] : "other"]));
  return { name, params: { ...breakdown, count: n, ...shared } };
}

async function send() {
  if (!available()) return;
  const { statsConsent, statsClientId, statsDays } = await chrome.storage.local.get(KEYS);
  if (statsConsent !== true || !statsClientId) return;
  const days = plain(statsDays);
  const today = dayOf(now());
  for (const day of Object.keys(days).sort()) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day >= today) continue;
    if (now() - noonOf(day) > MAX_AGE) await settle(day, [], true);
    else if (!(await sendDay(statsClientId, day, plain(days[day])))) return;
  }
}

// Takes what was sent off the stored day, key by key, so a failure later in the same day never sends it
// twice. It subtracts rather than deletes, so a count that landed while the request was in flight stays.
// A day with nothing valid left (or one that is too old) is dropped, so stored rubbish can't keep it.
function settle(day, sent, drop = false) {
  return serial(async () => {
    const { statsDays } = await chrome.storage.local.get("statsDays");
    const days = plain(statsDays);
    if (!Object.hasOwn(days, day)) return;
    const counts = { ...plain(days[day]) };
    for (const [key, n] of sent) {
      counts[key] -= n;
      if (!(counts[key] > 0)) delete counts[key];
    }
    const alive = !drop && Object.entries(counts).some(([k, n]) => toEvent(k, n, {}));
    const { [day]: _gone, ...rest } = days;
    await chrome.storage.local.set({ statsDays: alive ? { ...rest, [day]: counts } : rest });
  });
}

async function sendDay(clientId, day, counts) {
  const { agentSync } = await chrome.storage.local.get("agentSync");
  const shared = { version: chrome.runtime.getManifest().version, install: codeOf(clientId), agent_sync: plain(agentSync).on === true ? "on" : "off", session_id: Number(day.replace(/-/g, "")), engagement_time_msec: 1 };
  const pairs = []; // [stored key, event]
  for (const [key, n] of Object.entries(counts)) {
    const event = toEvent(key, n, shared);
    if (event) pairs.push([key, event]);
  }
  if (!pairs.length) { await settle(day, []); return true; }
  const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    // Asked again before every request: a "no" given meanwhile stops the rest.
    const { statsConsent, statsClientId } = await chrome.storage.local.get(["statsConsent", "statsClientId"]);
    if (statsConsent !== true || statsClientId !== clientId) return false;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ client_id: clientId, timestamp_micros: noonOf(day) * 1000, events: batch.map(([, e]) => e) }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return false;
    }
    if (!res.ok) return false;
    await settle(day, batch.map(([key, e]) => [key, e.params.count]));
  }
  return true;
}

// Called once from the worker's top level, on every wake: listens for the alarm, puts it back for an
// install that said yes and has none (Chrome may drop alarms on update), and sends anything due.
export function startStats() {
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === STATS_ALARM) return sendDue(); });
  (async () => {
    const { statsConsent } = await chrome.storage.local.get("statsConsent");
    if (statsConsent !== true) return;
    // Only when it's missing: creating it again would restart the 3-hour wait on every wake.
    if (!(await chrome.alarms.get(STATS_ALARM))) chrome.alarms.create(STATS_ALARM, { delayInMinutes: 1, periodInMinutes: 180 });
    await sendDue();
  })().catch(() => {});
}
