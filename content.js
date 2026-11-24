(() => {
  if (window.__atlasSaver) return;
  window.__atlasSaver = true;

  const SIZE = 28;
  const INSET = 10;
  const MIN_SIDE = 120; // skips avatars, emoji, icons
  const SVG_NS = "http://www.w3.org/2000/svg";
  const host_ = location.hostname;
  const SITE = /instagram\.com$/.test(host_) ? "instagram"
    : /(^|\.)(x|twitter)\.com$/.test(host_) ? "x"
    : /linkedin\.com$/.test(host_) ? "linkedin"
    : "generic";

  /* ---------- UI (closed shadow root, no page CSS leaks in or out) ---------- */

  const host = document.createElement("atlas-saver");
  const hs = host.style;
  hs.setProperty("all", "initial");
  hs.setProperty("position", "fixed");
  hs.setProperty("top", "0");
  hs.setProperty("left", "0");
  hs.setProperty("width", "0");
  hs.setProperty("height", "0");
  hs.setProperty("z-index", "2147483647");
  hs.setProperty("pointer-events", "none");
  const root = host.attachShadow({ mode: "closed" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    button {
      all: unset; box-sizing: border-box; position: fixed; top: 0; left: 0;
      width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
      display: grid; place-items: center; cursor: pointer; color: #fff;
      background: rgba(18,18,18,.5); /* white icon stays ≥3.5:1 even over a white image */
      -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); border: 1px solid transparent;
      opacity: 0; scale: .9; pointer-events: none;
      transition: opacity 120ms ease-out, scale 120ms ease-out;
    }
    button.on { opacity: 1; scale: 1; pointer-events: auto;
      transition: opacity 150ms ease-out, scale 150ms ease-out, background-color 150ms ease-out; }
    /* hover darkens only the plain state, so "saved" (white) and "error" (red) keep their color */
    @media (hover: hover) { button.on:is([data-state="idle"], [data-state="saving"]):hover { background: rgba(18,18,18,.68); } }
    button.on:active { scale: .96; }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    button[data-state="saved"] { background: rgba(255,255,255,.94); color: #111; }
    button[data-state="error"] { background: rgba(214,52,52,.92); }
    svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5;
          stroke-linecap: round; stroke-linejoin: round; }
    /* state icons sit on top of each other and cross-fade */
    button .ic, button .spin { grid-area: 1 / 1; opacity: 0; scale: .25;
          filter: blur(4px) drop-shadow(0 0 1px rgba(0,0,0,.35));
          transition: opacity 300ms cubic-bezier(.2, 0, 0, 1), scale 300ms cubic-bezier(.2, 0, 0, 1), filter 300ms cubic-bezier(.2, 0, 0, 1); }
    button[data-state="idle"] .plus, button[data-state="saving"] .spin,
    button[data-state="saved"] .check, button[data-state="error"] .bang,
    button[data-note="1"][data-state="idle"] .pen {
          opacity: 1; scale: 1; filter: blur(0px) drop-shadow(0 0 1px rgba(0,0,0,.35)); }
    button[data-note="1"][data-state="idle"] .plus { opacity: 0; scale: .25; filter: blur(4px) drop-shadow(0 0 1px rgba(0,0,0,.35)); }
    /* holding ⌘ swaps + and the pencil many times a day: no animation for that */
    button[data-state="idle"] .ic { transition-duration: 0s; }
    @media (prefers-reduced-motion: no-preference) { .spin { animation: turn .7s linear infinite; } }
    /* reduced motion: the arc stays put and gently pulses instead of spinning */
    @media (prefers-reduced-motion: reduce) { .spin { animation: pulse 1.2s ease-in-out infinite; } }
    @keyframes turn { to { rotate: 360deg; } }
    @keyframes pulse { 50% { opacity: .45; } }
    .tip {
      position: fixed; top: 0; left: 0; height: ${SIZE}px; padding: 0 10px; border-radius: 14px;
      display: flex; align-items: center; white-space: nowrap;
      font: 500 12px/1 ${AtlasUI.FONT};
      letter-spacing: -.005em; color: #fff; background: rgba(18,18,18,.82);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      opacity: 0; pointer-events: none; transition: opacity .14s ease;
    }
    .tip.on { opacity: 1; }
    @media (prefers-reduced-motion: no-preference) {
      /* comes out of the button, toward the left */
      .tip { transform: translateX(8px); transition: opacity 150ms ease-out, transform 200ms cubic-bezier(.23, 1, .32, 1); }
      .tip.on { transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      button, .tip { transition: opacity .1s linear; }
      button.on:active { scale: 1; }
      button .ic, button .spin { scale: 1; filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); transition-property: opacity; }
    }
  `);
  const noteSheet = new CSSStyleSheet();
  noteSheet.replaceSync(`

    .scrim { position: fixed; inset: 0; width: 100vw; height: 100vh; display: none; place-items: center;
             background: rgba(0,0,0,.28); pointer-events: auto; transition: opacity 140ms ease-out; }
    .scrim.on { display: grid; }
    @starting-style { .scrim.on { opacity: 0; } }
    .modal { width: min(380px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px; border-radius: 22px; /* 8 inner + 14 padding */
             display: flex; flex-direction: column; gap: 10px; color: #f2f2f2; background: rgba(24,24,24,.94);
             -webkit-backdrop-filter: blur(20px) saturate(1.4); backdrop-filter: blur(20px) saturate(1.4);
             box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 18px 50px rgba(0,0,0,.35); border: 1px solid transparent;
             font: 13px/1.4 ${AtlasUI.FONT}; letter-spacing: -.005em;
             transition: opacity 180ms cubic-bezier(.2, .8, .2, 1), scale 180ms cubic-bezier(.2, .8, .2, 1); }
    /* opens from 96% and transparent; reduced motion keeps only the fade */
    @starting-style { .scrim.on .modal { opacity: 0; scale: .96; } }
    @media (prefers-reduced-motion: reduce) {
      .modal { transition: opacity 180ms ease-out; }
      @starting-style { .scrim.on .modal { scale: 1; } }
    }
    .head { display: flex; align-items: center; gap: 10px; }
    .linkthumb { display: grid; place-items: center; color: rgba(255,255,255,.8); font-size: 17px; }
    .linkthumb .sf-svg { width: 17px; height: 17px; }
    .thumb { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: rgba(255,255,255,.08); flex: none; }
    img.thumb { outline: 1px solid oklch(1 0 0 / .1); outline-offset: -1px; }
    .title { font-weight: 600; }
    .sub { color: rgba(255,255,255,.5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
    .modal textarea, .modal input { all: unset; box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px;
             background: rgba(255,255,255,.07); color: #f2f2f2; font: inherit; }
    .modal textarea { min-height: 74px; resize: vertical; white-space: pre-wrap; }
    .modal textarea:focus-visible, .tagbox:focus-within { box-shadow: 0 0 0 1.5px rgba(255,255,255,.55); }
    .modal ::placeholder { color: rgba(255,255,255,.62); }
    .tagbox { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px; border-radius: 17px; /* 11 chip + 6 padding */ background: rgba(255,255,255,.07); cursor: text; }
    .tagbox input { flex: 1; min-width: 90px; width: auto; padding: 3px 4px; background: transparent; }
    .chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px 0 8px; border-radius: 11px;
            background: rgba(255,255,255,.14); font-size: 12px; }
    .modal .chip-x { all: unset; box-sizing: border-box; display: inline-grid; place-items: center; width: 16px; height: 16px;
                     border-radius: 50%; cursor: pointer; opacity: .7; color: inherit; }
    .modal .chip-x:focus-visible { outline: 2px solid #fff; outline-offset: 1px; opacity: 1; }
    @media (hover: hover) { .modal .chip-x:hover { opacity: 1; background: rgba(255,255,255,.12); } }
    .sugg { display: flex; flex-wrap: wrap; gap: 5px; min-height: 0; }
    .sugg:empty { display: none; }
    .sugg span { height: 22px; padding: 0 8px; border-radius: 11px; display: inline-flex; align-items: center; cursor: pointer;
                 font-size: 12px; color: rgba(255,255,255,.75); box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); border: 1px solid transparent; box-sizing: border-box; }
    .sugg span.hi { background: rgba(255,255,255,.12); color: #fff; }
    @media (hover: hover) { .sugg span:hover { background: rgba(255,255,255,.12); color: #fff; } }
    .actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
    .actions .hint { margin-right: auto; color: rgba(255,255,255,.62); font-size: 11px; }
    .modal button { all: unset; box-sizing: border-box; position: static; width: auto; height: 30px; padding: 0 12px;
                    border-radius: 8px; display: inline-flex; align-items: center; cursor: pointer; font-weight: 500;
                    opacity: 1; scale: 1; pointer-events: auto; color: #f2f2f2; box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); border: 1px solid transparent; }
    .modal button.primary { background: #f2f2f2; color: #111; box-shadow: none; }
    .modal button { transition: scale 150ms ease-out; }
    .modal button:active { scale: .96; }
    @media (prefers-reduced-motion: reduce) { .modal button:active { scale: 1; } }
    .modal button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

  `);
  const iconSheet = new CSSStyleSheet();
  iconSheet.replaceSync(AtlasUI.iconCSS(13) + `
    button .sf.ic { font-size: 13px; font-weight: 500; }
    .chip .sf { font-size: 9px; } .chip .sf-svg { width: 9px; height: 9px; }
  `);

  const hudSheet = new CSSStyleSheet();
  hudSheet.replaceSync(`
    .hud { position: fixed; top: 50%; right: 16px; width: 272px; box-sizing: border-box; padding: 12px;
           display: flex; flex-direction: column; gap: 8px; border-radius: 21px; /* 9 button + 12 padding */ color: #f2f2f2;
           background: rgba(24,24,24,.9); -webkit-backdrop-filter: blur(20px) saturate(1.4); backdrop-filter: blur(20px) saturate(1.4);
           box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 18px 50px rgba(0,0,0,.3); border: 1px solid transparent;
           font: 12px/1.4 ${AtlasUI.FONT}; letter-spacing: -.003em;
           opacity: 0; translate: 12px -50%; pointer-events: none;
           transition: opacity 150ms ease-out, translate 150ms ease-out; }
    .hud.on { opacity: 1; translate: 0 -50%; pointer-events: auto;
           transition: opacity 200ms cubic-bezier(.23, 1, .32, 1), translate 200ms cubic-bezier(.23, 1, .32, 1); }
    .hud .head { display: flex; align-items: center; justify-content: space-between; margin: -4px -4px -2px 0; }
    .hud .title { font-weight: 600; font-size: 12px; color: rgba(255,255,255,.62); letter-spacing: .01em; }
    .hud .hide { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px;
           color: rgba(255,255,255,.62); cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out, scale 150ms ease-out; }
    @media (hover: hover) { .hud .hide:hover { background: rgba(255,255,255,.12); color: #fff; } }
    @media (prefers-reduced-motion: no-preference) { .hud .hide:active { scale: .96; } }
    .hud .hide:focus-visible { outline: 2px solid #fff; outline-offset: 1px; color: #fff; }
    .hud .hide .sf { font-size: 13px; }
    .hud .line { display: grid; grid-template-columns: 34px 1fr; gap: 8px; align-items: baseline; }
    .hud kbd { font: 500 12px/1 ${AtlasUI.FONT}; color: #fff; letter-spacing: .04em; }
    .hud .line span { color: rgba(255,255,255,.82); }
    .hud .acts { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .hud .act { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 32px;
           padding: 0 10px; border-radius: 9px; background: rgba(255,255,255,.08); color: #fff; font-weight: 500; cursor: pointer;
           transition: scale 150ms ease-out, background-color 150ms ease-out; }
    @media (hover: hover) { .hud .act:hover { background: rgba(255,255,255,.16); } }
    .hud .act:active { scale: .96; }
    .hud .act:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .hud .act kbd { margin-left: auto; color: rgba(255,255,255,.62); font-weight: 500; letter-spacing: 0; }
    .hud .act .sf { font-size: 13px; width: 16px; text-align: center; font-weight: 500; }
    .hud .act .sf-svg { width: 14px; height: 14px; }
    .hud .hint { color: rgba(255,255,255,.62); font-size: 11px; }
    .hud .status { min-height: 0; color: rgba(255,255,255,.6); }
    .hud .status:empty { display: none; }
    .hud .status.ok { color: #7ee2a8; }
    .hud .status.error { color: #ff8a8a; }
    @media (prefers-reduced-motion: reduce) {
      .hud, .hud.on { transition: opacity .1s linear; translate: 0 -50%; }
      .hud .act:active { scale: 1; }
    }
  `);
  const capSheet = new CSSStyleSheet();
  capSheet.replaceSync(AtlasUI.keycapCSS(20) + `
    .hud { --keycap-edge: rgba(255,255,255,.18); }
    .hud .line { grid-template-columns: 48px 1fr; align-items: center; }
    .hud .line kbd, .hud .act kbd { display: inline-flex; letter-spacing: 0; }
    .hud .act kbd { color: rgba(255,255,255,.82); }
  `);
  root.adoptedStyleSheets = [sheet, noteSheet, iconSheet, hudSheet, capSheet];

  const icon = (cls, d) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.state = "idle";
  btn.setAttribute("aria-label", "Save to Atlas");
  btn.append(
    AtlasUI.icon("plus", "ic plus"),
    icon("spin", "M7 1.75A5.25 5.25 0 1 0 12.25 7"), // no SF Symbol spins, so the arc stays
    AtlasUI.icon("checkmark", "ic check"),
    AtlasUI.icon("exclamationmark", "ic bang"),
    AtlasUI.icon("square.and.pencil", "ic pen")
  );
  const tip = document.createElement("div");
  tip.className = "tip";
  root.append(btn, tip);
  // The + button and its note always sit above the guide, so a click meant for + never lands on a guide row.
  btn.style.zIndex = tip.style.zIndex = "2";

  /* ---------- finding the media under the pointer ---------- */

  const isMedia = (el) => el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
  const bigEnough = (r) => r.width >= MIN_SIDE && r.height >= MIN_SIDE;
  const contains = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  function mediaAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    if (stack[0] === host) return current;

    const hits = stack.filter((el) => isMedia(el) && bigEnough(el.getBoundingClientRect()));
    if (!hits.length) {
      // Sites often lay a transparent div over the media; look around the top element.
      let node = stack[0];
      for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
        const found = node.querySelectorAll("video, img");
        if (found.length > 60) break;
        for (const m of found) {
          const r = m.getBoundingClientRect();
          if (bigEnough(r) && contains(r, x, y)) hits.push(m);
        }
        if (hits.length) break;
      }
    }
    let video = hits.find((el) => el instanceof HTMLVideoElement);
    if (!video && hits[0]) {
      // A cover image often sits on top of the <video>; prefer the video next to it.
      let node = hits[0].parentElement;
      for (let i = 0; i < 5 && node && node !== document.body && !video; i++, node = node.parentElement) {
        video = [...node.querySelectorAll("video")].find((v) => {
          const r = v.getBoundingClientRect();
          return bigEnough(r) && contains(r, x, y);
        });
      }
    }
    return video || hits[0] || null;
  }

  /* ---------- working out what to send to Atlas ---------- */

  const isHttp = (u) => /^https?:\/\//i.test(u || "");
  const abs = (href) => { try { return new URL(href, location.href).href; } catch { return ""; } };
  const clean = (href) => { try { const u = new URL(href, location.href); u.search = ""; u.hash = ""; return u.href; } catch { return ""; } };

  function bestImage(img) {
    const set = img.getAttribute("srcset");
    let best = "", bestW = 0;
    if (set) {
      for (const part of set.split(/,\s+/)) {
        const [u, d] = part.trim().split(/\s+/);
        const w = parseFloat(d) || 1;
        if (u && w >= bestW) { best = u; bestW = w; }
      }
    }
    let url = abs(best || img.currentSrc || img.src);
    if (SITE === "x" && /pbs\.twimg\.com\/media\//.test(url)) {
      const u = new URL(url);
      u.searchParams.set("name", "orig"); // full resolution instead of the timeline size
      url = u.href;
    }
    return isHttp(url) ? url : "";
  }

  function directVideo(video) {
    const src = video.currentSrc || video.src || video.querySelector("source")?.src || "";
    return isHttp(src) && !/\.m3u8(\?|$)/i.test(src) ? src : ""; // blob:/HLS can't be fetched by Atlas
  }

  function postUrl(el) {
    if (SITE === "instagram") {
      const sel = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';
      const trim = (href) => clean(href).replace(/(\/(?:p|reel|tv)\/[^/]+\/).*$/, "$1");
      const a = el.closest(sel) || el.closest("article")?.querySelector(sel);
      if (a) return trim(a.href);
      // Newer feeds have no <article>: climb until a container links to exactly one post.
      const codeOf = (href) => href.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1];
      let node = el.parentElement;
      for (let i = 0; i < 14 && node && node !== document.body; i++, node = node.parentElement) {
        const links = [...node.querySelectorAll(sel)].filter((x) => codeOf(x.href));
        const codes = new Set(links.map((x) => codeOf(x.href)));
        if (codes.size === 1) return trim(links[0].href);
        if (codes.size > 1) break;
      }
      if (/\/(p|reel|reels|tv|stories)\//.test(location.pathname)) return clean(location.href);
      return "";
    }
    if (SITE === "x") {
      const status = (href) => {
        const m = (href || "").match(/^https?:\/\/[^/]+\/([^/]+)\/status\/(\d+)/);
        return m ? `https://x.com/${m[1]}/status/${m[2]}` : "";
      };
      const near = el.closest('a[href*="/status/"]');
      if (near && status(near.href)) return status(near.href);
      const article = el.closest("article");
      const time = article?.querySelector('a[href*="/status/"] time');
      if (time) return status(time.closest("a").href);
      const any = article?.querySelector('a[href*="/status/"]');
      return status(any?.href) || status(location.href);
    }
    if (SITE === "linkedin") {
      const node = el.closest('[data-urn^="urn:li:"], [data-id^="urn:li:"]');
      const urn = node?.getAttribute("data-urn") || node?.getAttribute("data-id") || "";
      if (/^urn:li:(activity|ugcPost|share):\d+/.test(urn)) return `https://www.linkedin.com/feed/update/${urn}/`;
      if (/\/(feed\/update|posts)\//.test(location.pathname)) return clean(location.href);
      return "";
    }
    return "";
  }

  const pageUrl = () => { try { const u = new URL(location.href); u.hash = ""; return u.href; } catch { return location.href; } };

  function describe(el) {
    const post = postUrl(el);
    const isVideo = el instanceof HTMLVideoElement;
    const direct = isVideo ? directVideo(el) : bestImage(el);
    const page = pageUrl();
    // On profile grids a reel is only a thumbnail image linking to /reel/…
    const reelThumb = SITE === "instagram" && !isVideo && /\/reels?\//.test(post);
    return {
      // what Atlas downloads: the file itself when reachable, else the post or page
      url: direct || post || (isVideo ? page : ""),
      // what Atlas records as the link: the post or page the media lives on
      sourceUrl: post || page,
      key: direct || `${post}#${isVideo ? "video" : "image"}`,
      post,
      resolveVideo: SITE === "instagram" && !!post && (reelThumb || (isVideo && !direct))
    };
  }

  /* ---------- Instagram: find the real video file ---------- */
  // Instagram plays videos from a blob: stream that nothing outside the tab can fetch.
  // The post's own data (read with your logged-in session) lists the actual .mp4.

  function instagramMediaId(post) {
    const story = post.match(/\/stories\/[^/]+\/(\d+)/);
    if (story) return story[1];
    const m = post.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return "";
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = 0n;
    for (const ch of m[1].slice(0, 11)) {
      const i = abc.indexOf(ch);
      if (i < 0) return "";
      id = id * 64n + BigInt(i);
    }
    return id.toString();
  }

  const fileName = (u) => { try { return new URL(u, location.href).pathname.split("/").pop(); } catch { return ""; } };

  function videoFromItem(item, el) {
    if (!item) return "";
    const slides = item.carousel_media?.length ? item.carousel_media : [item];
    const videos = slides.filter((sl) => sl?.video_versions?.length);
    if (!videos.length) return "";

    // In a carousel, match the hovered slide by its poster image.
    let pick = videos[0];
    const poster = fileName(el.poster || el.currentSrc || el.src || "");
    if (videos.length > 1 && poster) {
      pick = videos.find((sl) => (sl.image_versions2?.candidates || []).some((c) => fileName(c.url) === poster)) || pick;
    }
    const best = [...pick.video_versions].sort((p, q) => (q.width || 0) * (q.height || 0) - (p.width || 0) * (p.height || 0))[0];
    return isHttp(best?.url) ? best.url : "";
  }

  // 1) Ask ig-hook.js (page world) for the post data Instagram already loaded.
  function askPage(keys) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (item) => { removeEventListener("message", on); clearTimeout(timer); resolve(item); };
      const on = (e) => { if (e.source === window && e.data?.type === "atlas-ig-answer" && e.data.id === id) done(e.data.item); };
      const timer = setTimeout(() => done(undefined), 1500); // undefined = ig-hook.js never answered
      addEventListener("message", on);
      window.postMessage({ type: "atlas-ig-ask", id, keys }, location.origin);
    });
  }

  // 2) Ask Instagram's API with the same headers its web app sends.
  async function askApi(id) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
      let claim = "0";
      try { claim = sessionStorage.getItem("www-claim-v2") || "0"; } catch {}
      const res = await fetch(`/api/v1/media/${id}/info/`, {
        headers: {
          "X-IG-App-ID": "936619743392459",
          "X-ASBD-ID": "129477",
          "X-IG-WWW-Claim": claim,
          "X-Requested-With": "XMLHttpRequest",
          ...(csrf ? { "X-CSRFToken": csrf } : {})
        },
        credentials: "include",
        signal: ctrl.signal
      });
      if (!res.ok) { lastWhy.api = `API ${res.status}`; return null; }
      const item = (await res.json())?.items?.[0] || null;
      lastWhy.api = item ? (item.video_versions || item.carousel_media ? "API ok" : "API no video") : "API empty";
      return item;
    } catch (e) {
      lastWhy.api = e?.name === "AbortError" ? "API timeout" : "API error";
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Why the last lookup failed, shown in the tip so a failure can be traced.
  const lastWhy = { page: "", api: "" };

  async function instagramVideo(el, post) {
    lastWhy.page = lastWhy.api = "";
    const id = instagramMediaId(post);
    const code = post.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id && !code) { lastWhy.page = "no post id"; return ""; }
    const pageItem = await askPage([code, id]);
    lastWhy.page = pageItem === undefined ? "hook missing" : pageItem ? "page item, no video" : "page no data";
    const fromPage = videoFromItem(pageItem, el);
    if (fromPage) return fromPage;
    const fromApi = id ? videoFromItem(await askApi(id), el) : "";
    console.info("[Atlas Saver] Instagram video lookup", { post, code, id, ...lastWhy, found: !!fromApi });
    return fromApi;
  }

  /* ---------- behaviour ---------- */

  let current = null;
  let state = "idle";
  let hideTimer = 0;
  let tipTimer = 0;
  let px = -1, py = -1, queued = false;
  let alt = false; // the + button only shows while the chosen key (⌥ by default) is held
  let holdUntil = 0; // a finished save stays on screen until then
  let noting = false; // the note panel is open
  const saved = new Set();

  function setState(next, message) {
    state = next;
    btn.dataset.state = next;
    btn.setAttribute("aria-label", next === "saved" ? "Saved to Atlas" : next === "saving" ? "Saving to Atlas" : "Save to Atlas");
    clearTimeout(tipTimer);
    if (message) {
      tip.textContent = message;
      tip.classList.add("on");
      place();
      // "Saving…" stays until the result replaces it; results fade after a moment.
      if (next !== "saving") tipTimer = setTimeout(() => tip.classList.remove("on"), 2600);
    } else {
      tip.classList.remove("on");
    }
  }

  function place() {
    if (!current) return;
    if (!current.isConnected) return hide(true);
    const r = current.getBoundingClientRect();
    if (r.bottom < SIZE || r.top > innerHeight || !bigEnough(r)) return hide(true);
    const left = Math.min(r.right, innerWidth) - SIZE - INSET;
    const top = Math.max(r.top, 0) + INSET;
    btn.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
    const tipW = tip.offsetWidth;
    tip.style.translate = `${Math.round(left - tipW - 6)}px ${Math.round(top)}px`;
  }

  function show(el) {
    AtlasUI.loadInter();
    clearTimeout(hideTimer);
    if (el !== current) {
      current = el;
      if (state !== "saving") setState(saved.has(describe(el).key) ? "saved" : "idle");
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    place();
    btn.classList.add("on");
    // The guide steps aside for the + button, even while the pointer is over it when they overlap.
    if (hudOn && !linkBusy && (!hudHover || overlaps(btn, hud))) hideHud(true);
  }

  const overlaps = (a, b) => {
    const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    return r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top;
  };

  function hide(now) {
    clearTimeout(hideTimer);
    const run = () => {
      // keep the button while saving, writing a note, or showing a fresh result
      if (state === "saving" || noting || Date.now() < holdUntil) return;
      btn.classList.remove("on");
      tip.classList.remove("on");
      current = null;
    };
    now ? run() : (hideTimer = setTimeout(run, 120));
  }

  // The button only appears once the pointer nears the media's top-right corner.
  function inCorner(el) {
    const r = el.getBoundingClientRect();
    const zone = Math.max(72, Math.min(140, Math.min(r.width, r.height) * 0.35));
    const right = Math.min(r.right, innerWidth);
    const top = Math.max(r.top, 0);
    return px >= right - zone && px <= right && py >= top && py <= top + zone;
  }

  function track() {
    queued = false;
    const el = mediaAt(px, py);
    el && alt && inCorner(el) ? show(el) : current && hide(true);
  }

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(track); } };
  const setAlt = (on) => { if (on !== alt) { alt = on; if (px >= 0) schedule(); } };
  const setMeta = (on) => { btn.dataset.note = on ? "1" : ""; };

  // Keys are set in the popup: hoverKey shows the + button ("none" = always),
  // noteKey held as well opens the note and tags panel before saving.
  const KEY_PROP = { Alt: "altKey", Control: "ctrlKey", Shift: "shiftKey", Meta: "metaKey" };
  let hoverKey = "Alt", noteKey = "Meta";
  const held = (e, key) => key === "none" || !!e[KEY_PROP[key]];
  function applyKeys(v = {}) {
    hoverKey = v.hoverKey === "none" || KEY_PROP[v.hoverKey] ? v.hoverKey : "Alt";
    noteKey = KEY_PROP[v.noteKey] && v.noteKey !== hoverKey ? v.noteKey : hoverKey === "Meta" ? "Alt" : "Meta";
    setAlt(hoverKey === "none");
  }
  try {
    AtlasUI.getStored(["hoverKey", "noteKey"]).then(applyKeys);
    AtlasUI.onStored((c) => { if (c.hoverKey || c.noteKey) AtlasUI.getStored(["hoverKey", "noteKey"]).then(applyKeys); });
  } catch { /* extension reloaded under this tab */ }

  addEventListener("keydown", (e) => { if (e.key === hoverKey) setAlt(true); if (e.key === noteKey) setMeta(true); }, true);
  addEventListener("keyup", (e) => { if (e.key === hoverKey) setAlt(false); if (e.key === noteKey) setMeta(false); }, true);
  addEventListener("blur", () => { setAlt(hoverKey === "none"); setMeta(false); });

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    px = e.clientX; py = e.clientY;
    alt = held(e, hoverKey);
    setMeta(held(e, noteKey));
    schedule();
  }, { passive: true, capture: true });

  addEventListener("scroll", () => { if (current) requestAnimationFrame(place); }, { passive: true, capture: true });
  addEventListener("resize", () => { if (current) place(); }, { passive: true });
  document.addEventListener("pointerleave", () => hide(true));

  // Keep the page from reacting to presses on the button (opening the post, pausing the video…).
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "dblclick"]) {
    btn.addEventListener(type, (e) => e.stopPropagation());
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { window.postMessage({ type: "atlas-debug", info: { step: "click", hasCurrent: !!current, tag: current?.tagName, state } }, location.origin); } catch {}
    if (!current || state === "saving") return;
    if (state === "saved") return setState("saved", "Already saved");
    saveMediaFrom(current, held(e, noteKey), false);
  });

  // Saves one image or video: from the + button, or from the keyboard (fromKeys).
  async function saveMediaFrom(target, withNote, fromKeys) {
    if (!AtlasUI.alive()) return fail(AtlasUI.RELOAD);
    const info = describe(target);
    if (!info.url) return fail("No link found. Open the post itself and try again.");

    let extras = null;
    if (withNote) {
      noting = true;
      extras = await openNote(target, info);
      noting = false;
      if (!extras) { if (fromKeys || !mediaAt(px, py)) hide(false); return; }
    }

    // Spinner on the button and a note beside it; videos can take a while (conversion).
    setState("saving", target instanceof HTMLVideoElement ? "Saving video…" : "Saving…");
    let viaPost = false, igFile = false;
    const igNoPost = SITE === "instagram" && !info.post && !info.url.startsWith("https://scontent") && target instanceof HTMLVideoElement;
    if (info.resolveVideo) {
      const file = await instagramVideo(target, info.post);
      if (file) { info.url = file; igFile = true; }
      else { info.url = info.post; viaPost = true; }
    }
    const debug = (extra) => { try { window.postMessage({ type: "atlas-debug", info: { tag: target.tagName, post: info.post, resolveVideo: info.resolveVideo, sent: String(info.url).slice(0, 90), viaPost, igFile, ...lastWhy, ...extra } }, location.origin); } catch {} };
    debug({ step: "sending" });
    let res;
    try {
      res = await AtlasUI.send({ type: "atlas-save", payload: { url: info.url, sourceUrl: info.sourceUrl, ...(extras || {}) } });
    } catch {
      res = { ok: false, error: "Reload the page" }; // extension was updated under this tab
    }

    debug({ step: "answered", res });
    if (res?.ok) {
      saved.add(info.key);
      const to = res.where || "Inbox";
      if (current === target || !current) setState("saved",
        res.duplicate ? (extras ? "Already in Atlas, note added" : "Already in Atlas")
        : extras && res.noted === false ? `Added to ${to}, note or tags not added`
        : res.linked === false ? `Added to ${to}, link not attached`
        : viaPost ? `Sent post link (${lastWhy.page || "?"} · ${lastWhy.api || "no API call"})`
        : igNoPost ? `Added page link to ${to}`
        : extras ? `Added to ${to} with note`
        : res.converted ? `Added to ${to} as MP4`
        : `Added to ${to}`);
      else setState(saved.has(describe(current).key) ? "saved" : "idle");
    } else {
      fail(res?.error || "No answer from the extension, reload the page");
    }
    // Keep the checkmark and its message up long enough to read, wherever the pointer went.
    holdUntil = Date.now() + 2400;
    setTimeout(() => {
      holdUntil = 0;
      const stillThere = alt && current && mediaAt(px, py) === current && inCorner(current);
      if (!stillThere && state !== "saving") hide(true);
    }, 2400);
  }

  // Keyboard path: the image or video that has focus, or the one inside the focused element.
  function focusedMedia() {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return null;
    if (isMedia(a) && bigEnough(a.getBoundingClientRect())) return a;
    const inside = [...a.querySelectorAll("img, video")].filter((m) => bigEnough(m.getBoundingClientRect()));
    if (!inside.length) return null;
    // A cover image and its video: prefer the video, then the largest.
    const video = inside.find((m) => m instanceof HTMLVideoElement);
    if (video) return video;
    return inside.sort((m, n) => {
      const r = m.getBoundingClientRect(), q = n.getBoundingClientRect();
      return q.width * q.height - r.width * r.height;
    })[0];
  }

  function fail(message) {
    setState("error", message);
    setTimeout(() => { if (state === "error") setState("idle"); }, 2600);
  }
  /* ---------- holding the key: a short guide and "Save link" ---------- */
  // Holding ⌥ (or the key chosen in settings) works like opening a command: after a
  // moment, a guide slides in from the right with a button to save the page itself.
  // A quick ⌥+key (typing @, €…) never shows it.

  const HUD_DELAY = 350;
  const GLYPH = { Alt: "⌥", Control: "⌃", Shift: "⇧", Meta: "⌘" };
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.setAttribute("role", "dialog");
  hud.setAttribute("aria-label", "Atlas Saver");
  root.append(hud);
  let hudTimer = 0, hudOn = false, hudHover = false, hudHeld = false, linkBusy = false, hudHideTimer = 0;
  // The guide can be hidden from its own eye button or in settings ("guide": false).
  // Results of saves still show in it briefly; only the hold-to-open guide goes away.
  let guideOn = true;
  AtlasUI.getStored("guide").then((v) => { guideOn = v.guide !== false; });
  AtlasUI.onStored((c) => { if (c.guide) guideOn = c.guide.newValue !== false; });
  const hudKey = () => (hoverKey === "none" ? "Alt" : hoverKey);

  // Shortcuts recorded in settings ({ code, alt, shift, ctrl, meta }, null = not set).
  // Save link is handled here; the screenshot ones live in shot.js and are only shown in the guide.
  const DEFAULT_KEYS = {
    linkKey: { code: "KeyS", meta: true, shift: true },
    shotKey: { code: "KeyW", alt: true, shift: true },
    visibleKey: { code: "KeyE", alt: true, shift: true },
    fullKey: { code: "KeyF", alt: true, shift: true }
  };
  const keys = { ...DEFAULT_KEYS };
  let linkKey = keys.linkKey;
  const comboLabel = (k) => !k ? "" :
    `${k.ctrl ? "⌃" : ""}${k.alt ? "⌥" : ""}${k.shift ? "⇧" : ""}${k.meta ? "⌘" : ""}${k.code.replace(/^Key|^Digit/, "")}`;
  const comboHit = (e, k) => !!k && e.code === k.code && e.altKey === !!k.alt && e.shiftKey === !!k.shift &&
    e.ctrlKey === !!k.ctrl && e.metaKey === !!k.meta;
  function loadKeys() {
    try {
      AtlasUI.getStored(Object.keys(DEFAULT_KEYS)).then((v) => {
        for (const k of Object.keys(DEFAULT_KEYS)) keys[k] = v[k] === undefined ? DEFAULT_KEYS[k] : v[k];
        linkKey = keys.linkKey;
      }, () => {});
    } catch {}
  }
  loadKeys();
  try {
    AtlasUI.onStored((c) => { if (c.linkKey || c.shotKey || c.fullKey || c.visibleKey) loadKeys(); });
  } catch {}

  function buildHud(statusText = "", kind = "", compact = false) {
    const k = GLYPH[hudKey()], n = GLYPH[noteKey];
    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; };
    const line = (keys, text) => { const r = el("div", "line"); const kb = el("kbd"); kb.append(AtlasUI.keycapsFromGlyphs(keys)); r.append(kb, el("span", "", text)); return r; };
    const action = (iconName, label, combo, aria, onClick) => {
      const b = el("button", "act");
      b.type = "button";
      const kb = el("kbd");
      kb.append(AtlasUI.keycaps(combo));
      b.append(AtlasUI.icon(iconName), el("span", "", label), kb);
      b.setAttribute("aria-label", aria + (combo ? `, ${comboLabel(combo)}` : ""));
      b.addEventListener("click", onClick);
      for (const t of ["pointerdown", "mousedown", "mouseup", "pointerup"]) b.addEventListener(t, (e) => e.stopPropagation());
      return b;
    };
    const actions = el("div", "acts");
    actions.append(
      action("viewfinder", "Screenshot", keys.shotKey, "Take a screenshot", (e) => {
        e.preventDefault(); e.stopPropagation();
        hideHud(true);
        globalThis.AtlasShotState?.start();
      }),
      action("macwindow", "Visible screen", keys.visibleKey, "Capture what's on screen", (e) => {
        e.preventDefault(); e.stopPropagation();
        hideHud(true);
        globalThis.AtlasShotState?.visible();
      }),
      action("doc.viewfinder", "Full page", keys.fullKey, "Take a full-page screenshot", (e) => {
        e.preventDefault(); e.stopPropagation();
        hideHud(true);
        globalThis.AtlasShotState?.full();
      }),
      action("link", "Save link", linkKey, `Save this page to Atlas as a link. Hold ${n} while clicking to add a note and tags`, onSaveLink)
    );
    const status = el("div", `status ${kind}`, statusText);
    status.setAttribute("role", "status");
    const head = el("div", "head");
    const hideBtn = el("button", "hide");
    hideBtn.type = "button";
    hideBtn.append(AtlasUI.icon("eye.slash"));
    hideBtn.setAttribute("aria-label", "Hide this guide. Turn it back on in Atlas Saver settings.");
    hideBtn.title = "Hide this guide";
    hideBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      guideOn = false;
      await AtlasUI.setStored({ guide: false });
      showHud("Guide hidden. Turn it back on in Atlas Saver settings.", "", true);
      hudHideTimer = setTimeout(() => hideHud(true), 2200);
    });
    for (const t of ["pointerdown", "mousedown", "mouseup", "pointerup"]) hideBtn.addEventListener(t, (e) => e.stopPropagation());
    head.append(el("div", "title", "Atlas Saver"), hideBtn);
    if (compact) {
      // Only a result to report (guide hidden): title and status.
      head.lastChild.remove();
      const status = el("div", `status ${kind}`, statusText);
      status.setAttribute("role", "status");
      return hud.replaceChildren(head, status);
    }
    hud.replaceChildren(
      head,
      line(k, "Point at the top-right of an image or video, then press +"),
      line(n + k, "Same, with a note and tags"),
      actions,
      el("div", "hint", `Hold ${n} while clicking Save link to add a note and tags`),
      status
    );
  }

  function showHud(statusText, kind, compact) {
    if (globalThis.AtlasShotState?.active || noting) return;
    // Holding ⌥ to use the + button shouldn't also pop the guide up.
    if (!statusText && (btn.classList.contains("on") || state === "saving")) return;
    if (!statusText && !guideOn) return; // hidden: holding the key no longer opens it
    clearTimeout(hudHideTimer);
    AtlasUI.loadInter();
    buildHud(statusText, kind, compact ?? !guideOn);
    if (!host.isConnected) document.documentElement.appendChild(host);
    hud.classList.add("on");
    hudOn = true;
  }

  function hideHud(force) {
    clearTimeout(hudTimer);
    if (!hudOn || linkBusy) return;
    if (!force && (hudHover || hudHeld)) return;
    hud.classList.remove("on");
    hudOn = false;
  }

  hud.addEventListener("pointerenter", () => { hudHover = true; });
  hud.addEventListener("pointerleave", () => { hudHover = false; if (!hudHeld) hudHideTimer = setTimeout(() => hideHud(), 250); });

  addEventListener("keydown", (e) => {
    if (e.key === hudKey()) {
      hudHeld = true;
      if (!e.repeat && !hudOn) { clearTimeout(hudTimer); hudTimer = setTimeout(() => { if (hudHeld) showHud(); }, HUD_DELAY); }
    } else if (!GLYPH[e.key]) {
      // A real key while holding ⌥ means typing (⌥Q = @ …), not the guide.
      clearTimeout(hudTimer);
      if (hudOn && !hudHover) hideHud(true);
    }
  }, true);
  addEventListener("keyup", (e) => {
    if (e.key !== hudKey()) return;
    hudHeld = false;
    clearTimeout(hudTimer);
    hideHud();
  }, true);
  addEventListener("blur", () => { hudHeld = false; hudHover = false; hideHud(true); });

  addEventListener("keydown", (e) => {
    if (e.repeat || !comboHit(e, linkKey) || globalThis.AtlasShotState?.active || noting) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Focus on (or inside) an image or video saves that media; anywhere else saves the page link.
    const media = focusedMedia();
    if (media && state !== "saving") {
      show(media);
      return saveMediaFrom(media, false, true);
    }
    saveLink(false);
  }, true);

  function onSaveLink(e) {
    e.preventDefault();
    e.stopPropagation();
    saveLink(!!e[KEY_PROP[noteKey]]);
  }

  async function saveLink(withNote) {
    if (linkBusy) return;
    if (!AtlasUI.alive()) return showHud(AtlasUI.RELOAD, "error");
    let extras = null;
    if (withNote) {
      hideHud(true);
      noting = true;
      extras = await openNote(null, { sourceUrl: pageUrl(), link: true });
      noting = false;
      if (!extras) return;
    }
    linkBusy = true;
    showHud("Saving link…");
    let res;
    try {
      res = await AtlasUI.send({ type: "atlas-save-link", payload: { url: pageUrl(), ...(extras || {}) } });
    } catch {
      res = { ok: false, error: "Reload the page" };
    }
    linkBusy = false;
    const to = res?.where || "Inbox";
    if (res?.ok) showHud(extras && res.noted === false ? `Link added to ${to}, note or tags not added` : extras ? `Link added to ${to} with note` : `Link added to ${to}`, "ok");
    else showHud(res?.error || "Couldn't save the link. Check that Atlas is running, then try again.", "error");
    // Leave the result up for a moment, then follow the key as usual.
    hudHideTimer = setTimeout(() => hideHud(), 1800);
  }

  /* ---------- note and tags panel (⌘⌥ + click) ---------- */

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  root.append(scrim);
  let tagNames = null;

  function openNote(target, info) {
    return new Promise((resolve) => {
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
      const modal = el("div", "modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Save to Atlas with a note");

      const head = el("div", "head");
      const thumb = el("img", "thumb");
      thumb.alt = "";
      const still = !target ? "" : target instanceof HTMLVideoElement ? target.poster : target.currentSrc || target.src;
      let lead = thumb;
      if (info.link) {
        lead = el("div", "thumb linkthumb");
        lead.append(AtlasUI.icon("link"));
      } else if (still) thumb.src = still;
      else thumb.style.visibility = "hidden";
      const text = el("div");
      let where = info.sourceUrl;
      try { const u = new URL(info.sourceUrl); where = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch {}
      text.append(el("div", "title", info.link ? "Save link to Atlas" : "Save to Atlas"), el("div", "sub", where));
      head.append(lead, text);

      const note = el("textarea");
      note.placeholder = "Add a note…";
      note.rows = 3;
      note.setAttribute("aria-label", "Note");

      const tags = [];
      const box = el("div", "tagbox");
      const input = el("input");
      input.placeholder = "Add tags";
      input.setAttribute("aria-label", "Tags");
      box.append(input);
      const sugg = el("div", "sugg");

      const actions = el("div", "actions");
      const cancel = el("button", "", "Cancel");
      const save = el("button", "primary", "Save");
      cancel.type = save.type = "button";
      actions.append(el("span", "hint", "⌘↵ to save · esc to cancel"), cancel, save);

      modal.append(head, note, box, sugg, actions);
      scrim.replaceChildren(modal);
      scrim.classList.add("on");

      function drawChips() {
        box.querySelectorAll(".chip").forEach((c) => c.remove());
        for (const t of tags) {
          const chip = el("span", "chip", t);
          const x = el("button", "chip-x");
          x.type = "button";
          x.append(AtlasUI.icon("xmark"));
          x.setAttribute("aria-label", `Remove tag ${t}`);
          x.addEventListener("click", (e) => { e.stopPropagation(); tags.splice(tags.indexOf(t), 1); drawChips(); drawSugg(); input.focus(); });
          chip.append(x);
          box.insertBefore(chip, input);
        }
      }
      function addTag(t) {
        t = t.replace(/,/g, "").trim().replace(/^#/, "");
        if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
        input.value = "";
        drawChips();
        drawSugg();
      }
      function drawSugg() {
        const q = input.value.trim().toLowerCase();
        const pool = (tagNames || []).filter((n) => !tags.includes(n));
        const list = (q ? pool.filter((n) => n.toLowerCase().includes(q)) : pool).slice(0, 8);
        sugg.replaceChildren(...list.map((n, i) => {
          const s = el("span", q && i === 0 ? "hi" : "", n);
          s.addEventListener("mousedown", (e) => { e.preventDefault(); addTag(n); input.focus(); });
          return s;
        }));
      }
      if (tagNames) drawSugg();
      else AtlasUI.send({ type: "atlas-tags" }).then((r) => { tagNames = r?.names || []; drawSugg(); });

      input.addEventListener("input", () => {
        // A comma (typed or pasted) ends a tag.
        if (input.value.includes(",")) {
          const parts = input.value.split(",");
          const rest = parts.pop();
          for (const p of parts) addTag(p);
          input.value = rest;
        }
        drawSugg();
      });
      input.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" && !e.metaKey) || e.key === ",") {
          e.preventDefault();
          const pick = input.value.trim() && sugg.querySelector(".hi");
          addTag(pick ? pick.textContent : input.value);
        } else if (e.key === "Backspace" && !input.value && tags.length) {
          tags.pop();
          drawChips();
          drawSugg();
        }
      });
      box.addEventListener("click", () => input.focus());

      // Modal for real: the page behind can't be reached, and focus goes back afterwards.
      const before = root.activeElement || document.activeElement;
      const body = document.body;
      const bodyWasInert = body ? body.inert : false;
      if (body) body.inert = true; // our UI hangs off <html>, outside <body>
      const close = (result) => {
        scrim.classList.remove("on");
        scrim.replaceChildren();
        if (body) body.inert = bodyWasInert;
        try { if (before?.isConnected) before.focus({ preventScroll: true }); } catch {}
        resolve(result);
      };
      const submit = () => {
        if (input.value.trim()) addTag(input.value);
        close({ note: note.value.trim(), tags: [...tags] });
      };
      save.addEventListener("click", submit);
      cancel.addEventListener("click", () => close(null));
      scrim.onpointerdown = (e) => { if (e.target === scrim) close(null); };

      // Keep typing inside the panel: no page shortcuts (X, Instagram…) fire while it's open.
      for (const type of ["keydown", "keyup", "keypress"]) {
        modal.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type !== "keydown") return;
          if (e.key === "Escape") { e.preventDefault(); close(null); }
          else if (e.key === "Tab") {
            // Keep Tab inside the panel.
            const stops = [...modal.querySelectorAll("textarea, input, button")].filter((n) => !n.disabled && n.getClientRects().length);
            const i = stops.indexOf(root.activeElement);
            const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i === -1 || i === stops.length - 1 ? 0 : i + 1);
            e.preventDefault();
            stops[next]?.focus();
          }
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        });
      }
      for (const type of ["pointerdown", "mousedown", "click", "wheel"]) modal.addEventListener(type, (e) => e.stopPropagation());

      requestAnimationFrame(() => note.focus());
    });
  }
})();
