// Reads only posts that stay on screen long enough for you to see them.
// Never clicks, types, scrolls or posts anything on LinkedIn.
(() => {
  const CARD = '[role="listitem"][componentkey^="update-card-"]';
  const BODY = '[data-testid="expandable-text-box"]';
  const DWELL_MS = 600;
  const MAX_CHARS = 4000;

  const LABEL = {
    built_something: "built something", opinion: "opinion", question: "asks a question",
    news: "news", promo: "promo", personal: "personal",
    ask_failures: "ask about failures and limits", ask_how: "ask how it works",
    share_result: "share a related result", answer_question: "answer their question",
    disagree: "respectful counterpoint", none: "",
  };
  const ERRORS = {
    no_key: "Sieve: add your TypeSafe key in the extension settings",
    key_rejected: "Jev: key rejected",
    no_credit: "Jev: out of credit, check TypeSafe billing",
    rate_limited: "Jev: rate limited, will retry on next view",
    network: "Jev: network error",
  };

  const results = new Map(); // text hash -> result
  const states = new Map(); // text hash -> what Jev saw, reused for drafting
  const pending = new Set();
  let enabled = true;
  chrome.storage.local.get("prefs").then((v) => { enabled = v.prefs?.linkedinOn !== false; if (!enabled) clearAll(); });

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function extract(card) {
    // A reshare has two text boxes: the author's comment, then the post they shared.
    const boxes = [...card.querySelectorAll(BODY)].map((b) => b.innerText.trim()).filter(Boolean);
    if (!boxes.length) return null;
    const text = boxes.join("\n\n[shared post]\n");
    if (text.length < 40) return null;
    const all = card.innerText;
    const header = all.slice(0, Math.max(0, all.indexOf(boxes[0].slice(0, 30)))).trim();
    if (/Promoted/.test(header)) return null;
    return { key: hash(text), state: { author: header.slice(0, 400), post: text.slice(0, MAX_CHARS) } };
  }

  function clearAll() {
    document.querySelectorAll(CARD).forEach((c) => {
      c.querySelector(":scope > .jev-badge")?.remove();
      c.querySelector(":scope > .jev-draft")?.remove();
      c.classList.remove("jev-strong", "jev-maybe", "jev-low", "jev-hidden");
      delete c.dataset.jevKey;
    });
  }

  // Settings changed: forget old scores and re-score what's on screen.
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.prefs) return;
    enabled = changes.prefs.newValue?.linkedinOn !== false;
    results.clear();
    clearAll();
    if (!enabled) return;
    document.querySelectorAll(CARD).forEach((c) => {
      const b = c.getBoundingClientRect();
      if (b.bottom > 0 && b.top < innerHeight) check(c);
    });
  });

  function render(card, r) {
    card.querySelector(":scope > .jev-badge")?.remove();
    card.classList.remove("jev-strong", "jev-maybe", "jev-low", "jev-hidden");
    const badge = document.createElement("div");
    badge.className = "jev-badge";
    if (r.error) {
      badge.classList.add("jev-error");
      badge.textContent = ERRORS[r.error] || `Jev: ${r.error}`;
      if (r.error === "rate_limited" || r.error === "network") results.delete(card.dataset.jevKey);
    } else {
      const tier = r.tier;
      if (tier !== "low") card.classList.add(`jev-${tier}`);
      else if (r.lowMode === "fade") card.classList.add("jev-low");
      else if (r.lowMode === "hide") card.classList.add("jev-hidden");
      const bits = [LABEL[r.kind], r.topic, r.reason].filter(Boolean).join(" · ");
      const angle = tier !== "low" && r.angle !== "none" ? ` → ${LABEL[r.angle]}` : "";
      badge.textContent = `Jev ${r.worth.toFixed(2)} · ${bits}${angle}`;
      badge.title = "Jev's read of this post. It picks from fixed lists and writes nothing. Reading and replying is up to you.";
      if (tier !== "low") {
        const btn = document.createElement("button");
        btn.className = "jev-suggest";
        btn.textContent = "Comment angles";
        btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openDraft(card, r, false); });
        badge.append(btn);
      }
    }
    card.prepend(badge);
  }

  function openDraft(card, r, again) {
    const key = card.dataset.jevKey;
    let panel = card.querySelector(":scope > .jev-draft");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "jev-draft";
      panel.innerHTML = `<div class="jev-draft-note">Ideas, not a comment. Pick one, write it in your own words, paste it into the comment box yourself.</div>
        <ul class="jev-angles"></ul>
        <div class="jev-draft-row"><button data-a="again">New angles</button><button data-a="close">Close</button><span class="jev-draft-msg"></span></div>`;
      for (const ev of ["click", "keydown", "keyup", "keypress", "focusin"]) panel.addEventListener(ev, (e) => e.stopPropagation());
      panel.querySelector('[data-a="again"]').onclick = () => openDraft(card, r, true);
      panel.querySelector('[data-a="close"]').onclick = () => panel.remove();
      card.querySelector(":scope > .jev-badge").after(panel);
    }
    const list = panel.querySelector(".jev-angles");
    const msg = panel.querySelector(".jev-draft-msg");
    list.innerHTML = '<li class="jev-thinking">Thinking of angles…</li>';
    msg.textContent = "";
    chrome.runtime.sendMessage({ type: "draft", ...states.get(key), angle: r.angle, again }, (d) => {
      list.innerHTML = "";
      if (!d || d.error) { msg.textContent = d?.error || "No answer from the extension."; return; }
      for (const a of d.angles) {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = a.label + ": ";
        li.append(b, a.text);
        if (a.fact) {
          const f = document.createElement("div");
          f.className = "jev-fact";
          f.textContent = "Your fact: " + a.fact;
          li.append(f);
        }
        list.append(li);
      }
    });
  }

  function check(card) {
    if (!enabled) return;
    const post = extract(card);
    if (!post) return;
    card.dataset.jevKey = post.key;
    states.set(post.key, post.state);
    if (results.has(post.key)) return render(card, results.get(post.key));
    if (pending.has(post.key)) return;
    pending.add(post.key);
    chrome.runtime.sendMessage({ type: "classify", state: post.state }, (r) => {
      pending.delete(post.key);
      if (!r) return;
      results.set(post.key, r);
      if (!r.error && r.tier === "strong") {
        const profile = card.querySelector('a[href*="/in/"], a[href*="/company/"]');
        const name = [...card.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')].map((a) => a.innerText.trim().split("\n")[0].replace(/\s*•.*$/, "").trim()).find(Boolean);
        chrome.runtime.sendMessage({ type: "save", post: {
          key: post.key, author: post.state.author, authorName: name || "", authorUrl: profile ? profile.href.split("?")[0] : "",
          text: post.state.post, topic: r.topic, kind: r.kind, worth: r.worth,
        } });
      }
      document.querySelectorAll(CARD).forEach((c) => { if (c.dataset.jevKey === post.key) render(c, r); });
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
    document.querySelectorAll(CARD).forEach((card) => {
      if (!card.dataset.jevWatched) { card.dataset.jevWatched = "1"; seen.observe(card); }
      const r = card.dataset.jevKey && results.get(card.dataset.jevKey);
      if (r && !card.querySelector(":scope > .jev-badge")) render(card, r); // LinkedIn re-rendered it
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
