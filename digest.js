const $ = (id) => document.getElementById(id);

function renderDigest(d) {
  const box = document.createElement("div");
  box.className = "digest";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${new Date(d.at).toLocaleString()} · ${d.count} posts · $${(d.cost || 0).toFixed(5)}`;
  box.append(meta);
  let ul = null;
  for (const raw of d.text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const h = document.createElement("h3");
      h.textContent = line.replace(/^#+\s*/, "");
      box.append(h);
      ul = null;
    } else {
      if (!ul) { ul = document.createElement("ul"); box.append(ul); }
      const li = document.createElement("li");
      li.textContent = line.replace(/^[-*•]\s*/, "").replace(/\*\*/g, "");
      ul.append(li);
    }
  }
  return box;
}

function redditList(saved) {
  // Deterministic, no LLM: Reddit questions you could still answer, freshest first.
  const now = Date.now();
  const open = saved
    .filter((p) => p.platform === "reddit" && p.createdAt && now - p.createdAt < 24 * 36e5)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!open.length) return [];
  const box = document.createElement("div");
  box.className = "rlist";
  const h = document.createElement("h3");
  h.textContent = "Reddit threads you could answer (last 24 hours)";
  box.append(h);
  for (const p of open) {
    const div = document.createElement("div");
    div.className = "post";
    const a = document.createElement("a");
    a.href = p.authorUrl; a.target = "_blank"; a.rel = "noopener";
    a.textContent = p.title || p.text.split("\n")[0];
    const hours = Math.round((now - p.createdAt) / 36e5);
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${p.authorName} · ${hours < 1 ? "under 1h" : hours + "h"} old · ${p.comments} comments when seen · ${hours <= 12 ? "still fresh" : "getting late"}`;
    div.append(a, m);
    box.append(div);
  }
  return [box];
}

function videoList(watched) {
  // Every video Sieve watched for you in the last 7 days, with its learnings.
  const recent = Object.values(watched).filter((w) => Date.now() - w.at < 7 * 864e5).sort((a, b) => b.at - a.at);
  if (!recent.length) return [];
  const box = document.createElement("div");
  box.className = "rlist";
  const h = document.createElement("h3");
  h.textContent = "Videos watched for you (last 7 days)";
  box.append(h);
  for (const w of recent) {
    const div = document.createElement("div");
    div.className = "post";
    const a = document.createElement("a");
    a.href = w.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = w.title;
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${w.channel} · ${{ watch: "worth watching", skim: "skim it", skip: "skip it" }[w.verdict]} · ${new Date(w.at).toLocaleDateString()}`;
    const t = document.createElement("div");
    t.className = "t";
    t.style.maxHeight = "none";
    t.textContent = w.learnings.map((l) => "• " + l).join("\n") || w.summary;
    div.append(a, m, t);
    box.append(div);
  }
  return [box];
}

async function load() {
  const { digests = [], saved = [], watched = {} } = await chrome.storage.local.get(["digests", "saved", "watched"]);
  $("reddit").replaceChildren(...redditList(saved));
  $("videos").replaceChildren(...videoList(watched));
  $("digests").replaceChildren(...digests.map(renderDigest));
  if (!digests.length) $("digests").textContent = "No digests yet.";
  $("savedSum").textContent = `Saved posts (${saved.length}, kept 30 days)`;
  $("saved").replaceChildren(...saved.map((p) => {
    const div = document.createElement("div");
    div.className = "post";
    const a = document.createElement(p.authorUrl ? "a" : "span");
    if (p.authorUrl) { a.href = p.authorUrl; a.target = "_blank"; a.rel = "noopener"; }
    a.textContent = (p.platform === "reddit" ? "Reddit · " : "") + (p.authorName || "Unknown author");
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${new Date(p.savedAt).toLocaleString()} · ${p.kind} · ${p.topic} · Jev ${p.worth.toFixed(2)}`;
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = p.text;
    div.append(a, m, t);
    return div;
  }));
}

async function run(since) {
  $("msg").textContent = "Summarising…";
  const d = await chrome.runtime.sendMessage({ type: "digest", since });
  $("msg").textContent = d.error || "";
  load();
}

$("today").onclick = async () => {
  const { lastDigestAt = 0 } = await chrome.storage.local.get("lastDigestAt");
  run(lastDigestAt || Date.now() - 864e5);
};
$("day").onclick = () => run(Date.now() - 864e5);
$("week").onclick = () => run(Date.now() - 7 * 864e5);
load();
