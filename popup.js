import { loadPrefs } from "./prefs.js";
const $ = (id) => document.getElementById(id);

async function load() {
  const p = await loadPrefs();
  const { stats = {} } = await chrome.storage.local.get("stats");
  $("linkedinOn").checked = p.linkedinOn;
  $("xOn").checked = p.xOn;
  $("redditOn").checked = p.redditOn;
  $("youtubeOn").checked = p.youtubeOn;
  $("watched").textContent = stats.watched || 0;
  $("posts").textContent = stats.posts || 0;
  $("strong").textContent = stats.strong || 0;
  $("maybe").textContent = stats.maybe || 0;
  $("briefs").textContent = stats.briefs || 0;
  $("cost").textContent = `$${((stats.cost || 0) + (stats.scoreCost || 0) + (stats.draftCost || 0)).toFixed(4)}`;
}
for (const id of ["linkedinOn", "xOn", "redditOn", "youtubeOn"]) {
  $(id).onchange = async () => {
    const { prefs = {} } = await chrome.storage.local.get("prefs");
    await chrome.storage.local.set({ prefs: { ...prefs, [id]: $(id).checked } });
  };
}
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("digest").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("digest.html") });
$("reset").onclick = async () => {
  if (!confirm("Reset the counters? This can't be undone.")) return;
  await chrome.storage.local.remove("stats");
  await load();
};
// The one usage-stats question: shown until it's answered, only in a build that can send (analytics.js).
async function ask() {
  const s = await chrome.runtime.sendMessage({ type: "stats", action: "status" }).catch(() => null);
  $("ask").hidden = !(s && s.available && s.consent === null);
}
const answer = (on) => async () => {
  $("askYes").disabled = $("askNo").disabled = true;
  $("askErr").textContent = "";
  const r = await chrome.runtime.sendMessage({ type: "stats", action: "consent", on }).catch(() => null);
  if (r && !r.error) {
    $("ask").hidden = true;
    $("askThanks").textContent = "Thanks. You can change this in Settings.";
    return;
  }
  $("askErr").textContent = (r && r.error) || "Sieve couldn't change usage stats. Reload the extension and try again.";
  $("askYes").disabled = $("askNo").disabled = false;
};
$("askYes").onclick = answer(true);
$("askNo").onclick = answer(false);
ask();
load();

// Your agent: one line, only while sending to the agent is on (the same status the settings page reads).
const sentAt = (ms) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
};
async function agent() {
  const r = await chrome.runtime.sendMessage({ type: "agentSync", do: "status" }).catch(() => null);
  // Once the invite ended the agent no longer reads this library: nothing to say.
  const shows = !!(r && !r.error && r.on && r.state !== "ended");
  $("agent").hidden = !shows;
  if (!shows) return;
  if (!r.lastAt) { $("agent").textContent = "Your agent is on. Nothing sent yet."; return; }
  const n = Number.isFinite(r.lastItems) ? r.lastItems : 0;
  $("agent").textContent = `Your agent reads ${n} ${n === 1 ? "pin" : "pins"} from Chrome, sent ${sentAt(r.lastAt)}.`;
}
agent();
