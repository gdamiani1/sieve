// Offline: the settings page saves as you change (extension settings pinboard spec 5). Each kind of
// control writes the same storage keys and values the old Save settings button (saveAll) wrote, through
// the same validation, and a "Saved" toast confirms. Keys still save only through Check and save keys.
// Runs the real options.js against a fake DOM built from options.html. No keys, no network.
import assert from "node:assert/strict";
import { DEFAULT_PREFS, DEFAULT_REDDIT_ABOUT, KINDS, REDDIT_KINDS, YOUTUBE_KINDS } from "../prefs.js";
import { DEFAULT_MODEL } from "../models.js";
import { DEFAULT_VIDEO_MODEL } from "../watch-prompt.js";
import { fire, html, page, tick } from "./options-page.mjs";

const off = { on: false, state: "off" };
// What saveAll wrote as prefs for an untouched page: every default, in loadPrefs' shape.
const saved = (change = {}) => ({ ...structuredClone(DEFAULT_PREFS), ...change });
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const change = async (el, value, prop = "value") => { el[prop] = value; fire(el, "change"); await settle(); };
const toastSaid = ($, words) => {
  assert.equal($("toast").getAttribute("role"), "status");
  assert.equal($("toast").hidden, false, "the live region is always in the page");
  assert.equal($("toast").textContent, words);
};
const chip = ($, container, key) => $(container).children.find((c) => c.dataset.key === key || c.dataset.value === key);

// No Save settings bar, no saveAll, no saveMsg.
assert.doesNotMatch(html, /id="saveAll"|id="saveMsg"|Save settings/);
// The key fields point to their footnotes.
assert.match(html, /id="orkey"[^>]*aria-describedby="keysFoot"/);
assert.match(html, /id="key"[^>]*aria-describedby="tsFoot"/);
assert.match(html, /<p class="foot" id="keysFoot">Stored only in this browser/);
assert.match(html, /<p class="foot" id="tsFoot">A TypeSafe key is only used/);
// One filled blue button on the page: Check and save keys.
assert.deepEqual([...html.matchAll(/class="btn primary"[^>]*id="(\w+)"/g)].map((m) => m[1]), ["saveKeys"]);

// The page shows the defaults on a fresh install, and nothing is written just by opening it.
{
  const { $, sets } = await page({ record: off });
  assert.equal($("role").value, DEFAULT_PREFS.role);
  assert.equal($("topics").value, DEFAULT_PREFS.topics.join("\n"));
  assert.equal($("model").value, DEFAULT_MODEL);
  assert.equal($("videoModel").value, DEFAULT_VIDEO_MODEL);
  assert.equal($("redditAbout").value, DEFAULT_REDDIT_ABOUT);
  assert.equal($("rtime").value, "18:00");
  assert.equal($("remind").checked, true);
  assert.equal($("highAtOut").textContent, "0.70");
  assert.equal($("version").textContent, "1.5.0");
  assert.deepEqual(sets, []);
  assert.equal($("toast").hidden, false, "the live region is in the page from the start");
  assert.equal($("toast").textContent, "", "and empty");
  // Chips: every kind, the chosen ones pressed.
  for (const [box, names, values] of [["kinds", KINDS, DEFAULT_PREFS.kinds], ["redditKinds", REDDIT_KINDS, DEFAULT_PREFS.redditKinds], ["youtubeKinds", YOUTUBE_KINDS, DEFAULT_PREFS.youtubeKinds]]) {
    assert.deepEqual($(box).children.map((c) => c.textContent), Object.values(names));
    assert.deepEqual($(box).children.map((c) => c.getAttribute("aria-pressed")), Object.keys(names).map((k) => String(values[k] !== false)));
  }
  assert.equal($("lowMode").getAttribute("role"), "radiogroup");
  assert.deepEqual($("lowMode").children.map((c) => [c.dataset.value, c.getAttribute("role"), c.getAttribute("aria-checked")]), [["fade", "radio", "true"], ["hide", "radio", "false"], ["show", "radio", "false"]]);
}

// Text field on change: trimmed; empty means the default (shown back in the field). Enter saves too, once.
{
  const { $, store, sets } = await page({ record: off });
  await change($("role"), "  a developer building with coding agents  ");
  assert.deepEqual(store.prefs, saved({ role: "a developer building with coding agents" }));
  assert.deepEqual(Object.keys(sets.at(-1)), ["prefs"], "writes only what changed");
  toastSaid($, "Saved");
  await change($("role"), "   ");
  assert.equal(store.prefs.role, DEFAULT_PREFS.role);
  assert.equal($("role").value, DEFAULT_PREFS.role);

  $("role").value = "a designer";
  const e = fire($("role"), "keydown", { key: "Enter" });
  await settle();
  assert.equal(store.prefs.role, "a designer");
  assert.ok(e.defaultPrevented);
  const n = sets.length;
  fire($("role"), "change");
  await settle();
  assert.equal(sets.length, n, "the change after Enter writes nothing new");
}

// Textarea on change: topics trimmed, blank lines dropped, capped at 8. Lists likewise.
{
  const { $, store } = await page({ record: off });
  await change($("topics"), " One \n\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine\nTen ");
  assert.deepEqual(store.prefs.topics, ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]);
  toastSaid($, "Saved the first 8 topics.");
  assert.equal($("topics").value, "One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
  await change($("subreddits"), "r/a\n\n r/b ");
  assert.deepEqual(store.prefs.subreddits, ["r/a", "r/b"]);
  await change($("boostWords"), "di vergada\n");
  await change($("muteWords"), "webinar\nwe're hiring");
  assert.deepEqual(store.prefs, saved({ topics: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"], subreddits: ["r/a", "r/b"], boostWords: ["di vergada"], muteWords: ["webinar", "we're hiring"] }));
}

// The other stored keys: model, videoModel, redditAbout, each alone, with defaults when empty.
{
  const { $, store, sets } = await page({ record: off });
  await change($("model"), " deepseek/x ");
  assert.equal(store.model, "deepseek/x");
  assert.deepEqual(Object.keys(sets.at(-1)), ["model"]);
  await change($("model"), "");
  assert.equal(store.model, DEFAULT_MODEL);
  assert.equal($("model").value, DEFAULT_MODEL);
  await change($("videoModel"), "");
  assert.equal(store.videoModel, DEFAULT_VIDEO_MODEL);
  await change($("redditAbout"), "- I keep my own books.");
  assert.equal(store.redditAbout, "- I keep my own books.");
  await change($("redditAbout"), "  ");
  assert.equal(store.redditAbout, DEFAULT_REDDIT_ABOUT);
  assert.equal(store.prefs, undefined, "prefs untouched by the other keys");
}

// Switches save at once.
for (const id of ["linkedinOn", "xOn", "redditOn", "youtubeOn", "youtubeDescriptions"]) {
  const { $, store } = await page({ record: off });
  assert.equal($(id).getAttribute("role"), "switch");
  await change($(id), false, "checked");
  assert.deepEqual(store.prefs, saved({ [id]: false }), id);
  toastSaid($, "Saved");
}

// Kinds chips toggle and save at once.
{
  const { $, store } = await page({ record: off });
  chip($, "kinds", "promo").click();
  await settle();
  assert.equal(chip($, "kinds", "promo").getAttribute("aria-pressed"), "true");
  assert.deepEqual(store.prefs, saved({ kinds: { ...DEFAULT_PREFS.kinds, promo: true } }));
  chip($, "redditKinds", "asking_help").click();
  await settle();
  assert.deepEqual(store.prefs.redditKinds, { ...DEFAULT_PREFS.redditKinds, asking_help: false });
  chip($, "youtubeKinds", "entertainment").click();
  await settle();
  assert.deepEqual(store.prefs.youtubeKinds, { ...DEFAULT_PREFS.youtubeKinds, entertainment: true });
  toastSaid($, "Saved");
}

// Low posts: one choice, saved at once.
{
  const { $, store } = await page({ record: off });
  chip($, "lowMode", "hide").click();
  await settle();
  assert.equal(store.prefs.lowMode, "hide");
  assert.deepEqual($("lowMode").children.map((c) => c.getAttribute("aria-checked")), ["false", "true", "false"]);
  chip($, "lowMode", "show").click();
  await settle();
  assert.equal(store.prefs.lowMode, "show");
  // Arrow keys move the choice, as a radio group does, and save it.
  fire(chip($, "lowMode", "show"), "keydown", { key: "ArrowRight" });
  await settle();
  assert.equal(store.prefs.lowMode, "fade");
  assert.equal(document.activeElement, chip($, "lowMode", "fade"));
  fire(chip($, "lowMode", "fade"), "keydown", { key: "ArrowLeft" });
  await settle();
  assert.equal(store.prefs.lowMode, "show");
}
// The old dimLow checkbox still reads as Leave them alone.
{
  const { $ } = await page({ record: off, store: { dimLow: false } });
  assert.equal(chip($, "lowMode", "show").getAttribute("aria-checked"), "true");
}

// Ranges: the number follows as you drag, the save comes on release; highAt and lowBelow kept apart.
{
  const { $, store } = await page({ record: off });
  $("highAt").value = "0.85";
  fire($("highAt"), "input");
  assert.equal($("highAtOut").textContent, "0.85");
  assert.equal(store.prefs, undefined, "nothing saved while dragging");
  fire($("highAt"), "change");
  await settle();
  assert.deepEqual(store.prefs, saved({ highAt: 0.85, lowBelow: 0.4 }));
  await change($("lowBelow"), "0.6");
  await change($("highAt"), "0.55");
  assert.equal(store.prefs.highAt, 0.55);
  assert.equal(store.prefs.lowBelow, Math.max(0.1, 0.55 - 0.1), "lowBelow moves under highAt, as saveAll did");
  assert.equal(Number($("lowBelow").value), store.prefs.lowBelow, "the slider shows what was saved");
  assert.equal($("lowBelowOut").textContent, "0.45");
}

// Number fields: empty means the default; otherwise rounded and kept within the field's min and max;
// 0 comments is a real answer.
{
  const { $, store } = await page({ record: off });
  await change($("freshHours"), "48");
  await change($("freshComments"), "");
  assert.deepEqual(store.prefs, saved({ freshHours: 48, freshComments: DEFAULT_PREFS.freshComments }));
  await change($("freshHours"), "");
  assert.equal(store.prefs.freshHours, DEFAULT_PREFS.freshHours);
  await change($("freshComments"), "0");
  assert.equal(store.prefs.freshComments, 0);
  assert.equal(String($("freshComments").value), "0");
  await change($("freshComments"), "2000");
  assert.equal(store.prefs.freshComments, 1000);
  await change($("freshHours"), "3.6");
  assert.equal(store.prefs.freshHours, 4);
  await change($("freshHours"), "0");
  assert.equal(store.prefs.freshHours, 1);
  assert.equal(String($("freshHours").value), "1", "the field shows what was saved");
  await change($("freshHours"), "500");
  assert.equal(store.prefs.freshHours, 168);
}

// Reminder: the switch and the time save at once; the time is disabled while the reminder is off.
{
  const { $, store, sets } = await page({ record: off });
  assert.equal($("rtime").disabled, false);
  await change($("remind"), false, "checked");
  assert.equal(store.reminderOn, false);
  assert.deepEqual(Object.keys(sets.at(-1)), ["reminderOn"]);
  assert.equal($("rtime").disabled, true);
  await change($("remind"), true, "checked");
  await change($("rtime"), "07:30");
  assert.equal(store.reminderTime, "07:30");
  await change($("rtime"), "");
  assert.equal(store.reminderTime, "18:00");
}
{
  const { $ } = await page({ record: off, store: { reminderOn: false } });
  assert.equal($("rtime").disabled, true);
}

// A change from the popup meanwhile is kept: each save changes only its own setting.
{
  const { $, store } = await page({ record: off, store: { prefs: { xOn: true } } });
  store.prefs = { ...store.prefs, xOn: false };
  await change($("role"), "a tester");
  assert.equal(store.prefs.xOn, false);
  assert.equal(store.prefs.role, "a tester");
}

// Stored values load into the controls.
{
  const prefs = { ...saved(), role: "r", topics: ["a", "b"], linkedinOn: false, kinds: { ...DEFAULT_PREFS.kinds, news: false }, lowMode: "hide", highAt: 0.8, freshHours: 3 };
  const { $ } = await page({ record: off, store: { prefs, model: "m", reminderTime: "09:15" } });
  assert.equal($("role").value, "r");
  assert.equal($("topics").value, "a\nb");
  assert.equal($("linkedinOn").checked, false);
  assert.equal(chip($, "kinds", "news").getAttribute("aria-pressed"), "false");
  assert.equal(chip($, "lowMode", "hide").getAttribute("aria-checked"), "true");
  assert.equal($("highAtOut").textContent, "0.80");
  assert.equal($("freshHours").value, 3);
  assert.equal($("model").value, "m");
  assert.equal($("rtime").value, "09:15");
}

// A failed save says why, in the toast.
{
  const { $ } = await page({ record: off, setFails: new Error("QUOTA_BYTES quota exceeded") });
  await change($("role"), "x");
  assert.match($("toast").textContent, /^Couldn't save: QUOTA_BYTES quota exceeded/);
}

// The toast goes after 1.5 seconds.
{
  const { $ } = await page({ record: off });
  await change($("xOn"), false, "checked");
  toastSaid($, "Saved");
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal($("toast").textContent, "", "emptied, so it is visually hidden");
}

// A second "Saved" is announced too: the region is emptied, then the words come on the next frame.
{
  const { $ } = await page({ record: off });
  const said = [];
  let text = "";
  Object.defineProperty($("toast"), "textContent", { get: () => text, set: (t) => { text = String(t); said.push(text); }, configurable: true });
  await change($("xOn"), false, "checked");
  await change($("xOn"), true, "checked");
  assert.deepEqual(said, ["", "Saved", "", "Saved"]);
}

// Typing and then closing the tab keeps the edit: the focused field saves when the page is hidden or
// left, even with prefs writes being joined.
{
  const { $, store, doc, window } = await page({ record: off, saveDelay: 500 });
  $("role").focus();
  $("role").value = "a tester";
  doc.visibilityState = "hidden";
  for (const fn of doc.listeners.visibilitychange) fn({ type: "visibilitychange" });
  await settle();
  assert.equal(store.prefs.role, "a tester", "saved without waiting for the join");
  $("model").focus();
  $("model").value = "m/x";
  for (const fn of window.listeners.pagehide) fn({ type: "pagehide" });
  await settle();
  assert.equal(store.model, "m/x");
  // A key field is never saved this way.
  $("orkey").focus();
  $("orkey").value = "sk-or-x";
  for (const fn of window.listeners.pagehide) fn({ type: "pagehide" });
  await settle();
  assert.equal(store.orKey, undefined);
}
// Closing the tab: the write starts at once, from what the page already knows, with nothing read first
// (a closing page never gets a read's answer).
{
  const { $, store, sets, hang, window } = await page({ record: off, saveDelay: 500, store: { prefs: { xOn: false }, model: "m/old" } });
  chip($, "kinds", "promo").click(); // waiting to be joined
  await settle();
  assert.deepEqual(sets, []);
  $("role").focus();
  $("role").value = "typed then closed";
  hang.on = true;
  for (const fn of window.listeners.pagehide) fn({ type: "pagehide" });
  assert.equal(sets.length, 1, "written in the same turn, nothing awaited");
  assert.deepEqual(sets[0].prefs, saved({ xOn: false, role: "typed then closed", kinds: { ...DEFAULT_PREFS.kinds, promo: true } }));
  assert.equal(store.prefs.role, "typed then closed");
}
{
  const { $, sets, hang, doc } = await page({ record: off, store: { model: "m/old" } });
  $("model").focus();
  $("model").value = "m/closing";
  hang.on = true;
  doc.visibilityState = "hidden";
  for (const fn of doc.listeners.visibilitychange) fn({ type: "visibilitychange" });
  assert.deepEqual(sets, [{ model: "m/closing" }], "the other saved keys too, alone");
  await settle(); // this page's change listener runs before the next page takes the globals
}
{
  // Nothing changed: nothing written.
  const { $, sets, hang, window } = await page({ record: off });
  $("role").focus();
  hang.on = true;
  for (const fn of window.listeners.pagehide) fn({ type: "pagehide" });
  $("model").focus();
  for (const fn of window.listeners.pagehide) fn({ type: "pagehide" });
  assert.deepEqual(sets, [], "not even a default for a field left as it was");
}

// A later toast isn't cut short by an earlier one: a "Couldn't save" shown just after a "Saved" stays
// its full 4 seconds.
{
  const { $ } = await page({ record: off, setFails: (obj) => (obj.model === "m/bad" ? new Error("nope") : null) });
  $("model").value = "m/good"; fire($("model"), "change");
  $("model").value = "m/bad"; fire($("model"), "change");
  await settle();
  assert.match($("toast").textContent, /^Couldn't save: nope/);
  await new Promise((r) => setTimeout(r, 2000));
  assert.match($("toast").textContent, /^Couldn't save: nope/, "still there after 2 seconds");
}

// Visible again: nothing is saved.
{
  const { $, sets, doc } = await page({ record: off });
  $("role").focus();
  $("role").value = "typing";
  doc.visibilityState = "visible";
  for (const fn of doc.listeners.visibilitychange) fn({ type: "visibilitychange" });
  await settle();
  assert.deepEqual(sets, []);
}

// Prefs writes within about 500 ms are joined into one, so open tabs re-score once; the toast still shows.
{
  const { $, sets, store } = await page({ record: off, saveDelay: 500 });
  chip($, "kinds", "promo").click();
  chip($, "kinds", "personal").click();
  await change($("xOn"), false, "checked");
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(sets, [], "nothing yet");
  await new Promise((r) => setTimeout(r, 600));
  await settle();
  assert.equal(sets.length, 1, "one write");
  assert.deepEqual(store.prefs, saved({ kinds: { ...DEFAULT_PREFS.kinds, promo: true, personal: true }, xOn: false }));
  toastSaid($, "Saved");
}

// Two quick changes keep their order.
{
  const { $, store, sets } = await page({ record: off });
  $("role").value = "first"; fire($("role"), "change");
  $("role").value = "second"; fire($("role"), "change");
  $("model").value = "m/one"; fire($("model"), "change");
  $("model").value = "m/two"; fire($("model"), "change");
  await settle();
  assert.equal(store.prefs.role, "second");
  assert.equal(store.model, "m/two");
  assert.deepEqual(sets.filter((x) => "model" in x).map((x) => x.model), ["m/one", "m/two"]);
}

// A change from elsewhere (the popup) redraws the controls that aren't focused.
{
  const { $, elsewhere } = await page({ record: off });
  $("role").focus();
  $("role").value = "being typed";
  elsewhere({ prefs: { ...saved(), xOn: false, role: "from the popup", kinds: { ...DEFAULT_PREFS.kinds, news: false } }, model: "m/else", reminderOn: false });
  await settle();
  assert.equal($("xOn").checked, false);
  assert.equal(chip($, "kinds", "news").getAttribute("aria-pressed"), "false");
  assert.equal($("role").value, "being typed", "the focused field is left alone");
  assert.equal($("model").value, "m/else");
  assert.equal($("remind").checked, false);
  assert.equal($("rtime").disabled, true);
}

// Keys never save as you change: only Check and save keys, and only a key that works.
{
  const { $, sets } = await page({ record: off, fetchOk: true });
  $("orkey").value = "sk-or-test";
  fire($("orkey"), "change");
  fire($("orkey"), "keydown", { key: "Enter" });
  $("key").value = "ts-test";
  fire($("key"), "change");
  await settle();
  assert.deepEqual(sets, [], "no key saved by changing the field");
  assert.equal($("start").hidden, false, "Start here shows with no key");
  assert.equal($("saveKeys").classList.contains("primary"), true, "the page's one filled button");
  $("saveKeys").click();
  assert.equal($("saveKeys").disabled, true, "disabled while the keys are checked");
  await settle();
  assert.equal($("saveKeys").disabled, false);
  assert.deepEqual(sets.flatMap((s) => Object.keys(s)).sort(), ["apiKey", "orKey"]);
  assert.equal($("keyMsg").textContent, "TypeSafe key saved. OpenRouter key saved");
  assert.equal($("orkey").value, "");
  assert.equal($("start").hidden, true, "Start here goes once a key is saved");
  assert.equal($("scoreStatus").textContent, "Jev, through OpenRouter. The saved TypeSafe key isn't used.");
}
{
  const { $, sets } = await page({ record: off, fetchOk: false });
  $("orkey").value = "sk-or-bad";
  $("saveKeys").click();
  await settle();
  assert.deepEqual(sets, []);
  assert.equal($("keyMsg").textContent, "OpenRouter said 401, not saved");
  assert.ok($("keyMsg").classList.contains("bad"));
  assert.equal($("scoreStatus").textContent, "Nothing scores your posts until an OpenRouter key is saved.");
}
{
  const { $ } = await page({ record: off, store: { apiKey: "t" } });
  assert.equal($("scoreStatus").textContent, "Jev, with your TypeSafe key");
  $("saveKeys").click();
  await settle();
  assert.equal($("keyMsg").textContent, "Paste a key first.");
}

// Usage stats: shown only when the build can send; the switch asks the worker, says its failure, and
// shows the install code.
{
  const { $ } = await page({ record: off });
  assert.equal($("statsSection").hidden, true);
}
{
  const asks = [];
  const { $ } = await page({ record: off, stats: (m) => { asks.push(m); return m.action === "consent" ? { available: true, consent: true, installCode: "A1B2C3" } : { available: true, consent: false }; } });
  assert.equal($("statsSection").hidden, false);
  assert.equal($("statsOn").checked, false);
  await change($("statsOn"), true, "checked");
  assert.deepEqual(asks.at(-1), { type: "stats", action: "consent", on: true });
  assert.equal($("statsCode").hidden, false);
  assert.equal($("statsCode").textContent, "Your install code: A1B2C3. Tell me this code only if you want me to recognise your install.");
  assert.equal($("statsMsg").textContent, "");
}
{
  const { $ } = await page({ record: off, stats: (m) => (m.action === "consent" ? { error: "Usage stats can only be changed from Sieve's popup or settings." } : { available: true, consent: false }) });
  await change($("statsOn"), true, "checked");
  assert.equal($("statsMsg").textContent, "Usage stats can only be changed from Sieve's popup or settings.");
}

console.log("options_autosave_test: ok");
