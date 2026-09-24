import { DEFAULT_MODEL, DEFAULT_ABOUT, DEFAULT_REDDIT_ABOUT } from "./draft.js";
import { DEFAULT_PREFS, KINDS, REDDIT_KINDS, YOUTUBE_KINDS, loadPrefs } from "./prefs.js";
import { DEFAULT_VIDEO_MODEL } from "./watch-prompt.js";

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
  const s = await chrome.storage.local.get(["apiKey", "orKey", "useJev", "model", "about", "redditAbout", "reminderOn", "reminderTime", "videoModel"]);
  $("key").placeholder = s.apiKey ? "Key saved. Paste a new one to replace it." : "Paste your TypeSafe key";
  $("orkey").placeholder = s.orKey ? "Key saved. Paste a new one to replace it." : "Paste your OpenRouter key";
  // Unset for everyone who installed before the switch: a saved TypeSafe key means they already score
  // with Jev, and an update doesn't move them off it (background.js scorer() reads it the same way).
  showJev(s.useJev ?? Boolean(s.apiKey), Boolean(s.apiKey));
  $("role").value = p.role;
  $("topics").value = p.topics.join("\n");
  $("linkedinOn").checked = p.linkedinOn;
  $("xOn").checked = p.xOn;
  $("redditOn").checked = p.redditOn;
  checks("kinds", KINDS, p.kinds);
  checks("redditKinds", REDDIT_KINDS, p.redditKinds);
  checks("youtubeKinds", YOUTUBE_KINDS, p.youtubeKinds);
  $("youtubeOn").checked = p.youtubeOn;
  $("videoModel").value = s.videoModel || DEFAULT_VIDEO_MODEL;
  $("subreddits").value = p.subreddits.join("\n");
  $("freshHours").value = p.freshHours;
  $("freshComments").value = p.freshComments;
  $("boostWords").value = p.boostWords.join("\n");
  $("muteWords").value = p.muteWords.join("\n");
  for (const id of ["highAt", "lowBelow"]) { $(id).value = p[id]; $(`${id}Out`).textContent = Number(p[id]).toFixed(2); }
  document.querySelector(`input[name=lowMode][value=${p.lowMode}]`).checked = true;
  $("model").value = s.model || DEFAULT_MODEL;
  $("about").value = s.about || DEFAULT_ABOUT;
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
    about: $("about").value.trim() || DEFAULT_ABOUT,
    redditAbout: $("redditAbout").value.trim() || DEFAULT_REDDIT_ABOUT,
    reminderOn: $("remind").checked,
    reminderTime: $("rtime").value || "18:00",
  });
  $("saveMsg").textContent = "Saved. Open tabs re-score what's on screen.";
  load();
};

// The switch shows the TypeSafe field, and says what happens with the switch on and no key yet.
function showJev(on, hasKey) {
  $("useJev").checked = on;
  $("jevKey").hidden = !on;
  $("jevNote").textContent = on && !hasKey ? "Until a TypeSafe key is saved, your OpenRouter key keeps scoring." : "";
}
$("useJev").onchange = async () => {
  const on = $("useJev").checked;
  await chrome.storage.local.set({ useJev: on });
  const { apiKey } = await chrome.storage.local.get("apiKey");
  showJev(on, Boolean(apiKey));
  $("keyMsg").textContent = on ? (apiKey ? "Jev scores your posts." : "") : "Your OpenRouter key scores your posts. A saved TypeSafe key is kept, unused.";
};

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
