import { briefPrompt, platformName, cleanText, recentBriefs } from "./brief.js";
import { buildExport, exportFilename } from "./export.js";

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
    a.textContent = cleanText(w.title) || cleanText(w.channel) || "Untitled video"; // a reel's caption may give no title
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = [platformName(w.platform), cleanText(w.title) ? cleanText(w.channel) : "", { watch: "worth watching", skim: "skim it", skip: "skip it" }[w.verdict], new Date(w.at).toLocaleDateString()].filter(Boolean).join(" · ");
    const t = document.createElement("div");
    t.className = "t";
    t.style.maxHeight = "none";
    t.textContent = w.learnings.map((l) => "• " + l).join("\n") || w.summary;
    div.append(a, m, t);
    box.append(div);
  }
  return [box];
}

// A small local copy of brief-panel.js's clipboard fallback: brief-panel.js is a classic content
// script digest.js can't import, so the same clipboard-then-execCommand approach is duplicated here.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const back = document.activeElement;
  const t = document.createElement("textarea");
  t.value = text;
  t.readOnly = true;
  t.setAttribute("aria-hidden", "true");
  t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  let ok = false;
  try {
    document.body.append(t);
    t.select();
    ok = document.execCommand("copy");
  } catch {} finally {
    t.remove();
    back?.focus?.({ preventScroll: true });
  }
  return ok;
}

// The Copy row for a brief: a button, a visually hidden status span for screen readers, and, only if
// copying fails outright (blocked clipboard AND blocked execCommand), a fallback line plus a selected,
// read-only textarea so the developer can copy by hand. `div` is the row's own brief container, already
// in the DOM by the time this can run, so a repeat click can find and reuse an existing fallback.
function copyRow(div, promptText) {
  const row = document.createElement("div");
  row.className = "row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copy as prompt";
  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("role", "status");
  let timer = 0, busy = false;
  btn.onclick = async () => {
    if (busy) return;
    busy = true;
    const ok = await copyText(promptText);
    busy = false;
    if (ok) {
      clearTimeout(timer);
      btn.textContent = "Copied";
      status.textContent = "Copied";
      timer = setTimeout(() => { btn.textContent = "Copy as prompt"; status.textContent = ""; }, 2000);
      return;
    }
    const old = div.querySelector(".fallback");
    if (old) { old.select(); return; }
    const why = document.createElement("div");
    why.className = "fail";
    why.textContent = "The browser blocked copying. The prompt is selected below: copy it with your keyboard.";
    why.id = `brief-fail-${Math.random().toString(36).slice(2)}`;
    const area = document.createElement("textarea");
    area.className = "fallback";
    area.readOnly = true;
    area.value = promptText;
    area.setAttribute("aria-label", "Brief as a prompt");
    area.setAttribute("aria-describedby", why.id);
    row.after(why, area);
    area.select();
  };
  row.append(btn, status);
  return row;
}

function briefList(briefs) {
  // Technique briefs from the last 30 days, newest first, each ready to copy into a coding agent.
  // recentBriefs (brief.js) does the age filtering and the normalizing, and tolerates a null entry, a
  // missing or non-numeric `at`, and a record that no longer normalizes (no "what").
  const box = document.createElement("div");
  box.className = "rlist";
  const h = document.createElement("h3");
  h.textContent = "Technique briefs (last 30 days)";
  box.append(h);
  const shown = recentBriefs(briefs);
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Briefs for your coding agent appear here. Click Brief on a post marked \"technique to try\", or Watch it for me on a video that teaches one.";
    box.append(p);
    return [box];
  }
  for (const [b, nb] of shown) {
    const div = document.createElement("div");
    div.className = "post brief";
    const isLink = typeof b.url === "string" && /^https?:\/\//.test(b.url);
    const a = document.createElement(isLink ? "a" : "span");
    if (isLink) { a.href = b.url; a.target = "_blank"; a.rel = "noopener"; }
    a.textContent = cleanText(b.title) || cleanText(b.author) || "Untitled";
    const m = document.createElement("div");
    m.className = "m";
    const platform = platformName(b.platform);
    m.textContent = [platform, b.title ? cleanText(b.author) : "", new Date(b.at).toLocaleDateString(), nb.skill?.worth ? "worth a skill" : ""].filter(Boolean).join(" · ");
    div.append(a, m);
    if (nb.warning) {
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.textContent = `Warning: the source contains text aimed at AI agents: ${nb.warning}`;
      div.append(warn);
    }
    const w = document.createElement("div");
    w.className = "w";
    w.textContent = nb.what;
    div.append(w, copyRow(div, briefPrompt(b)));
    if (nb.warning) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = "Read the warning first. The copied prompt tells your agent to show you the warning and run nothing unless you ask.";
      div.append(note);
    }
    box.append(div);
  }
  return [box];
}

// One malformed section must not blank the rest of the page: each call below runs on its own, and a
// section that throws shows this named, alert-styled line instead of taking the others down with it.
// buildExport (export.js) tolerates bad records on its own, so the reassurance here is true even when
// a section can't render.
function sectionError(name) {
  const p = document.createElement("p");
  p.className = "sect-err";
  p.textContent = `Couldn't show ${name}. Reload the page; if it keeps happening, Export library still saves your data.`;
  return p;
}

async function load() {
  const { digests = [], saved = [], watched = {}, briefs = {} } = await chrome.storage.local.get(["digests", "saved", "watched", "briefs"]);
  try {
    $("reddit").replaceChildren(...redditList(saved));
  } catch { $("reddit").replaceChildren(sectionError("Reddit threads")); }
  try {
    $("briefs").replaceChildren(...briefList(briefs));
  } catch { $("briefs").replaceChildren(sectionError("technique briefs")); }
  try {
    $("videos").replaceChildren(...videoList(watched));
  } catch { $("videos").replaceChildren(sectionError("watched videos")); }
  try {
    $("digests").replaceChildren(...digests.map(renderDigest));
    if (!digests.length) $("digests").textContent = "No digests yet.";
  } catch { $("digests").replaceChildren(sectionError("digests")); }
  try {
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
  } catch {
    $("savedSum").textContent = "Saved posts";
    $("saved").replaceChildren(sectionError("saved posts"));
  }
}

async function run(since) {
  $("msg").classList.remove("alert");
  $("msg").textContent = "Summarising…";
  const d = await chrome.runtime.sendMessage({ type: "digest", since });
  if (d.error) $("msg").classList.add("alert");
  $("msg").textContent = d.error || "";
  load();
}

$("today").onclick = async () => {
  const { lastDigestAt = 0 } = await chrome.storage.local.get("lastDigestAt");
  run(lastDigestAt || Date.now() - 864e5);
};
$("day").onclick = () => run(Date.now() - 864e5);
$("week").onclick = () => run(Date.now() - 7 * 864e5);
$("export").onclick = async () => {
  try {
    const data = await chrome.storage.local.get(["saved", "watched", "briefs", "digests"]);
    const url = URL.createObjectURL(new Blob([JSON.stringify(buildExport(data), null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("msg").classList.remove("alert");
    $("msg").textContent = `Export started: ${a.download}.`;
  } catch (e) {
    const why = String(e?.message ?? e ?? "").replace(/[.\s]+$/, "");
    $("msg").classList.add("alert");
    $("msg").textContent = `Couldn't export${why ? `: ${why}` : ""}. Reload the page and try again.`;
  }
};
load();
