// Shared look for the extension's UI: Inter Variable and SF Symbols.
//
// SF Symbols are drawn as characters from Apple's SF Pro font when it's installed
// (it ships with Apple's developer downloads, not with macOS itself). Nothing from Apple
// is bundled here; without SF Pro, a matching SVG is used instead.
var AtlasUI = globalThis.AtlasUI || (() => {
  const SF = {
    "info.circle": 0x100174,
    "pencil": 0x10020a,
    "plus": 0x10017c,
    "checkmark": 0x100185,
    "exclamationmark": 0x10014e,
    "xmark": 0x100184,
    "square.and.pencil": 0x10020e,
    "link": 0x100263,
    "chevron.up.chevron.down": 0x10018f,
    "viewfinder": 0x1003b9,
    "doc.viewfinder": 0x1003be,
    "eye": 0x1002ed,
    "eye.slash": 0x1002ef,
    "macwindow": 0x1003dc,
    "gearshape": 0x1008cb
  };

  // Stand-ins in the same spirit (1.5 stroke on a 14 grid) for computers without SF Pro.
  const SVG = {
    "info.circle": [["circle", { cx: 7, cy: 7, r: 5.75 }], ["path", { d: "M7 6.3v3.6M7 4.4v.1" }]],
    "pencil": [["path", { d: "M9.4 2.6l2 2-6.3 6.3-2.6.6.6-2.6 6.3-6.3z" }]],
    "plus": [["path", { d: "M7 2.25v9.5M2.25 7h9.5" }]],
    "checkmark": [["path", { d: "M2.9 7.4l2.7 2.7 5.5-5.9" }]],
    "exclamationmark": [["path", { d: "M7 3v4.6M7 10.6v.1" }]],
    "xmark": [["path", { d: "M3.5 3.5l7 7M10.5 3.5l-7 7" }]],
    "square.and.pencil": [["path", { d: "M6.5 2.5h-3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3" }], ["path", { d: "M10.4 2.1l1.5 1.5-4.6 4.6-1.9.4.4-1.9 4.6-4.6z" }]],
    "link": [["path", { d: "M6 8a2.5 2.5 0 0 0 3.6 0l2-2A2.5 2.5 0 0 0 8 2.4l-.8.8" }], ["path", { d: "M8 6a2.5 2.5 0 0 0-3.6 0l-2 2A2.5 2.5 0 0 0 6 11.6l.8-.8" }]],
    "chevron.up.chevron.down": [["path", { d: "M4.5 5.5L7 3l2.5 2.5M4.5 8.5L7 11l2.5-2.5" }]],
    "viewfinder": [["path", { d: "M2 5V3.5A1.5 1.5 0 0 1 3.5 2H5M9 2h1.5A1.5 1.5 0 0 1 12 3.5V5M12 9v1.5a1.5 1.5 0 0 1-1.5 1.5H9M5 12H3.5A1.5 1.5 0 0 1 2 10.5V9" }]],
    "doc.viewfinder": [["path", { d: "M2 4.5v-1A1.5 1.5 0 0 1 3.5 2h1M9.5 2h1A1.5 1.5 0 0 1 12 3.5v1M12 9.5v1a1.5 1.5 0 0 1-1.5 1.5h-1M4.5 12h-1A1.5 1.5 0 0 1 2 10.5v-1" }], ["path", { d: "M5 4.5h4v5H5z" }]],
    "eye": [["path", { d: "M1.5 7S3.5 3 7 3s5.5 4 5.5 4-2 4-5.5 4S1.5 7 1.5 7z" }], ["circle", { cx: 7, cy: 7, r: 1.75 }]],
    "eye.slash": [["path", { d: "M1.5 7S3.5 3 7 3s5.5 4 5.5 4-2 4-5.5 4S1.5 7 1.5 7z" }], ["path", { d: "M2.5 2.5l9 9" }]],
    "macwindow": [["rect", { x: 1.75, y: 2.75, width: 10.5, height: 8.5, rx: 1.5 }], ["path", { d: "M1.75 5h10.5" }]],
    "gearshape": [["circle", { cx: 7, cy: 7, r: 1.9 }], ["path", { d: "M7 1.5v1.6M7 10.9v1.6M1.5 7h1.6M10.9 7h1.6M3.1 3.1l1.15 1.15M9.75 9.75l1.15 1.15M3.1 10.9l1.15-1.15M9.75 4.25l1.15-1.15" }]]
  };

  /* ---------- talking to the extension safely ---------- */
  // After the extension is reloaded or updated, scripts already in open tabs lose their
  // connection, and chrome.* calls throw "Extension context invalidated". These helpers
  // turn that into a plain message instead of an uncaught error.
  const RELOAD = "Atlas Saver was updated. Reload the page to keep using it.";
  function alive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }
  async function send(msg) {
    if (!alive()) return { ok: false, error: RELOAD };
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, error: !alive() || /context invalidated/i.test(e?.message || "") ? RELOAD : "No answer from the extension. Reload the page." };
    }
  }
  async function getStored(keys) {
    if (!alive()) return {};
    try { return (await chrome.storage.local.get(keys)) || {}; } catch { return {}; }
  }
  function onStored(fn) {
    try { if (alive()) chrome.storage.onChanged.addListener((c, area) => { if (area === "local") fn(c); }); } catch {}
  }
  async function setStored(values) {
    if (!alive()) return false;
    try { await chrome.storage.local.set(values); return true; } catch { return false; }
  }
  const url = (path) => { try { return alive() ? chrome.runtime.getURL(path) : ""; } catch { return ""; } };

  let sf = null;
  function hasSF() {
    if (sf !== null) return sf;
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      const ch = String.fromCodePoint(SF["info.circle"]);
      ctx.font = '40px monospace';
      const plain = ctx.measureText(ch).width;
      ctx.font = '40px "SF Pro", "SF Pro Text", monospace';
      sf = Math.abs(ctx.measureText(ch).width - plain) > 0.5;
    } catch {
      sf = false;
    }
    return sf;
  }

  // An icon element: <span class="sf"> with the symbol, or an inline SVG fallback.
  function icon(name, cls = "") {
    if (hasSF() && SF[name]) {
      const s = document.createElement("span");
      s.className = `sf ${cls}`.trim();
      s.setAttribute("aria-hidden", "true");
      s.textContent = String.fromCodePoint(SF[name]);
      return s;
    }
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("class", `sf-svg ${cls}`.trim());
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of SVG[name] || []) {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    return svg;
  }

  // CSS both kinds of icon share; `size` is the symbol's point size.
  const iconCSS = (size = 14) => `
    .sf { font-family: "SF Pro", "SF Pro Text", sans-serif; font-size: ${size}px; line-height: 1;
          font-weight: 400; display: inline-block; font-style: normal; -webkit-font-smoothing: antialiased; }
    .sf-svg { width: ${size}px; height: ${size}px; fill: none; stroke: currentColor; stroke-width: 1.5;
              stroke-linecap: round; stroke-linejoin: round; }
  `;

  // Inter Variable for UI inside web pages. Loaded from bytes, so a page's font
  // policy can't block it; the family name is our own so it never clashes.
  let interLoad = null;
  function loadInter() {
    if (interLoad) return interLoad;
    interLoad = (async () => {
      try {
        const fontUrl = url("fonts/InterVariable.woff2");
        if (!fontUrl) return;
        const buf = await (await fetch(fontUrl)).arrayBuffer();
        const face = new FontFace("Atlas Saver Inter", buf, { weight: "100 900", style: "normal" });
        await face.load();
        document.fonts.add(face);
      } catch { /* system font fallback */ }
    })();
    return interLoad;
  }

  const FONT = '"Atlas Saver Inter", "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  /* ---------- keycaps: each key in its own square, symbol centered ---------- */
  // Drawn on a 72×72 grid like the reference artwork (⌘ and ⌥ are its exact paths);
  // letters and digits are set in Inter so every key reads at the same weight.
  const KEY_PATHS = {
    "⌘": "M31 31V25C31 21.6863 28.3137 19 25 19C21.6863 19 19 21.6863 19 25C19 28.3137 21.6863 31 25 31H31ZM31 31H41M31 31V41M41 31V25C41 21.6863 43.6862 19 47 19C50.3138 19 53 21.6863 53 25C53 28.3137 50.3138 31 47 31H41ZM41 31V41M31 41H41M31 41V47C31 50.3138 28.3137 53 25 53C21.6863 53 19 50.3138 19 47C19 43.6862 21.6863 41 25 41H31ZM41 41V47C41 50.3138 43.6862 53 47 53C50.3138 53 53 50.3138 53 47C53 43.6862 50.3138 41 47 41H41Z",
    "⌥": "M17 21H23.6C25.077 21 26.434 21.8142 27.129 23.1176L40.871 48.8824C41.566 50.1858 42.923 51 44.4 51H51M51 21H43",
    "⇧": "M36 19L53 37H44V53H28V37H19L36 19Z",
    "⌃": "M22 42L36 27L50 42"
  };
  const KEY_TEXT = {
    Space: "␣", Enter: "↩", Tab: "⇥", Backspace: "⌫", Delete: "⌦", Escape: "esc",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`"
  };
  function keycap(glyph) {
    const cap = document.createElement("span");
    cap.className = "keycap";
    if (KEY_PATHS[glyph]) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 72 72");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", KEY_PATHS[glyph]);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "3.5");
      path.setAttribute("stroke-linecap", glyph === "⌘" ? "square" : "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      cap.appendChild(svg);
    } else {
      cap.textContent = glyph;
      if (glyph.length > 1) cap.classList.add("wide");
    }
    return cap;
  }
  const MOD_NAMES = { "⌃": "Control", "⌥": "Option", "⇧": "Shift", "⌘": "Command" };
  // { code, ctrl, alt, shift, meta } → caps in macOS order ⌃⌥⇧⌘, then the key.
  function keycaps(combo) {
    const wrap = document.createElement("span");
    wrap.className = "keycaps";
    if (!combo) return wrap;
    const glyphs = [];
    if (combo.ctrl) glyphs.push("⌃");
    if (combo.alt) glyphs.push("⌥");
    if (combo.shift) glyphs.push("⇧");
    if (combo.meta) glyphs.push("⌘");
    if (combo.code) glyphs.push(KEY_TEXT[combo.code] || combo.code.replace(/^Key|^Digit|^Numpad/, ""));
    for (const g of glyphs) wrap.appendChild(keycap(g));
    wrap.setAttribute("aria-label", glyphs.map((g) => MOD_NAMES[g] || g).join(" "));
    return wrap;
  }
  // "⌘⌥" → caps (for modifier pairs written as text).
  function keycapsFromGlyphs(text) {
    const wrap = document.createElement("span");
    wrap.className = "keycaps";
    for (const g of [...text]) wrap.appendChild(keycap(g));
    wrap.setAttribute("aria-label", [...text].map((g) => MOD_NAMES[g] || g).join(" "));
    return wrap;
  }
  // Shared look; color comes from the surface (currentColor), the edge from --keycap-edge.
  const keycapCSS = (size = 22) => `
    .keycaps { display: inline-flex; align-items: center; gap: ${Math.round(size * 0.14)}px; vertical-align: middle; }
    .keycap { box-sizing: border-box; display: inline-grid; place-items: center; width: ${size}px; height: ${size}px;
              border-radius: ${(size * 15.5 / 72).toFixed(1)}px; box-shadow: inset 0 0 0 1px var(--keycap-edge, rgba(17,17,17,.1));
              border: 1px solid transparent; /* keeps an edge in forced-colors mode, which drops shadows */
              font: 500 ${Math.round(size * 0.58)}px/1 ${FONT}; letter-spacing: 0; color: inherit; }
    .keycap.wide { width: auto; padding: 0 ${Math.round(size * 0.27)}px; font-size: ${Math.round(size * 0.48)}px; }
    .keycap svg { width: ${size}px; height: ${size}px; margin: -1px; display: block; }
  `;

  return { icon, iconCSS, hasSF, loadInter, FONT, keycap, keycaps, keycapsFromGlyphs, keycapCSS, alive, send, getStored, setStored, onStored, RELOAD };
})();
