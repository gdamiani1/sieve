// "Watch it for me": the drawer that shows what the video model made of a video. Shared by every page
// that offers Watch it for me; a classic content script listed before them in the manifest, like
// brief-panel.js. It only draws: the page script asks the worker and passes the answer in.
//   SieveWatchDrawer.show(v, r, opts)
//     v     the video: { title, channel, seconds }. title should not be empty.
//     r     null while it is being watched, { error } when that failed, or the worker's answer, whose
//           points, learnings and checks are arrays and whose cost is a number.
//     opts  again():  what "Try again" and "Watch again" do; needed, or both buttons do nothing.
//           stamp(t): an element for a timestamp such as "1:05" (YouTube makes it a link); without it
//                     the time is plain text.
//           price:    shown while waiting, such as "<1¢"; "" shows none.
//           showCost: whether the footer says what the answer cost.
// Needs content.css to look right. brief-panel.js is optional; without it the brief shows a fallback
// line instead of breaking. There is one #sieve-drawer per page: each call replaces its contents, and a
// call after it was closed re-creates it.
(() => {
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

  function show(v, r, opts = {}) {
    const again = () => opts.again?.();
    const stamp = (t) => (opts.stamp ? opts.stamp(t) : el("span", "sieve-ts", t));
    const d = drawer();
    d.replaceChildren();
    const head = el("div", "sieve-d-head");
    head.append(el("span", "sieve-d-brand", "Sieve · watched for you"));
    const close = el("button", "sieve-d-close", "×");
    close.onclick = () => d.remove();
    head.append(close);
    d.append(head, el("div", "sieve-d-title", v.title), el("div", "sieve-d-meta", [v.channel, v.seconds ? `${Math.round(v.seconds / 60)} min` : ""].filter(Boolean).join(" · ")));
    if (!r) { d.append(el("div", "sieve-d-wait", `Watching the whole video${opts.price ? ` (${opts.price})` : ""}. This takes about 10 to 40 seconds…`)); return; }
    if (r.error) {
      const retry = el("button", "sieve-d-again", "Try again");
      retry.onclick = again;
      d.append(el("div", "sieve-d-err", r.error), retry);
      return;
    }
    const verdict = el("div", `sieve-d-verdict sieve-v-${r.verdict}`, { watch: "Worth watching", skim: "Skim it", skip: "Skip it" }[r.verdict]);
    d.append(verdict, el("p", "sieve-d-why", r.why));
    if (r.brief?.warning) d.append(el("div", "sieve-b-warn", `Warning: the source contains text aimed at AI agents: ${r.brief.warning}`));
    d.append(el("p", "", r.summary));
    if (r.best) {
      const best = el("div", "sieve-d-best");
      best.append(el("b", "", "Best moment "), stamp(r.best.t), document.createTextNode(" " + r.best.text));
      d.append(best);
    }
    const section = (title, items, render) => {
      if (!Array.isArray(items) || !items.length) return;
      d.append(el("h4", "", title));
      const ul = el("ul");
      for (const it of items) { const li = el("li"); render(li, it); ul.append(li); }
      d.append(ul);
    };
    section("Key points", r.points, (li, p) => li.append(stamp(p.t), document.createTextNode(" " + p.text)));
    section("Learnings", r.learnings, (li, t) => li.append(t));
    section("Check before repeating", r.checks, (li, t) => li.append(t));
    // The prompt is only there when the brief passed normalizeBrief, which enforces the warned-brief
    // rules, so a brief without one is never shown.
    if (r.brief && r.prompt) {
      d.append(el("h4", "sieve-d-brief-h", "Technique brief"));
      const box = el("div", "sieve-d-brief");
      if (globalThis.SieveBriefPanel?.fill) {
        // warning: false -- the drawer already showed this brief's warning right after the verdict.
        globalThis.SieveBriefPanel.fill(box, { ...r.brief, prompt: r.prompt }, { compact: true, level: 5, warning: false }); // its labels sit under this h4
      } else {
        box.append(el("p", "", "Sieve couldn't show the brief. Reload the page and try again."));
      }
      d.append(box);
    }
    const foot = el("div", "sieve-d-foot", `Saved to your daily learnings. These are the creator's claims, not verified facts.${opts.showCost && r.cost ? ` Cost $${r.cost.toFixed(4)}.` : ""}`);
    const more = el("button", "sieve-d-again", "Watch again");
    more.onclick = again;
    d.append(foot, more);
  }

  globalThis.SieveWatchDrawer = { show };
})();
