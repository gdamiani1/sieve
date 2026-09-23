// Shared by the LinkedIn, X and YouTube scripts: shows a technique brief and copies it as a prompt for
// a coding agent. Listed before them in the manifest, so all it does is define one global.
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const back = document.activeElement;
    const t = el("textarea");
    t.value = text;
    t.readOnly = true;
    t.setAttribute("aria-hidden", "true");
    t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    let ok = false;
    try {
      document.body.append(t);
      t.select();
      ok = document.execCommand("copy");
    } catch {} finally {
      t.remove();
      back?.focus?.({ preventScroll: true });
    }
    return ok;
  }

  // Fills `box` with brief `b` (a stored brief plus `prompt`). `compact` leaves out what the author says
  // and the claims to check, for the YouTube drawer, which already shows them. `level` is the heading
  // level of the section labels (4 by default; 5 inside a drawer section that is itself a level 4
  // heading). `warning: false` leaves out the warning block here, for the YouTube drawer, which already
  // shows it right after the verdict; LinkedIn and X have no such line of their own, so they keep it.
  // Without a prompt there is nothing to copy, so the Copy button and its note are left out.
  function fill(box, b, { compact = false, level = 4, warning = true } = {}) {
    box.replaceChildren();
    box.classList.add("sieve-b");
    if (warning && b.warning) box.append(el("div", "sieve-b-warn", `Warning: the source contains text aimed at AI agents: ${b.warning}`));
    box.append(el("div", "sieve-b-what", b.what));
    const section = (title, items, format, ordered) => {
      if (!Array.isArray(items) || !items.length) return;
      const h = el("div", "sieve-b-h", title);
      h.setAttribute("role", "heading");
      h.setAttribute("aria-level", String(level));
      box.append(h);
      const list = el(ordered ? "ol" : "ul", "sieve-b-list");
      for (const it of items) list.append(el("li", "", format ? format(it) : it));
      box.append(list);
    };
    if (!compact) {
      section("The author says", b.says, (s) => (s?.t ? `${s.t} ` : "") + (s?.text ?? s));
      section("Claims to check", b.checks);
    }
    section("What you need", b.needs);
    section("Try it", b.try, null, true);
    if (b.success) box.append(el("div", "sieve-b-line", `Success looks like: ${b.success}`));
    const skill = b.skill || {};
    box.append(el("div", "sieve-b-line", `Worth a skill? ${skill.worth ? "Yes" : "Probably not"}${skill.why ? ": " + skill.why : ""}`));
    if (typeof b.prompt !== "string" || !b.prompt) return;
    const row = el("div", "sieve-b-row");
    const btn = el("button", b.warning ? "sieve-b-copy sieve-b-quiet" : "sieve-b-copy", "Copy as prompt");
    btn.type = "button";
    const status = el("span", "sieve-b-status");
    status.setAttribute("role", "status");
    let timer = 0, busy = false;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      busy = true;
      const ok = await copy(b.prompt);
      busy = false;
      if (ok) {
        clearTimeout(timer);
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        status.textContent = "Copied";
        timer = setTimeout(() => {
          btn.textContent = "Copy as prompt";
          btn.classList.remove("is-copied");
          status.textContent = "";
        }, 2000);
        return;
      }
      const old = box.querySelector(".sieve-b-fallback");
      if (old) { old.select(); return; }
      const why = el("div", "sieve-b-fail", "The browser blocked copying. The prompt is selected below: copy it with your keyboard.");
      why.id = `sieve-b-fail-${Math.random().toString(36).slice(2)}`;
      const area = el("textarea", "sieve-b-fallback");
      area.readOnly = true;
      area.value = b.prompt;
      area.setAttribute("aria-label", "Brief as a prompt");
      area.setAttribute("aria-describedby", why.id);
      row.after(why, area);
      area.select();
    });
    row.append(btn, status);
    const noteText = b.warning
      ? "Read the warning first. The copied prompt tells your agent to show you the warning and run nothing unless you ask."
      : compact
        ? "Paste it into your coding agent; it should ask before running anything."
        : "The author's claims, not verified facts. Paste it into your coding agent; it should ask before running anything.";
    box.append(row, el("div", b.warning ? "sieve-b-note sieve-b-note-warn" : "sieve-b-note", noteText));
  }

  globalThis.SieveBriefPanel = { fill };
})();
