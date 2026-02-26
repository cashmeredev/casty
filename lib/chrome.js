// Chrome プロセス起動・バイナリ検出

import { spawn } from 'child_process';
import { readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { get } from 'http';

const BROWSERS_DIR = join(homedir(), '.casty', 'browsers');

// chrome-headless-shell バイナリを検出
// Chrome for Testing 形式: chrome-headless-shell-<ver>/chrome-headless-shell
// Playwright 形式: chromium_headless_shell-<rev>/chrome-headless-shell-<platform>/chrome-headless-shell
export function findChrome() {
  if (!existsSync(BROWSERS_DIR)) return null;

  const entries = readdirSync(BROWSERS_DIR).sort().reverse();

  // Chrome for Testing 形式を優先
  for (const dir of entries) {
    if (!dir.startsWith('chrome-headless-shell-')) continue;
    const bin = join(BROWSERS_DIR, dir, 'chrome-headless-shell');
    if (existsSync(bin)) return bin;
  }

  // Playwright 形式にフォールバック
  for (const dir of entries) {
    if (!dir.startsWith('chromium_headless_shell-')) continue;
    const base = join(BROWSERS_DIR, dir);
    try {
      const subs = readdirSync(base).filter(s => s.startsWith('chrome-headless-shell-'));
      for (const sub of subs) {
        const bin = join(base, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    } catch {}
  }

  return null;
}

// プロファイルの肥大化を防止 (Cookie/LocalStorage 以外のキャッシュ・DB を削除)
// Chrome は起動時にこれらを処理するため、蓄積すると起動が劇的に遅くなる
function cleanProfile(userDataDir) {
  const def = join(userDataDir, 'Default');
  if (!existsSync(def)) return;
  const KEEP = new Set([
    'Cookies', 'Cookies-journal',
    'Local Storage',
    'Preferences', 'Secure Preferences',
  ]);
  try {
    for (const entry of readdirSync(def)) {
      if (KEEP.has(entry)) continue;
      rmSync(join(def, entry), { recursive: true, force: true });
    }
  } catch {}
}

// Chrome 起動、DevTools WebSocket URL を返す
export function launchChrome({ userDataDir, windowSize, args = [] } = {}) {
  cleanProfile(userDataDir);
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('Chrome not found. Run ./bin/casty to install.');

  const chromeArgs = [
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--auto-grant-permissions',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    `--user-data-dir=${userDataDir}`,
  ];
  // Linux では sandbox が使えない環境が多い (VM, コンテナ等)
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox');
  }
  if (windowSize) {
    chromeArgs.push(`--window-size=${windowSize.width},${windowSize.height}`);
  }
  chromeArgs.push(...args);

  const proc = spawn(chromeBin, chromeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // stderr から DevTools URL を取得
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error('Chrome startup timeout'));
    }, 15000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // DevTools listening on ws://127.0.0.1:PORT/...
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timeout);
        const wsUrl = m[1];
        const portMatch = wsUrl.match(/:(\d+)\//);
        const port = portMatch ? parseInt(portMatch[1]) : 0;
        resolve({ proc, wsUrl, port });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited with code ${code}`));
    });
  });
}

// /json エンドポイントから page ターゲットの WebSocket URL を取得
export function getPageWsUrl(port) {
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const page = targets.find(t => t.type === 'page');
          if (page) resolve(page.webSocketDebuggerUrl);
          else reject(new Error('No page target found'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}
