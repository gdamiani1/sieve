// Runs in X's own page, not beside Sieve's other scripts. X keeps a post's full data (the whole text of
// a long post, which post it replies to, its pictures and its video's mp4 links) only in the page's
// React data, which x.js can't see from the extension's side. When x.js raises "sieve-x-post" on a post,
// this finds the post's data there and writes a small summary on it as data-sieve-x (JSON). It only
// reads: it never changes the page otherwise. x.js checks everything it gets (x-thread.js).
// The field names are X's own and undocumented (measured 26 Sep 2026). When they change, nothing is
// written and the post works the way it did before this script existed.
(() => {
  const MAX_UP = 40; // the post's Tweet component sat 13 levels above its <article> when measured
  const MAX_TEXT = 25000; // X's longest post
  const MAX_PHOTOS = 10;
  const MAX_BYTES = 64 * 1024;
  // X's 720p rendition, the one the iPhone app sends (XPost.maxBitrate). Higher is only bigger.
  const MAX_BITRATE = 2200000;
  const ID = /^\d{1,20}$/;
  const str = (v) => (typeof v === "string" ? v : "");
  const https = (u, host) => {
    try {
      const x = new URL(str(u));
      return x.protocol === "https:" && x.hostname === host ? x.href : "";
    } catch {
      return "";
    }
  };

  // The post's own data: the nearest ancestor fiber whose props carry a `tweet` with an id.
  function tweetOf(article) {
    const key = Object.keys(article).find((k) => k.startsWith("__reactFiber$"));
    let f = key ? article[key] : null;
    for (let i = 0; f && i <= MAX_UP; i++, f = f.return) {
      const t = f.memoizedProps?.tweet;
      if (t && typeof t === "object" && typeof t.id_str === "string") return t;
    }
    return null;
  }

  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

  // A post's words as its author wrote them: the iPhone's XPost.words, ported. Each t.co link goes back
  // to where it points, the post's own link to its media is dropped (the media is sent anyway), and a
  // reply's leading @mentions go (displayStart). Links are replaced by their recorded position, counted
  // in code points, because one t.co code can be a prefix of another. Entities are decoded only between
  // links, so an "&amp;" inside an expanded link stays as X sent it. A link whose position doesn't point
  // at its own short form falls back to a plain search and replace.
  function words(raw, entities, displayStart) {
    const cps = Array.from(raw);
    const urls = Array.isArray(entities?.urls) ? entities.urls : [];
    const media = Array.isArray(entities?.media) ? entities.media : [];
    const range = (ix) => {
      if (!Array.isArray(ix) || ix.length !== 2) return null;
      const [a, b] = ix;
      return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b <= cps.length ? [a, b] : null;
    };
    const points = (r, short) => !!r && cps.slice(r[0], r[1]).join("") === short;
    const reps = [];
    const leftover = [];
    if (Number.isInteger(displayStart) && displayStart > 0 && displayStart <= cps.length) reps.push({ r: [0, displayStart], text: "" });
    for (const u of urls) {
      const short = str(u?.url), long = str(u?.expanded_url);
      if (!short || !long) continue;
      const r = range(u.indices);
      if (points(r, short)) reps.push({ r, text: long });
      else leftover.push([short, long]);
    }
    for (const m of media) {
      const short = str(m?.url);
      if (!short) continue;
      const r = range(m.indices);
      if (points(r, short)) reps.push({ r, text: "" });
      else leftover.push([short, ""]);
    }
    reps.sort((a, b) => a.r[0] - b.r[0]);
    let out = "", cursor = 0;
    for (const { r, text } of reps) {
      if (r[0] < cursor) continue; // an overlap: the earlier one stands
      out += decode(cps.slice(cursor, r[0]).join("")) + text;
      cursor = r[1];
    }
    out += decode(cps.slice(cursor).join(""));
    for (const [short, long] of leftover) out = out.split(short).join(long);
    return out.trim();
  }

  // The whole text: a long post's note_tweet when X sent one, else full_text.
  function textOf(t) {
    const note = t.note_tweet;
    const noteText = str(note?.text) || str(note?.note_tweet_results?.result?.text);
    const text = noteText
      ? words(noteText, note.entity_set || note.note_tweet_results?.result?.entity_set, 0)
      : words(str(t.full_text), t.entities, Array.isArray(t.display_text_range) ? t.display_text_range[0] : 0);
    return Array.from(text).slice(0, MAX_TEXT).join("");
  }

  const authorOf = (t) => str(t.user?.screen_name) || str(t.user?.legacy?.screen_name);

  // The highest mp4 at or under MAX_BITRATE, else the lowest known bitrate, else the first mp4.
  function videoOf(media) {
    const m = media.find((x) => x?.type === "video");
    if (!m) return null;
    const mp4s = (Array.isArray(m.video_info?.variants) ? m.video_info.variants : [])
      .filter((v) => v?.content_type === "video/mp4")
      .map((v) => ({ bitrate: typeof v.bitrate === "number" ? v.bitrate : null, url: https(v.url, "video.twimg.com") }))
      .filter((v) => v.url);
    const known = mp4s.filter((v) => v.bitrate !== null);
    const under = known.filter((v) => v.bitrate <= MAX_BITRATE).sort((a, b) => b.bitrate - a.bitrate)[0];
    const lowest = [...known].sort((a, b) => a.bitrate - b.bitrate)[0];
    const pick = under || lowest || mp4s[0];
    if (!pick) return null;
    const ms = m.video_info?.duration_millis;
    return typeof ms === "number" && ms > 0 ? { mp4: pick.url, seconds: ms / 1000 } : { mp4: pick.url };
  }

  function record(t) {
    if (!ID.test(t.id_str)) return null;
    const rec = { id: t.id_str };
    const author = authorOf(t);
    if (author) rec.author = author;
    if (ID.test(str(t.in_reply_to_status_id_str))) rec.replyTo = t.in_reply_to_status_id_str;
    if (str(t.in_reply_to_screen_name)) rec.replyToAuthor = t.in_reply_to_screen_name;
    rec.text = textOf(t);
    const q = t.quoted_status;
    if (q && typeof q === "object" && q !== t) {
      const qt = textOf(q);
      if (qt) rec.quoted = { author: authorOf(q), text: qt };
    }
    const media = Array.isArray(t.extended_entities?.media) ? t.extended_entities.media : Array.isArray(t.entities?.media) ? t.entities.media : [];
    const photos = media.filter((m) => m?.type === "photo").map((m) => https(m.media_url_https, "pbs.twimg.com")).filter(Boolean).slice(0, MAX_PHOTOS);
    if (photos.length) rec.photos = photos;
    const video = videoOf(media);
    if (video) rec.video = video;
    if (typeof t.reply_count === "number" && t.reply_count > 0) rec.hasReplies = true;
    if (t.self_thread?.id_str === t.id_str) rec.startsThread = true;
    return rec;
  }

  document.addEventListener("sieve-x-post", (e) => {
    const post = e.target;
    if (!(post instanceof Element)) return;
    try {
      const t = tweetOf(post);
      const rec = t && record(t);
      const json = rec ? JSON.stringify(rec) : "";
      if (json && json.length <= MAX_BYTES) post.setAttribute("data-sieve-x", json);
      else post.removeAttribute("data-sieve-x");
    } catch {
      try { post.removeAttribute("data-sieve-x"); } catch {}
    }
  }, true);
})();
