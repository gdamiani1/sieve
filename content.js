// Reads only posts that stay on screen long enough for you to see them.
// Never clicks, types, scrolls or posts anything on LinkedIn.
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

  const CARD = '[role="listitem"][componentkey^="update-card-"]';
  const BODY = '[data-testid="expandable-text-box"]';
  const DWELL_MS = 600;
  const MAX_CHARS = 4000;

  const LABEL = {
    technique: "technique to try", built_something: "built something", opinion: "opinion", question: "asks a question",
    news: "news", promo: "promo", personal: "personal",
    ask_failures: "ask about failures and limits", ask_how: "ask how it works",
    share_result: "share a related result", answer_question: "answer their question",
    disagree: "respectful counterpoint", none: "",
  };
  const ERRORS = {
    no_key: "Sieve: add your OpenRouter key in the extension settings", or_key_rejected: "Sieve: OpenRouter rejected the key. Paste a new one in the extension settings", or_no_credit: "Sieve: out of OpenRouter credit. Add credit at openrouter.ai", unreadable: "Sieve: couldn't read the score. It retries next time the post is on screen",
    key_rejected: "Jev: key rejected",
    no_credit: "Jev: out of credit, check TypeSafe billing",
    rate_limited: "Sieve: rate limited, will retry on next view",
    network: "Sieve: network error",
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

  // The post's own link, or "" when LinkedIn doesn't give its id. The 2026 feed keeps that id only in
  // the page's own data, out of this script's reach, so linkedin-post-id.js (running in the page)
  // writes it on the card when asked; dispatchEvent runs its listener before returning. Only the exact
  // shape of a post id is used, since anything on the page can set an attribute.
  function postLink(card) {
    card.removeAttribute("data-sieve-urn");
    card.dispatchEvent(new CustomEvent("sieve-post-id", { bubbles: true }));
    const urn = card.getAttribute("data-sieve-urn") || "";
    card.removeAttribute("data-sieve-urn");
    return /^urn:li:(?:activity|ugcPost|share):\d{6,25}$/.test(urn) ? `https://www.linkedin.com/feed/update/${urn}/` : "";
  }

  // What gets saved, and briefed, for a post: the same record the digest page reads.
  function postRecord(card, key, r) {
    // Best guess at the real author against 2026 LinkedIn markup: a card can list a reactor's
    // profile link ("Jane Reactor likes this") before the author's own, so take the LAST profile
    // link that comes before the post's text box, not simply the first link on the card. Recheck
    // this against the live site if it ever picks the wrong person.
    const links = [...card.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')];
    const box = card.querySelector(BODY);
    const before = links.filter((a) => box && (box.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING));
    const url = (before.at(-1) || links[0])?.href.split("?")[0] || "";
    const name = links.filter((a) => a.href.split("?")[0] === url).map((a) => a.innerText.trim().split("\n")[0].replace(/\s*•.*$/, "").trim()).find(Boolean);
    const state = states.get(key) || {};
    return {
      key, platform: "linkedin", author: state.author || "", authorName: name || "", authorUrl: url, postUrl: postLink(card),
      text: state.post || "", topic: r.topic, kind: r.kind, worth: r.worth, scorer: r.scorer,
    };
  }

  function clearAll() {
    document.querySelectorAll(CARD).forEach((c) => {
      c.querySelector(":scope > .jev-badge")?.remove();
      c.querySelectorAll(":scope > .jev-draft").forEach((p) => p.remove());
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
      badge.textContent = ERRORS[r.error] || (r.error.startsWith("http_") ? `Sieve: the scoring service answered ${r.error.slice(5)}. It retries next time the post is on screen` : `Sieve: ${r.error}`);
      if (r.error === "rate_limited" || r.error === "network") results.delete(card.dataset.jevKey);
    } else {
      const tier = r.tier;
      if (tier !== "low") card.classList.add(`jev-${tier}`);
      else if (r.lowMode === "fade") card.classList.add("jev-low");
      else if (r.lowMode === "hide") card.classList.add("jev-hidden");
      const bits = [LABEL[r.kind], r.topic, r.reason].filter(Boolean).join(" · ");
      const angle = tier !== "low" && r.angle !== "none" ? ` → ${LABEL[r.angle]}` : "";
      badge.textContent = `${r.scorer === "jev" ? "Jev" : "Sieve"} ${r.worth.toFixed(2)} · ${bits}${angle}`;
      badge.title = `${r.scorer === "jev" ? "Jev's" : "Sieve's"} read of this post. It picks from fixed lists and writes nothing. Reading and replying is up to you.`;
      if (tier !== "low") {
        const actions = document.createElement("span");
        actions.className = "jev-actions";
        const btn = document.createElement("button");
        btn.className = "jev-suggest";
        btn.textContent = "Comment angles";
        btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openDraft(card, r, false); });
        actions.append(btn);
        if (r.kind === "technique") {
          const bb = document.createElement("button");
          bb.className = "jev-suggest";
          bb.textContent = "Brief";
          bb.title = "A brief for your coding agent: what it is, what you need, and a small way to try it.";
          bb.dataset.jevBriefBtn = "1";
          bb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openBrief(card, r, false); });
          actions.append(bb);
        }
        badge.append(actions);
      }
    }
    card.prepend(badge);
  }

  function openDraft(card, r, again) {
    const key = card.dataset.jevKey;
    let panel = card.querySelector(":scope > .jev-draft:not(.jev-brief)");
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
    send({ type: "draft", ...states.get(key), angle: r.angle, again }, (d) => {
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

  function openBrief(card, r, again) {
    const key = card.dataset.jevKey;
    let panel = card.querySelector(":scope > .jev-brief");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "jev-draft jev-brief";
      panel.innerHTML = `<div class="jev-draft-note">A brief for your coding agent.</div>
        <div class="sieve-b-body"></div>
        <div class="jev-draft-row"><button data-a="again">Write it again</button><button data-a="close">Close</button><span class="jev-draft-msg" role="status"></span></div>`;
      for (const ev of ["click", "keydown", "keyup", "keypress", "focusin"]) panel.addEventListener(ev, (e) => e.stopPropagation());
      panel.querySelector('[data-a="again"]').onclick = () => openBrief(card, r, true);
      panel.querySelector('[data-a="close"]').onclick = () => {
        panel.remove();
        card.querySelector(":scope > .jev-badge [data-jev-brief-btn]")?.focus();
      };
      card.querySelector(":scope > .jev-badge").after(panel);
    }
    if (panel.dataset.busy) return; // a brief is already loading; ignore Brief / Write it again clicks
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
    send({ type: "brief", post: postRecord(card, key, r), again }, (b) => {
      if (panel.dataset.req !== req) return; // a newer request replaced this one
      panel.dataset.busy = "";
      if (!b || b.error) {
        msg.classList.add("jev-brief-err");
        const text = b?.error || "No answer from the extension. Reload the page and try again.";
        msg.textContent = panel.dataset.hasBrief ? `Couldn't write it again: ${text}` : text;
        if (!panel.dataset.hasBrief) body.textContent = "";
        return;
      }
      globalThis.SieveBriefPanel.fill(body, b);
      panel.dataset.hasBrief = "1";
      msg.textContent = "Brief ready.";
    });
  }

  function check(card) {
    if (retired) return;
    if (!enabled) return;
    const post = extract(card);
    if (!post) return;
    card.dataset.jevKey = post.key;
    states.set(post.key, post.state);
    if (results.has(post.key)) return render(card, results.get(post.key));
    if (pending.has(post.key)) return;
    pending.add(post.key);
    send({ type: "classify", state: post.state }, (r) => {
      pending.delete(post.key);
      if (!r) return;
      results.set(post.key, r);
      if (!r.error && r.tier === "strong") send({ type: "save", post: postRecord(card, post.key, r) });
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
    if (retired || !alive()) { if (!retired) retire(); return; }
    markDark();
    document.querySelectorAll(CARD).forEach((card) => {
      if (!card.dataset.jevWatched) { card.dataset.jevWatched = "1"; seen.observe(card); }
      const r = card.dataset.jevKey && results.get(card.dataset.jevKey);
      if (r && !card.querySelector(":scope > .jev-badge")) render(card, r); // LinkedIn re-rendered it
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
