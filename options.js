const fields = ["endpoint", "token"];
const $ = (id) => document.getElementById(id);
// The toolbar popup opens options.html?popup; Chrome's options page opens it plain.
const isPopup = new URLSearchParams(location.search).has("popup");
document.body.classList.toggle("popup", isPopup);
if (isPopup) {
  // Compact popup: no title, no Connection form. A footer keeps the connection
  // status on the left and a settings (gear) button in the bottom-right corner.
  document.querySelector("header")?.remove();
  const footer = document.createElement("div");
  footer.className = "popup-foot";
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "gear";
  gear.id = "openSettings";
  gear.setAttribute("aria-label", "Open settings");
  gear.title = "Settings";
  gear.dataset.icon = "gearshape";
  gear.addEventListener("click", () => { chrome.runtime.openOptionsPage(); window.close(); });
  footer.append(document.getElementById("status"), gear);
  document.querySelector("section.connection").replaceWith(footer);
}

/* ---------- icons (SF Symbols when SF Pro is installed, SVG otherwise) ---------- */

const iconStyle = document.createElement("style");
iconStyle.textContent = AtlasUI.iconCSS(14) + AtlasUI.keycapCSS(22) +
  "body.popup .keycap { width: 20px; height: 20px; } body.popup .keycap svg { width: 20px; height: 20px; }";
document.head.append(iconStyle);
for (const el of document.querySelectorAll("[data-icon]")) el.append(AtlasUI.icon(el.dataset.icon));

// Selects look like the key fields, so they carry a chevron to read as menus.
for (const select of document.querySelectorAll(".row select")) {
  const wrap = document.createElement("span");
  wrap.className = "select";
  const chev = document.createElement("span");
  chev.className = "chev";
  chev.append(AtlasUI.icon("chevron.up.chevron.down"));
  select.replaceWith(wrap);
  wrap.append(select, chev);
}

/* ---------- connection ---------- */

const status = $("status");
// Settings the extension actually uses (saved values over the defaults), from background.js.
// The page never loads config.js itself: extension pages can't handle a missing script quietly.
let base = { endpoint: "", token: "" };

// In the popup the form isn't there; fall back to the saved values.
const field = (id) => ($(id) ? $(id).value.trim() : "");
function read() {
  return {
    endpoint: field("endpoint") || base.endpoint,
    token: field("token") || base.token
  };
}

function setStatus(kind, text) {
  status.className = `dot ${kind}`;
  status.lastElementChild.textContent = text;
  status.title = kind === "ok" ? text : "";
}

async function test() {
  setStatus("", "Checking");
  const { endpoint, token } = read();
  if (!endpoint || !token) return setStatus("bad", "Not set up");
  const res = await chrome.runtime.sendMessage({ type: "atlas-ping", override: { endpoint, token } });
  res?.ok ? setStatus("ok", "Connected") : setStatus("bad", res?.error || "No connection");
}

chrome.runtime.sendMessage({ type: "atlas-config" }).then((cfg) => {
  if (cfg) base = { ...base, ...cfg };
  for (const f of fields) if ($(f)) $(f).value = base[f] ?? "";
  test();
});

$("test")?.addEventListener("click", test);
$("save")?.addEventListener("click", async () => {
  await chrome.storage.local.set(read());
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save"), 1200);
  test();
});

/* ---------- screenshot shortcuts: click a field, press the new keys ---------- */
// Stored as { code, alt, shift, ctrl, meta } (null = not set). shot.js listens for them on web pages.

const DEFAULT_KEYS = {
  shotKey: { code: "KeyW", alt: true, shift: true },
  visibleKey: { code: "KeyE", alt: true, shift: true },
  fullKey: { code: "KeyF", alt: true, shift: true },
  linkKey: { code: "KeyS", meta: true, shift: true }
};
const KEY_IDS = Object.keys(DEFAULT_KEYS);
// Where each field's messages go (screenshot fields share one under their section).
const noteFor = () => "keyNote"; // one message line under the Shortcuts list
const MOD_CODES = ["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight"];
const NAMED = {
  Space: "Space", Enter: "↩", Tab: "⇥", Backspace: "⌫", Delete: "⌦", Escape: "esc",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`"
};
const keyName = (code) => NAMED[code] || code.replace(/^Key|^Digit|^Numpad/, "");
const mods = (k) => `${k.ctrl ? "⌃" : ""}${k.alt ? "⌥" : ""}${k.shift ? "⇧" : ""}${k.meta ? "⌘" : ""}`;
const label = (k) => (k ? mods(k) + keyName(k.code) : "Not set");
const sameKey = (a, b) => !!a && !!b && a.code === b.code && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl && !!a.meta === !!b.meta;

const shortcuts = { ...DEFAULT_KEYS };
let recording = null; // the field being recorded

function drawKey(id) {
  const field = $(id);
  const k = shortcuts[id];
  // Each key in its own square; "Not set" stays text.
  field.querySelector("kbd").replaceChildren(k ? AtlasUI.keycaps(k) : document.createTextNode("Not set"));
  field.classList.toggle("empty", !k);
  field.setAttribute("aria-label", `${field.dataset.name}: ${label(k)}. Click to change`);
}

function note(text, id = recording?.id) {
  $("keyNote").textContent = "";
  if (text && id) $(noteFor(id)).textContent = text;
}

function startRecording(field) {
  if (recording) stopRecording();
  recording = field;
  field.classList.add("recording");
  field.querySelector("kbd").textContent = "Type shortcut";
  note("");
}

function stopRecording() {
  if (!recording) return;
  recording.classList.remove("recording");
  drawKey(recording.id);
  recording = null;
}

async function saveKey(id, value) {
  shortcuts[id] = value;
  await chrome.storage.local.set({ [id]: value });
  note("");
  stopRecording();
}

for (const id of KEY_IDS) {
  const field = $(id);
  field.addEventListener("click", () => (recording === field ? stopRecording() : startRecording(field)));
  field.addEventListener("blur", () => { if (recording === field) stopRecording(); });
}

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  const k = { code: e.code, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey };
  if (MOD_CODES.includes(e.code)) {
    // Show the modifiers as they're held.
    // Show the held modifiers as keycaps while recording.
    const held = { ...k, code: null };
    recording.querySelector("kbd").replaceChildren(mods(k) ? AtlasUI.keycaps(held) : document.createTextNode("Type shortcut"));
    return;
  }
  const none = !k.alt && !k.shift && !k.ctrl && !k.meta;
  if (e.code === "Escape" && none) return stopRecording();
  if ((e.code === "Backspace" || e.code === "Delete") && none) return saveKey(recording.id, null);
  if (!k.alt && !k.ctrl && !k.meta) {
    note("Use ⌘, ⌥ or ⌃ with a key, so it doesn't fire while typing.");
    return;
  }
  const other = KEY_IDS.find((id) => id !== recording.id && sameKey(k, shortcuts[id]));
  if (other) {
    note(`${label(k)} is already used for ${$(other).dataset.name}.`);
    return;
  }
  saveKey(recording.id, k);
}, true);

chrome.storage.local.get(KEY_IDS).then((v) => {
  for (const id of KEY_IDS) {
    if (v[id] !== undefined) shortcuts[id] = v[id];
    drawKey(id);
  }
});

/* ---------- save button keys ---------- */

const KEY_LABEL = { Alt: "⌥", Control: "⌃", Shift: "⇧", Meta: "⌘", none: "" };

function drawHelp(hoverKey, noteKey) {
  const hold = hoverKey === "none" ? "Move to" : `Hold ${KEY_LABEL[hoverKey]} over`;
  $("tipSave").textContent =
    `${hold} the top-right corner of an image or video and press + to save it with its post link. ` +
    `Hold ${KEY_LABEL[noteKey]}${KEY_LABEL[hoverKey]} and press + to add a note and tags first. ` +
    `Save link saves the page itself; hold ${KEY_LABEL[noteKey]} while clicking it for a note. ` +
    `Holding ${hoverKey === "none" ? "⌥" : KEY_LABEL[hoverKey]} also opens a short guide; hide it with its eye button or here.`;
}

function syncKeys() {
  const hoverKey = $("hoverKey").value;
  // The note key can't be the same key that shows the button.
  for (const o of $("noteKey").options) o.disabled = o.value === hoverKey;
  if ($("noteKey").value === hoverKey) $("noteKey").value = [...$("noteKey").options].find((o) => !o.disabled).value;
  const noteKey = $("noteKey").value;
  drawHelp(hoverKey, noteKey);
  return { hoverKey, noteKey };
}

chrome.storage.local.get(["hoverKey", "noteKey"]).then((v) => {
  $("hoverKey").value = v.hoverKey || "Alt";
  $("noteKey").value = v.noteKey || "Meta";
  syncKeys();
});
for (const id of ["hoverKey", "noteKey"]) {
  $(id).addEventListener("change", () => chrome.storage.local.set(syncKeys()));
}

/* ---------- settings switches ---------- */

// Guide on hold ("guide"), on by default.
function bindSwitch(id) {
  const sw = $(id);
  const draw = (on) => sw.setAttribute("aria-checked", String(on));
  chrome.storage.local.get(id).then((v) => draw(v[id] !== false));
  sw.addEventListener("click", () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    draw(on);
    chrome.storage.local.set({ [id]: on });
  });
  // The guide can also be hidden from its own eye button on a page.
  chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c[id]) draw(c[id].newValue !== false); });
}
bindSwitch("guide");

/* ---------- tooltips: Esc dismisses ---------- */

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || recording) return;
  const open = [...document.querySelectorAll("h2")].find((h) => h.matches(":hover") || h.querySelector(".info:focus-visible"));
  if (open) open.classList.add("tip-dismissed");
});
for (const h of document.querySelectorAll("h2")) {
  const reset = () => h.classList.remove("tip-dismissed");
  h.addEventListener("pointerleave", reset);
  h.querySelector(".info")?.addEventListener("blur", reset);
}

