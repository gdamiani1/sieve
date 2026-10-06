// A fresh settings page for the offline options tests: options.html's elements inside <main>, nested as
// the HTML nests them, with `hidden` as the HTML has it, focus, events and querySelectorAll by tag name,
// then the real options.js run against it with chrome stubbed. No keys, no network.
import { readFileSync } from "node:fs";
import { fakeDocument } from "./fake-dom.mjs";

export const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
export const tick = () => new Promise((r) => setTimeout(r, 0));
let loads = 0;

const VOID = new Set(["input", "br", "meta", "img", "hr", "link", "source"]);

/** Calls an element's listeners for `type` (and its on<type> property), as the browser would. */
export function fire(el, type, extra = {}) {
  if (type === "click") return el.click();
  const e = { type, target: el, preventDefault() { e.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  for (const fn of el.listeners[type] || []) fn(e);
  el[`on${type}`]?.(e);
  return e;
}

/**
 * record: what the worker's agentSync status answers. answer: what an agentSync action answers (or a
 * function of the message). store: chrome.storage.local's contents (kept and changed). setFails: the
 * error chrome.storage.local.set throws. stats: what a stats message answers. fetchOk: whether the key
 * checks succeed.
 */
export async function page({ record, granted = true, confirmed = true, answer, store = {}, setFails = null, stats = null, fetchOk = null, saveDelay = 0 } = {}) {
  const doc = fakeDocument();
  const body = html.slice(html.indexOf("<main>"), html.indexOf("</main>") + 7);
  const stack = [doc.body];
  let last = 0;
  const text = (t) => {
    const s = t.replace(/&#10;/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    if (s.trim() && !["SCRIPT", "STYLE"].includes(stack.at(-1).tagName)) stack.at(-1).append(s);
  };
  for (const m of body.matchAll(/<(\/?)(\w+)([^>]*)>/g)) {
    text(body.slice(last, m.index));
    last = m.index + m[0].length;
    const [, close, tag, attrs] = m;
    if (close) { if (stack.length > 1 && stack.at(-1).tagName === tag.toUpperCase()) stack.pop(); continue; }
    const el = doc.createElement(tag);
    el.id = attrs.match(/\sid="([^"]+)"/)?.[1] || "";
    el.className = attrs.match(/\sclass="([^"]+)"/)?.[1] || "";
    el.hidden = /\shidden(\s|$|\/)/.test(attrs);
    for (const [, k, v] of attrs.matchAll(/\s([\w-]+)="([^"]*)"/g)) el.attrs[k] = v;
    if (el.attrs.type) el.type = el.attrs.type;
    if (tag === "input" || tag === "textarea") { el.value = el.attrs.value ?? ""; el.placeholder = el.attrs.placeholder ?? ""; el.checked = false; }
    el.querySelectorAll = (sel) => {
      const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
      return all(el).filter((c) => c.tagName === sel.toUpperCase());
    };
    el.focus = () => { doc.activeElement = el; };
    stack.at(-1).append(el);
    if (!VOID.has(tag) && !attrs.trim().endsWith("/")) stack.push(el);
  }
  // Elements options.js creates (chips) can take focus too.
  const create = doc.createElement;
  doc.createElement = (t) => { const el = create(t); el.focus = () => { doc.activeElement = el; }; return el; };
  doc.activeElement = doc.body;
  doc.visibilityState = "visible";
  doc.listeners = {};
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= []).push(fn); };

  const sent = [];
  const asked = [];
  const sets = [];
  const copied = [];
  globalThis.document = doc;
  const win = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } };
  globalThis.window = win;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  // Prefs writes that come close together are joined; the tests wait for none unless they ask.
  globalThis.SIEVE_SAVE_DELAY_MS = saveDelay;
  const changedListeners = [];
  const tell = (obj) => {
    const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: structuredClone(v) }]));
    setTimeout(() => { for (const fn of changedListeners) fn(changes, "local"); }, 0);
  };
  globalThis.confirm = () => confirmed;
  globalThis.fetch = async () => {
    if (fetchOk === null) throw new Error("no network in this test");
    return { ok: fetchOk, status: fetchOk ? 200 : 401 };
  };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => { copied.push(t); } } }, configurable: true, writable: true });
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const list = keys === undefined || keys === null ? Object.keys(store) : [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        set: async (obj) => {
          if (setFails) throw setFails;
          sets.push(structuredClone(obj));
          Object.assign(store, structuredClone(obj));
          tell(obj);
        },
      },
      onChanged: { addListener: (fn) => changedListeners.push(fn) },
    },
    permissions: { request: async (p) => { asked.push({ p, before: sent.length }); return granted; } },
    runtime: {
      getManifest: () => ({ version: "1.5.0" }),
      sendMessage: async (msg) => {
        if (msg.type === "stats") return typeof stats === "function" ? stats(msg) : stats;
        if (msg.type !== "agentSync") return null;
        sent.push(msg);
        if (msg.do === "status") return record;
        return typeof answer === "function" ? answer(msg) : answer;
      },
    },
  };
  await import(`../options.js?page=${++loads}`);
  for (let i = 0; i < 4; i++) await tick();
  const $ = (id) => doc.getElementById(id);
  // Another page (the popup) writes to storage: Chrome tells this one.
  const elsewhere = (obj) => { Object.assign(store, structuredClone(obj)); tell(obj); };
  return { $, doc, sent, asked, sets, store, copied, elsewhere, window: win };
}

/** Whether an element shows: neither it nor anything it is in is hidden. */
export function visible(el) {
  for (let e = el; e; e = e.parentNode) if (e.hidden) return false;
  return true;
}
