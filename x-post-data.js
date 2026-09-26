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
      return x.protocol === "https:" && x.hostname === host && !x.username && !x.password ? x.href : "";
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
  // at its own short form falls back to a plain search and replace, longest short form first, so one
  // t.co code that's a prefix of another doesn't leave a leftover fragment of itself behind.
  // `positional`: false when the entities' own indices don't describe this text at all (a note_tweet
  // whose tweet carries no entity_set of its own: its positions are for full_text, not the note), so
  // every link is search-and-replaced rather than checked by index.
  function words(raw, entities, displayStart, positional = true) {
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
      const r = positional ? range(u.indices) : null;
      if (positional && points(r, short)) reps.push({ r, text: long });
      else leftover.push([short, long]);
    }
    for (const m of media) {
      const short = str(m?.url);
      if (!short) continue;
      const r = positional ? range(m.indices) : null;
      if (positional && points(r, short)) reps.push({ r, text: "" });
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
    for (const [short, long] of leftover.slice().sort((a, b) => b[0].length - a[0].length)) out = out.split(short).join(long);
    return out.trim();
  }

  // The whole text: a long post's note_tweet when X sent one, else full_text. A note's own entity_set has
  // positions that describe the note's text; without one, the tweet's own entities.urls/media are the
  // only links known, but their positions are for full_text, so they're applied by search and replace only.
  function textOf(t) {
    const note = t.note_tweet;
    const noteText = str(note?.text) || str(note?.note_tweet_results?.result?.text);
    const entitySet = note?.entity_set || note?.note_tweet_results?.result?.entity_set;
    const text = noteText
      ? (entitySet ? words(noteText, entitySet, 0) : words(noteText, t.entities, 0, false))
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
    // X sends duration_millis as a number, but sometimes as a numeric string; either way, a length.
    const ms = Number(m.video_info?.duration_millis);
    return Number.isFinite(ms) && ms > 0 ? { mp4: pick.url, seconds: ms / 1000 } : { mp4: pick.url };
  }

  function record(t) {
    // A repost is X's own wrapper around the original: read the original, not the wrapper, so the id,
    // author, text and media are the post that was actually reposted, not "RT @orig: ..." with no media.
    const rt = t.retweeted_status;
    if (rt && typeof rt === "object" && ID.test(str(rt.id_str))) t = rt;
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
      if (qt) {
        const qa = authorOf(q);
        rec.quoted = qa ? { author: qa, text: qt } : { text: qt };
      }
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
