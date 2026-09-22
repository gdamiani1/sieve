import { DEFAULT_MODEL, DEFAULT_ABOUT, DEFAULT_REDDIT_ABOUT } from "./draft.js";
const $ = (id) => document.getElementById(id);

async function load() {
  const { apiKey, dimLow, stats = {}, orKey, model, about, reminderOn, reminderTime, redditAbout } = await chrome.storage.local.get(["apiKey", "dimLow", "stats", "orKey", "model", "about", "reminderOn", "reminderTime", "redditAbout"]);
  $("redditAbout").value = redditAbout || DEFAULT_REDDIT_ABOUT;
  $("remind").checked = reminderOn !== false;
  $("rtime").value = reminderTime || "18:00";
  $("orkey").placeholder = orKey ? "Key saved. Paste a new one to replace it." : "Stored only in this browser profile";
  $("model").value = model || DEFAULT_MODEL;
  $("about").value = about || DEFAULT_ABOUT;
  $("drafts").textContent = stats.drafts || 0;
  $("dcost").textContent = `$${(stats.draftCost || 0).toFixed(4)}`;
  $("key").placeholder = apiKey ? "Key saved. Paste a new one to replace it." : "Stored only in this browser profile";
  $("dim").checked = dimLow !== false;
  $("posts").textContent = stats.posts || 0;
  $("strong").textContent = stats.strong || 0;
  $("maybe").textContent = stats.maybe || 0;
  $("tokens").textContent = (stats.tokens || 0).toLocaleString();
  $("cost").textContent = `$${(stats.cost || 0).toFixed(4)}`;
}

$("save").onclick = async () => {
  const key = $("key").value.trim();
  if (!key) return;
  const res = await fetch("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
  if (!res || !res.ok) { $("msg").textContent = res ? `TypeSafe said ${res.status}. Key not saved.` : "Network error. Key not saved."; return; }
  await chrome.storage.local.set({ apiKey: key });
  $("key").value = "";
  $("msg").textContent = "Key checked and saved. Reload your LinkedIn feed.";
  load();
};
$("saveDraft").onclick = async () => {
  const set = { model: $("model").value.trim() || DEFAULT_MODEL, about: $("about").value.trim() || DEFAULT_ABOUT, redditAbout: $("redditAbout").value.trim() || DEFAULT_REDDIT_ABOUT };
  const key = $("orkey").value.trim();
  if (key) {
    const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
    if (!res || !res.ok) { $("msg2").textContent = res ? `OpenRouter said ${res.status}. Nothing saved.` : "Network error. Nothing saved."; return; }
    set.orKey = key;
    $("orkey").value = "";
  }
  await chrome.storage.local.set(set);
  $("msg2").textContent = key ? "Key checked. Draft settings saved." : "Draft settings saved.";
  load();
};
$("openDigest").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("digest.html") });
$("remind").onchange = () => chrome.storage.local.set({ reminderOn: $("remind").checked });
$("rtime").onchange = () => chrome.storage.local.set({ reminderTime: $("rtime").value || "18:00" });
$("dim").onchange = () => chrome.storage.local.set({ dimLow: $("dim").checked });
$("reset").onclick = async () => { await chrome.storage.local.remove("stats"); load(); };
load();
