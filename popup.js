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
  $("drafts").textContent = stats.drafts || 0;
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
$("reset").onclick = async () => { await chrome.storage.local.remove("stats"); load(); };
load();
