const fields = ["collection", "endpoint", "token"];
const $ = (id) => document.getElementById(id);
const status = $("status");

function read() {
  return {
    collection: $("collection").value.trim(),
    endpoint: $("endpoint").value.trim() || ATLAS_DEFAULTS.endpoint,
    token: $("token").value.trim() || ATLAS_DEFAULTS.token
  };
}

function setStatus(kind, text) {
  status.className = `dot ${kind}`;
  status.lastElementChild.textContent = text;
}

async function test() {
  setStatus("", "Checking");
  const { endpoint, token } = read();
  if (!endpoint || !token) return setStatus("bad", "Not set up");
  const res = await chrome.runtime.sendMessage({ type: "atlas-ping", override: { endpoint, token } });
  res?.ok ? setStatus("ok", "Connected") : setStatus("bad", res?.error || "No connection");
}

chrome.storage.local.get(fields).then((stored) => {
  for (const f of fields) $(f).value = stored[f] ?? ATLAS_DEFAULTS[f];
  test();
});

$("test").addEventListener("click", test);
$("save").addEventListener("click", async () => {
  await chrome.storage.local.set(read());
  $("save").textContent = "Saved";
  setTimeout(() => ($("save").textContent = "Save"), 1200);
  test();
});

const startShot = async (full) => {
  const res = await chrome.runtime.sendMessage({ type: "atlas-shot-request", full });
  if (res?.ok) return window.close();
  $("shotErr").textContent = res?.error || "Couldn't start a screenshot here";
  $("shotErr").hidden = false;
};
$("shot").addEventListener("click", () => startShot(false));
$("full").addEventListener("click", () => startShot(true));

chrome.commands?.getAll?.().then((cmds) => {
  for (const [name, ids] of [["take-screenshot", ["keys", "keysRow"]], ["take-full-page", ["fullKeys", "fullKeysRow"]]]) {
    const key = cmds.find((c) => c.name === name)?.shortcut;
    for (const id of ids) key ? ($(id).textContent = key) : ($(id).textContent = id.endsWith("Row") ? "Not set" : "");
  }
});

// Chrome only lets people change extension shortcuts on its own page.
$("editKeys").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

/* ---------- in-page keys ---------- */

const KEY_LABEL = { Alt: "⌥", Control: "⌃", Shift: "⇧", Meta: "⌘", none: "" };

function drawHelp(hoverKey, noteKey) {
  const hold = hoverKey === "none" ? "Move to" : `Hold ${KEY_LABEL[hoverKey]} over`;
  const note = `${KEY_LABEL[noteKey]}${KEY_LABEL[hoverKey]}`;
  $("help").textContent =
    `${hold} the top-right corner of an image or video and press + to save it with its post link; ` +
    `hold ${note} and press + to add a note and tags first. ` +
    "For a screenshot, drag an area or click for the visible screen; hold ⌥ to pick a block, press F for the full page.";
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

chrome.storage.local.get("shotScale").then(({ shotScale }) => { $("shotScale").value = String(shotScale || 2); });
$("shotScale").addEventListener("change", (e) => chrome.storage.local.set({ shotScale: Number(e.target.value) }));
