// Runs in LinkedIn's own page, not beside Sieve's other scripts. LinkedIn's 2026 feed keeps a post's id
// only in the page's React data, which content.js can't see from the extension's side. When content.js
// raises "sieve-post-id" on a feed card, this finds the post's id there and writes it on the card as
// data-sieve-urn. It only reads: it never changes the page otherwise. content.js checks what it gets.
(() => {
  const URN = /urn:li:(?:activity|ugcPost|share):\d{6,25}/g;
  // Links from one piece of React's data to other components' (the parent, the next card, older
  // copies) and to DOM nodes: followed, they would lead out of the card.
  const SKIP = new Set(["return", "child", "sibling", "alternate", "stateNode", "_owner", "_debugOwner"]);
  const MAX_FIBERS = 20000;
  const MAX_VALUES = 200000;
  const MAX_DEPTH = 12;

  // The post's id: the one the card mentions most, since its reaction, comment and repost counts are
  // all keyed by it. A share card also names its share once, which isn't the post's link. Ties go to
  // the id seen first. "" when the card has no React data or names no post.
  function postUrn(card) {
    const key = Object.keys(card).find((k) => k.startsWith("__reactFiber$"));
    const counts = new Map();
    const seen = new WeakSet();
    let values = 0;
    const read = (o, depth) => {
      if (!o || typeof o !== "object" || depth > MAX_DEPTH || seen.has(o) || o instanceof Node || values > MAX_VALUES) return;
      seen.add(o);
      for (const k of Object.keys(o)) {
        if (SKIP.has(k) || ++values > MAX_VALUES) continue;
        let v;
        try { v = o[k]; } catch { continue; }
        if (typeof v === "string") for (const [urn] of v.matchAll(URN)) counts.set(urn, (counts.get(urn) || 0) + 1);
        else read(v, depth + 1);
      }
    };
    // The card's own fiber is left out: its sibling is the next card. Everything under it is walked.
    const stack = card[key]?.child ? [card[key].child] : [];
    for (let n = 0; stack.length && n < MAX_FIBERS; n++) {
      const f = stack.pop();
      read(f.memoizedProps, 0);
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    let best = "", most = 0;
    for (const [urn, n] of counts) if (n > most) [best, most] = [urn, n];
    return best;
  }

  document.addEventListener("sieve-post-id", (e) => {
    const card = e.target;
    if (!(card instanceof Element)) return;
    try {
      const urn = postUrn(card);
      if (urn) card.setAttribute("data-sieve-urn", urn);
      else card.removeAttribute("data-sieve-urn");
    } catch {}
  }, true);
})();
