// Reddit triage. Reads only posts that stay on screen, never votes, comments or posts.
// New Reddit: <shreddit-post> elements with attributes. Old Reddit: .thing.link with data-* attributes.
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
    if (retired) return;
    if (!alive()) return retire();
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) { if (!alive()) retire(); return; }
        cb?.(r);
      });
    } catch { retire(); }
  }

  const DWELL_MS = 600;
  let prefs = { redditOn: true, subreddits: [], freshHours: 12, freshComments: 40 };

  const LABEL = {
    asking_help: "asks for help", discussion: "discussion", showcase: "showcase", rant: "rant", news: "news", promo: "promo",
    answer_from_experience: "answer from experience", clarifying_question: "ask for details", approach: "explain your approach",
    share_mistake: "warn about a pitfall", none: "",
  };
  const ERRORS = {
    no_key: "Sieve: add your OpenRouter key in the extension settings", or_key_rejected: "Sieve: OpenRouter rejected the key", or_no_credit: "Sieve: out of OpenRouter credit",
    key_rejected: "Jev: key rejected",
    no_credit: "Jev: out of credit, check TypeSafe billing",
    rate_limited: "Sieve: rate limited, will retry on next view",
    network: "Sieve: network error",
  };

  const results = new Map();
  const infos = new Map();
  const pending = new Set();
  const applyPrefs = (p = {}) => { prefs = { ...prefs, ...p }; };
  chrome.storage.local.get("prefs").then((v) => applyPrefs(v.prefs));
  const inScope = (info) => prefs.redditOn !== false && (!prefs.subreddits?.length ||
    prefs.subreddits.some((s) => s.replace(/^r\//i, "").toLowerCase() === info.subreddit.replace(/^r\//i, "").toLowerCase()));

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };

  function posts() {
    const modern = [...document.querySelectorAll("shreddit-post")];
    if (modern.length) return modern;
    return [...document.querySelectorAll(".thing.link:not(.promoted)")];
  }

  function read(el) {
    const a = (n) => el.getAttribute(n) || "";
    let info;
    if (el.tagName === "SHREDDIT-POST") {
      if (el.hasAttribute("is-promoted") || a("post-type") === "ad") return null;
      const body = el.querySelector('[slot="text-body"]') || el.querySelector('[property="schema:articleBody"]');
      info = {
        id: a("id") || a("permalink"), title: a("post-title"), author: a("author"),
        subreddit: a("subreddit-prefixed-name"), permalink: a("permalink"),
        created: Date.parse(a("created-timestamp")), comments: Number(a("comment-count")) || 0,
        body: body ? body.innerText.trim() : "",
      };
    } else {
      const body = el.querySelector(".expando .md");
      info = {
        id: a("data-fullname"), title: el.querySelector("a.title")?.innerText || "", author: a("data-author"),
        subreddit: a("data-subreddit-prefixed") || "r/" + a("data-subreddit"), permalink: a("data-permalink"),
        created: Number(a("data-timestamp")), comments: Number(a("data-comments-count")) || 0,
        body: body ? body.innerText.trim() : "",
      };
    }
    if (!info.title) return null;
    if (info.permalink && !info.permalink.startsWith("http")) info.permalink = "https://www.reddit.com" + info.permalink;
    info.ageHours = info.created ? (Date.now() - info.created) / 36e5 : null;
    info.fresh = info.ageHours !== null && info.ageHours <= prefs.freshHours && info.comments <= prefs.freshComments;
    info.key = hash(info.id + info.title);
    return info;
  }

  function slot(el) {
    // Badges go next to the post, not inside it: shreddit-post renders its children through slots.
    let wrap = el.previousElementSibling;
    if (!wrap || !wrap.classList.contains("jev-r-wrap")) {
      wrap = document.createElement("div");
      wrap.className = "jev-r-wrap";
      el.before(wrap);
    }
    return wrap;
  }

  function render(el, info, r) {
    const wrap = slot(el);
    wrap.replaceChildren();
    el.classList.remove("jev-strong", "jev-maybe", "jev-low", "jev-hidden");
    const badge = document.createElement("div");
    badge.className = "jev-badge";
    if (r.error) {
      badge.classList.add("jev-error");
      badge.textContent = ERRORS[r.error] || `Sieve: ${r.error}`;
      if (r.error === "rate_limited" || r.error === "network") results.delete(info.key);
      wrap.append(badge);
      return;
    }
    const tier = r.tier;
    if (tier !== "low") el.classList.add(`jev-${tier}`);
    else if (r.lowMode === "fade") el.classList.add("jev-low");
    else if (r.lowMode === "hide") { el.classList.add("jev-hidden"); wrap.replaceChildren(); return; }
    wrap.classList.toggle("jev-strong", tier === "strong");
    wrap.classList.toggle("jev-maybe", tier === "maybe");
    const age = info.ageHours === null ? "" : info.ageHours < 1 ? "under 1h old" : `${Math.round(info.ageHours)}h old`;
    const fresh = info.fresh ? "still fresh" : info.ageHours !== null ? "probably too late" : "";
    const bits = [LABEL[r.kind], r.topic, age && `${age}, ${info.comments} comments`, tier !== "low" && fresh, r.reason].filter(Boolean).join(" · ");
    const angle = tier !== "low" && r.angle !== "none" ? ` → ${LABEL[r.angle]}` : "";
    badge.textContent = `Jev ${r.worth.toFixed(2)} · ${bits}${angle}`;
    badge.title = "Jev's read: could you answer this from your own experience? It writes nothing. Replying is up to you.";
    if (tier === "low") { if (r.lowMode === "fade") badge.classList.add("jev-quiet"); wrap.append(badge); return; }
    const btn = document.createElement("button");
    btn.className = "jev-suggest";
    btn.textContent = "Reply angles";
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); angles(wrap, info, r, false); });
    badge.append(btn);
    wrap.append(badge);
  }

  function angles(wrap, info, r, again) {
    let panel = wrap.querySelector(".jev-draft");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "jev-draft";
      panel.innerHTML = `<div class="jev-draft-note">Ideas, not a reply. Write it yourself, in plain Reddit voice. No links or mentions of your business for now.</div>
        <ul class="jev-angles"></ul>
        <div class="jev-draft-row"><button data-a="again">New angles</button><button data-a="close">Close</button><span class="jev-draft-msg"></span></div>`;
      for (const ev of ["click", "keydown", "keyup", "keypress", "focusin"]) panel.addEventListener(ev, (e) => e.stopPropagation());
      panel.querySelector('[data-a="again"]').onclick = () => angles(wrap, info, r, true);
      panel.querySelector('[data-a="close"]').onclick = () => panel.remove();
      wrap.append(panel);
    }
    const list = panel.querySelector(".jev-angles");
    const msg = panel.querySelector(".jev-draft-msg");
    list.innerHTML = '<li class="jev-thinking">Thinking of angles…</li>';
    msg.textContent = "";
    send({ type: "draft", platform: "reddit", author: `u/${info.author} in ${info.subreddit}`, post: `${info.title}\n\n${info.body}`, angle: r.angle, again }, (d) => {
      list.innerHTML = "";
      if (!d || d.error) { msg.textContent = d?.error || "No answer from the extension."; return; }
      for (const a of d.angles) {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = a.label + ": ";
        li.append(b, a.text);
        if (a.fact) { const f = document.createElement("div"); f.className = "jev-fact"; f.textContent = "Your fact: " + a.fact; li.append(f); }
        list.append(li);
      }
    });
  }

  function check(el) {
    if (retired) return;
    const info = read(el);
    if (!info || !inScope(info)) return;
    el.dataset.jevKey = info.key;
    infos.set(info.key, info);
    if (results.has(info.key)) return render(el, info, results.get(info.key));
    if (pending.has(info.key)) return;
    pending.add(info.key);
    const state = { subreddit: info.subreddit, title: info.title, body: info.body.slice(0, 4000) };
    send({ type: "classify", platform: "reddit", state }, (r) => {
      pending.delete(info.key);
      if (!r) return;
      results.set(info.key, r);
      if (!r.error && r.tier === "strong") {
        send({ type: "save", post: {
          key: info.key, platform: "reddit", authorName: `u/${info.author} (${info.subreddit})`, authorUrl: info.permalink,
          title: info.title, text: `${info.title}\n\n${info.body}`, topic: r.topic, kind: r.kind, worth: r.worth,
          fresh: info.fresh, createdAt: info.created || null, comments: info.comments,
        } });
      }
      posts().forEach((p) => { if (p.dataset.jevKey === info.key) render(p, info, r); });
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
    if (retired || !alive()) { if (!retired) retire(); return; }
    markDark();
    for (const el of posts()) {
      if (!el.dataset.jevWatched) { el.dataset.jevWatched = "1"; seen.observe(el); }
      const r = el.dataset.jevKey && results.get(el.dataset.jevKey);
      const prev = el.previousElementSibling;
      if (r && !(prev && prev.classList.contains("jev-r-wrap") && prev.childElementCount)) render(el, infos.get(el.dataset.jevKey), r);
    }
  }

  // Settings changed: forget old scores and re-score what's on screen.
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.prefs) return;
    applyPrefs(changes.prefs.newValue);
    results.clear();
    for (const el of posts()) {
      el.classList.remove("jev-strong", "jev-maybe", "jev-low", "jev-hidden");
      const prev = el.previousElementSibling;
      if (prev && prev.classList.contains("jev-r-wrap")) prev.remove();
      delete el.dataset.jevKey;
      const b = el.getBoundingClientRect();
      if (b.bottom > 0 && b.top < innerHeight) check(el);
    }
  });

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();

  // If this layout can't be read, say so once instead of failing silently.
  setTimeout(() => {
    if (posts().length || !/\/(r\/[^/]+\/?($|(hot|new|top|rising)\/?)|$)/.test(location.pathname)) return;
    const n = document.createElement("div");
    n.className = "jev-layout-note";
    n.textContent = "Sieve couldn't find posts on this Reddit layout. Reddit may have changed its markup.";
    n.onclick = () => n.remove();
    document.body.append(n);
  }, 6000);
})();
