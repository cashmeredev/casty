#!/usr/bin/env node
// casty - TTY web browser using raw CDP and Kitty graphics protocol

// Handle stdout/stderr write errors (SSH disconnect, terminal close, etc.)
process.stdout.on('error', (err) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') process.exit(0);
});
process.stderr.on('error', () => {});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --version / -v
if (process.argv[2] === '--version' || process.argv[2] === '-v') {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  console.log(`casty ${pkg.version}`);
  process.exit(0);
}

// --help / -h
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log(`casty - A real Chrome browser in your terminal

Usage: casty [url] [options]

Options:
  --help, -h       Show this help
  --version, -v    Show version

Key bindings:
  Alt+L            Address bar
  Alt+F            Hint mode (Vimium-style link navigation)
  Alt+C            Copy selected text
  Ctrl+V           Paste from clipboard
  Alt+Left/Right   Back / Forward
  Ctrl+Q           Quit

Address bar:
  Type a URL or search query, then Enter
  /b [query]       Search bookmarks

Config: ~/.casty/config.json
Keys:   ~/.casty/keys.json

https://github.com/sanohiro/casty`);
  process.exit(0);
}

// Ensure Chrome is installed (skip if launched from bin/casty shell script)
if (!process.env.CASTY_ENSURE_CHROME) {
  const __bin = dirname(fileURLToPath(import.meta.url));
  try {
    execFileSync('bash', [join(__bin, 'casty')], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, CASTY_ENSURE_CHROME: '1' },
    });
  } catch (err) {
    if (err.status) process.exit(err.status);
  }
}

import { startBrowser, setupPage, startScreencast, stopScreencast } from '../lib/browser.js';
import { sendFrame, resetFrameCache, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp, transport, setDisplaySize, setPlacement, disableDedup } from '../lib/kitty.js';
import { enableMouse, disableMouse, startInputHandling, createActions } from '../lib/input.js';
import { HintMode } from '../lib/hints.js';
import { startIpcServer, cleanupIpc } from '../lib/ipc.js';
import { loadKeyBindings } from '../lib/keys.js';
import { loadConfig } from '../lib/config.js';
import { startMedia } from '../lib/media.js';

const config = loadConfig();
const bindings = loadKeyBindings();

// Parse CLI args: a single positional URL plus optional embed-mode flags.
// Embed mode (--embed) lets a host (e.g. kitty-graphics.el) render casty inside
// a sub-rectangle of its own screen and drive it over a Unix socket (--ipc),
// instead of casty owning the whole terminal.
function parseArgs(argv) {
  const o = { embed: false, url: null, ipc: null, imageId: null,
              cols: null, rows: null, top: null, left: null, width: null, height: null };
  const valFlag = { '--ipc': 'ipc', '--image-id': 'imageId',
                    '--cols': 'cols', '--rows': 'rows', '--top': 'top', '--left': 'left',
                    '--width': 'width', '--height': 'height' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--embed') { o.embed = true; continue; }
    if (valFlag[a]) { o[valFlag[a]] = argv[++i]; continue; }
    if (a.startsWith('--')) continue;        // unknown flag → ignore
    if (o.url === null) o.url = a;            // first positional = URL
  }
  for (const k of ['imageId', 'cols', 'rows', 'top', 'left', 'width', 'height']) {
    if (o[k] != null) o[k] = parseInt(o[k], 10);
  }
  return o;
}

const cli = parseArgs(process.argv);
const embed = cli.embed ? cli : null;
const url = cli.url || config.homeUrl;

const TERM_QUERY_TIMEOUT = 1000;  // CSI 14t response timeout (ms)

// Delayed capture timings after page navigation (ms)
const DELAYED_CAPTURE_MS = [0, 300, 1000];

// Reference cell size (96 DPI, standard terminal font)
// Larger cells → zoom in, smaller cells → zoom out
const REF_CELL_WIDTH = 8;

// Auto-calculate zoom from cell size
function calcZoom(cellWidth) {
  return cellWidth / REF_CELL_WIDTH;
}

// Query terminal pixel size via CSI 14t
// keepAlive: true when called during operation (SIGWINCH) — don't touch stdin state
function queryTermPixelSize({ keepAlive = false } = {}) {
  if (!process.stdin.isTTY) return Promise.resolve(null);

  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const wasRaw = process.stdin.isRaw;
  const timeout = setTimeout(() => {
    process.stdin.removeListener('data', onData);
    if (!keepAlive) {
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    }
    resolve(null);
  }, TERM_QUERY_TIMEOUT);

  if (!keepAlive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  let buf = '';
  const onData = (data) => {
    buf += data.toString();
    const match = buf.match(/\x1b\[4;(\d+);(\d+)t/);
    if (match) {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      if (!keepAlive) process.stdin.setRawMode(wasRaw);
      resolve({ height: parseInt(match[1]), width: parseInt(match[2]) });
    }
  };
  process.stdin.on('data', onData);

  process.stdout.write('\x1b[14t');
  return promise;
}

// Get terminal info
// keepAlive: true during operation (SIGWINCH) to avoid killing stdin
async function getTermInfo({ keepAlive = false } = {}) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const pixelSize = await queryTermPixelSize({ keepAlive });
  if (pixelSize) {
    // Align to cell boundaries: floor cell size, then multiply back
    // This ensures image pixels == display pixels (no GPU interpolation blur)
    const cellWidth = Math.floor(pixelSize.width / cols);
    const cellHeight = Math.floor(pixelSize.height / rows);
    const width = cellWidth * cols;
    const height = cellHeight * rows;
    const zoom = calcZoom(cellWidth);
    return { cols, rows, width, height, cellWidth, cellHeight, zoom };
  }

  const cellWidth = parseInt(process.env.CASTY_CELL_WIDTH) || 10;
  const cellHeight = parseInt(process.env.CASTY_CELL_HEIGHT) || 20;
  const zoom = calcZoom(cellWidth);
  return {
    cols, rows,
    width: cols * cellWidth,
    height: rows * cellHeight,
    cellWidth, cellHeight, zoom,
  };
}

// Terminal info for embed mode: no CSI 14t handshake (the pty is shared with
// the host and the reply would be intercepted).  Geometry comes from flags;
// cell size from the host-provided env vars, falling back to width/cols.
function embedTermInfo(e) {
  const cols = e.cols || process.stdout.columns || 80;
  const rows = e.rows || process.stdout.rows || 24;
  const cellWidth = parseInt(process.env.CASTY_CELL_WIDTH)
    || (e.width ? Math.floor(e.width / cols) : 10);
  const cellHeight = parseInt(process.env.CASTY_CELL_HEIGHT)
    || (e.height ? Math.floor(e.height / rows) : 20);
  const width = e.width || cols * cellWidth;
  const height = e.height || rows * cellHeight;
  return { cols, rows, width, height, cellWidth, cellHeight, zoom: calcZoom(cellWidth) };
}

async function main() {
  // Phase 1: Launch Chrome, get terminal info, and start media in parallel
  // getTermInfo() must complete fully (prevent CSI 14t response leak)
  const browserP = startBrowser();
  const mediaP = config.media ? startMedia(config) : null;
  const term = embed ? embedTermInfo(embed) : await getTermInfo();
  const browser = await browserP;
  const media = mediaP ? await mediaP : null;

  // Embed: full height (host draws its own chrome), anchor frames at the
  // host-provided cell.  Interactive: reserve line 1 for the URL bar.
  const barHeight = embed ? 0 : term.cellHeight;
  const viewHeight = term.height - barHeight;
  if (embed) {
    setDisplaySize(term.cols, term.rows);
    setPlacement(embed.top || 1, embed.left || 1, embed.imageId || 1);
  } else {
    setDisplaySize(term.cols, term.rows - 1);
  }

  // Phase 2: CDP connection + page setup
  const { client, cssWidth, cssHeight } = await setupPage(browser, { ...term, height: viewHeight, mediaPort: media?.port || 0 });
  const chromeProcess = browser.proc;

  // Log WebSocket errors to stderr (prevent unhandled crash)
  client.on('error', (err) => { console.error('casty: CDP error:', err.message); });

  // Navigate immediately (before screencast) to avoid showing previous session's page
  client.send('Page.navigate', { url }).catch(e => console.error('casty: navigate error:', e.message));

  let renderPaused = false;
  const pauseRender = (p = true) => { renderPaused = p; };
  let embedIpcServer = null;

  // Embed mode never touches the terminal: the host owns the screen, cursor
  // and mouse modes.  Doing any of these would corrupt the host's display.
  if (!embed) {
    hideCursor();
    clearScreen();
    enableMouse();
  }

  // Mouse coordinates in device pixels
  // Chrome headless-shell ignores deviceScaleFactor for Input.dispatchMouseEvent
  const cssCellW = term.cellWidth;
  const cssCellH = term.cellHeight;
  // format: auto → PNG for inline, JPEG (adaptive) for file transfer
  // jpeg mode: fast JPEG during activity, PNG refinement when static
  const fmt = config.format || 'auto';
  // Embed mode MUST use PNG: the host (kitty-graphics.el) forwards frames into
  // a kitty terminal, and the kitty graphics protocol only decodes RGB/RGBA/PNG
  // -- never JPEG.  The normal file-transport default is JPEG (for bcon), which
  // kitty cannot decode, so fast frames would fail and the image would flicker.
  const screenshotFormat = embed
    ? 'png'
    : (fmt === 'auto' ? (transport === 'file' ? 'jpeg' : 'png') : fmt);

  console.error(`casty: ${term.width}x${term.height} cell=${term.cellWidth.toFixed(0)}x${term.cellHeight.toFixed(0)} zoom=${term.zoom.toFixed(2)} transport=${transport} format=${screenshotFormat}${screenshotFormat === 'jpeg' ? ' (adaptive)' : ''}`);

  // Frame callback for screencast / captureScreenshot
  // sendFrame includes cursor positioning (single write)
  let urlBar = null;
  function onFrame(data) {
    if (renderPaused) return;
    sendFrame(data);
    if (urlBar) urlBar.renderIfDirty();
  }

  // Phase 3: Start screencast
  let { forceCapture, cleanup: screencastCleanup } = await startScreencast(client, {
    width: cssWidth,
    height: cssHeight,
    format: screenshotFormat,
    onFrame,
  });

  if (embed) {
    // Stable wrapper: forceCapture is reassigned when the screencast restarts
    // on resize, so close over the binding rather than capturing its value.
    const fc = () => forceCapture();
    const hintMode = new HintMode(fc);
    // Click/scroll coordinates are CSS pixels relative to the emulated viewport
    // (cssWidth x cssHeight spanning cols x rows cells), NOT device pixels, so
    // pass CSS pixels per cell.  Otherwise clicks drift by the zoom factor.
    const actions = createActions(client, {
      forceCapture: fc,
      cellWidth: cssWidth / term.cols,
      cellHeight: cssHeight / term.rows,
      hintMode, topRow: 1,
    });

    // Reposition / resize the embedded frame.  top/left always update the
    // placement; cols/rows additionally re-emulate the viewport and restart
    // the screencast.  Always reset dedup so the next frame repaints at the
    // new location (an unchanged page would otherwise be skipped).
    async function setGeometry({ top, left, cols, rows }) {
      const dimsChanged = (cols && cols !== term.cols) || (rows && rows !== term.rows);
      setPlacement(top, left, null);
      if (dimsChanged) {
        term.cols = cols || term.cols;
        term.rows = rows || term.rows;
        term.width = term.cols * term.cellWidth;
        term.height = term.rows * term.cellHeight;
        setDisplaySize(term.cols, term.rows);
        const cw = Math.round(term.width / term.zoom);
        const ch = Math.round(term.height / term.zoom);
        await stopScreencast(client, screencastCleanup);
        await client.send('Emulation.setDeviceMetricsOverride', {
          width: cw, height: ch, deviceScaleFactor: term.zoom, mobile: false,
        });
        ({ forceCapture, cleanup: screencastCleanup } = await startScreencast(client, {
          width: cw, height: ch, format: screenshotFormat, onFrame,
        }));
        // Keep click/scroll mapping in sync with the new CSS viewport.
        actions.setCellSize(cw / term.cols, ch / term.rows);
      }
      resetFrameCache();
      disableDedup(500);
      fc();
    }

    const handlers = {
      navigate:       (m) => actions.navigate(m.url),
      back:           () => actions.back(),
      forward:        () => actions.forward(),
      reload:         () => actions.reload(),
      scroll:         (m) => actions.scroll(m.dx || 0, m.dy || 0, m.col, m.row),
      key:            (m) => actions.key(m.name, m.modifiers),
      text:           (m) => actions.text(m.string),
      click:          (m) => actions.click(m.col, m.row, m.button),
      mouse:          (m) => actions.mouse(m.type, m.col, m.row, m.button),
      hints:          () => actions.hints(),
      'hint-key':     async (m, reply) => reply({ hintActive: await actions.hintKey(m.key) }),
      'set-geometry': (m) => setGeometry(m),
      'get-url':      async (_m, reply) => reply({ url: await actions.getUrl() }),
      quit:           () => process.emit('SIGINT'),
    };
    embedIpcServer = startIpcServer(embed.ipc, handlers);
  } else {
    urlBar = startInputHandling(client, cssCellW, cssCellH, bindings, pauseRender, forceCapture);
    urlBar.render();
  }

  // Force capture on page load events (debounced — multiple events fire close together)
  let delayedTimers = [];
  function delayedCapture() {
    for (const t of delayedTimers) clearTimeout(t);
    delayedTimers = [];
    for (const ms of DELAYED_CAPTURE_MS) {
      if (ms === 0) forceCapture();
      else delayedTimers.push(setTimeout(() => forceCapture(), ms));
    }
  }
  client.on('Page.domContentEventFired', delayedCapture);
  client.on('Page.loadEventFired', delayedCapture);
  client.on('Page.frameNavigated', ({ frame }) => {
    if (!frame.parentId) delayedCapture(); // Main frame only
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('casty: shutting down...');
    renderPaused = true;           // Stop rendering first
    try {
      await stopScreencast(client, screencastCleanup);  // Stop screencast (disables pending captures)
      await client.send('Browser.close').catch(() => {});
    } catch {}
    client.close();
    chromeProcess.kill();
    media?.cleanup();
    if (embed) {
      // Host owns the terminal; only tear down our own resources.  The host
      // deletes the kitty image (by id) and restores its cursor itself.
      if (embedIpcServer) { try { embedIpcServer.close(); } catch {} }
      cleanupIpc(embed.ipc);
    } else {
      disableMouse();
      showCursor();
      try { process.stdin.setRawMode(false); } catch {}
      clearScreen();               // Clear after everything is stopped — no re-render risk
    }
    cleanupTmp();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // SIGWINCH: Follow resize + font size changes
  // Debounced (150ms) + guarded with pending flag to catch late resizes
  let resizeTimer = null;
  let resizing = false;
  let pendingResize = false;
  // Embed mode is driven by the host's `set-geometry` IPC command, not by the
  // terminal's own SIGWINCH (the pty size is the host's, not the viewport's).
  if (!embed) {
    process.on('SIGWINCH', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 150);
    });
  }
  // Direct screenshot — bypasses screencast's capturing flag
  const screenshotOpts = { format: screenshotFormat, optimizeForSpeed: true, captureBeyondViewport: false };
  if (screenshotFormat === 'jpeg') screenshotOpts.quality = 85;
  async function directCapture() {
    try {
      const { data } = await client.send('Page.captureScreenshot', screenshotOpts);
      if (data) onFrame(data);
    } catch {}
  }

  async function handleResize() {
    if (resizing) { pendingResize = true; return; }
    resizing = true;
    try {
      // Stop old screencast FIRST to prevent stale frames
      await stopScreencast(client, screencastCleanup);

      const t = await getTermInfo({ keepAlive: true });
      const vh = t.height - t.cellHeight;
      const cw = Math.round(t.width / t.zoom);
      const ch = Math.round(vh / t.zoom);
      setDisplaySize(t.cols, t.rows - 1);
      console.error(`casty: resize ${cw}x${ch} (dev:${t.width}x${vh}) zoom:${t.zoom.toFixed(2)}`);

      urlBar.updateCellSize(t.cellWidth, t.cellHeight);
      clearScreen();
      resetFrameCache();
      disableDedup(3000); // Force re-send for 3s (bcon may not display first frame)

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: cw, height: ch, deviceScaleFactor: t.zoom, mobile: false,
      });

      // Wait for Chrome to finish re-rendering by watching for a screencast frame
      await new Promise(resolve => {
        const onFirstFrame = ({ sessionId }) => {
          client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
          client.removeListener('Page.screencastFrame', onFirstFrame);
          resolve();
        };
        client.on('Page.screencastFrame', onFirstFrame);
        client.send('Page.startScreencast', {
          format: 'jpeg', quality: 10,
          maxWidth: Math.round(cw / 4), maxHeight: Math.round(ch / 4),
          everyNthFrame: 1,
        }).catch(() => resolve());
        setTimeout(() => {
          client.removeListener('Page.screencastFrame', onFirstFrame);
          resolve();
        }, 2000);
      });
      await client.send('Page.stopScreencast').catch(() => {});

      // Capture hi-res frame (Chrome has finished rendering)
      await directCapture();
      urlBar.render();

      // Restart screencast for ongoing change detection
      ({ forceCapture, cleanup: screencastCleanup } = await startScreencast(client, {
        width: cw,
        height: ch,
        format: screenshotFormat,
        onFrame,
      }));
    } catch (err) {
      console.error('casty: resize error:', err.message);
    }
    resizing = false;
    if (pendingResize) {
      pendingResize = false;
      handleResize();
    }
  }
}

try {
  await main();
} catch (err) {
  // Restore stdin from raw mode (prevent CSI 14t response leak)
  try { process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
  console.error('casty: error:', err.message);
  disableMouse();
  showCursor();
  cleanupTmp();
  process.exit(1);
}
