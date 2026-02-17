# casty

A TTY web browser powered by Playwright and Kitty graphics protocol.

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
- File downloads to `~/Downloads/`
- Loading indicator

## Requirements

- **Kitty graphics protocol** — kitty, Ghostty, or other compatible terminals
- Node.js >= 18

## Installation

```bash
npm install -g casty
```

Chromium is automatically installed to `~/.casty/browsers/` on first run and kept up to date on subsequent launches. Only one version is kept at a time.

### From source

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
./bin/casty
```

## Usage

```bash
casty https://google.com
casty https://youtube.com
casty   # opens Google
```

### Keybindings

| Key | Action |
|-----|--------|
| Alt+L | Open address bar |
| Alt+Left | Back |
| Alt+Right | Forward |
| Ctrl+Q | Quit |
| Ctrl+C | Quit (fallback) |

Keybindings are customizable via `~/.casty/keys.json`.

### Address Bar

- **Alt+L** to focus — URL is selected, type to replace
- **Enter** to navigate (URLs) or search (Google)
- **Escape** to cancel
- **Ctrl+A** select all, **Ctrl+U** clear, **Ctrl+W** delete word

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
  urlbar.js      # Address/search bar
```

## How It Works

1. Launches headless Chrome via Playwright
2. Starts CDP Screencast (PNG frames, not screenshots)
3. Renders frames to terminal via Kitty graphics protocol (file transfer mode)
4. Captures terminal input (raw mode) and dispatches to Chrome via CDP
5. Auto-detects terminal pixel size (CSI 14t) for zoom calculation

## License

MIT
