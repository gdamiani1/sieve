// A tiny stand-in for the browser's DOM: enough to run Sieve's classic content scripts in node:vm and
// read back what they built. Not a browser: no layout, no CSS, no selector engine (only getElementById).
export class Text {
  constructor(data) { this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
}

export class Element {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.id = "";
    this.className = "";
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.onclick = null;
    this.href = "";
    this.target = "";
    this.rel = "";
    this.title = "";
    this.disabled = false;
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(" ").filter(Boolean);
    return {
      add: (...c) => { el.className = [...new Set([...list(), ...c])].join(" "); },
      remove: (...c) => { el.className = list().filter((x) => !c.includes(x)).join(" "); },
      contains: (c) => list().includes(c),
      toggle: (c, on) => {
        const want = on === undefined ? !list().includes(c) : !!on;
        if (want) el.classList.add(c); else el.classList.remove(c);
        return want;
      },
    };
  }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(t) { this.replaceChildren(); if (t !== "" && t !== null && t !== undefined) this.append(String(t)); }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === "string" ? new Text(n) : n;
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  prepend(...nodes) {
    const norm = nodes.map((n) => (typeof n === "string" ? new Text(n) : n));
    for (const n of norm) { n.parentNode?.removeChild(n); n.parentNode = this; }
    this.childNodes = [...norm, ...this.childNodes];
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  replaceChildren(...nodes) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() {
    if (this.disabled) return;
    const e = { type: "click", preventDefault() {}, stopPropagation() {} };
    for (const fn of this.listeners.click || []) fn(e);
    this.onclick?.(e);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
}

export function fakeDocument() {
  const doc = {
    createElement: (t) => new Element(t, doc),
    createTextNode: (t) => new Text(t),
  };
  doc.body = new Element("body", doc);
  doc.documentElement = new Element("html", doc);
  const all = (root) => root.children.flatMap((c) => [c, ...all(c)]);
  doc.getElementById = (id) => all(doc.body).find((e) => e.id === id) || null;
  return doc;
}

// One line per node, children indented two spaces: `tag#id.class1.class2`, plus ` href=...` on a link;
// a text node is its text as a JSON string. Enough to compare what a script built with what it should.
export function outline(node, depth = 0) {
  const pad = "  ".repeat(depth);
  if (node instanceof Text) return [`${pad}${JSON.stringify(node.data)}`];
  const name = node.tagName.toLowerCase() + (node.id ? `#${node.id}` : "") + node.className.split(" ").filter(Boolean).map((c) => `.${c}`).join("");
  const extra = node.tagName === "A" && node.href ? ` href=${node.href}` : "";
  return [`${pad}${name}${extra}`, ...node.childNodes.flatMap((c) => outline(c, depth + 1))];
}
