import { briefPrompt, platformName, cleanText, recentBriefs, leftOutLine } from "./brief.js";
import { buildExport, exportFilename } from "./export.js";

// Opt-in usage stats: the worker counts these only if the user said yes. No text goes with them.
const counted = (name, where) => { try { return chrome.runtime.sendMessage({ type: "count", name, where }).catch(() => {}); } catch {} };

const $ = (id) => document.getElementById(id);

// The page's parts (pinboard version 2): a section heading, a card of rows, a row, and a title that is
// a link in ink (blue only on hover and focus) or plain text when there's no web address.
function heading(text) {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}
function group(rows) {
  const box = document.createElement("div");
  box.className = "group";
  box.append(...rows);
  return box;
}
function item(cls = "") {
  const div = document.createElement("div");
  div.className = cls ? `item ${cls}` : "item";
  return div;
}
function title(text, url) {
  const isLink = typeof url === "string" && /^https?:\/\//.test(url);
  const a = document.createElement(isLink ? "a" : "span");
  if (isLink) { a.href = url; a.target = "_blank"; a.rel = "noopener"; }
  a.className = "title";
  a.textContent = text;
  return a;
}
function meta(text) {
  const m = document.createElement("div");
  m.className = "m";
  m.textContent = text;
  return m;
}
function empty(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}

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
  return [heading(REDDIT), group(open.map((p) => {
    const div = item();
    const hours = Math.round((now - p.createdAt) / 36e5);
    div.append(
      title(p.title || p.text.split("\n")[0], p.authorUrl),
      meta(`${p.authorName} · ${hours < 1 ? "under 1h" : hours + "h"} old · ${p.comments} comments when seen · ${hours <= 12 ? "still fresh" : "getting late"}`),
    );
    return div;
  }))];
}

function videoList(watched) {
  // Every video Sieve watched for you in the last 7 days, with its learnings.
  const recent = Object.values(watched).filter((w) => Date.now() - w.at < 7 * 864e5).sort((a, b) => b.at - a.at);
  if (!recent.length) return [];
  return [heading(VIDEOS), group(recent.map((w) => {
    const div = item();
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = w.learnings.map((l) => "• " + l).join("\n") || w.summary;
    div.append(
      title(cleanText(w.title) || cleanText(w.channel) || "Untitled video", w.url), // a short video's caption may give no title
      meta([platformName(w.platform), cleanText(w.title) ? cleanText(w.channel) : "", { watch: "worth watching", skim: "skim it", skip: "skip it" }[w.verdict], new Date(w.at).toLocaleDateString()].filter(Boolean).join(" · ")),
      t,
    );
    return div;
  }))];
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
  row.className = "acts";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn text";
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
      counted("prompt_copied", "digest");
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
  const shown = recentBriefs(briefs);
  if (!shown.length) {
    return [heading(BRIEFS), empty("Briefs for your coding agent appear here. Click Brief on a post marked \"technique to try\", or Watch it for me on a video that teaches one.")];
  }
  const box = group([]);
  for (const [b, nb] of shown) {
    const div = item("brief");
    div.append(
      title(cleanText(b.title) || cleanText(b.author) || "Untitled", b.url),
      meta([platformName(b.platform), b.title ? cleanText(b.author) : "", new Date(b.at).toLocaleDateString(), nb.skill?.worth ? "worth a skill" : ""].filter(Boolean).join(" · ")),
    );
    if (nb.warning) {
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.textContent = `Warning: the source contains text aimed at AI agents: ${nb.warning}`;
      div.append(warn);
      // Which planted names cost the brief steps, right after the warning.
      const line = leftOutLine(nb);
      if (line) {
        const left = document.createElement("div");
        left.className = "note";
        left.textContent = line;
        div.append(left);
      }
    }
    const w = document.createElement("div");
    w.className = "w";
    w.textContent = nb.what;
    div.append(w, copyRow(div, briefPrompt(b)));
    if (nb.warning) {
      const note = document.createElement("div");
      note.className = "foot";
      note.textContent = "Read the warning first. The copied prompt tells your agent to show you the warning and run nothing unless you ask.";
      div.append(note);
    }
    box.append(div);
  }
  return [heading(BRIEFS), box];
}

// One malformed section must not blank the rest of the page: each call below runs on its own, and a
// section that throws shows its heading and this named failure note instead of taking the others down
// with it.
// buildExport (export.js) tolerates bad records on its own, so the reassurance here is true even when
// a section can't render.
function sectionError(name, title) {
  const p = document.createElement("p");
  p.className = "sect-err";
  p.textContent = `Couldn't show ${name}. Reload the page; if it keeps happening, Export library still saves your data.`;
  return title ? [heading(title), p] : [p];
}

const REDDIT = "Reddit threads you could answer (last 24 hours)";
const BRIEFS = "Technique briefs (last 30 days)";
const VIDEOS = "Videos watched for you (last 7 days)";
const DIGESTS = "Digests";

async function load() {
  const { digests = [], saved = [], watched = {}, briefs = {} } = await chrome.storage.local.get(["digests", "saved", "watched", "briefs"]);
  try {
    $("reddit").replaceChildren(...redditList(saved));
  } catch { $("reddit").replaceChildren(...sectionError("Reddit threads", REDDIT)); }
  try {
    $("briefs").replaceChildren(...briefList(briefs));
  } catch { $("briefs").replaceChildren(...sectionError("technique briefs", BRIEFS)); }
  try {
    $("videos").replaceChildren(...videoList(watched));
  } catch { $("videos").replaceChildren(...sectionError("watched videos", VIDEOS)); }
  try {
    $("digests").replaceChildren(heading(DIGESTS), ...(digests.length ? digests.map(renderDigest) : [empty("No digests yet.")]));
  } catch { $("digests").replaceChildren(...sectionError("digests", DIGESTS)); }
  try {
    $("savedSum").textContent = `Saved posts (${saved.length})`;
    $("saved").replaceChildren(saved.length ? group(saved.map((p) => {
      const div = item();
      const a = title((p.platform === "reddit" ? "Reddit · " : "") + (p.authorName || "Unknown author"), p.authorUrl);
      const m = meta("");
      // A watched video was never scored (it is saved because you asked for it), so it gets no score at
      // all. Every other score reads "Sieve", whichever scorer answered, as the tags on the page do.
      const score = p.kind === "video" ? "" : ` · Sieve ${p.worth.toFixed(2)}`;
      m.textContent = `${new Date(p.savedAt).toLocaleString()} · ${p.kind}${p.topic ? ` · ${p.topic}` : ""}${score}`;
      const t = document.createElement("div");
      t.className = "t clip";
      t.textContent = p.text;
      div.append(a, m, t);
      return div;
    })) : empty("Nothing saved in the last 30 days."));
  } catch {
    $("savedSum").textContent = "Saved posts";
    $("saved").replaceChildren(...sectionError("saved posts"));
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
    // Counts a started export: the download's result isn't reported.
    counted("library_exported");
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
