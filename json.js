// Tolerant JSON parsing for model answers. Shared by Watch it for me and technique briefs.

// Models occasionally wrap JSON in code fences, leave trailing commas, or get cut off.
// Try the text as is, then repaired, then closed off where it stopped. Throws if nothing works.
export function looseJson(text) {
  let t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  if (start === -1) throw new Error("No JSON object in the answer");
  t = t.slice(start);
  const attempts = [t.slice(0, t.lastIndexOf("}") + 1), t];
  for (const a of attempts) {
    for (const candidate of [a, a.replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(candidate); } catch {}
    }
  }
  // Cut off mid-answer: note every point where a value or key just ended, then
  // walk back from the last one, closing whatever is still open, until one parses.
  const cuts = [];
  const stack = [];
  let inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') { inStr = false; cuts.push([i + 1, stack.slice()]); }
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") { stack.pop(); cuts.push([i + 1, stack.slice()]); }
  }
  for (const [end, open] of cuts.slice(-200).reverse()) {
    const prefix = t.slice(0, end).trim().replace(/,$/, "");
    try {
      const r = JSON.parse(prefix + open.reverse().join(""));
      if (r && typeof r === "object" && !Array.isArray(r)) return r;
    } catch {}
  }
  throw new Error("No JSON object in the answer");
}
