#!/usr/bin/env node
// casty - TTY web browser using raw CDP and Kitty graphics protocol

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
import { sendFrame, resetFrameCache, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp, transport } from '../lib/kitty.js';
import { enableMouse, disableMouse, startInputHandling } from '../lib/input.js';
import { loadKeyBindings } from '../lib/keys.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
const bindings = loadKeyBindings();
const url = process.argv[2] || config.homeUrl;

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
    const cellWidth = pixelSize.width / cols;
    const cellHeight = pixelSize.height / rows;
    const zoom = calcZoom(cellWidth);
    return { cols, rows, width: pixelSize.width, height: pixelSize.height, cellWidth, cellHeight, zoom };
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

async function main() {
  // Phase 1: Launch Chrome and get terminal info in parallel
  // getTermInfo() must complete fully (prevent CSI 14t response leak)
  const browserP = startBrowser();
  const term = await getTermInfo();
  const browser = await browserP;

  // Reserve line 1 for URL bar, use the rest for browser display
  const barHeight = Math.round(term.cellHeight);
  const viewHeight = term.height - barHeight;

  // Phase 2: CDP connection + page setup
  const { client, cssWidth, cssHeight } = await setupPage(browser, { ...term, height: viewHeight });
  const chromeProcess = browser.proc;

  // Log WebSocket errors to stderr (prevent unhandled crash)
  client.on('error', (err) => { console.error('casty: CDP error:', err.message); });

  // Navigate immediately (before screencast) to avoid showing previous session's page
  client.send('Page.navigate', { url }).catch(e => console.error('casty: navigate error:', e.message));

  let renderPaused = false;
  const pauseRender = (p = true) => { renderPaused = p; };

  hideCursor();
  clearScreen();
  enableMouse();

  // Mouse coordinates in device pixels
  // Chrome headless-shell ignores deviceScaleFactor for Input.dispatchMouseEvent
  const cssCellW = term.cellWidth;
  const cssCellH = term.cellHeight;
  // format: auto → PNG for inline, JPEG (adaptive) for file transfer
  // jpeg mode: fast JPEG during activity, PNG refinement when static
  const fmt = config.format || 'auto';
  const screenshotFormat = fmt === 'auto'
    ? (transport === 'file' ? 'jpeg' : 'png')
    : fmt;

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

  urlBar = startInputHandling(client, cssCellW, cssCellH, bindings, pauseRender, forceCapture);
  urlBar.render();

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
    disableMouse();
    showCursor();
    try { process.stdin.setRawMode(false); } catch {}
    clearScreen();                 // Clear after everything is stopped — no re-render risk
    cleanupTmp();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // SIGWINCH: Follow resize + font size changes
  // Debounced (150ms) + guarded with pending flag to catch late resizes
  let resizeTimer = null;
  let resizing = false;
  let pendingResize = false;
  process.on('SIGWINCH', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  });
  async function handleResize() {
    if (resizing) { pendingResize = true; return; }
    resizing = true;
    try {
      const t = await getTermInfo({ keepAlive: true });
      const vh = t.height - Math.round(t.cellHeight);
      const cw = Math.round(t.width / t.zoom);
      const ch = Math.round(vh / t.zoom);
      console.error(`casty: resize ${cw}x${ch} (dev:${t.width}x${vh}) zoom:${t.zoom.toFixed(2)}`);

      urlBar.updateCellSize(t.cellWidth, t.cellHeight);
      clearScreen();
      resetFrameCache();

      await stopScreencast(client, screencastCleanup);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: cw, height: ch, deviceScaleFactor: t.zoom, mobile: false,
      });

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
