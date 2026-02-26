// Chrome プロセス起動・バイナリ検出

import { spawn, execFileSync } from 'child_process';
import { readdirSync, existsSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { get } from 'http';

const BROWSERS_DIR = join(homedir(), '.casty', 'browsers');
const IS_ARM_LINUX = process.platform === 'linux' && process.arch === 'arm64';

// Playwright 形式ディレクトリ内で headless shell バイナリを再帰探索
// バイナリ名はバージョンにより異なる: chrome-headless-shell or headless_shell
const HEADLESS_BINS = ['chrome-headless-shell', 'headless_shell'];
function findBinInDir(base) {
  try {
    for (const name of HEADLESS_BINS) {
      // 直下にあるか
      const direct = join(base, name);
      if (existsSync(direct) && statSync(direct).isFile()) return direct;
    }
    // サブディレクトリを探索
    for (const sub of readdirSync(base)) {
      for (const name of HEADLESS_BINS) {
        const bin = join(base, sub, name);
        if (existsSync(bin) && statSync(bin).isFile()) return bin;
      }
    }
  } catch {}
  return null;
}

// Chrome バイナリを検出
// 戻り値: { bin, headless } — headless=true ならシステム Chrome (--headless=new が必要)
export function findChrome() {
  if (existsSync(BROWSERS_DIR)) {
    const entries = readdirSync(BROWSERS_DIR).sort().reverse();

    // 1. Chrome for Testing headless-shell (x86_64 のみ、ARM64 Linux はスキップ)
    if (!IS_ARM_LINUX) {
      for (const dir of entries) {
        if (!dir.startsWith('chrome-headless-shell-')) continue;
        const bin = join(BROWSERS_DIR, dir, 'chrome-headless-shell');
        if (existsSync(bin)) return { bin, headless: false };
      }
    }

    // 2. Playwright 形式 (全プラットフォーム対応)
    for (const dir of entries) {
      if (!dir.startsWith('chromium_headless_shell-')) continue;
      const bin = findBinInDir(join(BROWSERS_DIR, dir));
      if (bin) return { bin, headless: false };
    }
  }

  // 3. システム Chrome/Chromium (フォールバック)
  const candidates = [
    'chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome',
  ];
  for (const name of candidates) {
    try {
      const path = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (path) return { bin: path, headless: true };
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
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found. Install chromium-browser or run ./bin/casty to install.');

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
  // システム Chrome は --headless=new が必要 (headless-shell は不要)
  if (chrome.headless) {
    chromeArgs.push('--headless=new');
  }
  // Linux では sandbox が使えない環境が多い (VM, コンテナ等)
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox');
  }
  if (windowSize) {
    chromeArgs.push(`--window-size=${windowSize.width},${windowSize.height}`);
  }
  chromeArgs.push(...args);

  const proc = spawn(chrome.bin, chromeArgs, {
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
      reject(new Error(`Chrome exited with code ${code}\n${stderr}`));
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
