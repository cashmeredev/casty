// Raw CDP browser control
// Runtime.enable must never be sent

import { join } from 'node:path';
import { homedir } from 'node:os';
import { CDPClient } from './cdp.js';
import { launchChrome } from './chrome.js';
import { loadConfig } from './config.js';

const DEFAULT_CHROME_VERSION = '146.0.7680.80';

// Platform-specific identity (must match real OS to avoid TLS/TCP fingerprint mismatch)
const PLATFORM = process.platform === 'darwin'
  ? { ua: 'Macintosh; Intel Mac OS X 10_15_7', nav: 'MacIntel',
      uaPlatform: 'macOS', uaPlatformVersion: '15.0.0',
      glVendor: 'Google Inc. (Apple)', glRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' }
  : { ua: `X11; Linux ${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
      nav: `Linux ${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
      uaPlatform: 'Linux', uaPlatformVersion: '',
      glVendor: 'Google Inc. (Intel)', glRenderer: 'ANGLE (Intel, Mesa Intel UHD Graphics, OpenGL 4.5)' };

const buildUserAgent = (v) =>
  `Mozilla/5.0 (${PLATFORM.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const PROFILE_DIR = join(homedir(), '.casty', 'profile');

// Screencast settings (low-res stream for change detection)
const SCREENCAST_SCALE     = 4;    // Downscale factor (1/4 resolution)
const SCREENCAST_NTH_FRAME = 1;    // Every frame (no decimation, faster change detection)

// Capture control
const CAPTURE_MIN_INTERVAL = 50;   // ms (~20fps)
const CAPTURE_STUCK_RESET  = 5000; // Reset stuck capturing flag (ms)

// Build stealth script with locale-dependent language settings
// lang: primary language (e.g. "ja", "en-US")
function buildStealthScript(lang, { fakeMedia = false } = {}) {
  // Build Accept-Language style list: primary, then en-US/en fallbacks
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
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
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
${fakeMedia ? `  if (params.name === 'camera' || params.name === 'microphone') {
    return Promise.resolve({ state: 'granted' });
  }` : ''}
  return origQuery(params);
};

// WebGL vendor/renderer (hide SwiftShader)
// 0x9245 = UNMASKED_VENDOR_WEBGL, 0x9246 = UNMASKED_RENDERER_WEBGL
const getParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p) {
  if (p === 0x9245) return '${PLATFORM.glVendor}';
  if (p === 0x9246) return '${PLATFORM.glRenderer}';
  return getParam.call(this, p);
};

// navigator.connection (can be undefined in headless)
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
  });
}

${fakeMedia ? `
// getUserMedia emulation (headless-shell lacks media capture)
if (navigator.mediaDevices) {
  const fakeStream = (constraints) => {
    const tracks = [];
    if (constraints.video) {
      const w = constraints.video.width?.ideal || constraints.video.width?.max || 640;
      const h = constraints.video.height?.ideal || constraints.video.height?.max || 480;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); requestAnimationFrame(draw); };
      draw();
      const stream = canvas.captureStream(30);
      tracks.push(...stream.getVideoTracks());
    }
    if (constraints.audio) {
      const actx = new AudioContext();
      const gain = actx.createGain();
      gain.gain.value = 0;
      gain.connect(actx.destination);
      const dest = actx.createMediaStreamDestination();
      gain.connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    }
    return Promise.resolve(new MediaStream(tracks));
  };
  navigator.mediaDevices.getUserMedia = fakeStream;
  navigator.mediaDevices.enumerateDevices = () => Promise.resolve([
    { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone', groupId: 'default' },
    { deviceId: 'default', kind: 'videoinput', label: 'Default Camera', groupId: 'default' },
    { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker', groupId: 'default' },
  ]);
}
` : ''}
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
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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

  // Detect Chrome version from CDP endpoint
  const versionInfo = await fetchJson(`${baseUrl}/json/version`);
  const chromeVersion = versionInfo?.Browser?.replace(/^.*\//, '') || DEFAULT_CHROME_VERSION;
  const userAgent = buildUserAgent(chromeVersion);

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
      userAgent: userAgent, platform: PLATFORM.nav,
      acceptLanguage: buildAcceptLanguage(lang),
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: chromeVersion.split('.')[0] },
          { brand: 'Google Chrome', version: chromeVersion.split('.')[0] },
          { brand: 'Not-A.Brand', version: '99' },
        ],
        fullVersionList: [
          { brand: 'Chromium', version: chromeVersion },
          { brand: 'Google Chrome', version: chromeVersion },
          { brand: 'Not-A.Brand', version: '99.0.0.0' },
        ],
        platform: PLATFORM.uaPlatform,
        platformVersion: PLATFORM.uaPlatformVersion,
        architecture: process.arch === 'arm64' ? 'arm' : 'x86',
        bitness: '64',
        model: '',
        mobile: false,
        wow64: false,
      },
    }),
    client.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStealthScript(lang, { fakeMedia: config.fakeMedia }) }),
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

  async function capture() {
    if (capturing) return;

    const now = Date.now();
    const elapsed = now - lastCaptureTime;
    if (elapsed < CAPTURE_MIN_INTERVAL) {
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
      const { data } = await client.send('Page.captureScreenshot', fastOpts);
      if (data) onFrame(data);
    } catch {}
    capturing = false;
    scheduleRefine();
  }

  function onScreencastFrame({ data, sessionId }) {
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
