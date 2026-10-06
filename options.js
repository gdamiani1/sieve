import { DEFAULT_MODEL } from "./models.js";
import { DEFAULT_PREFS, KINDS, REDDIT_KINDS, YOUTUBE_KINDS, loadPrefs, DEFAULT_REDDIT_ABOUT } from "./prefs.js";
import { DEFAULT_VIDEO_MODEL } from "./watch-prompt.js";
import { scoringKey } from "./jev.js";
import { AGENTS, SERVER, words } from "./agent-sync.js";

// The settings page (extension settings pinboard spec): every setting saves as it changes, a toast says
// so; keys save only through Check and save keys; Your agent asks the worker.

const $ = (id) => document.getElementById(id);
const lines = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
const kids = (id) => [...$(id).children];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- The toast: "Saved", or why a save failed. One at a time, bottom centre.
let toastTimer = 0;
function toast(text, ms = 1500) {
  const t = $("toast");
  t.hidden = false;
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; t.textContent = ""; }, ms);
}

// Saves run one after another, so an Enter and the change that follows it never race. `fn` resolves to
// whether it wrote anything; nothing written, nothing said.
let queue = Promise.resolve();
function save(fn) {
  queue = queue.then(fn).then(
    (wrote) => { if (wrote) toast("Saved"); },
    (e) => toast(`Couldn't save: ${e?.message || e}. Try again.`, 4000),
  );
  return queue;
}

// ---- Chips: the kinds lists (several chosen) and Low posts (one chosen).
const LOW_MODES = { fade: "Fade them", hide: "Hide them", show: "Leave them alone" };
const pressed = (b) => b.getAttribute("aria-pressed") === "true";

function chips(container, names, values) {
  $(container).replaceChildren(...Object.entries(names).map(([key, text]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.key = key; b.textContent = text;
    b.setAttribute("aria-pressed", String(values[key] !== false));
    b.onclick = () => { b.setAttribute("aria-pressed", String(!pressed(b))); savePrefs(container); };
    return b;
  }));
}
const readChips = (container) => Object.fromEntries(kids(container).map((b) => [b.dataset.key, pressed(b)]));

function lowModeChips(mode) {
  $("lowMode").replaceChildren(...Object.entries(LOW_MODES).map(([value, text]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.value = value; b.textContent = text;
    b.setAttribute("aria-pressed", String(value === mode));
    b.onclick = () => {
      for (const c of kids("lowMode")) c.setAttribute("aria-pressed", String(c === b));
      savePrefs("lowMode");
    };
    return b;
  }));
}

// ---- Prefs: each control reads its own part, with saveAll's rules (defaults when empty, topics capped
// at 8, lowBelow kept under highAt). A save merges it into the stored prefs, so a change the popup made
// meanwhile is kept.
function scores() {
  const highAt = Number($("highAt").value);
  let lowBelow = Number($("lowBelow").value);
  if (lowBelow >= highAt) lowBelow = Math.max(0.1, highAt - 0.1);
  return { highAt, lowBelow };
}
const checked = (id) => () => ({ [id]: $(id).checked });
const listOf = (id) => () => ({ [id]: lines(id) });
const PREFS = {
  role: () => ({ role: $("role").value.trim() || DEFAULT_PREFS.role }),
  topics: () => ({ topics: lines("topics").slice(0, 8) }),
  kinds: () => ({ kinds: readChips("kinds") }),
  redditKinds: () => ({ redditKinds: readChips("redditKinds") }),
  youtubeKinds: () => ({ youtubeKinds: readChips("youtubeKinds") }),
  linkedinOn: checked("linkedinOn"), xOn: checked("xOn"), redditOn: checked("redditOn"),
  youtubeOn: checked("youtubeOn"), youtubeDescriptions: checked("youtubeDescriptions"),
  subreddits: listOf("subreddits"), boostWords: listOf("boostWords"), muteWords: listOf("muteWords"),
  freshHours: () => ({ freshHours: Number($("freshHours").value) || DEFAULT_PREFS.freshHours }),
  freshComments: () => ({ freshComments: Number($("freshComments").value) || DEFAULT_PREFS.freshComments }),
  highAt: scores, lowBelow: scores,
  lowMode: () => ({ lowMode: kids("lowMode").find(pressed)?.dataset.value || DEFAULT_PREFS.lowMode }),
};

// What a field shows of the saved prefs (only the fields whose text a save can change).
const showRange = (id, v) => { $(id).value = v; $(`${id}Out`).textContent = Number(v).toFixed(2); };
const SHOW_PREFS = {
  role: (p) => { $("role").value = p.role; },
  topics: (p) => { $("topics").value = p.topics.join("\n"); },
  subreddits: (p) => { $("subreddits").value = p.subreddits.join("\n"); },
  boostWords: (p) => { $("boostWords").value = p.boostWords.join("\n"); },
  muteWords: (p) => { $("muteWords").value = p.muteWords.join("\n"); },
  freshHours: (p) => { $("freshHours").value = p.freshHours; },
  freshComments: (p) => { $("freshComments").value = p.freshComments; },
  highAt: (p) => { showRange("highAt", p.highAt); showRange("lowBelow", p.lowBelow); },
};
SHOW_PREFS.lowBelow = SHOW_PREFS.highAt;

function savePrefs(id) {
  const change = PREFS[id]();
  return save(async () => {
    const p = await loadPrefs();
    const next = { ...p, ...change };
    const wrote = !Object.keys(change).every((k) => same(p[k], next[k]));
    if (wrote) await chrome.storage.local.set({ prefs: next });
    SHOW_PREFS[id]?.(await loadPrefs());
    return wrote;
  });
}

// The settings kept beside prefs, each under its own key.
const OTHER = {
  model: { key: "model", read: () => $("model").value.trim() || DEFAULT_MODEL },
  videoModel: { key: "videoModel", read: () => $("videoModel").value.trim() || DEFAULT_VIDEO_MODEL },
  redditAbout: { key: "redditAbout", read: () => $("redditAbout").value.trim() || DEFAULT_REDDIT_ABOUT },
  remind: { key: "reminderOn", read: () => $("remind").checked, show: false },
  rtime: { key: "reminderTime", read: () => $("rtime").value || "18:00" },
};
function saveOther(id) {
  const { key, read, show } = OTHER[id];
  const value = read();
  return save(async () => {
    const s = await chrome.storage.local.get(key);
    const wrote = !same(s[key], value);
    if (wrote) await chrome.storage.local.set({ [key]: value });
    if (show !== false) $(id).value = value;
    return wrote;
  });
}

// Text saves when it loses focus (change), and on Enter in a single-line field; switches, ranges and
// the time save at once (change); a range's number follows as it moves.
const enter = (id, fn) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } });
for (const id of Object.keys(PREFS)) {
  if (["kinds", "redditKinds", "youtubeKinds", "lowMode"].includes(id)) continue;
  $(id).addEventListener("change", () => savePrefs(id));
}
for (const id of ["role", "freshHours", "freshComments"]) enter(id, () => savePrefs(id));
for (const id of Object.keys(OTHER)) $(id).addEventListener("change", () => saveOther(id));
for (const id of ["model", "videoModel"]) enter(id, () => saveOther(id));
for (const id of ["highAt", "lowBelow"]) $(id).addEventListener("input", () => { $(`${id}Out`).textContent = Number($(id).value).toFixed(2); });
$("remind").addEventListener("change", () => { $("rtime").disabled = !$("remind").checked; });

async function load() {
  const p = await loadPrefs();
  const s = await chrome.storage.local.get(["apiKey", "orKey", "model", "redditAbout", "reminderOn", "reminderTime", "videoModel"]);
  showKeys(s);
  $("role").value = p.role;
  $("topics").value = p.topics.join("\n");
  $("linkedinOn").checked = p.linkedinOn;
  $("xOn").checked = p.xOn;
  $("redditOn").checked = p.redditOn;
  chips("kinds", KINDS, p.kinds);
  chips("redditKinds", REDDIT_KINDS, p.redditKinds);
  chips("youtubeKinds", YOUTUBE_KINDS, p.youtubeKinds);
  $("youtubeOn").checked = p.youtubeOn;
  $("youtubeDescriptions").checked = p.youtubeDescriptions;
  $("videoModel").value = s.videoModel || DEFAULT_VIDEO_MODEL;
  $("subreddits").value = p.subreddits.join("\n");
  $("freshHours").value = p.freshHours;
  $("freshComments").value = p.freshComments;
  $("boostWords").value = p.boostWords.join("\n");
  $("muteWords").value = p.muteWords.join("\n");
  showRange("highAt", p.highAt);
  showRange("lowBelow", p.lowBelow);
  lowModeChips(p.lowMode);
  $("model").value = s.model || DEFAULT_MODEL;
  $("redditAbout").value = s.redditAbout || DEFAULT_REDDIT_ABOUT;
  $("remind").checked = s.reminderOn !== false;
  $("rtime").value = s.reminderTime || "18:00";
  $("rtime").disabled = !$("remind").checked;
}

// ---- Keys: checked before they're saved, only by Check and save keys.
// Says which key scores (jev.js scoringKey() decides, as the worker does).
function showKeys(s) {
  $("key").placeholder = s.apiKey ? "Key saved. Paste a new one to replace it." : "Not added";
  $("orkey").placeholder = s.orKey ? "Key saved. Paste a new one to replace it." : "Paste your OpenRouter key";
  $("start").hidden = Boolean(s.orKey || s.apiKey);
  const via = scoringKey(s)?.via;
  $("scoreStatus").textContent = via === "openrouter"
    ? `Jev, through OpenRouter${s.apiKey ? ". The saved TypeSafe key isn't used." : ""}`
    : via === "typesafe" ? "Jev, with your TypeSafe key" : "Nothing scores your posts until an OpenRouter key is saved.";
  $("scoreStatus").classList.toggle("bad", !via);
}
const readKeys = () => chrome.storage.local.get(["apiKey", "orKey"]).then(showKeys);

$("saveKeys").onclick = async () => {
  const msgs = [];
  let bad = false;
  const ts = $("key").value.trim(), or = $("orkey").value.trim();
  if (ts) {
    const r = await fetch("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${ts}` } }).catch(() => null);
    if (r && r.ok) { await chrome.storage.local.set({ apiKey: ts }); $("key").value = ""; msgs.push("TypeSafe key saved"); }
    else { bad = true; msgs.push(r ? `TypeSafe said ${r.status}, not saved` : "TypeSafe unreachable, not saved"); }
  }
  if (or) {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${or}` } }).catch(() => null);
    if (r && r.ok) { await chrome.storage.local.set({ orKey: or }); $("orkey").value = ""; msgs.push("OpenRouter key saved"); }
    else { bad = true; msgs.push(r ? `OpenRouter said ${r.status}, not saved` : "OpenRouter unreachable, not saved"); }
  }
  $("keyMsg").textContent = msgs.join(". ") || "Paste a key first.";
  $("keyMsg").classList.toggle("bad", bad);
  $("keyMsg").classList.toggle("good", msgs.length > 0 && !bad);
  readKeys();
};

load();
$("version").textContent = chrome.runtime.getManifest?.()?.version || "";

// ---- Usage stats (analytics.js): shown only in a build that can send. The switch acts at once.
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
$("statsOn").addEventListener("change", async () => {
  const r = await chrome.runtime.sendMessage({ type: "stats", action: "consent", on: $("statsOn").checked }).catch(() => null);
  if (r && !r.error) {
    $("statsMsg").textContent = "";
    showStats(r);
    toast("Saved");
  } else {
    $("statsMsg").textContent = (r && r.error) || "Sieve couldn't change usage stats. Reload the extension and try again.";
    readStats();
  }
});

// ---- Your agent (extension library sync spec 5.4, settings pinboard spec 4): the worker signs in and
// sends (agent-sync-run.js); this page only asks it, shows the stored record and asks for the optional
// permissions.
const OPTIONAL = { permissions: ["identity"], origins: [`${SERVER}/*`] };
const agent = (msg) => chrome.runtime.sendMessage({ type: "agentSync", ...msg });
// A line for an outcome the record has no words for (a refused permission, the worker's error). Cleared
// when the next action starts; a status read keeps it.
let note = "";
// The account's sign-in method, for the agents' meta lines.
let method;

// What the status line says about a failed account delete, or "" when there's none to tell.
function deleteFailure(r, state) {
  const reason = r.detail?.reason;
  // Signed out by the server while deleting: the account is still there.
  if (!r.on && state === "signed_out" && reason === "server") return "Couldn't delete your account: this Chrome was signed out. Turn on again, then delete.";
  // Still on with a reason: the delete didn't reach the server, or it said no. ("invalid" carries the
  // server's reason for refusing a library instead.)
  if (!r.on || state === "invalid") return "";
  if (reason === "offline") return "Couldn't delete your account. Check your connection and try again.";
  if (reason === "server") return "Sieve's server couldn't delete your account. Try again in a minute.";
  return "";
}

// The section's buttons, and Delete at the bottom of the page.
const agentButtons = () => [...$("agentSection").querySelectorAll("button"), $("agentDelete")];
// Shown: neither the element nor anything it is in is hidden.
const shown = (el) => {
  for (let e = el; e; e = e.parentNode) if (e.hidden) return false;
  return true;
};

const whole = (n) => (Number.isFinite(n) ? n : 0);
function sentAt(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}
function reads(r) {
  if (!r.lastAt) return "Not sent yet";
  const n = whole(r.lastItems);
  return `${n} ${n === 1 ? "pin" : "pins"} from Chrome, sent ${sentAt(r.lastAt)}`;
}

// The failure note's one button forward, by state; none for limit, older, too_big and invalid.
const FIX = { other_device: "agentReplace", shrunk: "agentShrink", busy: "agentRetry", error: "agentRetry" };

function showAgent(r, had = null) {
  if (!r || r.error) { note = r?.error || "Sieve couldn't read the agent sync status. Reload the extension and try again."; $("agentMsg").textContent = note; return; }
  const on = !!r.on;
  // No record yet (a fresh install) is off; a record that is on but says off (it shouldn't) is on.
  const state = on ? (!r.state || r.state === "off" ? "on" : r.state) : r.state || "off";
  const line = words({ ...r, state });
  // Something unexpected while acting shows as its own failure, in any state but invalid.
  const kind = r.detail?.reason === "error" && state !== "invalid" ? "error" : state;
  const ended = on && state === "ended";
  const failing = on && kind !== "on" && !ended;

  $("sub").textContent = on && !ended ? "Your library goes to your agent when it changes." : "Sieve works in your browser with your own key.";
  $("agentOff").hidden = on;
  $("agentFootOff").hidden = on;
  $("agentLine").textContent = on ? "" : line;
  $("agentOnBox").hidden = !on;
  $("agentFootOn").hidden = !on;
  $("agentWho").textContent = r.email || "";
  $("agentReads").textContent = reads(r);
  // Once the invite ended the agent no longer reads this library: no Send now and nothing to set up.
  $("agentSend").hidden = ended;
  $("agentNote").hidden = !on || ended;
  $("agentFail").hidden = !failing;
  $("agentFailText").textContent = failing ? line : "";
  for (const id of ["agentReplace", "agentShrink", "agentRetry"]) $(id).hidden = !(failing && FIX[kind] === id);
  $("agentInfo").hidden = !ended;
  $("agentInfoText").textContent = ended ? line : "";
  $("agentDeleteBox").hidden = !on;
  method = r.method;
  showChoice();
  $("agentMsg").textContent = deleteFailure(r, state) || note;
  // Focus stays with the agent's buttons: a button the answer hid hands it to the first one still shown,
  // and one that was disabled during the request (Chrome drops focus from a disabled button) gets it back.
  const focused = had || document.activeElement;
  if (!agentButtons().includes(focused)) return;
  if (!shown(focused)) agentButtons().find(shown)?.focus();
  else if (document.activeElement !== focused) focused.focus();
}

// Connect your agent: the chips (one choice, remembered as agentChoice), the code to copy, the meta line.
let choice = AGENTS[0].id;
const chosen = () => AGENTS.find((a) => a.id === choice) || AGENTS[0];
function showChoice() {
  const a = chosen();
  for (const c of kids("agentChips")) {
    const on = c.dataset.id === a.id;
    c.setAttribute("aria-checked", String(on));
    c.tabIndex = on ? 0 : -1;
  }
  // Each word is kept whole, so a narrow window wraps the line between words, never inside "--scope".
  $("agentCode").replaceChildren(...a.code.split(" ").flatMap((w, i) => {
    const span = document.createElement("span");
    span.textContent = w;
    return i ? [" ", span] : [span];
  }));
  $("agentMeta").textContent = a.meta(method);
}
function choose(id, focus = false) {
  choice = id;
  showChoice();
  if (focus) kids("agentChips").find((c) => c.dataset.id === id)?.focus();
  chrome.storage.local.set({ agentChoice: id }).catch(() => {});
}
$("agentChips").replaceChildren(...AGENTS.map((a, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.dataset.id = a.id; b.textContent = a.name;
  b.setAttribute("role", "radio");
  b.onclick = () => choose(a.id);
  b.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    choose(AGENTS[(i + step + AGENTS.length) % AGENTS.length].id, true);
  });
  return b;
}));
showChoice();

let copiedTimer = 0;
$("agentCopy").onclick = () => navigator.clipboard.writeText(chosen().code).then(() => {
  $("agentCopy").textContent = "Copied";
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { $("agentCopy").textContent = "Copy"; }, 2000);
}, () => { $("agentMsg").textContent = "Sieve couldn't copy. Select the line and copy it."; });

const readAgent = () => agent({ do: "status" }).then(showAgent, () => showAgent({ on: false, state: "off" }));

// One request at a time from this page: every agent button is disabled until it answers, and the
// status line says what is happening.
let acting = false;
async function act(progress, fn) {
  if (acting) return;
  acting = true;
  note = "";
  $("agentMsg").textContent = progress;
  const buttons = agentButtons();
  const had = buttons.includes(document.activeElement) ? document.activeElement : null;
  for (const b of buttons) b.disabled = true;
  let r = null;
  try {
    r = await fn().catch(() => ({ error: "Sieve couldn't reach its background worker. Reload the extension and try again." }));
  } finally {
    for (const b of buttons) b.disabled = false;
    acting = false;
    if ($("agentMsg").textContent === progress) $("agentMsg").textContent = "";
  }
  // Drawn once the buttons are back, so focus can move to one that is enabled.
  if (r) showAgent(r, had);
  else had?.focus();
}

// The permission is asked first, from the click: Chrome only grants optional permissions during a
// user gesture, so nothing is awaited before chrome.permissions.request.
const turnOn = (provider) => act("Signing in…", async () => {
  const granted = await chrome.permissions.request(OPTIONAL).catch(() => false);
  if (!granted) {
    note = words({ state: "no_permission" });
    $("agentMsg").textContent = note;
    return null;
  }
  return agent({ do: "on", provider });
});
$("agentOn").onclick = () => turnOn("google");
$("agentEmail").onclick = () => turnOn("email");
$("agentSend").onclick = () => act("Sending…", () => agent({ do: "send" }));
$("agentRetry").onclick = () => act("Sending…", () => agent({ do: "send" }));
$("agentReplace").onclick = () => act("Sending…", () => agent({ do: "send", replace: true }));
$("agentShrink").onclick = () => act("Sending…", () => agent({ do: "send", allowShrink: true }));
$("agentOffBtn").onclick = () => act("Turning off…", () => agent({ do: "off" }));
$("agentDelete").onclick = () => {
  if (!confirm("This deletes your Sieve account and everything your agent reads, from iPhone too. Delete it?")) return;
  act("Deleting…", () => agent({ do: "delete" }));
};
chrome.storage.local.get("agentChoice").then(({ agentChoice }) => {
  if (AGENTS.some((a) => a.id === agentChoice)) { choice = agentChoice; showChoice(); }
}, () => {}).then(readAgent);
// A send by the alarm, or a change in another tab, shows when this page is looked at again.
window.onfocus = () => { if (!acting) readAgent(); };
