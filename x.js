// X (Twitter): same scoring and briefs as LinkedIn. Reads only posts that stay on
// screen, never likes, reposts, replies or follows. Hooks: X's long-standing data-testid labels.
(() => {
  // After the extension is reloaded or updated, scripts already running in open tabs lose their
  // connection to it. Stop quietly and ask for a page reload instead of throwing errors.
  // Dark page (LinkedIn/X/Reddit/YouTube dark themes): switch on-page accents to the lighter blue.
  let darkCheckedAt = 0;
  const markDark = () => {
    if (Date.now() - darkCheckedAt < 3000) return; // theme switches are rare; don't recompute on every scan
    darkCheckedAt = Date.now();
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    document.documentElement.classList.toggle("sieve-dark", lum < 0.5);
  };
  markDark();

  let retired = false;
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  function retire() {
    if (retired) return;
    retired = true;
    const n = document.createElement("div");
    n.className = "jev-layout-note";
    n.textContent = "Sieve was updated. Reload this page to keep using it.";
    n.onclick = () => n.remove();
    document.body.append(n);
  }
  function send(msg, cb) {
    if (retired) return cb?.(undefined);
    if (!alive()) { retire(); return cb?.(undefined); }
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) { if (!alive()) retire(); return cb?.(undefined); }
        cb?.(r);
      });
    } catch { retire(); return cb?.(undefined); }
  }

  const POST = 'article[data-testid="tweet"]';
  const TEXT = '[data-testid="tweetText"]';
  const DWELL_MS = 600;
  const LABEL = {
    technique: "technique to try", built_something: "built something", opinion: "opinion", question: "asks a question", news: "news", promo: "promo", personal: "personal",
  };
  const ERRORS = { no_key: "Sieve: add your OpenRouter key in the extension settings", or_key_rejected: "Sieve: OpenRouter rejected the key. Paste a new one in the extension settings", or_no_credit: "Sieve: out of OpenRouter credit. Add credit at openrouter.ai", unreadable: "Sieve: couldn't read the score. Reload the page to try again", key_rejected: "Sieve: TypeSafe key rejected", no_credit: "Sieve: out of TypeSafe credit, check TypeSafe billing", timeout: "Sieve: the scorer took too long, will retry on next view" };

  let enabled = true;
  const results = new Map();
  const states = new Map();
  const urls = new Map(); // key -> the post's own link
  const pending = new Set();
  chrome.storage.local.get("prefs").then((v) => { enabled = v.prefs?.xOn !== false; if (!enabled) clearAll(); });

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };

  // X threads, pictures and video (x-thread.js, x-post-data.js). Without them, every post works as before.
  const XT = globalThis.SieveXThread;
  const records = new Map(); // the page summaries read on this page, by post id
  const onPostPage = () => /\/status\/\d+/.test(location.pathname);
  // Which page the records belong to: the post's id on a post's page, else the address. Opening a picture
  // (/photo/1, /video/1) or the post's likes, quotes and so on changes the address but not the post, and
  // closing it changes it back: keyed on the address, that would lose a thread gathered by scrolling.
  const pageKey = () => location.pathname.match(/\/status\/(\d+)/)?.[1] || location.pathname;
  let recordsPage = pageKey();
  // A picture or video opened full size, over whatever page it was opened from. Its address carries the id
  // of the post the picture is in, which can be another post than the page's (or come from the feed), so
  // it must neither start a new set nor add the posts X draws beside it.
  const mediaView = () => /\/status\/\d+\/(photo|video)\/\d+/.test(location.pathname);
  // In the feed, posts keep coming for as long as someone scrolls; keep the most recent ones only.
  const MAX_FEED_RECORDS = 500;
  // A post's own page can carry a very long thread (or reply chain) too, so it needs a cap of its own:
  // higher than the feed's, since threadOf reads up to 50 posts back from wherever the cap left the
  // parent, but still finite, so an endless scroll on one post's page can't grow the map forever.
  const MAX_POST_RECORDS = 2000;

  // The post's own link, from its timestamp (the way X has linked a post for years); "" when it has none.
  const permalink = (post) => post.querySelector('a[href*="/status/"] time')?.parentElement?.getAttribute("href") || "";
  // The status ids of every post link in the post, with each link, in page order.
  const statusLinks = (post) => [...post.querySelectorAll('a[href*="/status/"]')]
    .map((a) => { const href = a.getAttribute("href") || ""; return { href, id: href.match(/\/status\/(\d+)/)?.[1] }; })
    .filter((l) => l.id);

  // Asks x-post-data.js (in X's own page) for this post's summary, checks it, and keeps it. Null when
  // there is none or it fails a check. X is a single-page app: a new post's page, or a new address off a
  // post's page, starts a new set. In a picture or video view nothing is read: only what was read before.
  function readRecord(post) {
    if (!XT) return null;
    if (mediaView()) return records.get(post.dataset.sieveXId) || null;
    const page = pageKey();
    if (page !== recordsPage) { records.clear(); recordsPage = page; }
    try {
      delete post.dataset.sieveXId;
      post.removeAttribute("data-sieve-x");
      post.dispatchEvent(new CustomEvent("sieve-x-post", { bubbles: true }));
      const rec = XT.readRecord(post.getAttribute("data-sieve-x"));
      post.removeAttribute("data-sieve-x");
      if (!rec) return null;
      // The reader walks X's React data up from the post, so it could land on a container's post instead
      // of this one. When the post links to any post, one of those links has to be the record's. Not just
      // the first link: on a post's own page X puts its timestamp at the bottom, after any quoted post's.
      const ids = statusLinks(post).map((l) => l.id);
      if (ids.length && !ids.includes(rec.id)) return null;
      records.delete(rec.id); // put back at the end, so the cap below drops the posts read longest ago
      records.set(rec.id, rec);
      const cap = onPostPage() ? MAX_POST_RECORDS : MAX_FEED_RECORDS;
      while (records.size > cap) records.delete(records.keys().next().value);
      post.dataset.sieveXId = rec.id;
      return rec;
    } catch {
      return null;
    }
  }

  // The post's own words and any post it quotes, as extract() reads them.
  const textOf = (post) => [...post.querySelectorAll(TEXT)].map((t) => t.innerText.trim()).filter(Boolean).join("\n\n[quoted post]\n");

  // An ad: "Ad" or "Promoted" in the header, before the post's own words (or in its first 200
  // characters when it has none).
  const isAd = (post, text) => {
    const header = post.innerText.slice(0, 200);
    return /\bAd\b|Promoted/.test(text ? header.split(text.slice(0, 20))[0] || "" : header);
  };

  function extract(post) {
    const text = textOf(post);
    if (!text) return null;
    if (text.length < 40) return null;
    const user = post.querySelector('[data-testid="User-Name"]')?.innerText.replace(/\s+/g, " ").trim() || "";
    if (isAd(post, text)) return null;
    const link = permalink(post);
    return { key: hash(text), url: link ? `https://x.com${link}` : "", state: { author: user.slice(0, 200), post: text.slice(0, 4000) } };
  }

  // What gets saved, and briefed, for a post: the same record the digest page reads.
  function postRecord(key, r) {
    const state = states.get(key) || {};
    return { key, platform: "x", authorName: (state.author || "").split(" @")[0], authorUrl: urls.get(key) || "", text: state.post || "", topic: r.topic, kind: r.kind, worth: r.worth, scorer: r.scorer };
  }

  // Watch it for me on an X video: the same drawer and worker path as YouTube (watch-drawer.js, watch()).
  function watchButton(rec) {
    const w = rec && XT?.watchRequest(rec);
    if (!w) return null;
    const b = document.createElement("button");
    b.className = "jev-suggest sieve-x-watch";
    b.textContent = w.label;
    b.disabled = w.tooLong;
    b.title = "The video model watches the whole video and says whether it's worth your time.";
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); watch(w, false); });
    return b;
  }

  function showWatch(w, r) {
    const D = globalThis.SieveWatchDrawer;
    if (!D?.show) { retire(); return; } // watch-drawer.js didn't load: ask for a reload rather than draw nothing
    D.show({ title: w.msg.title, channel: w.msg.channel, seconds: w.msg.seconds }, r, { again: () => watch(w, true), price: w.price, showCost: true });
  }

  function watch(w, again) {
    if (retired || !alive()) { showWatch(w, { error: "Sieve was updated. Reload this page to keep using it." }); return; }
    showWatch(w, null);
    send({ ...w.msg, again }, (r) => {
      if (!enabled) return; // X was switched off while the video was being watched; its drawer is gone
      showWatch(w, r || { error: "No answer from the extension." });
    });
  }

  // A video post Sieve doesn't score (too few words to judge) still gets Watch it for me.
  function renderWatchOnly(post, rec) {
    const b = watchButton(rec);
    if (!b) return;
    delete post.dataset.jevKey; // no words to score: any key here is from a post X drew in this element before
    const wrap = wrapOf(post);
    if (wrap.dataset.sieveWatchOnly === rec.id) return;
    wrap.dataset.sieveWatchOnly = rec.id;
    delete wrap.dataset.jevKey;
    wrap.replaceChildren();
    wrap.className = "sieve-x-wrap";
    post.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe");
    const badge = document.createElement("div");
    badge.className = "jev-badge jev-quiet";
    badge.textContent = "Sieve";
    const actions = document.createElement("span");
    actions.className = "jev-actions";
    actions.append(b);
    badge.append(actions);
    wrap.append(badge);
  }

  // Badges sit just above the post, outside X's own layout.
  function wrapOf(post) {
    let w = post.previousElementSibling;
    if (!w || !w.classList.contains("sieve-x-wrap")) { w = document.createElement("div"); w.className = "sieve-x-wrap"; post.before(w); }
    return w;
  }

  // X can draw another post in an article element it already used. check() notes the post's own link on
  // the element; when the link changes, what Sieve drew there (the wrap above it, with any brief or Watch
  // button, and the classes) was for the old post and goes.
  function undecorate(post) {
    const w = post.previousElementSibling;
    if (w?.classList.contains("sieve-x-wrap")) w.remove();
    post.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe");
    delete post.dataset.jevKey;
  }
  const reused = (post) => post.dataset.sieveXLink !== undefined && permalink(post) !== post.dataset.sieveXLink;

  function clearAll() {
    document.querySelectorAll(".sieve-x-wrap").forEach((w) => w.remove());
    document.getElementById("sieve-drawer")?.remove(); // a Watch it for me drawer opened from X
    document.querySelectorAll(POST).forEach((p) => { p.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe"); delete p.dataset.jevKey; });
  }

  function render(post, r) {
    const wrap = wrapOf(post);
    wrap.dataset.jevKey = post.dataset.jevKey;
    delete wrap.dataset.sieveWatchOnly;
    // The post's record, for Watch it for me. The records may have been reset (another page) or capped
    // since the post was read: read it again. The wrap notes which record this drawing considered, so
    // check() draws again only when a new one arrives, not on every dwell over a hidden or error post.
    const id = post.dataset.sieveXId;
    const rec = id ? records.get(id) || readRecord(post) : null;
    wrap.dataset.sieveXWatch = rec?.id || "";
    wrap.replaceChildren();
    wrap.className = "sieve-x-wrap";
    post.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe");
    const badge = document.createElement("div");
    badge.className = "jev-badge";
    if (r.error) { badge.classList.add("jev-error"); badge.textContent = ERRORS[r.error] || (r.error.startsWith("http_") ? `Sieve: the scoring service answered ${r.error.slice(5)}. Reload the page to try again` : `Sieve: ${r.error}`); wrap.append(badge); return; }
    if (r.tier === "low" && r.lowMode === "hide") { post.classList.add("jev-hidden"); return; }
    if (r.tier === "low" && r.lowMode === "fade") post.classList.add("jev-low");
    if (r.tier !== "low") { post.classList.add(`sieve-x-${r.tier}`); wrap.classList.add(`jev-${r.tier}`); }
    const bits = [LABEL[r.kind], r.topic, r.reason].filter(Boolean).join(" · ");
    badge.textContent = `Sieve ${r.worth.toFixed(2)} · ${bits}`;
    const actions = document.createElement("span");
    actions.className = "jev-actions";
    if (r.tier !== "low" && r.kind === "technique") {
      const bb = document.createElement("button");
      bb.className = "jev-suggest";
      bb.textContent = "Brief";
      bb.title = "A brief for your coding agent: what it is, what you need, and a small way to try it.";
      bb.dataset.jevBriefBtn = "1";
      bb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); briefPanel(wrap, post, r, false); });
      actions.append(bb);
    }
    // Any post with a video Sieve can send, low or not (a hidden one returned above).
    const wb = watchButton(rec);
    if (wb) actions.append(wb);
    if (actions.childNodes.length) badge.append(actions);
    if (r.tier === "low") badge.classList.add("jev-quiet");
    wrap.append(badge);
  }

  // What Brief sends: today's post, or with X's page data the full text, the pictures and the thread.
  function briefRequestFor(post, r) {
    const base = postRecord(post.dataset.jevKey, r);
    // Anything going wrong with X's page data still leaves today's brief of the post itself.
    try {
      const rec = readRecord(post);
      return XT && rec ? XT.briefRequest(base, records, rec.id, { feed: !onPostPage() }) : { post: base, note: "" };
    } catch {
      return { post: base, note: "" };
    }
  }

  function briefPanel(wrap, post, r, again) {
    let panel = wrap.querySelector(".jev-brief");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "jev-draft jev-brief";
      panel.innerHTML = `<div class="jev-draft-note">A brief for your coding agent.</div>
        <div class="sieve-b-body"></div>
        <div class="jev-draft-row"><button data-a="again">Write it again</button><button data-a="close">Close</button><span class="jev-draft-msg" role="status"></span></div>`;
      for (const ev of ["click", "keydown", "keyup", "keypress", "focusin"]) panel.addEventListener(ev, (e) => e.stopPropagation());
      panel.querySelector('[data-a="again"]').onclick = () => briefPanel(wrap, post, r, true);
      panel.querySelector('[data-a="close"]').onclick = () => {
        panel.remove();
        wrap.querySelector("[data-jev-brief-btn]")?.focus();
      };
      wrap.append(panel);
    }
    if (panel.dataset.busy) return; // a brief is already loading; ignore Brief / Write it again clicks
    const request = briefRequestFor(post, r);
    panel.querySelector(".jev-draft-note").textContent = ["A brief for your coding agent.", request.note].filter(Boolean).join(" ");
    const body = panel.querySelector(".sieve-b-body");
    const msg = panel.querySelector(".jev-draft-msg");
    if (!panel.dataset.hasBrief) body.textContent = ""; // "again" keeps the current brief up until the new one arrives; the status line says "reading…"
    msg.textContent = "reading…";
    msg.classList.remove("jev-brief-err");
    if (!globalThis.SieveBriefPanel?.fill) {
      msg.classList.add("jev-brief-err");
      const text = "Sieve couldn't show the brief. Reload the page and try again.";
      msg.textContent = panel.dataset.hasBrief ? `Couldn't write it again: ${text}` : text;
      if (!panel.dataset.hasBrief) body.textContent = "";
      return;
    }
    panel.dataset.busy = "1";
    const req = String((Number(panel.dataset.req) || 0) + 1);
    panel.dataset.req = req;
    send({ type: "brief", post: request.post, again }, (b) => {
      if (panel.dataset.req !== req) return; // a newer request replaced this one
      panel.dataset.busy = "";
      if (!b || b.error) {
        msg.classList.add("jev-brief-err");
        const text = b?.error || "No answer from the extension. Reload the page and try again.";
        msg.textContent = panel.dataset.hasBrief ? `Couldn't write it again: ${text}` : text;
        if (!panel.dataset.hasBrief) body.textContent = "";
        return;
      }
      // A brief kept from an earlier, longer read of the thread comes back as it was: when it read a
      // different number of posts than this request sent, say how much it read instead of the note about
      // this request. When the numbers match, the request's note (and its hints) still holds.
      const sentPosts = request.post.posts?.length || 1;
      if (Number.isInteger(b.threadPosts) && b.threadPosts >= 2 && b.threadPosts !== sentPosts) panel.querySelector(".jev-draft-note").textContent = `A brief for your coding agent. Read ${b.threadPosts} posts of this thread.`;
      globalThis.SieveBriefPanel.fill(body, b);
      panel.dataset.hasBrief = "1";
      msg.textContent = "Brief ready.";
    });
  }

  function check(post) {
    if (retired) return;
    if (!enabled) return;
    const p = extract(post);
    const rec = readRecord(post); // before any early return: a thread's short posts are still part of it
    if (reused(post) || (post.dataset.jevKey && post.dataset.jevKey !== p?.key)) undecorate(post); // another post in this element
    post.dataset.sieveXLink = permalink(post);
    if (!p) { if (rec?.video && !isAd(post, textOf(post))) renderWatchOnly(post, rec); return; }
    post.dataset.jevKey = p.key;
    states.set(p.key, p.state);
    // With a record, the post's own link is the one with the record's id: the first timestamp can be a
    // quoted post's (X puts a focal post's own timestamp at the bottom).
    // Cut after the id: a picture's link (/status/<id>/photo/1) carries the id too.
    const own = rec && statusLinks(post).find((l) => l.id === rec.id)?.href.match(/^\/[A-Za-z0-9_]{1,15}\/status\/\d+/)?.[0];
    urls.set(p.key, own ? `https://x.com${own}` : p.url);
    if (results.has(p.key)) {
      const w = post.previousElementSibling;
      // Drawn already, unless a record with a video arrived after the drawing (sieveXWatch, set by render()).
      if (w?.classList.contains("sieve-x-wrap") && w.dataset.jevKey === p.key && (!XT?.watchRequest(rec) || w.dataset.sieveXWatch === rec.id)) return;
      return render(post, results.get(p.key));
    }
    if (pending.has(p.key)) return;
    pending.add(p.key);
    send({ type: "classify", platform: "x", state: p.state }, (r) => {
      pending.delete(p.key);
      if (!r || r.error === "rate_limited" || r.error === "network" || r.error === "timeout") return;
      results.set(p.key, r);
      if (!r.error && r.tier === "strong") send({ type: "save", post: postRecord(p.key, r) });
      // Not on an element X has since given another post, before scan() noticed.
      document.querySelectorAll(POST).forEach((el) => { if (el.dataset.jevKey === p.key && !reused(el)) render(el, r); });
    });
  }

  const timers = new WeakMap();
  const visible = new WeakSet(); // posts on screen now: a reused one gets no new IntersectionObserver event
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target);
      if (e.isIntersecting) timers.set(e.target, setTimeout(() => check(e.target), DWELL_MS));
      else clearTimeout(timers.get(e.target));
    }
  }, { threshold: 0.5 });

  function scan() {
    if (retired || !alive()) { if (!retired) retire(); return; }
    markDark();
    document.querySelectorAll(POST).forEach((post) => {
      if (!post.dataset.jevWatched) {
        post.dataset.jevWatched = "1";
        seen.observe(post);
        // On a post's page, every post is read as it appears, so a thread scrolled past quickly is still
        // whole when Brief is pressed (X removes posts from the page as they scroll away).
        if (enabled && onPostPage()) readRecord(post);
      }
      if (reused(post)) {
        undecorate(post);
        delete post.dataset.sieveXLink;
        clearTimeout(timers.get(post));
        if (visible.has(post)) timers.set(post, setTimeout(() => check(post), DWELL_MS));
        return;
      }
      const r = post.dataset.jevKey && results.get(post.dataset.jevKey);
      const prev = post.previousElementSibling;
      if (r && !(prev && prev.classList.contains("sieve-x-wrap"))) render(post, r); // X re-rendered it
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.prefs) return;
    enabled = changes.prefs.newValue?.xOn !== false;
    results.clear();
    clearAll();
    if (enabled) document.querySelectorAll(POST).forEach((p) => { const b = p.getBoundingClientRect(); if (b.bottom > 0 && b.top < innerHeight) check(p); });
  });

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
