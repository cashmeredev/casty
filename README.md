# casty

A TTY web browser powered by Kitty graphics protocol.

**[日本語](README.ja.md)**

casty renders full web pages in your terminal using Chrome's headless rendering, bridging the gap between a headless browser and your Kitty-compatible terminal.

<video src="https://github.com/user-attachments/assets/330bf0c3-dd08-44a5-b627-b90c200d57fe" autoplay loop muted playsinline></video>

```
Chrome (Headless Shell)     casty              Terminal
┌─────────────────┐      ┌─────────────────┐  ┌─────────────────┐
│  Web rendering  │ ───→ │  High-res       │ ─→│  Kitty graphics │
│  JS execution   │      │  capture        │  │  display        │
│  Full browser   │ ←─── │  Input bridge   │ ←─│  Mouse/Keyboard │
└─────────────────┘      └─────────────────┘  └─────────────────┘
```

## Features

- Full web rendering via headless Chrome (raw CDP, no Playwright)
- Stealth patches to avoid bot detection (Google login works)
- Kitty graphics protocol for image display
- Mouse support (click, scroll, drag)
- Keyboard passthrough to Chrome
- Vimium-style hint mode (Alt+F) for keyboard navigation
- Address bar with search (Alt+L)
- Bookmarks (`/b` search in address bar)
- Copy selected text / paste from clipboard
- Auto-zoom based on terminal font size
- Dynamic resize (SIGWINCH)
- Configurable keybindings (`~/.casty/keys.json`)
- Configurable settings (`~/.casty/config.json`)
- File downloads to `~/Downloads/`
- Loading indicator
- Fast startup with automatic profile cleanup

## Requirements

- **Kitty graphics protocol** compatible terminal
- Node.js >= 18

Tested on: **bcon**, **Ghostty**, **kitty**

## Installation

```bash
npm install -g @sanohiro/casty
casty
```

Or install from source:

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
./bin/casty
```

Chrome Headless Shell is automatically installed to `~/.casty/browsers/` on first run and kept up to date on subsequent launches. Only one version is kept at a time.

## Usage

```bash
casty https://google.com
casty https://youtube.com
casty   # opens home page (default: casty GitHub page)
```

### Keybindings

| Key | Action |
|-----|--------|
| Alt+L | Open address bar |
| Alt+F | Hint mode (Vimium-style link/button selection) |
| Alt+Left | Back |
| Alt+Right | Forward |
| Alt+C | Copy selected text |
| Ctrl+V | Paste from clipboard |
| Ctrl+Q | Quit |
| Ctrl+C | Quit (fallback) |

Customize via `~/.casty/keys.json` (file is not created automatically):

```json
{
  "ctrl+q": "quit",
  "alt+left": "back",
  "alt+right": "forward",
  "alt+l": "url_bar",
  "alt+f": "hints",
  "alt+c": "copy",
  "ctrl+v": "paste"
}
```

### Address Bar

- **Alt+L** or click row 1 to focus — URL is selected, type to replace
- **Enter** to navigate (URLs) or search (Google)
- **`/b query`** to search bookmarks
- **Escape** to cancel
- **Ctrl+A** select all, **Ctrl+U** clear, **Ctrl+W** delete word

### Hint Mode

Press **Alt+F** to show labels on clickable and focusable elements. Type the label characters to click a link/button or focus an input field. Press **Escape** to cancel.

Labels use home-row keys (`a`, `s`, `d`, `f`, `j`, `k`, `l`) — single character for ≤7 elements, two characters for more (up to 49).

### Bookmarks

Create `~/.casty/bookmarks.json` manually:

```json
{
  "GitHub": "https://github.com",
  "Google": "https://google.com",
  "YouTube": "https://youtube.com"
}
```

Search from the address bar with `/b query` (matches name or URL, case-insensitive).

### Configuration

Customize via `~/.casty/config.json` (file is not created automatically):

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
| `homeUrl` | Page opened when no URL is given | `https://github.com/sanohiro/casty` |
| `searchUrl` | Search engine URL (query appended) | `https://www.google.com/search?q=` |
| `transport` | Kitty image transfer: `auto`, `file`, or `inline` | `auto` (bcon/kitty→file, others→inline) |
| `format` | Screenshot format: `auto`, `png`, or `jpeg` | `auto` (file→jpeg, inline→png) |
| `mouseMode` | Mouse tracking mode: `1002` (button-event) or `1003` (any-event) | Auto (Ghostty→1003, others→1002) |

## Architecture

```
bin/
  casty          # Shell wrapper (Chrome install/update)
  casty.js       # Entry point (terminal detection, zoom, resize)
lib/
  browser.js     # CDP browser control (launch, screencast, capture)
  cdp.js         # Lightweight CDP WebSocket client
  chrome.js      # Chrome binary detection, launch, profile cleanup
  kitty.js       # Kitty graphics protocol output (file/inline)
  input.js       # Mouse/keyboard handling, actions
  hints.js       # Vimium-style hint mode
  urlbar.js      # Address/search bar
  bookmarks.js   # Bookmark search
  keys.js        # Configurable keybindings
  config.js      # User configuration
```

## How It Works

1. Launches Chrome Headless Shell via raw CDP (no Playwright, no `Runtime.enable`)
2. Injects stealth patches before page load to avoid bot detection
3. Uses hybrid frame capture: low-res Screencast as change detection trigger, `Page.captureScreenshot` for high-res frames
4. Renders frames to terminal via Kitty graphics protocol
5. Captures terminal input (raw mode) and dispatches to Chrome via CDP
6. Auto-detects terminal pixel size (CSI 14t) for zoom calculation
7. Cleans up profile on startup (keeps cookies/storage, removes caches) for fast launch

## License

MIT
