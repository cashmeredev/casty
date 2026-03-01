// Raw CDP browser control
// Runtime.enable must never be sent

import { join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync } from 'node:fs';
function dbg(msg) { appendFileSync('/tmp/casty-debug.log', `${Date.now()} [browser] ${msg}\n`); }
import { CDPClient } from './cdp.js';
import { launchChrome } from './chrome.js';
import { loadConfig } from './config.js';

const CHROME_VERSION = '145.0.7632.6';
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const PROFILE_DIR = join(homedir(), '.casty', 'profile');

// WEBGL_debug_renderer_info extension constants
const GL_UNMASKED_VENDOR   = 0x9245; // UNMASKED_VENDOR_WEBGL
const GL_UNMASKED_RENDERER = 0x9246; // UNMASKED_RENDERER_WEBGL

// Screencast settings (low-res stream for change detection)
const SCREENCAST_SCALE     = 4;    // Downscale factor (1/4 resolution)
const SCREENCAST_NTH_FRAME = 1;    // Every frame (no decimation, faster change detection)

// Capture control
const CAPTURE_MIN_INTERVAL = 50;   // ms (~20fps)
const CAPTURE_STUCK_RESET  = 5000; // Reset stuck capturing flag (ms)

// Build stealth script with locale-dependent language settings
// lang: primary language (e.g. "ja", "en-US")
function buildStealthScript(lang) {
  // Build Accept-Language style list: primary, then en-US/en fallbacks
  const langBase = lang.split('-')[0]; // "ja", "en", "zh", etc.
  const languages = [lang];
  if (lang !== 'en-US' && lang !== 'en') {
    languages.push('en-US', 'en');
  } else if (lang === 'en-US') {
    languages.push('en');
  }
  const langArray = JSON.stringify(languages);

  return `
// navigator.plugins (headless exposes empty array)
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    arr.refresh = () => {};
    return arr;
  },
});

// navigator.mimeTypes
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const arr = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    arr.refresh = () => {};
    return arr;
  },
});

// navigator.languages (derived from system locale or config)
Object.defineProperty(navigator, 'languages', {
  get: () => ${langArray},
});

// navigator.language
Object.defineProperty(navigator, 'language', {
  get: () => '${lang}',
});

// window.chrome (undefined in headless)
if (!window.chrome) {
  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect: function(){}, id: undefined, sendMessage: function(){} },
    csi: function() { return {}; },
    loadTimes: function() { return {}; },
  };
}

// Permissions API (headless behaves differently)
const origQuery = navigator.permissions.query.bind(navigator.permissions);
navigator.permissions.query = (params) => {
  if (params.name === 'notifications') {
    return Promise.resolve({ state: Notification.permission });
  }
  return origQuery(params);
};

// WebGL vendor/renderer (hide SwiftShader)
// 0x9245 = UNMASKED_VENDOR_WEBGL, 0x9246 = UNMASKED_RENDERER_WEBGL
const getParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p) {
  if (p === 0x9245) return 'Google Inc. (Apple)';
  if (p === 0x9246) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)';
  return getParam.call(this, p);
};

// navigator.connection (can be undefined in headless)
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
  });
}
`;
}

// Build Accept-Language header from primary language
function buildAcceptLanguage(lang) {
  if (lang === 'en-US') return 'en-US,en;q=0.9';
  if (lang === 'en') return 'en';
  return `${lang},en-US;q=0.9,en;q=0.8`;
}


// HTTP GET → JSON (using global fetch)
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  try { return await res.json(); }
  catch { return null; }
}

// Phase 1: Launch Chrome only (no terminal info needed, for parallel execution)
export async function startBrowser() {
  return launchChrome({ userDataDir: PROFILE_DIR });
}

// Phase 2: CDP connection + page setup (navigation is done by the caller)
// Tries /json/new first, then /json/list, then Target.createTarget via browser CDP
export async function setupPage({ port, wsUrl }, { width, height, zoom = 1 } = {}) {
  const config = loadConfig();
  const lang = config.language;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Try /json/new (single HTTP request, fastest)
  let target = await fetchJson(`${baseUrl}/json/new?about:blank`);
  if (!target?.webSocketDebuggerUrl) {
    // Check /json/list for existing pages
    const targets = await fetchJson(`${baseUrl}/json/list`);
    target = targets?.find(t => t.type === 'page');
  }
  if (!target?.webSocketDebuggerUrl) {
    // Fallback: create page via browser CDP (headless-shell needs this)
    const browserClient = new CDPClient();
    await browserClient.connect(wsUrl);
    const { targetId } = await browserClient.send('Target.createTarget', { url: 'about:blank' });
    browserClient.close();
    // Construct WS URL directly from targetId (avoids extra /json/list HTTP request)
    target = { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${targetId}` };
  }

  const client = new CDPClient();
  await client.connect(target.webSocketDebuggerUrl);

  const cssWidth = Math.round(width / zoom);
  const cssHeight = Math.round(height / zoom);

  // Run CDP commands in parallel (all must complete before navigation)
  await Promise.all([
    client.send('Page.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {
      width: cssWidth, height: cssHeight, deviceScaleFactor: zoom, mobile: false,
    }),
    client.send('Network.setUserAgentOverride', {
      userAgent: USER_AGENT, platform: 'MacIntel',
      acceptLanguage: buildAcceptLanguage(lang),
    }),
    client.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStealthScript(lang) }),
    client.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName', downloadPath: join(homedir(), 'Downloads'),
      eventsEnabled: true,
    }),
  ]);

  return { client, cssWidth, cssHeight };
}

// Adaptive frame capture with quality refinement:
//
// Screencast at 1/4 resolution as change-detection trigger,
// then Page.captureScreenshot for full DPR-aware hi-res frame.
// CAPTURE_MIN_INTERVAL throttles to keep CPU usage low.
//
// Adaptive format (JPEG → PNG refinement):
//   During rapid updates: JPEG for speed (3-5x smaller than PNG)
//   After activity stops: PNG refinement for crisp text (lossless)
//   Only active when format='jpeg'; PNG mode is already lossless.
//
// format: 'jpeg' (file transfer, adaptive) or 'png' (inline, always lossless)
export async function startScreencast(client, { width, height, onFrame, format = 'png', quality = 85 }) {
  let capturing = false;
  let lastCaptureTime = 0;
  let throttleTimer = null;
  let refineTimer = null;

  // Fast capture opts (configured format)
  const fastOpts = { format, optimizeForSpeed: true, captureBeyondViewport: false };
  if (format === 'jpeg') fastOpts.quality = quality;

  // PNG refinement opts (lossless, for crisp text after activity stops)
  const REFINE_DELAY = 500; // ms after last frame update
  const refineOpts = format === 'jpeg'
    ? { format: 'png', captureBeyondViewport: false }
    : null;

  // PNG refinement: capture one lossless frame after activity settles
  async function refineCapture() {
    if (capturing) return;
    capturing = true;
    try {
      const { data } = await client.send('Page.captureScreenshot', refineOpts);
      if (data) onFrame(data);
    } catch {}
    lastCaptureTime = Date.now();
    capturing = false;
  }

  function scheduleRefine() {
    if (!refineOpts) return;
    clearTimeout(refineTimer);
    refineTimer = setTimeout(refineCapture, REFINE_DELAY);
  }

  let captureCount = 0;
  let screencastCount = 0;
  async function capture() {
    if (capturing) { dbg('capture: skip (busy)'); return; }

    const now = Date.now();
    const elapsed = now - lastCaptureTime;
    if (elapsed < CAPTURE_MIN_INTERVAL) {
      dbg(`capture: throttled (${elapsed}ms)`);
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          capture();
        }, CAPTURE_MIN_INTERVAL - elapsed);
      }
      return;
    }

    capturing = true;
    lastCaptureTime = Date.now();
    try {
      captureCount++;
      dbg(`capture: #${captureCount} sending Page.captureScreenshot`);
      const { data } = await client.send('Page.captureScreenshot', fastOpts);
      dbg(`capture: #${captureCount} got data len=${data?.length || 0}`);
      if (data) onFrame(data);
    } catch (e) { dbg(`capture: error ${e.message}`); }
    capturing = false;
    scheduleRefine();
  }

  function onScreencastFrame({ data, sessionId }) {
    screencastCount++;
    dbg(`screencastFrame: #${screencastCount}`);
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    capture();
  }
  client.on('Page.screencastFrame', onScreencastFrame);

  // Low-res change-detection screencast + hi-res captureScreenshot
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 30,
    maxWidth: Math.round(width / SCREENCAST_SCALE),
    maxHeight: Math.round(height / SCREENCAST_SCALE),
    everyNthFrame: SCREENCAST_NTH_FRAME,
  });

  // Capture first frame immediately
  capture();

  // Force capture (bypasses throttle, always uses captureScreenshot)
  async function forceCapture() {
    if (capturing) return;
    capturing = true;
    try {
      const { data } = await client.send('Page.captureScreenshot', fastOpts);
      if (data) onFrame(data);
    } catch {}
    lastCaptureTime = Date.now();
    capturing = false;
    scheduleRefine();
  }

  // Prevent stuck capturing flag
  const stuckInterval = setInterval(() => { capturing = false; }, CAPTURE_STUCK_RESET);

  function cleanup() {
    clearInterval(stuckInterval);
    clearTimeout(throttleTimer);
    clearTimeout(refineTimer);
    client.removeListener('Page.screencastFrame', onScreencastFrame);
  }

  return { forceCapture, cleanup };
}

// Stop frame capture (cleanupFn from startScreencast return value)
export async function stopScreencast(client, cleanupFn) {
  try {
    if (cleanupFn) cleanupFn();
    await client.send('Page.stopScreencast');
  } catch {
    // Ignore if already closed
  }
}
