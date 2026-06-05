# casty

Run a real Chrome browser inside your terminal.

**[Japanese](README.ja.md)**

> **Fork note.** This is [cashmeredev/casty](https://github.com/cashmeredev/casty), a fork of [sanohiro/casty](https://github.com/sanohiro/casty) that adds an **[embed mode](#embed-mode-host-embedding)** so a host program can place casty's output in its own UI and drive it over an IPC socket. It is used by [kitty-graphics.el](https://github.com/cashmeredev/kitty-graphics.el) for an inline browser inside terminal Emacs. All credit for casty itself goes to the upstream author.

casty is not a text-mode browser like w3m or lynx. It launches headless Chrome, grabs the rendered frames over CDP, and draws them in your terminal via Kitty graphics protocol. Think of it as a remote desktop for Chrome that fits in a terminal window.

![casty running on Ghostty](docs/screenshot-ghostty.png)

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

Chrome does all the rendering. casty is just a bridge (~2300 lines) that streams frames to your terminal and sends input back. No Playwright, no puppeteer — raw CDP over WebSocket.

Since it's real Chrome, JavaScript, CSS, Canvas, and WebGL all work. Google login works too (stealth patches bypass bot detection). Mouse clicks, scrolling, dragging, typing — everything you'd expect.

## Why use this?

If you're working over SSH on a headless server and need to check a web page, your options are usually `curl`, `lynx`, or forwarding X11. casty gives you an actual browser without leaving the terminal. No X11, no VNC, no Wayland — just a Kitty-compatible terminal.

### Google Meet with camera & mic (experimental)

![Google Meet on casty](docs/screenshot-meet.png)

Camera and microphone can be streamed to WebRTC sites like Google Meet, Zoom, etc. via ffmpeg. Requires `ffmpeg` installed. Background effects are not available since the video is captured directly from the device. See [Configuration](#configuration) to enable.

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

- A terminal with **Kitty graphics protocol** support (tested on Ghostty, kitty, bcon)
- Node.js >= 18
- `unzip` (for Chrome auto-install)

### tmux

If you run casty inside tmux, enable passthrough so Kitty graphics escape
sequences can reach your terminal:

```tmux
set -g allow-passthrough on
```

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

Customizable via `~/.casty/keys.json`.

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
| `media` | Enable camera/mic for WebRTC (experimental, requires `ffmpeg`) | `false` |

## Comparison

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| Engine | Chrome | Firefox | Custom parser |
| Rendering | Pixel-perfect | Text approximation | Text only |
| JavaScript | Yes | Yes | No |
| Display | Kitty graphics | Character cells | Character cells |
| Dependencies | Node.js + Chrome | Go + Firefox | Standalone |

<details>
<summary>Technical Details</summary>

The whole thing is about 1200 lines of JavaScript. Here's what's going on under the hood:

- Launches chrome-headless-shell and talks to it via raw CDP WebSocket
- `Runtime.enable` is never sent (it breaks Google login — discovered the hard way)
- Stealth patches are injected via `Page.addScriptToEvaluateOnNewDocument` before any page loads
- Frame capture is hybrid: low-res Screencast triggers change detection, then `Page.captureScreenshot` grabs hi-res frames with proper DPR
- File transfer mode uses adaptive JPEG→PNG: fast JPEG during scrolling/video, crisp PNG after things settle
- Terminal pixel size is detected via CSI 14t for auto-zoom

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

## Embed mode (host embedding)

Embed mode lets another program (a "host") place casty's output inside its own UI and drive it over an IPC socket. casty owns no terminal state in this mode — no URL bar, cursor, mouse modes, or screen clears — the host positions every frame.

Launch it with `--embed`:

```bash
casty --embed --ipc /tmp/casty.sock --image-id 1 \
  --cols 80 --rows 24 --top 1 --left 1 --width 960 --height 480 \
  https://example.com
```

| Flag | Meaning |
| --- | --- |
| `--embed` | Embed mode: no terminal ownership, IPC-driven |
| `--ipc <path>` | Unix socket for newline-delimited JSON commands |
| `--image-id <n>` | Kitty image id to draw into |
| `--cols`, `--rows` | Content area size in cells |
| `--top`, `--left` | 1-based terminal anchor of the top-left cell |
| `--width`, `--height` | Content area in pixels (overrides cols/rows × cell size) |

Environment:

- `CASTY_CHROME` — path to a Chromium-based browser to drive instead of the bundled Chrome Headless Shell.
- `CASTY_CELL_WIDTH`, `CASTY_CELL_HEIGHT` — the host's font cell metrics in pixels.

Frames are sent as **PNG** over the Kitty graphics protocol using a single image id, staged via file transfer through `/dev/shm` to keep the pty cheap.

### IPC protocol

The host writes newline-delimited JSON objects to the `--ipc` socket. Most commands are fire-and-forget; two return a JSON reply on the same socket. Coordinates are 1-based cell positions.

| Command | Fields | Reply |
| --- | --- | --- |
| `navigate` | `url` | — |
| `back` / `forward` / `reload` | — | — |
| `scroll` | `dx`, `dy`, opt. `col`, `row` | — |
| `key` | `name`, opt. `modifiers[]` | — |
| `text` | `string` | — |
| `click` | `col`, `row`, opt. `button` | — |
| `mouse` | `type`, `col`, `row`, opt. `button` | — |
| `hints` | — | — |
| `hint-key` | `key` | `{"hintActive":<bool>}` |
| `set-geometry` | opt. `top`, `left`, `cols`, `rows` | — |
| `get-url` | — | `{"url":"<current>"}` |
| `quit` | — | — |

Example session:

```
{"cmd":"navigate","url":"https://example.com"}
{"cmd":"scroll","dy":300}
{"cmd":"click","col":10,"row":5}
{"cmd":"get-url"}        ->  {"url":"https://example.com/"}
{"cmd":"quit"}
```

[kitty-graphics.el](https://github.com/cashmeredev/kitty-graphics.el) is the reference embedder (see its `kitty-gfx-browse`).

## Troubleshooting

### No audio on YouTube (Ubuntu Server)

Chrome plays audio directly through the system audio server. If there's no sound:

```bash
sudo apt install pulseaudio
sudo usermod -aG audio $USER
# Log out and back in, then:
pulseaudio --start
```

### Chrome crashes

If casty fails to start or Chrome crashes, try removing the browser cache:

```bash
rm -rf ~/.casty/browsers
casty  # re-downloads Chrome automatically
```

To reset all settings and profile data:

```bash
rm -rf ~/.casty
```

## License

MIT. casty is by Hironobu Sano ([sanohiro/casty](https://github.com/sanohiro/casty)); this fork ([cashmeredev/casty](https://github.com/cashmeredev/casty)) adds embed mode under the same license.
