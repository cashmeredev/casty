// 生 CDP によるブラウザ制御
// Runtime.enable を絶対に送信しない

import { join } from 'path';
import { homedir } from 'os';
import { get } from 'http';
import { CDPClient } from './cdp.js';
import { launchChrome } from './chrome.js';

const CHROME_VERSION = '145.0.7632.6';
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
const PROFILE_DIR = join(homedir(), '.casty', 'profile');

// ページ JS 実行前に注入するステルスパッチ
// headless-shell が露出する自動化シグナルを隠す
const STEALTH_SCRIPT = `
// navigator.plugins (headless は空 → 偽装)
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

// navigator.languages (配列として返す)
Object.defineProperty(navigator, 'languages', {
  get: () => ['ja', 'en-US', 'en'],
});

// navigator.language
Object.defineProperty(navigator, 'language', {
  get: () => 'ja',
});

// window.chrome (headless は undefined)
if (!window.chrome) {
  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect: function(){}, id: undefined, sendMessage: function(){} },
    csi: function() { return {}; },
    loadTimes: function() { return {}; },
  };
}

// Permissions API (headless は挙動が異なる)
const origQuery = navigator.permissions.query.bind(navigator.permissions);
navigator.permissions.query = (params) => {
  if (params.name === 'notifications') {
    return Promise.resolve({ state: Notification.permission });
  }
  return origQuery(params);
};

// WebGL vendor/renderer (SwiftShader を隠す)
const getParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p) {
  if (p === 37445) return 'Google Inc. (Apple)';
  if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)';
  return getParam.call(this, p);
};

// navigator.connection (headless は undefined の場合がある)
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
  });
}
`;


// HTTP GET → JSON
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Phase 1: Chrome 起動のみ (ターミナル情報不要、並列実行用)
export async function startBrowser() {
  return launchChrome({ userDataDir: PROFILE_DIR });
}

// Phase 2: CDP 接続 + ページセットアップ (ナビゲーションは呼び出し側で行う)
export async function setupPage({ wsUrl, port }, { width, height, zoom = 1 } = {}) {
  // ブラウザ CDP 接続 → Target.createTarget でページを作成
  const browserClient = new CDPClient();
  await browserClient.connect(wsUrl);
  const { targetId } = await browserClient.send('Target.createTarget', { url: 'about:blank' });

  // 作成したターゲットの wsDebuggerUrl を /json/list から取得
  const targets = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find(t => t.id === targetId) || targets.find(t => t.type === 'page');
  if (!target) throw new Error('Failed to create page target');

  const client = new CDPClient();
  await client.connect(target.webSocketDebuggerUrl);

  const cssWidth = Math.round(width / zoom);
  const cssHeight = Math.round(height / zoom);

  // CDP コマンドを並列実行 (全て navigate 前に完了する必要あり)
  await Promise.all([
    client.send('Page.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {
      width: cssWidth, height: cssHeight, deviceScaleFactor: zoom, mobile: false,
    }),
    client.send('Network.setUserAgentOverride', {
      userAgent: USER_AGENT, platform: 'MacIntel',
      acceptLanguage: 'ja,en-US;q=0.9,en;q=0.8',
    }),
    client.send('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH_SCRIPT }),
    client.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName', downloadPath: join(homedir(), 'Downloads'),
      eventsEnabled: true,
    }),
  ]);

  return { client, browserClient, cssWidth, cssHeight };
}

// フレーム取得開始
// Screencast を変更検知トリガーとして使い、captureScreenshot で高解像度キャプチャ
// format: 'jpeg' (ローカル、高速) or 'png' (SSH、Kitty inline は PNG 必須)
export async function startScreencast(client, { width, height, onFrame, format = 'png', quality = 85 }) {
  let capturing = false;
  let lastCaptureTime = 0;
  const MIN_INTERVAL = 80; // ms (~12fps 上限、ターミナル表示には十分)
  let throttleTimer = null;

  const screenshotOpts = { format, optimizeForSpeed: true };
  if (format === 'jpeg') screenshotOpts.quality = quality;

  async function capture() {
    if (capturing) return;

    const now = Date.now();
    const elapsed = now - lastCaptureTime;
    if (elapsed < MIN_INTERVAL) {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          capture();
        }, MIN_INTERVAL - elapsed);
      }
      return;
    }

    capturing = true;
    lastCaptureTime = Date.now();
    try {
      const { data } = await client.send('Page.captureScreenshot', screenshotOpts);
      if (data) onFrame(data);
    } catch {}
    capturing = false;
  }

  // Screencast を低解像度の変更検知として使用
  client.on('Page.screencastFrame', async ({ sessionId }) => {
    await client.send('Page.screencastFrameAck', { sessionId });
    capture();
  });

  await client.send('Page.startScreencast', {
    format: 'png',
    maxWidth: Math.round(width / 4),
    maxHeight: Math.round(height / 4),
    everyNthFrame: 2, // 変更検知頻度を半減
  });

  // 初回フレームを即座に取得
  capture();

  // 強制キャプチャ (スロットルをバイパス)
  async function forceCapture() {
    if (capturing) return;
    capturing = true;
    try {
      const { data } = await client.send('Page.captureScreenshot', screenshotOpts);
      if (data) onFrame(data);
    } catch {}
    lastCaptureTime = Date.now();
    capturing = false;
  }

  // capturing フラグが stuck するのを防止 (5秒でリセット)
  setInterval(() => { capturing = false; }, 5000);

  return { forceCapture };
}

// フレーム取得停止
export async function stopScreencast(client) {
  try {
    client.removeAllListeners('Page.screencastFrame');
    await client.send('Page.stopScreencast');
  } catch {
    // 既に閉じている場合は無視
  }
}
