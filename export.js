// "Export library": everything Sieve kept, as one JSON file the person owns.
// Versioned, so a later Sieve can import an export written by an older one.
//
// The version 1 contract:
//   format: "sieve-library", version: 1, exportedAt: an ISO string, or null for an invalid clock.
//   items: one entry per saved post, watched video or briefed post, newest `savedAt` first.
//     Every item has exactly these fields, always present, always this type:
//       id        string, never empty: the stored key ("123", "yt-abc", ...).
//       platform  a lowercase platform name, usually linkedin, x, reddit or youtube (old posts
//                 without one are linkedin).
//       kind      string, e.g. "technique", "video"; "" when unknown.
//       title     "" for LinkedIn and X posts; the post title on Reddit, the video title on YouTube.
//       author    string, the author or channel name.
//       url       string. The author's profile on LinkedIn, the post on X and Reddit, the video
//                 on YouTube. Only a real http(s) link ever leaves the extension; "" otherwise.
//       savedAt   ISO string or null: when Sieve kept the item (saved, watched or briefed).
//       text      string, raw third-party text (a post body or a video summary), uncleaned.
//       worth     number or null.
//       topic     string, "" when there is none.
//       watch     { verdict, why, summary, points, best, learnings, checks, seconds } or null:
//                 points: [{t, text}], best: {t, text} | null, learnings and checks: string[],
//                 seconds: number | null.
//       brief     a normalized brief (brief.js normalizeBrief) plus `at`, or null.
//   digests: [{ at, since, count, text }], `at` and `since` each an ISO string or null.
//
//   Text fields -- title, author, text, and everything inside watch and brief -- are third-party
//   text or model output derived from it; consumers treat it as data and clean it for display.
//   New fields may appear within version 1; a consumer ignores fields it doesn't recognise. Only
//   renaming or removing a field, or changing what a field means, bumps the version.
import { normalizeBrief } from "./brief.js";

const iso = (ms) => { const d = new Date(typeof ms === "number" && ms > 0 ? ms : NaN); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const arr = (a) => (Array.isArray(a) ? a : []);
const isRec = (r) => !!r && typeof r === "object" && !Array.isArray(r);
// A stored key can be a string or (old LinkedIn data) a number; never trust anything else.
const idOf = (k) => (typeof k === "string" ? k : typeof k === "number" && Number.isFinite(k) ? String(k) : "");
// Every text field must actually be a string in the exported JSON: a stray number becomes text,
// anything else (an object, an array, a boolean) becomes "" rather than leaking its shape out.
const str = (s) => (typeof s === "string" ? s : typeof s === "number" && Number.isFinite(s) ? String(s) : "");
const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);
// Only web links leave the extension: a later page that renders `url` as a link must never get javascript:.
const webUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };

const blank = (id, fields) => ({
  id, platform: "", kind: "", title: "", author: "", url: "", savedAt: null, text: "", worth: null, topic: "", watch: null, brief: null,
  ...fields,
});

export function buildExport(data = {}, now = Date.now()) {
  const d = isRec(data) ? data : {};
  const savedArr = arr(d.saved);
  const watchedObj = isRec(d.watched) ? d.watched : {};
  const briefsObj = isRec(d.briefs) ? d.briefs : {};
  const digestsArr = arr(d.digests);

  const items = new Map();

  // Saved posts are stored newest first; skip anything without a usable id, and let the first
  // (newest) occurrence of a duplicate id win.
  for (const p of savedArr) {
    if (!isRec(p)) continue;
    const id = idOf(p.key);
    if (!id || items.has(id)) continue;
    items.set(id, blank(id, {
      platform: str(p.platform) || "linkedin", kind: str(p.kind), title: str(p.title), author: str(p.authorName), url: webUrl(p.authorUrl),
      savedAt: iso(p.savedAt), text: str(p.text), worth: num(p.worth), topic: str(p.topic),
    }));
  }

  for (const [k, w] of Object.entries(watchedObj)) {
    if (!isRec(w)) continue;
    const id = `yt-${idOf(w.id) || k}`;
    const it = items.get(id) || blank(id, { platform: "youtube", kind: "video", title: str(w.title), author: str(w.channel), url: webUrl(w.url), savedAt: iso(w.at), text: str(w.summary) });
    it.watch = {
      verdict: str(w.verdict), why: str(w.why), summary: str(w.summary), points: arr(w.points), best: isRec(w.best) ? w.best : null,
      learnings: arr(w.learnings), checks: arr(w.checks), seconds: num(w.seconds),
    };
    items.set(id, it);
  }

  // Stored briefs can be in older shapes, and normalizeBrief enforces the safety rules for warned
  // briefs (CHECK_SOURCE first, no link or pipe-into-shell steps, skill not worth it), so every
  // brief goes out through it rather than being copied field by field. A record that no longer
  // normalizes (no "what") is skipped: the item it would touch keeps brief: null if a saved post
  // or a watched video already put it in `items`, and no item is created for it otherwise.
  for (const [k, b] of Object.entries(briefsObj)) {
    if (!isRec(b)) continue;
    const nb = normalizeBrief(b);
    if (!nb) continue;
    const id = idOf(b.key) || k;
    if (!id) continue;
    const it = items.get(id) || blank(id, { platform: str(b.platform), title: str(b.title), author: str(b.author), url: webUrl(b.url), savedAt: iso(b.at) });
    it.brief = { ...nb, at: iso(b.at) };
    items.set(id, it);
  }

  return {
    format: "sieve-library",
    version: 1,
    exportedAt: iso(now),
    items: [...items.values()].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || "")),
    digests: digestsArr.filter(isRec).map((dg) => ({ at: iso(dg.at), since: iso(dg.since), count: num(dg.count) ?? 0, text: str(dg.text) })),
  };
}

// The local date, not UTC: a UTC date would misname the file for a couple of hours around
// midnight (e.g. it would still say yesterday at 1am in Zagreb).
export const exportFilename = (now = Date.now()) => {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `sieve-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
};
