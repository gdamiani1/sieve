// X threads, pictures and video for x.js: checking the summary x-post-data.js writes on a post, finding
// the author's thread among the posts read on this page, and building the brief and watch requests.
// Pure functions: no page, no storage, no network. A classic script listed before x.js in the manifest;
// all it does is define one global.
(() => {
  const ID = /^\d{1,20}$/;
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const MAX_RECORD = 64 * 1024;
  const MAX_TEXT = 25000;
  const MAX_PHOTOS = 10; // per post, as x-post-data.js writes them
  const MAX_THREAD = 50;
  const MAX_SENT_PHOTOS = 10; // per brief: the iPhone's maxImages
  const USD_PER_MINUTE = 0.0022; // keep in sync with watch-prompt.js
  const MAX_MINUTES = 55; // keep in sync with watch-prompt.js
  // A post's brief is keyed by a 32-bit hash of its text (x.js), at most 10 digits and a sign; a watched
  // video by its post id. Every X post id since 2010 has 15 or more digits. Offering Watch it for me only
  // from 11 digits keeps the two keys from ever meeting.
  const MIN_VIDEO_ID = 11;

  const isStr = (v) => typeof v === "string";
  const isBool = (v) => v === undefined || typeof v === "boolean";
  const link = (u, host) => {
    if (!isStr(u)) return "";
    try {
      const x = new URL(u);
      return x.protocol === "https:" && x.hostname === host && !x.username && !x.password ? x.href : "";
    } catch {
      return "";
    }
  };
  const handle = (v) => v === undefined || v === "" || (isStr(v) && HANDLE.test(v));
  // Counted in code points, not UTF-16 units: x-post-data.js cuts text to MAX_TEXT code points, and an
  // emoji surrogate pair is one code point but two units, so counting units would reject a text at
  // exactly the limit and lose the whole record (its pictures, video and replyTo) over nothing.
  const codePoints = (v) => Array.from(v).length;
  const words = (v) => v === undefined || (isStr(v) && codePoints(v) <= MAX_TEXT);

  // data-sieve-x -> a checked record, or null. Anything on the page can set an attribute, so every field
  // is checked, and a record that fails any check is ignored as a whole.
  function readRecord(json) {
    if (!isStr(json) || !json || json.length > MAX_RECORD) return null;
    let r;
    try { r = JSON.parse(json); } catch { return null; }
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (!isStr(r.id) || !ID.test(r.id)) return null;
    if (!handle(r.author) || !handle(r.replyToAuthor) || !words(r.text)) return null;
    if (r.replyTo !== undefined && !(isStr(r.replyTo) && ID.test(r.replyTo))) return null;
    if (!isBool(r.hasReplies) || !isBool(r.startsThread)) return null;
    const out = { id: r.id, author: r.author || "", replyToAuthor: r.replyToAuthor || "", text: r.text || "", photos: [], hasReplies: !!r.hasReplies, startsThread: !!r.startsThread };
    if (r.replyTo !== undefined) out.replyTo = r.replyTo;
    if (r.quoted !== undefined) {
      const q = r.quoted;
      if (!q || typeof q !== "object" || !handle(q.author) || !isStr(q.text) || !q.text || codePoints(q.text) > MAX_TEXT) return null;
      out.quoted = { author: q.author || "", text: q.text };
    }
    if (r.photos !== undefined) {
      if (!Array.isArray(r.photos) || r.photos.length > MAX_PHOTOS) return null;
      const photos = r.photos.map((u) => link(u, "pbs.twimg.com"));
      if (photos.some((u) => !u)) return null;
      out.photos = photos;
    }
    if (r.video !== undefined) {
      const v = r.video;
      const mp4 = v && typeof v === "object" ? link(v.mp4, "video.twimg.com") : "";
      if (!mp4) return null;
      if (v.seconds !== undefined && !(typeof v.seconds === "number" && Number.isFinite(v.seconds) && v.seconds > 0)) return null;
      out.video = v.seconds === undefined ? { mp4 } : { mp4, seconds: v.seconds };
    }
    return out;
  }

  // Compared as numbers: X ids grow over time, and "99" is earlier than "100".
  const earlier = (a, b) => (a.length !== b.length ? a.length < b.length : a < b);

  // The author's thread around post `id`: up through replyTo while the parent was read on this page and
  // is by the same author, then down, each time to the same author's earliest reply to the current post.
  // Anyone else's post ends it. At most MAX_THREAD posts. [] when `id` wasn't read.
  function threadOf(records, id) {
    const start = records.get(id);
    if (!start) return [];
    const same = (r) => !!r && !!start.author && r.author === start.author;
    const seen = new Set([start.id]);
    const thread = [start];
    for (let cur = start; thread.length < MAX_THREAD;) {
      const parent = cur.replyTo ? records.get(cur.replyTo) : null;
      if (!same(parent) || seen.has(parent.id)) break;
      thread.unshift(parent);
      seen.add(parent.id);
      cur = parent;
    }
    for (let cur = start; thread.length < MAX_THREAD;) {
      let next = null;
      for (const r of records.values()) {
        if (r.replyTo === cur.id && same(r) && !seen.has(r.id) && (!next || earlier(r.id, next.id))) next = r;
      }
      if (!next) break;
      thread.push(next);
      seen.add(next.id);
      cur = next;
    }
    return thread;
  }

  // One post's words as saved: its own, then any post it quotes. x.js writes "[quoted post]" on its own
  // line with no author; here the author is folded onto that line instead, so a model reading a joined
  // thread knows whose words the quote is, not just that a quote exists.
  const postText = (r) => [r.text, r.quoted ? `[quoted post] ${r.quoted.author ? `@${r.quoted.author}: ` : ""}${r.quoted.text}` : ""].filter(Boolean).join("\n\n");

  // True when the earliest post read replies to another post by the same author (X says so on the post
  // itself, via replyToAuthor): a same-author parent, read or not, means this post isn't really the
  // thread's start, so its link is never the thread's link.
  const sameAuthorParent = (first) => !!(first.replyTo && first.replyToAuthor && first.replyToAuthor === first.author);

  // Of that, only a same-author parent that wasn't read on this page is worth a note: the visible
  // fragment goes missing above and scrolling (or opening the post) would fetch it. The walk can also
  // stop one short of a same-author parent at the 50-post cap (a long thread, opened partway through);
  // there the parent WAS read, it's just not among the 50 posts kept, so this stays false and the cap
  // sentence below is the one that fires instead.
  const truncatedStart = (records, first) => sameAuthorParent(first) && !records.has(first.replyTo);

  function note(thread, feed, truncated) {
    const parts = [];
    const first = thread[0], last = thread[thread.length - 1];
    if (thread.length >= 2) parts.push(`Read ${thread.length} posts by @${first.author}.`);
    if (truncated) {
      // In the feed, scrolling never loads the parent either, so pointing at a scroll wouldn't help.
      parts.push(feed ? "Open the post to brief the whole thread." : "The thread starts above: scroll up and press Write it again.");
    } else if (thread.length >= MAX_THREAD) {
      // threadOf stops adding posts at the cap either way, so a scroll (or opening the post) can't
      // bring in more; say so instead of a hint that would go nowhere.
      parts.push("Sieve reads at most 50 posts of a thread.");
    } else if (thread.length >= 2 && last.hasReplies) {
      // In the feed, scrolling never loads the rest of an author's own posts X grouped together; only
      // opening the post does. On the post's own page, scrolling does load more.
      parts.push(feed ? "Open the post to brief the whole thread." : "If the thread goes on below, scroll down and press Write it again.");
    } else if (thread.length === 1 && feed && first.startsThread) {
      parts.push("This post starts a thread. Open it to brief the whole thread.");
    } else if (thread.length === 1 && !feed && first.startsThread) {
      // hasReplies alone isn't a thread hint on a post's own page: it counts anyone's replies, not just
      // the author continuing in a thread, so it fired on nearly every single post. startsThread is X's
      // own signal that the author did.
      parts.push("This post starts a thread. Scroll down to load it and press Write it again.");
    }
    if (thread.length >= 2) {
      const withVideo = thread.map((r, i) => (r.video ? i + 1 : 0)).filter(Boolean);
      if (withVideo.length === 1) parts.push(`Post ${withVideo[0]} has a video: use Watch it for me on it.`);
      else if (withVideo.length > 1) parts.push(`Posts ${withVideo.join(", ")} have videos: use Watch it for me on them.`);
    }
    return parts.join(" ");
  }

  // The brief request for the post the person clicked Brief on. `base` is x.js's postRecord (today's
  // post); with no record for `id` it goes out unchanged. With one: the full text, the pictures (all
  // counted, the first MAX_SENT_PHOTOS sent), and for a thread of two or more posts, the posts in order
  // and the first post's link. The key stays the clicked post's, as today.
  function briefRequest(base, records, id, { feed = false } = {}) {
    const thread = id ? threadOf(records, id) : [];
    if (!thread.length) return { post: base, note: "" };
    const truncated = truncatedStart(records, thread[0]);
    const photos = thread.flatMap((r) => r.photos);
    const joined = thread.map(postText).filter(Boolean).join("\n\n");
    const post = { ...base, text: joined || base.text, photos: photos.slice(0, MAX_SENT_PHOTOS), photoCount: photos.length };
    // A picture-only post (x-post-data.js drops the media link, so its "text" is blank) has nothing to
    // add to "posts": brief-prompt.js's isThread requires every entry to have real text, and one blank
    // entry would fail that check and drop the whole thread down to a single post. Its pictures already
    // travel in "photos" above, so leaving it out of "posts" loses nothing.
    const textPosts = thread.filter((r) => r.text && r.text.trim());
    if (textPosts.length >= 2) {
      post.posts = textPosts.map((r) => (r.quoted ? { text: r.text, quoted: { author: r.quoted.author, text: r.quoted.text } } : { text: r.text }));
      // Not when the earliest post read isn't really the thread's start: its link isn't the thread's link.
      if (thread[0].author && !sameAuthorParent(thread[0])) post.postUrl = `https://x.com/${thread[0].author}/status/${thread[0].id}`;
    }
    return { post, note: note(thread, feed, truncated) };
  }

  // A post's first non-blank line, cut to `max` characters with "..." (brief.js's firstLine, which a
  // classic script can't import).
  function firstLine(s, max = 80) {
    const line = Array.from((isStr(s) ? s : "").split(/\r\n|[\n\r\u2028\u2029]/).map((l) => l.trim()).find(Boolean) || "");
    return line.length > max ? `${line.slice(0, max).join("").trimEnd()}...` : line.join("");
  }

  const price = (seconds) => {
    if (!seconds) return "";
    const usd = (seconds / 60) * USD_PER_MINUTE;
    return usd < 0.01 ? "<1¢" : `~${Math.round(usd * 100)}¢`;
  };

  // The watch message for a post's video, with the button's label; null when the post has no video
  // Sieve can send. The worker checks every field again (watch() in background.js).
  function watchRequest(rec) {
    if (!rec?.video?.mp4 || !rec.author || rec.id.length < MIN_VIDEO_ID) return null;
    const seconds = rec.video.seconds || 0;
    const tooLong = seconds / 60 > MAX_MINUTES;
    const cost = price(seconds);
    return {
      msg: { type: "watch", platform: "x", id: rec.id, url: `https://x.com/${rec.author}/status/${rec.id}`, video: rec.video.mp4, title: firstLine(rec.text) || `Video by @${rec.author}`, channel: `@${rec.author}`, caption: rec.text, seconds },
      label: tooLong ? "too long to watch" : `Watch it for me${cost ? ` · ${cost}` : ""}`,
      price: cost,
      tooLong,
    };
  }

  globalThis.SieveXThread = { readRecord, threadOf, briefRequest, watchRequest, firstLine };
})();
