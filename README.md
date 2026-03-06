# casty

Run a real Chrome browser inside your terminal.

**[日本語](README.ja.md)**

casty is not a text-mode browser. It runs an actual Chrome engine in headless mode, captures rendered frames via Chrome DevTools Protocol, and displays them in your terminal using the Kitty graphics protocol. Your terminal becomes a remote Chrome viewer.

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## How It Works

```
Terminal (you)          casty               Chrome (headless)
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Kitty       │ ←──  │  Screencast  │ ←──  │  Full web    │
│  graphics    │      │  + hi-res    │      │  rendering   │
│  display     │      │  capture     │      │  JS, CSS,    │
│              │ ──→  │  Input       │ ──→  │  Canvas,     │
│  Mouse/KB    │      │  bridge      │      │  WebGL       │
└──────────────┘      └──────────────┘      └──────────────┘
```

- **Real Chrome engine** — JavaScript, CSS, Canvas, WebGL all work
- **Raw CDP** — no Playwright, no puppeteer, ~1200 lines of code
- **Stealth patches** — Google login works (bot detection bypassed)
- **High-res frames** — DPR-aware capture, not blurry screencast
- **Mouse + keyboard** — click, scroll, drag, type, just like a real browser

## Why casty?

Traditional terminal browsers (w3m, lynx, Browsh) parse and re-render HTML as text. casty takes a different approach: Chrome renders everything, casty just streams the pixels to your terminal.

This means:
- **Every website works** — no rendering quirks or missing features
- **SSH-friendly** — browse the web over SSH on a headless server
- **No X11/Wayland needed** — just a Kitty-compatible terminal
- **Stays in your workflow** — no context switch to a GUI browser

## Installation

```bash
npm install -g @sanohiro/casty
casty
```

Or from source:

```bash
git clone https://github.com/sanohiro/casty.git
cd casty && npm install
./bin/casty
```

Chrome Headless Shell is auto-installed to `~/.casty/browsers/` on first run.

### Requirements

- **Kitty graphics protocol** terminal (tested: **Ghostty**, **kitty**, **bcon**)
- Node.js >= 18
- `unzip` (for Chrome auto-install)

## Usage

```bash
casty https://google.com
casty https://youtube.com
casty   # opens home page
```

### Keybindings

| Key | Action |
|-----|--------|
| Alt+L | Address bar |
| Alt+F | Hint mode (Vimium-style) |
| Alt+Left / Right | Back / Forward |
| Alt+C | Copy selected text |
| Ctrl+V | Paste |
| Ctrl+Q | Quit |

Customize via `~/.casty/keys.json`.

### Hint Mode

**Alt+F** shows labels on clickable elements. Type the label to click. Labels use home-row keys (`a s d f j k l`).

### Address Bar

**Alt+L** to open. Type a URL or search query. `/b query` searches bookmarks.

### Bookmarks

Create `~/.casty/bookmarks.json`:

```json
{
  "GitHub": "https://github.com",
  "YouTube": "https://youtube.com"
}
```

### Configuration

`~/.casty/config.json`:

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `homeUrl` | Start page | `https://github.com/sanohiro/casty` |
| `searchUrl` | Search engine URL | `https://www.google.com/search?q=` |
| `transport` | Image transfer: `auto`, `file`, `inline` | `auto` (bcon/kitty→file, others→inline) |
| `format` | Capture format: `auto`, `png`, `jpeg` | `auto` (file→jpeg adaptive, inline→png) |
| `mouseMode` | `1002` (button-event) or `1003` (any-event) | Auto (Ghostty→1003, others→1002) |

<details>
<summary><strong>Technical Details</strong></summary>

1. Launches Chrome Headless Shell via raw CDP WebSocket (no `Runtime.enable` — breaks Google login)
2. Injects stealth patches via `Page.addScriptToEvaluateOnNewDocument` before page load
3. Hybrid frame capture: low-res Screencast for change detection, `Page.captureScreenshot` for hi-res output
4. Adaptive format: JPEG during rapid updates, PNG refinement after idle (file transfer mode)
5. Terminal pixel size detection (CSI 14t) for automatic zoom calculation
6. Profile cleanup on startup (keeps cookies/storage, removes caches)

```
bin/casty          Shell wrapper (Chrome install/update)
bin/casty.js       Entry point (terminal, zoom, resize)
lib/browser.js     CDP browser control, frame capture
lib/cdp.js         Lightweight CDP WebSocket client
lib/chrome.js      Chrome detection, launch, profile cleanup
lib/kitty.js       Kitty graphics protocol (file/inline)
lib/input.js       Mouse/keyboard handling
lib/hints.js       Vimium-style hint mode
lib/urlbar.js      Address/search bar
lib/config.js      User configuration
lib/keys.js        Keybinding config
lib/bookmarks.js   Bookmark search
```

</details>

## Comparison

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| Engine | Real Chrome | Real Firefox | Custom parser |
| Rendering | Pixel-perfect | Text approximation | Text only |
| JavaScript | Full support | Full support | None |
| Protocol | Kitty graphics | Character cells | Character cells |
| Dependencies | Node.js + Chrome | Go + Firefox | Standalone |
| Google login | Works (stealth) | May be blocked | N/A |

## License

MIT
