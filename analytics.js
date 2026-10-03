// Usage stats, opt-in. Off until the user says yes, in the popup's one question or under Usage stats in
// settings. Before that, nothing here counts, stores or sends anything.
//
// What is sent: once a day, for each finished day Sieve was used, how many posts were scored, saved,
// briefed, copied as a prompt, watched, put in a digest and exported, per platform, with the extension
// version, which scorer answered (Jev or the fallback model), and a random install ID made in this
// browser. Never post text, links, names, titles, facts, keys or anything typed.
// Where: Google Analytics 4, through its Measurement Protocol: one plain POST from this worker. No Google
// script is loaded, and no permission is needed (a text/plain POST is a simple request).
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
export function count(name, detail = {}) {
  if (!available() || !EVENTS[name]) return Promise.resolve();
  const key = [name, ...EVENTS[name].map((p) => (VALUES[p].includes(detail[p]) ? detail[p] : "other"))].join("|");
  const day = dayOf(now());
  return serial(async () => {
    const { statsConsent, statsDays = {} } = await chrome.storage.local.get(["statsConsent", "statsDays"]);
    if (statsConsent !== true) return;
    const counts = { ...statsDays[day] };
    counts[key] = (counts[key] || 0) + 1;
    await chrome.storage.local.set({ statsDays: { ...statsDays, [day]: counts } });
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

// Sends every finished day, oldest first, and removes each one only once GA has taken all of it. A day
// too old for GA is dropped unsent. On any failure it stops; the next alarm tries again.
let sending = null;
export function sendDue() {
  sending ||= send().catch(() => {}).finally(() => { sending = null; });
  return sending;
}

async function send() {
  if (!available()) return;
  const { statsConsent, statsClientId, statsDays = {} } = await chrome.storage.local.get(KEYS);
  if (statsConsent !== true || !statsClientId) return;
  const today = dayOf(now());
  for (const day of Object.keys(statsDays).sort()) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day >= today) continue;
    if (now() - noonOf(day) <= MAX_AGE && !(await sendDay(statsClientId, day, statsDays[day]))) return;
    await serial(async () => {
      const { statsDays: latest } = await chrome.storage.local.get("statsDays");
      if (!latest?.[day]) return;
      const { [day]: _gone, ...rest } = latest;
      await chrome.storage.local.set({ statsDays: rest });
    });
  }
}

async function sendDay(clientId, day, counts) {
  const shared = { version: chrome.runtime.getManifest().version, install: codeOf(clientId), session_id: Number(day.replace(/-/g, "")), engagement_time_msec: 1 };
  const events = [];
  for (const [key, n] of Object.entries(counts || {})) {
    const [name, ...values] = key.split("|");
    const params = EVENTS[name];
    if (!params || values.length !== params.length || !Number.isInteger(n) || n < 1) continue;
    const breakdown = Object.fromEntries(params.map((p, i) => [p, VALUES[p].includes(values[i]) ? values[i] : "other"]));
    events.push({ name, params: { ...breakdown, count: n, ...shared } });
  }
  const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`;
  for (let i = 0; i < events.length; i += BATCH) {
    // Asked again before every request: a "no" given meanwhile stops the rest.
    const { statsConsent, statsClientId } = await chrome.storage.local.get(["statsConsent", "statsClientId"]);
    if (statsConsent !== true || statsClientId !== clientId) return false;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ client_id: clientId, timestamp_micros: noonOf(day) * 1000, events: events.slice(i, i + BATCH) }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return false;
    }
    if (!res.ok) return false;
  }
  return true;
}

// Called once from the worker's top level, on every wake: listens for the alarm, puts it back for an
// install that said yes (Chrome may drop alarms on update), and sends anything due.
export function startStats() {
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === STATS_ALARM) return sendDue(); });
  (async () => {
    const { statsConsent } = await chrome.storage.local.get("statsConsent");
    if (statsConsent !== true) return;
    chrome.alarms.create(STATS_ALARM, { delayInMinutes: 1, periodInMinutes: 180 });
    await sendDue();
  })().catch(() => {});
}
