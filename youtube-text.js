// YouTube: what a video tile says beyond its title, for scoring. A classic content script listed before
// youtube.js in the manifest; it has no DOM code of its own, so the tests run it in node.
//   SieveYouTubeText.tileText(parts)      { snippets, chapters, summary } read off a tile -> { snippet, chapters }
//   SieveYouTubeText.clientVersion(text)  YouTube's web client version from the page's own config, or the fallback
//   SieveYouTubeText.describer(opts)      -> describe(id): the start of the video's description, or "" when
//                                         anything goes wrong. One request per video, at most two at a time.
// The description comes from YouTube's own player endpoint, the one the site calls to play or preview a
// video. It is undocumented: when it changes, describe() answers "" and the tile is scored as before.
(() => {
  const SNIPPET_MAX = 1000;
  const CHAPTERS_MAX = 600;
  const DESCRIPTION_MAX = 1500;
  const FALLBACK_VERSION = "2.20260925.00.00";
  // Zero-width and direction characters, which hide text from a reader but not from a model.
  const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

  const clean = (s) => String(s ?? "").replace(INVISIBLE, "").replace(/[ \t]+/g, " ").trim();
  const cap = (s, n) => Array.from(s).slice(0, n).join("");
  const distinct = (list) => [...new Set((list || []).map(clean).filter(Boolean))];

  // snippets: every description line the tile shows (a tile often has each one twice, for two layouts).
  // chapters: chapter titles. summary: the summary YouTube writes for some tiles.
  function tileText({ snippets = [], chapters = [], summary = "" } = {}) {
    const lines = distinct([...snippets, summary]);
    return {
      snippet: cap(lines.join("\n"), SNIPPET_MAX),
      chapters: cap(distinct(chapters).join(" | "), CHAPTERS_MAX),
    };
  }

  function clientVersion(text) {
    const m = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"(\d+\.\d{8}\.\d{2}\.\d{2})"/.exec(String(text ?? ""));
    return m ? m[1] : FALLBACK_VERSION;
  }

  // The start of the description in a player answer, or "" for anything else.
  function descriptionOf(body) {
    const d = body?.videoDetails?.shortDescription;
    return typeof d === "string" ? cap(clean(d.replace(/\r\n?/g, "\n")).replace(/\n{3,}/g, "\n\n"), DESCRIPTION_MAX) : "";
  }

  // fetch: the page's fetch. version(): the client version, asked for on the first request only.
  function describer({ fetch, version, origin = "https://www.youtube.com", timeoutMs = 4000, parallel = 2, keep = 500, trips = 3, restMs = 60000, now = () => Date.now() }) {
    const known = new Map(); // id -> Promise<string>, newest last
    const waiting = [];
    let running = 0;
    let v = "";
    // After `trips` failures in a row (YouTube slow, the endpoint changed, no network), answer "" at once
    // for `restMs`, rather than making every tile wait for the timeout.
    let failures = 0, restUntil = 0;

    const next = () => {
      while (running < parallel && waiting.length) {
        // Newest first: the tile just scrolled to, or on the page just opened, before ones already gone.
        const job = waiting.pop();
        running++;
        job().finally(() => { running--; next(); });
      }
    };

    async function ask(id) {
      if (!v) { try { v = version?.() || FALLBACK_VERSION; } catch { v = FALLBACK_VERSION; } }
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), timeoutMs);
      try {
        const res = await fetch(`${origin}/youtubei/v1/player?prettyPrint=false`, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: v, hl: "en" } } }),
          signal: stop.signal,
        });
        if (!res.ok) return null;
        const body = await res.json();
        // A removed or private video is an answer (no description), not a failure.
        if (!body?.videoDetails && body?.playabilityStatus?.status === "ERROR") return "";
        // The answer must be about the video asked for: anything else is a changed endpoint, not data.
        return body?.videoDetails?.videoId === id ? descriptionOf(body) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    return function describe(id) {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) return Promise.resolve("");
      if (known.has(id)) return known.get(id);
      if (now() < restUntil) return Promise.resolve("");
      // A failure (null) answers "" but isn't remembered, so the video can be asked for again later.
      const p = new Promise((resolve) => {
        // Resting when its turn comes (it was queued before the failures): answer at once, not remembered.
        waiting.push(() => (now() < restUntil ? Promise.resolve(undefined) : ask(id)).then((d) => {
          if (d === undefined) { if (known.get(id) === p) known.delete(id); return resolve(""); }
          if (d === null && known.get(id) === p) known.delete(id);
          failures = d === null ? failures + 1 : 0;
          if (failures >= trips) { failures = 0; restUntil = now() + restMs; }
          resolve(d ?? "");
        }));
      });
      known.set(id, p);
      if (known.size > keep) known.delete(known.keys().next().value);
      next();
      return p;
    };
  }

  globalThis.SieveYouTubeText = { tileText, clientVersion, describer, descriptionOf, SNIPPET_MAX, CHAPTERS_MAX, DESCRIPTION_MAX, FALLBACK_VERSION };
})();
