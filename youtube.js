// YouTube: a Jev chip on each video you scroll past (title, channel, length), and
// "Watch it for me", which has a video model watch the whole thing on request.
// Never plays, likes, comments or subscribes.
(() => {
  const TILE = "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model";
  const DWELL_MS = 600;
  const USD_PER_MINUTE = 0.0022; // keep in sync with watch-prompt.js
  const MAX_MINUTES = 55;
  const LABEL = {
    tutorial: "tutorial", build_demo: "build or demo", talk: "talk", commentary: "commentary",
    entertainment: "entertainment", promo: "promo",
  };
  const ERRORS = {
    no_key: "Sieve: add your TypeSafe key in settings",
    key_rejected: "Sieve: key rejected",
    no_credit: "Sieve: out of TypeSafe credit",
  };

  let enabled = true;
  const results = new Map();
  const pending = new Set();
  chrome.storage.local.get("prefs").then((v) => { enabled = v.prefs?.youtubeOn !== false; if (!enabled) clearAll(); });

  const cost = (seconds) => {
    if (!seconds) return "";
    const usd = (seconds / 60) * USD_PER_MINUTE;
    return usd < 0.01 ? "<1¢" : `~${Math.round(usd * 100)}¢`;
  };
  const toSeconds = (t) => String(t).trim().split(":").map(Number).reduce((a, n) => a * 60 + n, 0);
  const isoSeconds = (iso) => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  };
  const videoId = (href) => { try { return new URL(href, location.origin).searchParams.get("v"); } catch { return null; } };

  function tiles() {
    return [...document.querySelectorAll(TILE)].filter((el) => !el.parentElement?.closest(TILE) && el.querySelector('a[href*="/watch?v="]'));
  }

  function read(el) {
    const link = el.querySelector('a[href*="/watch?v="]');
    const id = videoId(link.getAttribute("href"));
    if (!id) return null;
    const titleEl = el.querySelector("#video-title, h3 a, h3, a[title]");
    const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
    const channel = (el.querySelector('ytd-channel-name a, a[href^="/@"]')?.textContent || "").trim();
    const badge = [...el.querySelectorAll("badge-shape, ytd-thumbnail-overlay-time-status-renderer, [class*='badge']")]
      .map((b) => b.textContent.trim()).find((t) => /^\d{1,2}(:\d{2}){1,2}$/.test(t));
    const snippet = (el.querySelector(".metadata-snippet-text, #description-text")?.textContent || "").trim();
    if (!title) return null;
    return { id, url: `https://www.youtube.com/watch?v=${id}`, title, channel, seconds: badge ? toSeconds(badge) : 0, snippet };
  }

  function thumbOf(el) {
    return el.querySelector("ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail, a.yt-lockup-view-model__content-image, a[href*='/watch?v=']");
  }

  function clearAll() {
    document.querySelectorAll(".sieve-yt-chip").forEach((c) => c.remove());
    tiles().forEach((el) => { el.classList.remove("jev-low", "jev-hidden", "sieve-yt-strong"); delete el.dataset.jevKey; });
  }

  function render(el, v, r) {
    const thumb = thumbOf(el);
    if (!thumb) return;
    thumb.querySelector(":scope > .sieve-yt-chip")?.remove();
    el.classList.remove("jev-low", "jev-hidden", "sieve-yt-strong");
    if (getComputedStyle(thumb).position === "static") thumb.style.position = "relative";
    const chip = document.createElement("div");
    chip.className = "sieve-yt-chip";
    for (const ev of ["click", "mousedown", "mouseup", "pointerdown"]) chip.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "click") e.preventDefault(); });
    if (r.error) {
      chip.textContent = ERRORS[r.error] || "Sieve: error";
      chip.classList.add("sieve-yt-err");
      thumb.append(chip);
      return;
    }
    if (r.tier === "strong") { chip.classList.add("sieve-yt-chip-strong"); el.classList.add("sieve-yt-strong"); }
    if (r.tier === "low" && r.lowMode === "fade") el.classList.add("jev-low");
    if (r.tier === "low" && r.lowMode === "hide") { el.classList.add("jev-hidden"); return; }
    const score = document.createElement("span");
    score.textContent = `Jev ${r.worth.toFixed(2)}${LABEL[r.kind] ? " · " + LABEL[r.kind] : ""}`;
    score.title = [r.topic, r.reason].filter(Boolean).join(" · ") || "Jev's guess from the title, channel and length";
    chip.append(score);
    if (r.tier !== "low") chip.append(watchButton(v));
    thumb.append(chip);
  }

  function watchButton(v) {
    const b = document.createElement("button");
    b.className = "sieve-yt-watch";
    const tooLong = v.seconds && v.seconds / 60 > MAX_MINUTES;
    b.textContent = tooLong ? "too long to watch" : `Watch it for me${v.seconds ? " · " + cost(v.seconds) : ""}`;
    b.disabled = !!tooLong;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); watch(v, false); });
    return b;
  }

  // ---- the drawer ----
  function drawer() {
    let d = document.getElementById("sieve-drawer");
    if (!d) {
      d = document.createElement("aside");
      d.id = "sieve-drawer";
      for (const ev of ["click", "keydown", "keyup", "keypress"]) d.addEventListener(ev, (e) => e.stopPropagation());
      document.body.append(d);
    }
    return d;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function stamp(v, t) {
    const a = el("a", "sieve-ts", t);
    const s = toSeconds(t);
    a.href = `${v.url}&t=${s}s`;
    a.addEventListener("click", (e) => {
      const video = document.querySelector("video");
      if (videoId(location.href) === v.id && video) { e.preventDefault(); video.currentTime = s; video.play?.(); }
    });
    return a;
  }

  function show(v, r) {
    const d = drawer();
    d.replaceChildren();
    const head = el("div", "sieve-d-head");
    head.append(el("span", "sieve-d-brand", "Sieve · watched for you"));
    const close = el("button", "sieve-d-close", "×");
    close.onclick = () => d.remove();
    head.append(close);
    d.append(head, el("div", "sieve-d-title", v.title), el("div", "sieve-d-meta", [v.channel, v.seconds ? `${Math.round(v.seconds / 60)} min` : ""].filter(Boolean).join(" · ")));
    if (!r) { d.append(el("div", "sieve-d-wait", `Watching the whole video${v.seconds ? ` (${cost(v.seconds)})` : ""}. This takes about 10 to 40 seconds…`)); return; }
    if (r.error) {
      const retry = el("button", "sieve-d-again", "Try again");
      retry.onclick = () => watch(v, true);
      d.append(el("div", "sieve-d-err", r.error), retry);
      return;
    }
    const verdict = el("div", `sieve-d-verdict sieve-v-${r.verdict}`, { watch: "Worth watching", skim: "Skim it", skip: "Skip it" }[r.verdict]);
    d.append(verdict, el("p", "sieve-d-why", r.why), el("p", "", r.summary));
    if (r.best) {
      const best = el("div", "sieve-d-best");
      best.append(el("b", "", "Best moment "), stamp(v, r.best.t), document.createTextNode(" " + r.best.text));
      d.append(best);
    }
    const section = (title, items, render) => {
      if (!items.length) return;
      d.append(el("h4", "", title));
      const ul = el("ul");
      for (const it of items) { const li = el("li"); render(li, it); ul.append(li); }
      d.append(ul);
    };
    section("Key points", r.points, (li, p) => li.append(stamp(v, p.t), document.createTextNode(" " + p.text)));
    section("Learnings", r.learnings, (li, t) => li.append(t));
    section("Check before repeating", r.checks, (li, t) => li.append(t));
    const foot = el("div", "sieve-d-foot", `Saved to your daily learnings. These are the creator's claims, not verified facts.${r.cost ? ` Cost $${r.cost.toFixed(4)}.` : ""}`);
    const again = el("button", "sieve-d-again", "Watch again");
    again.onclick = () => watch(v, true);
    d.append(foot, again);
  }

  function watch(v, again) {
    show(v, null);
    chrome.runtime.sendMessage({ type: "watch", id: v.id, url: v.url, title: v.title, channel: v.channel, seconds: v.seconds, again }, (r) => show(v, r || { error: "No answer from the extension." }));
  }

  // ---- watch page button ----
  function watchPage() {
    const id = videoId(location.href);
    const host = document.querySelector("ytd-watch-metadata #title");
    document.querySelectorAll(".sieve-yt-bar").forEach((b) => { if (b.dataset.id !== id) b.remove(); });
    if (!enabled || !id || !host || host.parentElement.querySelector(`.sieve-yt-bar[data-id="${id}"]`)) return;
    const title = document.querySelector("ytd-watch-metadata h1")?.innerText.trim();
    if (!title) return;
    const v = {
      id, url: `https://www.youtube.com/watch?v=${id}`, title,
      channel: document.querySelector("ytd-watch-metadata ytd-channel-name a")?.innerText.trim() || "",
      seconds: isoSeconds(document.querySelector('meta[itemprop="duration"]')?.content) || toSeconds(document.querySelector(".ytp-time-duration")?.textContent || "0"),
    };
    const bar = el("div", "sieve-yt-bar");
    bar.dataset.id = id;
    bar.append(el("span", "sieve-yt-bar-label", "Sieve"), watchButton(v));
    host.after(bar);
  }

  // ---- scoring ----
  function check(tile) {
    if (!enabled) return;
    const v = read(tile);
    if (!v) return;
    tile.dataset.jevKey = v.id;
    if (results.has(v.id)) return render(tile, v, results.get(v.id));
    if (pending.has(v.id)) return;
    pending.add(v.id);
    const state = { title: v.title, channel: v.channel, length: v.seconds ? `${Math.round(v.seconds / 60)} min` : "unknown", snippet: v.snippet };
    chrome.runtime.sendMessage({ type: "classify", platform: "youtube", state }, (r) => {
      pending.delete(v.id);
      if (!r) return;
      if (r.error === "rate_limited" || r.error === "network") return;
      results.set(v.id, r);
      tiles().forEach((t) => { if (t.dataset.jevKey === v.id) render(t, v, r); });
    });
  }

  const timers = new WeakMap();
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) timers.set(e.target, setTimeout(() => check(e.target), DWELL_MS));
      else clearTimeout(timers.get(e.target));
    }
  }, { threshold: 0.5 });

  function scan() {
    for (const t of tiles()) {
      if (!t.dataset.jevWatched) { t.dataset.jevWatched = "1"; seen.observe(t); }
      const key = t.dataset.jevKey;
      if (key && results.has(key) && !thumbOf(t)?.querySelector(":scope > .sieve-yt-chip")) { const v = read(t); if (v) render(t, v, results.get(key)); }
    }
    watchPage();
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.prefs) return;
    enabled = changes.prefs.newValue?.youtubeOn !== false;
    results.clear();
    clearAll();
    document.querySelectorAll(".sieve-yt-bar").forEach((b) => b.remove());
    if (enabled) scan();
  });

  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; scan(); }); } })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", scan);
  scan();
})();
