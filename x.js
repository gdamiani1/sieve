// X (Twitter): same scoring and comment angles as LinkedIn. Reads only posts that stay on
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
    ask_failures: "ask about failures and limits", ask_how: "ask how it works", share_result: "share a related result",
    answer_question: "answer their question", disagree: "respectful counterpoint", none: "",
  };
  const ERRORS = { no_key: "Sieve: add your OpenRouter key in the extension settings", or_key_rejected: "Sieve: OpenRouter rejected the key", or_no_credit: "Sieve: out of OpenRouter credit", key_rejected: "Sieve: key rejected", no_credit: "Sieve: out of TypeSafe credit" };

  let enabled = true;
  const results = new Map();
  const states = new Map();
  const urls = new Map(); // key -> the post's own link
  const pending = new Set();
  chrome.storage.local.get("prefs").then((v) => { enabled = v.prefs?.xOn !== false; if (!enabled) clearAll(); });

  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };

  function extract(post) {
    const texts = [...post.querySelectorAll(TEXT)].map((t) => t.innerText.trim()).filter(Boolean);
    if (!texts.length) return null;
    const text = texts.join("\n\n[quoted post]\n");
    if (text.length < 40) return null;
    const user = post.querySelector('[data-testid="User-Name"]')?.innerText.replace(/\s+/g, " ").trim() || "";
    const header = post.innerText.slice(0, 200);
    if (/\bAd\b|Promoted/.test(header.split(text.slice(0, 20))[0] || "")) return null;
    const link = post.querySelector('a[href*="/status/"] time')?.parentElement?.getAttribute("href");
    return { key: hash(text), url: link ? `https://x.com${link}` : "", state: { author: user.slice(0, 200), post: text.slice(0, 4000) } };
  }

  // What gets saved, and briefed, for a post: the same record the digest page reads.
  function postRecord(key, r) {
    const state = states.get(key) || {};
    return { key, platform: "x", authorName: (state.author || "").split(" @")[0], authorUrl: urls.get(key) || "", text: state.post || "", topic: r.topic, kind: r.kind, worth: r.worth };
  }

  // Badges sit just above the post, outside X's own layout.
  function wrapOf(post) {
    let w = post.previousElementSibling;
    if (!w || !w.classList.contains("sieve-x-wrap")) { w = document.createElement("div"); w.className = "sieve-x-wrap"; post.before(w); }
    return w;
  }

  function clearAll() {
    document.querySelectorAll(".sieve-x-wrap").forEach((w) => w.remove());
    document.querySelectorAll(POST).forEach((p) => { p.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe"); delete p.dataset.jevKey; });
  }

  function render(post, r) {
    const wrap = wrapOf(post);
    wrap.dataset.jevKey = post.dataset.jevKey;
    wrap.replaceChildren();
    wrap.className = "sieve-x-wrap";
    post.classList.remove("jev-low", "jev-hidden", "sieve-x-strong", "sieve-x-maybe");
    const badge = document.createElement("div");
    badge.className = "jev-badge";
    if (r.error) { badge.classList.add("jev-error"); badge.textContent = ERRORS[r.error] || `Sieve: ${r.error}`; wrap.append(badge); return; }
    if (r.tier === "low" && r.lowMode === "hide") { post.classList.add("jev-hidden"); return; }
    if (r.tier === "low" && r.lowMode === "fade") post.classList.add("jev-low");
    if (r.tier !== "low") { post.classList.add(`sieve-x-${r.tier}`); wrap.classList.add(`jev-${r.tier}`); }
    const bits = [LABEL[r.kind], r.topic, r.reason].filter(Boolean).join(" · ");
    const angle = r.tier !== "low" && r.angle !== "none" ? ` → ${LABEL[r.angle]}` : "";
    badge.textContent = `Jev ${r.worth.toFixed(2)} · ${bits}${angle}`;
    if (r.tier === "low") { badge.classList.add("jev-quiet"); wrap.append(badge); return; }
    const actions = document.createElement("span");
    actions.className = "jev-actions";
    const btn = document.createElement("button");
    btn.className = "jev-suggest";
    btn.textContent = "Reply angles";
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); angles(wrap, post, r, false); });
    actions.append(btn);
    if (r.kind === "technique") {
      const bb = document.createElement("button");
      bb.className = "jev-suggest";
      bb.textContent = "Brief";
      bb.title = "A brief for your coding agent: what it is, what you need, and a small way to try it.";
      bb.dataset.jevBriefBtn = "1";
      bb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); briefPanel(wrap, post, r, false); });
      actions.append(bb);
    }
    badge.append(actions);
    wrap.append(badge);
  }

  function angles(wrap, post, r, again) {
    let panel = wrap.querySelector(".jev-draft:not(.jev-brief)");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "jev-draft";
      panel.innerHTML = `<div class="jev-draft-note">Ideas, not a reply. Pick one and write it yourself.</div>
        <ul class="jev-angles"></ul>
        <div class="jev-draft-row"><button data-a="again">New angles</button><button data-a="close">Close</button><span class="jev-draft-msg"></span></div>`;
      for (const ev of ["click", "keydown", "keyup", "keypress", "focusin"]) panel.addEventListener(ev, (e) => e.stopPropagation());
      panel.querySelector('[data-a="again"]').onclick = () => angles(wrap, post, r, true);
      panel.querySelector('[data-a="close"]').onclick = () => panel.remove();
      wrap.append(panel);
    }
    const list = panel.querySelector(".jev-angles");
    const msg = panel.querySelector(".jev-draft-msg");
    list.innerHTML = '<li class="jev-thinking">Thinking of angles…</li>';
    msg.textContent = "";
    send({ type: "draft", ...states.get(post.dataset.jevKey), angle: r.angle, again }, (d) => {
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
    send({ type: "brief", post: postRecord(post.dataset.jevKey, r), again }, (b) => {
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

  function check(post) {
    if (retired) return;
    if (!enabled) return;
    const p = extract(post);
    if (!p) return;
    post.dataset.jevKey = p.key;
    states.set(p.key, p.state);
    urls.set(p.key, p.url);
    if (results.has(p.key)) {
      const w = post.previousElementSibling;
      if (w?.classList.contains("sieve-x-wrap") && w.dataset.jevKey === p.key) return;
      return render(post, results.get(p.key));
    }
    if (pending.has(p.key)) return;
    pending.add(p.key);
    send({ type: "classify", platform: "x", state: p.state }, (r) => {
      pending.delete(p.key);
      if (!r || r.error === "rate_limited" || r.error === "network") return;
      results.set(p.key, r);
      if (!r.error && r.tier === "strong") send({ type: "save", post: postRecord(p.key, r) });
      document.querySelectorAll(POST).forEach((el) => { if (el.dataset.jevKey === p.key) render(el, r); });
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
    document.querySelectorAll(POST).forEach((post) => {
      if (!post.dataset.jevWatched) { post.dataset.jevWatched = "1"; seen.observe(post); }
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
