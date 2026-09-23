// Offline: test/fake-dom.mjs itself, the tiny stand-in every classic-content-script test runs its
// script against. Covers prepend's edge cases and a disabled element's click(), the parts none of
// those other tests happen to exercise on their own.
import assert from "node:assert/strict";
import { fakeDocument, Text } from "./fake-dom.mjs";

const doc = fakeDocument();

// A new node is prepended ahead of the existing children, in the order given.
{
  const parent = doc.createElement("div");
  const a = doc.createElement("a"), b = doc.createElement("b");
  parent.append(a);
  parent.prepend(b);
  assert.deepEqual(parent.children, [b, a]);
}

// Prepending a node that is already one of this element's own children moves it to the front,
// rather than leaving the old copy in place and adding a second one.
{
  const parent = doc.createElement("div");
  const a = doc.createElement("a"), b = doc.createElement("b");
  parent.append(a, b);
  parent.prepend(b);
  assert.deepEqual(parent.children, [b, a], "the existing child moved to the front");
  assert.equal(parent.childNodes.length, 2, "not duplicated");
}

// Prepending a node that belongs to another parent detaches it from there first.
{
  const parent = doc.createElement("div"), other = doc.createElement("div");
  const a = doc.createElement("a"), c = doc.createElement("span");
  parent.append(a);
  other.append(c);
  parent.prepend(c);
  assert.deepEqual(parent.children, [c, a]);
  assert.equal(other.children.length, 0, "removed from its old parent");
  assert.equal(c.parentNode, parent);
}

// A plain string is wrapped in a Text node, the same as append does.
{
  const parent = doc.createElement("div");
  parent.prepend("hello");
  assert.ok(parent.childNodes[0] instanceof Text);
  assert.equal(parent.textContent, "hello");
}

// Two nodes prepended in one call keep their own order, both ahead of what was already there.
{
  const parent = doc.createElement("div");
  const a = doc.createElement("a"), b = doc.createElement("b"), d = doc.createElement("i");
  parent.append(a);
  parent.prepend(d, b);
  assert.deepEqual(parent.children, [d, b, a]);
}

// A disabled element's click() fires neither its listeners nor its onclick; re-enabled, both fire.
{
  const button = doc.createElement("button");
  let clicks = 0;
  button.addEventListener("click", () => clicks++);
  button.onclick = () => clicks++;
  button.disabled = true;
  button.click();
  assert.equal(clicks, 0, "a disabled element's click() does nothing");
  button.disabled = false;
  button.click();
  assert.equal(clicks, 2, "re-enabled, both the listener and onclick fire");
}

console.log("fake dom: all checks passed");
