# casty

> **Alpha:** casty currently uses Playwright to control Chrome, but Playwright's automation flags trigger bot detection on many sites and block Google account login. A major rewrite is planned to replace Playwright with raw CDP (Chrome DevTools Protocol) to eliminate these limitations.

A TTY web browser powered by Kitty graphics protocol.

**[日本語](README.ja.md)**

casty renders full web pages in your terminal using Chrome's headless Screencast, bridging the gap between a headless browser and your Kitty-compatible terminal.

```
Chrome (Headless)          casty              Terminal
┌─────────────────┐      ┌─────────────────┐  ┌─────────────────┐
│  Web rendering  │ ───→ │  Screencast     │ ─→│  Kitty graphics │
│  JS execution   │      │  PNG frames     │  │  display        │
│  Full browser   │ ←─── │  Input bridge   │ ←─│  Mouse/Keyboard │
└─────────────────┘      └─────────────────┘  └─────────────────┘
```

## Features

- Full web rendering via headless Chrome
- Kitty graphics protocol for image display
- Mouse support (click, scroll, drag)
- Keyboard passthrough to Chrome
- Auto-zoom based on terminal font size
- Address bar with search (Alt+L)
- Dynamic resize (SIGWINCH)
- Configurable keybindings (`~/.casty/keys.json`)
- Configurable home page and search engine (`~/.casty/config.json`)
- File downloads to `~/Downloads/`
- Loading indicator

## Requirements

- **Kitty graphics protocol** — kitty, Ghostty, or other compatible terminals
- Node.js >= 18

## Installation

> **Note:** `npm install -g casty` is not yet available. Currently, install from source only. npm publishing is planned for a future release.

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
./bin/casty
```

Chromium (headless shell) is automatically installed to `~/.casty/browsers/` on first run and kept up to date on subsequent launches. Only one version is kept at a time.

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
| Alt+Left | Back |
| Alt+Right | Forward |
| Ctrl+Q | Quit |
| Ctrl+C | Quit (fallback) |

Customize via `~/.casty/keys.json` (file is not created automatically):

```json
{
  "ctrl+q": "quit",
  "alt+left": "back",
  "alt+right": "forward",
  "alt+l": "url_bar"
}
```

### Address Bar

- **Alt+L** or click row 1 to focus — URL is selected, type to replace
- **Enter** to navigate (URLs) or search (Brave Search)
- **Escape** to cancel
- **Ctrl+A** select all, **Ctrl+U** clear, **Ctrl+W** delete word

### Configuration

Customize via `~/.casty/config.json` (file is not created automatically):

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://search.brave.com/search?q="
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `homeUrl` | Page opened when no URL is given | `https://github.com/sanohiro/casty` |
| `searchUrl` | Search engine URL (query appended) | `https://search.brave.com/search?q=` |

## Architecture

```
bin/
  casty          # Shell wrapper
  casty.js       # Entry point (terminal detection, zoom, resize)
lib/
  browser.js     # Playwright/CDP control (launch, screencast)
  kitty.js       # Kitty graphics protocol output
  input.js       # Mouse/keyboard handling, actions
  keys.js        # Configurable keybindings
  config.js      # User configuration
  urlbar.js      # Address/search bar
```

## How It Works

1. Launches headless Chrome via Playwright
2. Starts CDP Screencast (PNG frames, not screenshots)
3. Renders frames to terminal via Kitty graphics protocol (file transfer locally, inline over SSH)
4. Captures terminal input (raw mode) and dispatches to Chrome via CDP
5. Auto-detects terminal pixel size (CSI 14t) for zoom calculation

## License

MIT
