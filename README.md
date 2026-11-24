<img src="icons/256.png" width="96" alt="">

# Atlas Saver

Chrome extension that saves images, videos and screenshots from any web page into the Atlas app on macOS, with the page they came from as the source link.

## Features

- **Save media** – hold ⌥ over the top-right corner of an image or video and press **+**. X, Instagram and LinkedIn posts keep their post link.
- **Hold ⌥ anywhere** – a short guide slides in from the right with **Screenshot**, **Full page** and **Save link** (the page itself as a link card; hold ⌘ too to add a note and tags). ⇧⌘S saves the link straight away, or the image or video that has keyboard focus; the shortcut can be changed in settings. A quick ⌥+key while typing never shows it. Hide the guide with its eye button, or switch it off under **Settings ▸ Guide on hold**.
- **Note and tags** – hold ⌘⌥ and press **+** to add a note and tags before saving. Both are written to the item in Atlas.
- **Screenshots** – ⌥⇧W by default: drag an area (or ⇧-click two corners), click for the visible screen, hold ⌥ to pick a block on the page, or press **F** for the full page. ⌥⇧E captures the visible screen and ⌥⇧F a full-page shot, both straight away; while a long page is captured, a bar at the bottom shows progress with **Stop** (or Esc) to keep what's captured so far. All three shortcuts can be changed in the extension's settings: click the key field and press the new keys.
- **Quality** – screenshots are always Retina 2×. On a non-Retina screen Chrome re-renders the area through its debugger, which briefly shows a bar at the top.
- **WebM videos** are converted to MP4 in the browser, because macOS (and so Atlas) can't read them.
- **Stays out of design tools** – Figma, Framer, Canva, Miro, Excalidraw, tldraw, Penpot, Photopea, Spline, Rive and Whimsical use ⌥ for their own tools, so the extension doesn't run there. Published Framer sites (`*.framer.website`) still work.


## Look

The UI uses [Inter Variable](https://rsms.me/inter/) (bundled, SIL Open Font License, see `fonts/Inter-LICENSE.txt`). Icons are SF Symbols drawn from Apple's SF Pro font when it's installed; nothing from Apple is bundled, and similar SVG icons are used otherwise.

## Setup

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick this folder.
2. Open the extension popup, enter the **Endpoint** and **Access key** from Atlas ▸ Settings ▸ Developers, press **Save**, then **Test connection**.

Atlas must be running; the extension talks to its local MCP endpoint. Nothing is shipped with the extension: your endpoint and key only live in your browser's extension storage.

Optional: to prefill them while developing, copy `config.example.js` to `config.js` (git-ignored).

### Optional helper

Screenshots are handed to Atlas through a hidden download that is removed right after the import. If you'd rather skip Chrome's download system entirely, install the native helper once:

```bash
./helper/install.sh <extension-id>
```

The extension id is shown on `chrome://extensions`.
