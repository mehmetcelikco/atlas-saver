// Screenshot mode: hover snaps to page blocks (divs, cards, sections), click captures
// the block, drag draws a free rectangle whose edges snap to nearby block edges.
(() => {
  if (window.__atlasShot) return;
  window.__atlasShot = true;

  const ACCENT = "#3d8bff";
  const SNAP = 6;          // px distance at which a dragged edge sticks to a block edge
  const MIN_W = 24, MIN_H = 16;
  const MAX_FRAMES = 40;   // big areas are stitched from at most this many viewport captures
  const MAX_PX = 16000;    // longest side of the final image, in pixels
  const PAD = 16;          // breathing room added around a picked block that has no padding of its own

  /* ---------- UI ---------- */

  const host = document.createElement("atlas-shot");
  for (const [k, v] of Object.entries({ all: "initial", position: "fixed", top: "0", left: "0", width: "0", height: "0", "z-index": "2147483647", "pointer-events": "none" })) {
    host.style.setProperty(k, v);
  }
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; display: none; }
    .layer.on { display: block; }
    .layer.empty { background: rgba(0,0,0,.18); }
    .box { position: fixed; top: 0; left: 0; display: none; pointer-events: none;
           border: 1.5px solid ${ACCENT}; background: rgba(61,139,255,.06);
           box-shadow: 0 0 0 100vmax rgba(0,0,0,.32); }
    .box.on { display: block; }
    .box.drag { border-style: solid; }
    .label { position: fixed; top: 0; left: 0; display: none; height: 20px; padding: 0 7px; border-radius: 5px;
             align-items: center; white-space: nowrap; color: #fff; background: ${ACCENT};
             font: 500 11px/1 ui-monospace, "SF Mono", Menlo, monospace; pointer-events: none; }
    .label.on { display: flex; }
    .guide { position: fixed; display: none; background: #ff3d9a; pointer-events: none; }
    .guide.on { display: block; }
    .gx { top: 0; bottom: 0; width: 1px; }
    .gy { left: 0; right: 0; height: 1px; }
    .pill { position: fixed; left: 50%; bottom: 22px; translate: -50% 0; height: 32px; padding: 0 14px;
            border-radius: 16px; display: flex; align-items: center; gap: 10px; white-space: nowrap;
            font: 500 12px/1 ${AtlasUI.FONT};
            letter-spacing: -.005em; color: #fff; background: rgba(18,18,18,.86);
            -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
            box-shadow: 0 6px 24px rgba(0,0,0,.25); opacity: 0; pointer-events: none; transition: opacity .14s ease; }
    .pill.on { opacity: 1; }
    /* the hint wraps instead of running off a narrow window */
    .hint { height: auto; min-height: 32px; max-width: calc(100vw - 32px); flex-wrap: wrap; justify-content: center;
            row-gap: 6px; padding: 7px 14px; white-space: normal; }
    .hint .hg { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    /* separators: thin vertical rules instead of dots */
    .pill .sep { flex: none; width: 1px; height: 14px; background: rgba(255,255,255,.22); }
    .pill .keycaps { --keycap-edge: rgba(255,255,255,.22); }
    .toast.error { background: rgba(214,52,52,.94); }
    /* progress while a tall page is captured; it sits in a bottom strip the capture skips */
    .progress { gap: 12px; padding: 0 6px 0 14px; font-variant-numeric: tabular-nums; }
    .progress.on { pointer-events: auto; }
    .progress .stop { all: unset; box-sizing: border-box; height: 24px; padding: 0 10px; border-radius: 12px; cursor: pointer;
                      display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.14); color: #fff; font-weight: 500;
                      transition: background-color 150ms ease-out, scale 150ms ease-out; }
    @media (hover: hover) { .progress .stop:hover { background: rgba(255,255,255,.24); } }
    .progress .stop:active { scale: .96; }
    .progress .stop:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .progress .stop kbd { padding: 2px 4px; }
  `);
  const capSheet = new CSSStyleSheet();
  capSheet.replaceSync(AtlasUI.keycapCSS(18));
  root.adoptedStyleSheets = [sheet, capSheet];

  const div = (cls) => { const d = document.createElement("div"); d.className = cls; return d; };
  const layer = div("layer");
  const box = div("box");
  const label = div("label");
  const gx = div("guide gx");
  const gy = div("guide gy");
  const hint = div("pill hint");
  const toastEl = div("pill toast");
  toastEl.setAttribute("role", "status");
  // Keys in the same keycap style as settings: one square per key ("esc" gets a wide one).
  const kbd = (t) => {
    const wrap = document.createElement("span");
    wrap.className = "keycaps";
    wrap.appendChild(AtlasUI.keycap(t));
    return wrap;
  };
  const txt = (t) => document.createTextNode(t);
  const sep = () => { const s = document.createElement("span"); s.className = "sep"; s.setAttribute("aria-hidden", "true"); return s; };
  // Each hint stays on one line; a narrow window breaks only between hints.
  const group = (...parts) => { const g = document.createElement("span"); g.className = "hg"; g.append(...parts); return g; };
  hint.append(
    group(txt("Drag an area")), sep(),
    group(kbd("⇧"), txt("click two corners")), sep(),
    group(txt("Click: visible screen")), sep(),
    group(kbd("F"), txt("full page")), sep(),
    group(txt("Hold"), kbd("⌥"), txt("to pick blocks")), sep(),
    group(kbd("esc"))
  );
  const progress = div("pill progress");
  progress.setAttribute("role", "status");
  const progressText = document.createElement("span");
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "stop";
  stopBtn.append(txt("Stop"), kbd("esc"));
  stopBtn.setAttribute("aria-label", "Stop and save what's captured so far");
  progress.append(progressText, stopBtn);
  root.append(layer, box, label, gx, gy, hint, toastEl, progress);

  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
  const saverHost = () => document.querySelector("atlas-saver");
  const setSaverHidden = (on) => {
    const s = saverHost();
    if (s) on ? s.style.setProperty("display", "none", "important") : s.style.removeProperty("display");
  };

  let toastTimer = 0;
  function toast(message, kind = "", stay = false) {
    mount();
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.toggle("error", kind === "error");
    toastEl.classList.add("on");
    if (!stay) toastTimer = setTimeout(() => toastEl.classList.remove("on"), 2600);
  }

  /* ---------- picking blocks ---------- */

  const sameRect = (a, b) => Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  const isOurs = (el) => el === host || el === saverHost();

  function meaningful(el) {
    if (el instanceof SVGElement && el.ownerSVGElement) el = el.ownerSVGElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      const d = getComputedStyle(el).display;
      if (d !== "inline" && d !== "contents" && r.width >= MIN_W && r.height >= MIN_H) return el;
      el = el.parentElement;
    }
    return el || null;
  }

  function baseAt(x, y) {
    return document.elementsFromPoint(x, y).find((el) => !isOurs(el) && el !== document.documentElement) || null;
  }

  function parentOf(el) {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && p !== document.documentElement && sameRect(p.getBoundingClientRect(), r)) p = p.parentElement;
    return p && p !== document.documentElement ? p : null;
  }

  function describeEl(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (typeof el.className === "string" && el.className.trim()) s += `.${el.className.trim().split(/\s+/)[0]}`;
    return s.length > 38 ? `${s.slice(0, 37)}…` : s;
  }

  /* ---------- snapping for free drags ---------- */

  let edges = null;
  function gatherEdges() {
    const vw = innerWidth, vh = innerHeight;
    const xs = [0, vw], ys = [0, vh];
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const n = Math.min(all.length, 6000);
    for (let i = 0; i < n; i++) {
      const el = all[i];
      if (isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      xs.push(r.left, r.right);
      ys.push(r.top, r.bottom);
    }
    return { xs, ys };
  }

  function snapTo(v, list) {
    let best = v, d = SNAP + 0.01;
    for (const e of list) {
      const dd = Math.abs(e - v);
      if (dd < d) { d = dd; best = e; }
    }
    return { v: best, hit: d <= SNAP };
  }

  function snapPoint(x, y, free) {
    if (free || !edges) return { x, y, hx: false, hy: false };
    const sx = snapTo(x, edges.xs), sy = snapTo(y, edges.ys);
    return { x: sx.v, y: sy.v, hx: sx.hit, hy: sy.hit };
  }

  /* ---------- drawing ---------- */

  function drawBox(r, text, radius = "2px", drag = false) {
    if (!r) {
      box.classList.remove("on");
      label.classList.remove("on");
      layer.classList.add("empty");
      return;
    }
    layer.classList.remove("empty");
    box.classList.toggle("drag", drag);
    box.style.translate = `${r.left}px ${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.borderRadius = radius;
    box.classList.add("on");
    label.textContent = text;
    label.classList.add("on");
    const lw = label.offsetWidth;
    const lx = Math.max(4, Math.min(r.left, innerWidth - lw - 4));
    const ly = r.top >= 26 ? r.top - 24 : Math.min(Math.max(r.top, 0) + 4, innerHeight - 24);
    label.style.translate = `${Math.round(lx)}px ${Math.round(ly)}px`;
  }

  function drawGuides(p) {
    gx.classList.toggle("on", !!p?.hx);
    gy.classList.toggle("on", !!p?.hy);
    if (p?.hx) gx.style.translate = `${Math.round(p.x)}px 0`;
    if (p?.hy) gy.style.translate = `0 ${Math.round(p.y)}px`;
  }

  const size = (r) => `${Math.round(r.width)} × ${Math.round(r.height)}`;

  /* ---------- the mode ---------- */

  let active = false;
  let alt = false;         // ⌥ held: pick blocks and snap; otherwise a plain screenshot
  let px = 0, py = 0;
  let base = null, picked = null, chain = [];
  let down = null, dragging = false, dragRect = null;
  let anchor = null; // first corner of a two-click area (⇧-click), the no-drag way to pick an area

  function showPicked() {
    if (!picked) return drawBox(null);
    const r = picked.getBoundingClientRect();
    drawBox(r, `${describeEl(picked)}  ${size(r)}`, getComputedStyle(picked).borderRadius || "2px");
  }

  function hover() {
    if (!alt) {
      base = picked = null;
      chain = [];
      return drawBox(null);
    }
    const b = baseAt(px, py);
    if (b !== base) {
      base = b;
      chain = [];
      picked = b ? meaningful(b) : null;
    }
    showPicked();
  }

  function activate() {
    if (active) return;
    active = true;
    mount();
    setSaverHidden(true);
    layer.classList.add("on", "empty");
    hint.classList.add("on");
    toastEl.classList.remove("on");
    base = picked = null;
    chain = [];
    alt = false;
    addEventListener("keydown", onKey, true);
    addEventListener("keyup", onKey, true);
    addEventListener("blur", onBlur);
    addEventListener("scroll", onScroll, { passive: true, capture: true });
  }

  function deactivate() {
    anchor = null;
    active = false;
    down = null;
    dragging = false;
    layer.classList.remove("on");
    hint.classList.remove("on");
    drawBox(null);
    drawGuides(null);
    removeEventListener("keydown", onKey, true);
    removeEventListener("keyup", onKey, true);
    removeEventListener("blur", onBlur);
    removeEventListener("scroll", onScroll, true);
    setSaverHidden(false);
  }

  function onScroll() {
    if (active && !dragging) requestAnimationFrame(showPicked);
  }

  function setAlt(on) {
    if (on === alt) return;
    alt = on;
    if (!dragging) hover();
  }

  function onBlur() { setAlt(false); }

  function onKey(e) {
    if (!active) return;
    if (e.key === "Alt") {
      e.preventDefault();
      e.stopImmediatePropagation();
      return setAlt(e.type === "keydown");
    }
    if (e.type !== "keydown") return;
    const keys = ["Escape", "Enter", "ArrowUp", "ArrowDown", "f", "F"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      if (anchor) { anchor = null; return hover(); }
      return deactivate();
    }
    if ((e.key === "f" || e.key === "F") && !dragging) return takeFull();
    if (dragging) return;
    if (e.key === "Enter" && picked) return takeElement(picked);
    if (e.key === "ArrowUp" && picked) {
      const p = parentOf(picked);
      if (p) { chain.push(picked); picked = p; }
    }
    if (e.key === "ArrowDown" && chain.length) picked = chain.pop();
    showPicked();
  }

  layer.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    px = e.clientX; py = e.clientY;
    if (anchor && !down) {
      // Two-click area: the box follows the pointer from the first corner.
      const r = { left: Math.min(anchor.x, px), top: Math.min(anchor.y, py), width: Math.abs(px - anchor.x), height: Math.abs(py - anchor.y) };
      return drawBox(r, size(r), "0", true);
    }
    if (e.altKey !== alt && !down) return setAlt(e.altKey);
    if (!down) return requestAnimationFrame(hover);
    if (!dragging && Math.hypot(px - down.rawX, py - down.rawY) < 4) return;
    dragging = true;
    const p = snapPoint(px, py, !e.altKey);
    const left = Math.min(down.x, p.x), top = Math.min(down.y, p.y);
    dragRect = { left, top, width: Math.abs(p.x - down.x), height: Math.abs(p.y - down.y) };
    drawBox(dragRect, size(dragRect), "0", true);
    drawGuides(p);
  });

  layer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    layer.setPointerCapture(e.pointerId);
    edges = e.altKey ? gatherEdges() : null;
    const p = snapPoint(e.clientX, e.clientY, !e.altKey);
    down = { x: p.x, y: p.y, rawX: e.clientX, rawY: e.clientY };
    dragging = false;
    dragRect = null;
  });

  layer.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!down) return;
    const wasDrag = dragging;
    down = null;
    dragging = false;
    edges = null;
    drawGuides(null);
    if (wasDrag) {
      if (dragRect && dragRect.width >= 4 && dragRect.height >= 4) return takeRect(dragRect);
      return hover();
    }
    if (anchor) {
      // Second corner of a two-click area.
      const r = { left: Math.min(anchor.x, e.clientX), top: Math.min(anchor.y, e.clientY), width: Math.abs(e.clientX - anchor.x), height: Math.abs(e.clientY - anchor.y) };
      anchor = null;
      if (r.width >= 4 && r.height >= 4) return takeRect(r);
      return hover();
    }
    if (e.shiftKey) {
      // First corner: ⇧-click here, then click the opposite corner.
      anchor = { x: e.clientX, y: e.clientY };
      return drawBox({ left: anchor.x, top: anchor.y, width: 1, height: 1 }, "Click the opposite corner", "0", true);
    }
    if (alt && picked) return takeElement(picked);
    takeVisible();
  });

  for (const type of ["click", "dblclick", "contextmenu", "mousedown", "mouseup", "wheel"]) {
    layer.addEventListener(type, (e) => {
      if (type !== "wheel") e.preventDefault();
      e.stopPropagation();
      if (type === "contextmenu") deactivate();
    }, { passive: type === "wheel" ? true : false });
  }

  /* ---------- capturing ---------- */

  const send = (msg) => AtlasUI.send(msg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pageUrl = () => { try { const u = new URL(location.href); u.hash = ""; return u.href; } catch { return location.href; } };

  function toDoc(r) {
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function takeElement(el) {
    const d = toDoc(el.getBoundingClientRect());
    const docEl = document.documentElement;
    const maxW = Math.max(docEl.scrollWidth, d.x + d.w), maxH = Math.max(docEl.scrollHeight, d.y + d.h);
    const cs = getComputedStyle(el);
    const padded = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(cs[`padding${k}`]) > 0);
    const pad = padded ? 0 : PAD;
    const x = Math.max(0, d.x - pad), y = Math.max(0, d.y - pad);
    takeDoc({ x, y, w: Math.min(maxW, d.x + d.w + pad) - x, h: Math.min(maxH, d.y + d.h + pad) - y }, el);
  }

  // What's on screen right now (no scrolling, no selection).
  function takeVisible() {
    const docEl = document.documentElement;
    takeRect({ left: 0, top: 0, width: docEl.clientWidth || innerWidth, height: docEl.clientHeight || innerHeight });
  }

  function takeFull() {
    const docEl = document.documentElement;
    const h = Math.max(docEl.scrollHeight, document.body?.scrollHeight || 0, docEl.clientHeight);
    takeDoc({ x: 0, y: 0, w: docEl.clientWidth || innerWidth, h }, null);
  }

  function takeRect(r) {
    takeDoc(toDoc(r), null);
  }

  // Fixed and sticky bars would repeat in every stitched slice; hide them after the first.
  function hideFixed(el, list) {
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const n = Math.min(all.length, 8000);
    for (let i = 0; i < n; i++) {
      const node = all[i];
      if (isOurs(node) || (el && (node.contains(el) || el.contains(node)))) continue;
      const pos = getComputedStyle(node).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      list.push([node, node.style.getPropertyValue("visibility"), node.style.getPropertyPriority("visibility")]);
      node.style.setProperty("visibility", "hidden", "important");
    }
  }

  let busy = false;
  // content.js checks this so its ⌥ guide stays out of the way of screenshot mode.
  globalThis.AtlasShotState = {
    get active() { return active || busy; },
    start() { if (!busy && !active) activate(); },
    full() { if (!busy) { if (active) deactivate(); takeFull(); } },
    visible() { if (!busy) { if (active) deactivate(); takeVisible(); } }
  };

  async function takeDoc(doc, el) {
    deactivate();
    if (busy) return;
    busy = true;
    setSaverHidden(true);
    const sx0 = scrollX, sy0 = scrollY;
    const docEl = document.documentElement;
    const hidden = [];
    let outW = 0, outH = 0;
    let error = "";
    let stoppedEarly = false;
    try {
      const { scale = 2 } = (await send({ type: "atlas-shot-config" })) || {};
      // More pixels than the screen has: Chrome re-renders the area at that scale
      // (through its debugger, which shows a bar at the top for a moment).
      if (scale > (devicePixelRatio || 1) + 0.01) {
        await paint();
        const clip = { x: Math.round(doc.x), y: Math.round(doc.y), width: Math.round(doc.w), height: Math.round(doc.h) };
        if (clip.width < 2 || clip.height < 2) throw new Error("Nothing to capture here. Pick a larger area.");
        const res = await send({ type: "atlas-shot-render", clip, scale });
        if (!res?.ok) throw new Error(res?.error || "Couldn't capture this area. Scroll it into view and try again.");
        outW = clip.width;
        outH = clip.height;
      } else {
        await stitch();
      }
    } catch (e) {
      error = e.message || "Couldn't capture this area. Scroll it into view and try again.";
    } finally {
      for (const [node, v, p] of hidden) v ? node.style.setProperty("visibility", v, p) : node.style.removeProperty("visibility");
      window.scrollTo({ left: sx0, top: sy0, behavior: "instant" });
      setSaverHidden(false);
    }

    if (!error && stoppedEarly && (outW < 2 || outH < 2)) {
      busy = false;
      send({ type: "atlas-shot-cancel" });
      return toast("Screenshot cancelled");
    }
    if (!error && (outW < 2 || outH < 2)) error = "Nothing to capture here. Pick a larger area.";
    if (error) {
      busy = false;
      send({ type: "atlas-shot-cancel" });
      return toast(error, "error");
    }

    finish(outW, outH, stoppedEarly);

    // Screen-resolution capture: scroll through the area and stitch viewport slices.
    async function stitch() {
      const r = { x: Math.round(doc.x), y: Math.round(doc.y), w: Math.round(doc.w), h: Math.round(doc.h) };
      if (r.w < 2 || r.h < 2) throw new Error("Nothing to capture here. Pick a larger area.");

      const viewW = () => Math.min(innerWidth, docEl.clientWidth || innerWidth);
      const viewH = () => Math.min(innerHeight, docEl.clientHeight || innerHeight);
      const allVisible = r.x - scrollX >= 0 && r.y - scrollY >= 0 && r.x + r.w - scrollX <= viewW() && r.y + r.h - scrollY <= viewH();

      const begin = await send({ type: "atlas-shot-begin", width: r.w, height: r.h });
      if (!begin?.ok) throw new Error(begin?.error || "Couldn't start the capture");

      // Taller than the screen: show progress with Stop, and skip the strip it sits in.
      const SAFE = 72;
      const tall = r.h > viewH() + 1;
      let stopRequested = false;
      const onStopKey = (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        stopRequested = true;
      };
      const onStop = (e) => { e.preventDefault(); e.stopPropagation(); stopRequested = true; stopBtn.textContent = "Stopping…"; };
      if (tall) {
        mount();
        stopBtn.replaceChildren(txt("Stop"), kbd("esc"));
        progressText.textContent = "Capturing page · 0%";
        progress.style.visibility = "";
        progress.classList.add("on");
        stopBtn.addEventListener("click", onStop);
        addEventListener("keydown", onStopKey, true);
      }
      try {
      let frames = 0, doneY = 0, widthLimit = r.w;
      rows: while (doneY < r.h && frames < MAX_FRAMES) {
        let doneX = 0, rowH = 0;
        while (doneX < widthLimit && frames < MAX_FRAMES) {
          if (stopRequested) { stoppedEarly = true; break rows; }
          const wx = r.x + doneX, wy = r.y + doneY;
          if (!(frames === 0 && allVisible)) window.scrollTo({ left: wx, top: wy, behavior: "instant" });
          if (frames === 1) hideFixed(el, hidden);
          await paint();
          const vx = Math.round(wx - scrollX), vy = Math.round(wy - scrollY);
          if (vy < 0 || vy >= viewH()) break rows;       // can't scroll further down (inner scroller)
          if (vx < 0 || vx >= viewW()) { widthLimit = doneX; break; } // or further right
          let limitH = viewH() - (tall ? SAFE : 0);
          let tucked = false;
          if (tall && vy >= limitH) {
            // The page's last rows sit under the progress strip: hide it for this one frame.
            progress.style.visibility = "hidden";
            tucked = true;
            limitH = viewH();
            await paint();
          }
          const w = Math.min(widthLimit - doneX, viewW() - vx);
          const h = Math.min(r.h - doneY, limitH - vy);
          const res = await send({ type: "atlas-shot-frame", rect: { x: vx, y: vy, w, h }, dx: doneX, dy: doneY, vw: innerWidth });
          if (tucked) progress.style.visibility = "";
          if (!res?.ok) throw new Error(res?.error || "Couldn't capture this area. Scroll it into view and try again.");
          frames++;
          doneX += w;
          rowH = rowH ? Math.min(rowH, h) : h;
        }
        if (!doneX) break;
        if (!doneY) widthLimit = doneX; // the first row decides the width
        doneY += rowH;
        if (tall) progressText.textContent = `Capturing page · ${Math.min(100, Math.round((doneY / r.h) * 100))}%`;
      }
      outW = widthLimit;
      outH = doneY;
      } finally {
        if (tall) {
          progress.classList.remove("on");
          stopBtn.removeEventListener("click", onStop);
          removeEventListener("keydown", onStopKey, true);
        }
      }
    }
  }

  async function finish(width, height, stopped = false) {
    AtlasUI.prepareSound();
    toast("Saving screenshot…", "", true);
    const res = await send({ type: "atlas-shot-finish", width, height, sourceUrl: pageUrl(), title: document.title });
    busy = false;
    const to = res?.where || "Inbox";
    if (res?.ok && !res.duplicate) AtlasUI.playSaved();
    if (res?.ok) toast(res.duplicate ? "Already in Atlas" : res.linked === false ? `Added to ${to}, link not attached` : res.clipped ? `Added to ${to} at a smaller size` : stopped ? `Screenshot added to ${to}, up to where you stopped` : `Screenshot added to ${to}`);
    else toast(res?.error || "No answer from the extension, reload the page", "error");
  }

  /* ---------- shortcuts (recorded in the extension's settings) ---------- */
  // Stored as { code, alt, shift, ctrl, meta }; null means "not set".
  const DEFAULT_KEYS = {
    shotKey: { code: "KeyW", alt: true, shift: true },
    visibleKey: { code: "KeyE", alt: true, shift: true },
    fullKey: { code: "KeyF", alt: true, shift: true }
  };
  let keys = { ...DEFAULT_KEYS };
  const matches = (e, k) => !!k && e.code === k.code && e.altKey === !!k.alt && e.shiftKey === !!k.shift &&
    e.ctrlKey === !!k.ctrl && e.metaKey === !!k.meta;
  function loadKeys() {
    try {
      AtlasUI.getStored(Object.keys(DEFAULT_KEYS)).then((v) => {
        const next = {};
        for (const k of Object.keys(DEFAULT_KEYS)) next[k] = v[k] === undefined ? DEFAULT_KEYS[k] : v[k];
        keys = next;
      }, () => {});
    } catch { /* extension reloaded under this tab */ }
  }
  loadKeys();
  try {
    AtlasUI.onStored((c) => { if (c.shotKey || c.fullKey || c.visibleKey) loadKeys(); });
  } catch {}

  addEventListener("keydown", (e) => {
    if (e.repeat || busy) return;
    if ((matches(e, keys.shotKey) || matches(e, keys.fullKey) || matches(e, keys.visibleKey)) && !AtlasUI.alive()) {
      e.preventDefault();
      return toast(AtlasUI.RELOAD, "error");
    }
    if (matches(e, keys.shotKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      active ? deactivate() : activate();
    } else if (!active && matches(e, keys.fullKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      takeFull();
    } else if (!active && matches(e, keys.visibleKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      takeVisible();
    }
  }, true);

  if (AtlasUI.alive()) chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "atlas-shot-start" || busy) return;
    if (msg.full) return takeFull();
    active ? deactivate() : activate();
  });
})();
