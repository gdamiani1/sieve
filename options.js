import { DEFAULT_MODEL } from "./models.js";
import { DEFAULT_PREFS, KINDS, REDDIT_KINDS, YOUTUBE_KINDS, loadPrefs, DEFAULT_REDDIT_ABOUT } from "./prefs.js";
import { DEFAULT_VIDEO_MODEL } from "./watch-prompt.js";
import { scoringKey } from "./jev.js";
import { AGENT_URL, CLAUDE_LINE, SERVER, words } from "./agent-sync.js";

const $ = (id) => document.getElementById(id);
const lines = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);

function checks(container, names, values) {
  $(container).replaceChildren(...Object.entries(names).map(([key, text]) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox"; box.dataset.key = key; box.checked = values[key] !== false;
    label.append(box, text);
    return label;
  }));
}
const readChecks = (container) => Object.fromEntries([...$(container).querySelectorAll("input")].map((b) => [b.dataset.key, b.checked]));

async function load() {
  const p = await loadPrefs();
  const s = await chrome.storage.local.get(["apiKey", "orKey", "model", "redditAbout", "reminderOn", "reminderTime", "videoModel"]);
  $("key").placeholder = s.apiKey ? "Key saved. Paste a new one to replace it." : "Paste your TypeSafe key";
  $("orkey").placeholder = s.orKey ? "Key saved. Paste a new one to replace it." : "Paste your OpenRouter key";
  $("start").hidden = Boolean(s.orKey || s.apiKey);
  showScorer(scoringKey(s)?.via, Boolean(s.apiKey));
  $("role").value = p.role;
  $("topics").value = p.topics.join("\n");
  $("linkedinOn").checked = p.linkedinOn;
  $("xOn").checked = p.xOn;
  $("redditOn").checked = p.redditOn;
  checks("kinds", KINDS, p.kinds);
  checks("redditKinds", REDDIT_KINDS, p.redditKinds);
  checks("youtubeKinds", YOUTUBE_KINDS, p.youtubeKinds);
  $("youtubeOn").checked = p.youtubeOn;
  $("youtubeDescriptions").checked = p.youtubeDescriptions;
  $("videoModel").value = s.videoModel || DEFAULT_VIDEO_MODEL;
  $("subreddits").value = p.subreddits.join("\n");
  $("freshHours").value = p.freshHours;
  $("freshComments").value = p.freshComments;
  $("boostWords").value = p.boostWords.join("\n");
  $("muteWords").value = p.muteWords.join("\n");
  for (const id of ["highAt", "lowBelow"]) { $(id).value = p[id]; $(`${id}Out`).textContent = Number(p[id]).toFixed(2); }
  document.querySelector(`input[name=lowMode][value=${p.lowMode}]`).checked = true;
  $("model").value = s.model || DEFAULT_MODEL;
  $("redditAbout").value = s.redditAbout || DEFAULT_REDDIT_ABOUT;
  $("remind").checked = s.reminderOn !== false;
  $("rtime").value = s.reminderTime || "18:00";
}

for (const id of ["highAt", "lowBelow"]) $(id).oninput = () => { $(`${id}Out`).textContent = Number($(id).value).toFixed(2); };

$("saveAll").onclick = async () => {
  let highAt = Number($("highAt").value), lowBelow = Number($("lowBelow").value);
  if (lowBelow >= highAt) lowBelow = Math.max(0.1, highAt - 0.1);
  const prefs = {
    role: $("role").value.trim() || DEFAULT_PREFS.role,
    topics: lines("topics").slice(0, 8),
    kinds: readChecks("kinds"),
    redditKinds: readChecks("redditKinds"),
    youtubeKinds: readChecks("youtubeKinds"),
    youtubeOn: $("youtubeOn").checked,
    youtubeDescriptions: $("youtubeDescriptions").checked,
    linkedinOn: $("linkedinOn").checked,
    xOn: $("xOn").checked,
    redditOn: $("redditOn").checked,
    subreddits: lines("subreddits"),
    freshHours: Number($("freshHours").value) || DEFAULT_PREFS.freshHours,
    freshComments: Number($("freshComments").value) || DEFAULT_PREFS.freshComments,
    boostWords: lines("boostWords"),
    muteWords: lines("muteWords"),
    highAt, lowBelow,
    lowMode: document.querySelector("input[name=lowMode]:checked").value,
  };
  await chrome.storage.local.set({
    prefs,
    model: $("model").value.trim() || DEFAULT_MODEL,
    videoModel: $("videoModel").value.trim() || DEFAULT_VIDEO_MODEL,
    redditAbout: $("redditAbout").value.trim() || DEFAULT_REDDIT_ABOUT,
    reminderOn: $("remind").checked,
    reminderTime: $("rtime").value || "18:00",
  });
  $("saveMsg").textContent = "Saved. Open tabs re-score what's on screen.";
  load();
};

// Says which key scores (jev.js scoringKey() decides, as the worker does). The TypeSafe field opens itself
// for someone who scores with it, and is never closed here, so it stays open for someone who opened it.
function showScorer(via, hasKey) {
  if (via === "typesafe") $("tsBox").open = true;
  $("scoreStatus").textContent = via === "openrouter"
    ? `Jev scores your posts through your OpenRouter key.${hasKey ? " The saved TypeSafe key isn't used." : ""}`
    : via === "typesafe" ? "Jev scores your posts with your TypeSafe key." : "Nothing scores your posts until an OpenRouter key is saved.";
}

$("saveKeys").onclick = async () => {
  const msgs = [];
  const ts = $("key").value.trim(), or = $("orkey").value.trim();
  if (ts) {
    const r = await fetch("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${ts}` } }).catch(() => null);
    if (r && r.ok) { await chrome.storage.local.set({ apiKey: ts }); $("key").value = ""; msgs.push("TypeSafe key saved"); }
    else msgs.push(r ? `TypeSafe said ${r.status}, not saved` : "TypeSafe unreachable, not saved");
  }
  if (or) {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${or}` } }).catch(() => null);
    if (r && r.ok) { await chrome.storage.local.set({ orKey: or }); $("orkey").value = ""; msgs.push("OpenRouter key saved"); }
    else msgs.push(r ? `OpenRouter said ${r.status}, not saved` : "OpenRouter unreachable, not saved");
  }
  $("keyMsg").textContent = msgs.join(". ") || "Paste a key first.";
  load();
};
load();

// Usage stats (analytics.js): shown only in a build that can send. The switch acts at once.
function showStats(s) {
  if (!s || !s.available) return;
  $("statsSection").hidden = false;
  $("statsOn").checked = s.consent === true;
  const p = $("statsCode");
  p.hidden = !s.installCode;
  p.replaceChildren();
  if (s.installCode) {
    const b = document.createElement("strong");
    b.textContent = s.installCode;
    p.append("Your install code: ", b, ". Tell me this code only if you want me to recognise your install.");
  }
}
const readStats = () => chrome.runtime.sendMessage({ type: "stats", action: "status" }).then(showStats, () => {});
readStats();
// The popup can answer the question while this tab is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.statsConsent) readStats();
});
$("statsOn").onchange = async () => {
  const r = await chrome.runtime.sendMessage({ type: "stats", action: "consent", on: $("statsOn").checked }).catch(() => null);
  if (r && !r.error) {
    $("statsMsg").textContent = "";
    showStats(r);
  } else {
    $("statsMsg").textContent = (r && r.error) || "Sieve couldn't change usage stats. Reload the extension and try again.";
    readStats();
  }
};

// Your agent (extension library sync spec 5.4): the worker signs in and sends (agent-sync-run.js); this
// page only asks it, shows the stored record in words() and asks for the optional permissions.
const OPTIONAL = { permissions: ["identity"], origins: [`${SERVER}/*`] };
const agent = (msg) => chrome.runtime.sendMessage({ type: "agentSync", ...msg });
// A line for an outcome words() has no line for (a refused permission, the worker's error). Cleared
// when the next action starts; a status read keeps it.
let note = "";

function showAgent(r) {
  if (!r || r.error) { note = r?.error || "Sieve couldn't read the agent sync status. Reload the extension and try again."; $("agentMsg").textContent = note; return; }
  const on = !!r.on;
  // No record yet (a fresh install) is off; a record that is on but says off (it shouldn't) is on.
  const state = on ? (!r.state || r.state === "off" ? "on" : r.state) : r.state || "off";
  $("agentLine").textContent = words({ ...r, state });
  $("agentOff").hidden = on;
  $("agentOnBox").hidden = !on;
  $("agentReplace").hidden = !(on && state === "other_device");
  $("agentShrink").hidden = !(on && state === "shrunk");
  // One filled button per section: when an answer button shows, Send now steps back.
  $("agentSend").classList.toggle("quiet", !$("agentReplace").hidden || !$("agentShrink").hidden);
  $("agentUrl").textContent = AGENT_URL;
  $("agentCmd").textContent = CLAUDE_LINE;
  // Still on with a reason: the account delete didn't reach the server or it said no.
  const deleteFailed = on && ["offline", "server"].includes(r.detail?.reason);
  $("agentMsg").textContent = deleteFailed ? "Couldn't delete your account. Check your connection and try again." : note;
}

const readAgent = () => agent({ do: "status" }).then(showAgent, () => showAgent({ on: false, state: "off" }));

// One request at a time from this page; the button that started it is disabled until it answers.
let acting = false;
async function act(btn, fn) {
  if (acting) return;
  acting = true;
  note = "";
  $("agentMsg").textContent = "";
  btn.disabled = true;
  try {
    const r = await fn().catch(() => ({ error: "Sieve couldn't reach its background worker. Reload the extension and try again." }));
    if (r) showAgent(r);
  } finally {
    btn.disabled = false;
    acting = false;
  }
}

// The permission is asked first, from the click: Chrome only grants optional permissions during a
// user gesture, so nothing is awaited before chrome.permissions.request.
const turnOn = (btn, provider) => act(btn, async () => {
  const granted = await chrome.permissions.request(OPTIONAL).catch(() => false);
  if (!granted) {
    note = words({ state: "no_permission" });
    $("agentMsg").textContent = note;
    return null;
  }
  return agent({ do: "on", provider });
});
$("agentOn").onclick = () => turnOn($("agentOn"), "google");
$("agentEmail").onclick = (e) => { e.preventDefault(); turnOn($("agentEmail"), "email"); };
$("agentSend").onclick = () => act($("agentSend"), () => agent({ do: "send" }));
$("agentReplace").onclick = () => act($("agentReplace"), () => agent({ do: "send", replace: true }));
$("agentShrink").onclick = () => act($("agentShrink"), () => agent({ do: "send", allowShrink: true }));
$("agentOffBtn").onclick = () => act($("agentOffBtn"), () => agent({ do: "off" }));
$("agentDelete").onclick = () => {
  if (!confirm("This deletes your Sieve account and everything your agent reads, from iPhone too. Delete it?")) return;
  act($("agentDelete"), () => agent({ do: "delete" }));
};
readAgent();
// A send by the alarm, or a change in another tab, shows when this page is looked at again.
window.onfocus = () => { if (!acting) readAgent(); };
