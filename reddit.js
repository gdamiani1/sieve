// Reddit triage. Reads only posts that stay on screen, never votes, comments or posts.
// New Reddit: <shreddit-post> elements with attributes. Old Reddit: .thing.link with data-* attributes.
(() => {
  const DWELL_MS = 600;
  const FRESH_HOURS = 12;
  const FRESH_COMMENTS = 40;

  const LABEL = {
    asking_help: "asks for help", discussion: "discussion", showcase: "showcase", rant: "rant", news: "news", promo: "promo",
    automation: "automation", ai_tools: "AI tools", small_business: "small business", croatia: "Croatia", dev: "dev", off_topic: "off topic",
    answer_from_experience: "answer from experience", clarifying_question: "ask for details", approach: "explain your approach",
    share_mistake: "warn about a pitfall", none: "",
  };
  const ERRORS = {
    no_key: "Jev: add your TypeSafe key in the extension options",
    key_rejected: "Jev: key rejected",
    no_credit: "Jev: out of credit, check TypeSafe billing",
    rate_limited: "Jev: rate limited, will retry on next view",
    network: "Jev: network error",
  };

  const results = new Map();
  const infos = new Map();
  const pending = new Set();
  let dimLow = true;
  chrome.storage.local.get("dimLow").then((v) => { dimLow = v.dimLow !== false; });

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
    info.fresh = info.ageHours !== null && info.ageHours <= FRESH_HOURS && info.comments <= FRESH_COMMENTS;
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
    el.classList.remove("jev-strong", "jev-maybe", "jev-low");
    const badge = document.createElement("div");
    badge.className = "jev-badge";
    if (r.error) {
      badge.classList.add("jev-error");
      badge.textContent = ERRORS[r.error] || `Jev: ${r.error}`;
      if (r.error === "rate_limited" || r.error === "network") results.delete(info.key);
      wrap.append(badge);
      return;
    }
    const tier = r.worth >= 0.7 ? "strong" : r.worth >= 0.4 ? "maybe" : "low";
    if (tier !== "low" || dimLow) el.classList.add(`jev-${tier}`);
    wrap.classList.toggle("jev-strong", tier === "strong");
    wrap.classList.toggle("jev-maybe", tier === "maybe");
    const age = info.ageHours === null ? "" : info.ageHours < 1 ? "under 1h old" : `${Math.round(info.ageHours)}h old`;
    const fresh = info.fresh ? "still fresh" : info.ageHours !== null ? "probably too late" : "";
    const bits = [LABEL[r.kind], LABEL[r.topic], age && `${age}, ${info.comments} comments`, tier !== "low" && fresh].filter(Boolean).join(" · ");
    const angle = tier !== "low" && r.angle !== "none" ? ` → ${LABEL[r.angle]}` : "";
    badge.textContent = `Jev ${r.worth.toFixed(2)} · ${bits}${angle}`;
    badge.title = "Jev's read: could you answer this from your own experience? It writes nothing. Replying is up to you.";
    if (tier === "low") { if (dimLow) badge.classList.add("jev-quiet"); wrap.append(badge); return; }
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
    chrome.runtime.sendMessage({ type: "draft", platform: "reddit", author: `u/${info.author} in ${info.subreddit}`, post: `${info.title}\n\n${info.body}`, angle: r.angle, again }, (d) => {
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
    const info = read(el);
    if (!info) return;
    el.dataset.jevKey = info.key;
    infos.set(info.key, info);
    if (results.has(info.key)) return render(el, info, results.get(info.key));
    if (pending.has(info.key)) return;
    pending.add(info.key);
    const state = { subreddit: info.subreddit, title: info.title, body: info.body.slice(0, 4000) };
    chrome.runtime.sendMessage({ type: "classify", platform: "reddit", state }, (r) => {
      pending.delete(info.key);
      if (!r) return;
      results.set(info.key, r);
      if (!r.error && r.worth >= 0.7) {
        chrome.runtime.sendMessage({ type: "save", post: {
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
    for (const el of posts()) {
      if (!el.dataset.jevWatched) { el.dataset.jevWatched = "1"; seen.observe(el); }
      const r = el.dataset.jevKey && results.get(el.dataset.jevKey);
      const prev = el.previousElementSibling;
      if (r && !(prev && prev.classList.contains("jev-r-wrap") && prev.childElementCount)) render(el, infos.get(el.dataset.jevKey), r);
    }
  }

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
