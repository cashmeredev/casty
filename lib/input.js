// 入力イベント処理
// stdin raw mode でキー入力・マウスイベントを受け取り、CDP 経由で Chrome に送信

import { join } from 'path';
import { homedir } from 'os';
import { toKeyName } from './keys.js';
import { UrlBar } from './urlbar.js';
import { HintMode } from './hints.js';

// マウスイベント有効化 (SGR 1006 形式)
export function enableMouse() {
  process.stdout.write('\x1b[?1000;1002;1006h');
}

// マウスイベント無効化
export function disableMouse() {
  process.stdout.write('\x1b[?1000;1002;1006l');
}

// ターミナルのセル座標 → ピクセル座標に変換
// row=2 がブラウザ画面の先頭 (row=1 は URL バー)
function cellToPixel(col, row, cellWidth, cellHeight) {
  return {
    x: (col - 1) * cellWidth,
    y: (row - 2) * cellHeight,
  };
}

// CDP にマウスイベントを送信
async function dispatchMouse(client, type, x, y, button = 'left', clickCount = 0) {
  await client.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount });
}

// CDP にスクロールイベントを送信
async function dispatchScroll(client, x, y, deltaX, deltaY) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
}

// CDP modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
function modifierBits({ alt = false, ctrl = false, meta = false, shift = false } = {}) {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
}

// CDP にキー入力を送信
async function dispatchKey(client, { key, code, keyCode, text, modifiers = 0 }) {
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (text) {
    await client.send('Input.dispatchKeyEvent', { type: 'char', text, key, code, modifiers });
  }
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// ── キーマッピング (ターミナルエスケープシーケンス → CDP キー情報) ──

const SPECIAL_KEYS = {
  '\x1b[A':  { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  '\x1b[B':  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  '\x1b[C':  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  '\x1b[D':  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  '\x1b[H':  { key: 'Home',       code: 'Home',       keyCode: 36 },
  '\x1b[F':  { key: 'End',        code: 'End',        keyCode: 35 },
  '\x1b[5~': { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  '\x1b[6~': { key: 'PageDown',   code: 'PageDown',   keyCode: 34 },
  '\x1b[3~': { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  '\x7f':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '\x08' },
  '\x08':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '\x08' },
  '\r':      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
  '\n':      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
  '\t':      { key: 'Tab',        code: 'Tab',        keyCode: 9,  text: '\t' },
  '\x1b':    { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  ' ':       { key: ' ',          code: 'Space',      keyCode: 32, text: ' ' },
  '\x1bOP':   { key: 'F1',  code: 'F1',  keyCode: 112 },
  '\x1bOQ':   { key: 'F2',  code: 'F2',  keyCode: 113 },
  '\x1bOR':   { key: 'F3',  code: 'F3',  keyCode: 114 },
  '\x1bOS':   { key: 'F4',  code: 'F4',  keyCode: 115 },
  '\x1b[15~': { key: 'F5',  code: 'F5',  keyCode: 116 },
  '\x1b[17~': { key: 'F6',  code: 'F6',  keyCode: 117 },
  '\x1b[18~': { key: 'F7',  code: 'F7',  keyCode: 118 },
  '\x1b[19~': { key: 'F8',  code: 'F8',  keyCode: 119 },
  '\x1b[20~': { key: 'F9',  code: 'F9',  keyCode: 120 },
  '\x1b[21~': { key: 'F10', code: 'F10', keyCode: 121 },
  '\x1b[23~': { key: 'F11', code: 'F11', keyCode: 122 },
  '\x1b[24~': { key: 'F12', code: 'F12', keyCode: 123 },
};

// Ctrl+Key (0x01-0x1A) → Backspace/Tab/Enter と衝突するものは除外
const CTRL_KEYS = {};
const CTRL_EXCLUDE = new Set([2, 7, 8, 12]); // C, H(BS), I(Tab), M(Enter)
for (let i = 0; i < 26; i++) {
  if (CTRL_EXCLUDE.has(i)) continue;
  const char = String.fromCharCode(i + 1);
  const letter = String.fromCharCode(i + 97);
  const upper = letter.toUpperCase();
  CTRL_KEYS[char] = {
    key: letter,
    code: `Key${upper}`,
    keyCode: upper.charCodeAt(0),
    modifiers: modifierBits({ ctrl: true }),
  };
}

// 修飾キー付きキーの基本情報
const MOD_SUFFIX = {
  'A': { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  'B': { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  'C': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  'D': { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  'H': { key: 'Home',       code: 'Home',       keyCode: 36 },
  'F': { key: 'End',        code: 'End',        keyCode: 35 },
};

const MOD_TILDE = {
  '3':  { key: 'Delete',   code: 'Delete',   keyCode: 46 },
  '5':  { key: 'PageUp',   code: 'PageUp',   keyCode: 33 },
  '6':  { key: 'PageDown', code: 'PageDown',  keyCode: 34 },
  '15': { key: 'F5',  code: 'F5',  keyCode: 116 },
  '17': { key: 'F6',  code: 'F6',  keyCode: 117 },
  '18': { key: 'F7',  code: 'F7',  keyCode: 118 },
  '19': { key: 'F8',  code: 'F8',  keyCode: 119 },
  '20': { key: 'F9',  code: 'F9',  keyCode: 120 },
  '21': { key: 'F10', code: 'F10', keyCode: 121 },
  '23': { key: 'F11', code: 'F11', keyCode: 122 },
  '24': { key: 'F12', code: 'F12', keyCode: 123 },
};

// macOS Option+文字 → ベース文字のマップ (US キーボードレイアウト)
const MAC_OPTION_MAP = {
  'å': 'a', '∫': 'b', 'ç': 'c', '∂': 'd',
  'ƒ': 'f', '©': 'g', '˙': 'h', '∆': 'j',
  '˚': 'k', '¬': 'l', 'µ': 'm', 'ø': 'o',
  'π': 'p', 'œ': 'q', '®': 'r', 'ß': 's', '†': 't',
  '√': 'v', '∑': 'w', '≈': 'x', '¥': 'y', 'Ω': 'z',
};

function modBitsFromParam(p) {
  const n = p - 1;
  return modifierBits({ shift: !!(n & 1), alt: !!(n & 2), ctrl: !!(n & 4) });
}

// エスケープシーケンスをパースして key info を返す (modifiers 付き)
function parseInput(str) {
  // 完全一致の特殊キー
  const special = SPECIAL_KEYS[str];
  if (special) return { ...special, modifiers: 0 };

  // Ctrl+Key (0x01-0x1A)
  if (str.length === 1 && CTRL_KEYS[str]) return CTRL_KEYS[str];

  // 修飾キー付き矢印: ESC [ 1 ; <mod> <A-H>
  let m = str.match(/^\x1b\[1;(\d+)([A-H])$/);
  if (m) {
    const info = MOD_SUFFIX[m[2]];
    if (info) return { ...info, modifiers: modBitsFromParam(parseInt(m[1])) };
  }

  // 修飾キー付き特殊キー: ESC [ <num> ; <mod> ~
  m = str.match(/^\x1b\[(\d+);(\d+)~$/);
  if (m) {
    const info = MOD_TILDE[m[1]];
    if (info) return { ...info, modifiers: modBitsFromParam(parseInt(m[2])) };
  }

  // Alt+文字: ESC + 1文字 (ESC [ 等のシーケンスでないもの)
  if (str.length === 2 && str[0] === '\x1b' && str[1] !== '[' && str[1] !== 'O') {
    const ch = str[1];
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: modifierBits({ alt: true }),
    };
  }

  // macOS Option+文字: Unicode 文字として届く場合 → alt+文字 に変換
  if (str.length === 1 && MAC_OPTION_MAP[str]) {
    const ch = MAC_OPTION_MAP[str];
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: modifierBits({ alt: true }),
    };
  }

  // 通常文字
  if (!str.startsWith('\x1b') && str.length >= 1) return 'text';

  return undefined;
}

// ── OSC 52 クリップボード ──

// OSC 52 でクリップボードに書き込み
function clipboardWrite(text) {
  const b64 = Buffer.from(text).toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

// OSC 52 でクリップボードから読み取り
function clipboardRead() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.stdin.removeListener('data', onData);
      resolve(null);
    }, 1000);

    let buf = '';
    const onData = (data) => {
      buf += data.toString();
      // OSC 52 応答: ESC ] 52 ; c ; <base64> ESC \ or BEL
      const m = buf.match(/\x1b\]52;c;([A-Za-z0-9+/=]*?)(?:\x1b\\|\x07)/);
      if (m) {
        clearTimeout(timeout);
        process.stdin.removeListener('data', onData);
        resolve(Buffer.from(m[1], 'base64').toString());
      }
    };
    process.stdin.on('data', onData);

    // クリップボード読み取り要求
    process.stdout.write('\x1b]52;c;?\x07');
  });
}

// CDP で選択テキストを取得
async function getSelection(client) {
  try {
    const { result } = await client.send('Runtime.evaluate', {
      expression: 'window.getSelection().toString()',
    });
    return result.value || '';
  } catch { return ''; }
}

// ── casty アクションの実行 ──

async function getHistoryEntry(client, delta) {
  const { currentIndex, entries } = await client.send('Page.getNavigationHistory');
  const idx = currentIndex + delta;
  if (idx >= 0 && idx < entries.length) return { entryId: entries[idx].id };
  return { entryId: entries[currentIndex].id };
}

// ── メイン ──

// currentUrl を自前追跡 (page.url() の代替)
// bindings: { "ctrl+q": "quit", "alt+left": "back", "alt+l": "url_bar", ... }
export function startInputHandling(client, cellWidth, cellHeight, bindings, pauseRender, forceCapture) {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const keyToAction = bindings;
  const urlBar = new UrlBar();
  const hintMode = new HintMode(forceCapture);

  // 現在の URL を自前追跡
  let currentUrl = '';

  // macOS Option キー → rawBindings を構築
  const rawBindings = {};
  const MAC_OPTION_ARROWS = { 'alt+left': '\x1bb', 'alt+right': '\x1bf' };
  for (const [keyName, action] of Object.entries(bindings)) {
    const m = keyName.match(/^alt\+([a-z])$/);
    if (m) {
      const optChar = Object.entries(MAC_OPTION_MAP).find(([, v]) => v === m[1]);
      if (optChar) rawBindings[optChar[0]] = action;
    }
    if (MAC_OPTION_ARROWS[keyName]) {
      rawBindings[MAC_OPTION_ARROWS[keyName]] = action;
    }
  }

  // 初期 URL をナビゲーション履歴から取得
  urlBar.loading = true;
  client.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => {
    if (entries[currentIndex]) {
      urlBar.setUrl(entries[currentIndex].url);
    }
  }).catch(() => {});

  // ページ遷移時に URL バーを更新 (CDP イベント)
  client.on('Page.frameNavigated', ({ frame }) => {
    // parentId がないフレーム = メインフレーム
    if (!frame.parentId) {
      currentUrl = frame.url;
      urlBar.setUrl(currentUrl);
      urlBar.loading = true;
    }
  });

  // ローディング完了
  client.on('Page.loadEventFired', () => {
    urlBar.loading = false;
  });

  // ダウンロード処理 (CDP イベント)
  client.on('Browser.downloadWillBegin', ({ suggestedFilename }) => {
    urlBar.setStatus(`Downloading: ${suggestedFilename}`);
  });
  client.on('Browser.downloadProgress', ({ state }) => {
    if (state === 'completed') {
      urlBar.setStatus('Download complete');
      setTimeout(() => urlBar.clearStatus(), 3000);
    } else if (state === 'canceled') {
      urlBar.setStatus('Download canceled');
      setTimeout(() => urlBar.clearStatus(), 3000);
    }
  });

  // アクション実行
  async function execAction(action) {
    if (action === 'quit') { process.emit('SIGINT'); return true; }
    if (action === 'url_bar') {
      pauseRender();
      const url = await urlBar.startEditing();
      pauseRender(false);
      if (url) {
        urlBar.loading = true;
        await client.send('Page.navigate', { url });
      }
      return true;
    }
    if (action === 'back') {
      urlBar.loading = true;
      await client.send('Page.navigateToHistoryEntry', await getHistoryEntry(client, -1));
      return true;
    }
    if (action === 'forward') {
      urlBar.loading = true;
      await client.send('Page.navigateToHistoryEntry', await getHistoryEntry(client, +1));
      return true;
    }
    if (action === 'copy') {
      const text = await getSelection(client);
      if (text) {
        clipboardWrite(text);
        urlBar.setStatus(`Copied: ${text.slice(0, 40)}${text.length > 40 ? '...' : ''}`);
        setTimeout(() => urlBar.clearStatus(), 2000);
      }
      return true;
    }
    if (action === 'paste') {
      const text = await clipboardRead();
      if (text) {
        await client.send('Input.insertText', { text });
      }
      return true;
    }
    if (action === 'hints') {
      hintMode.start(client);
      return true;
    }
    return false;
  }

  process.stdin.on('data', async (data) => {
    const str = data.toString();

    // ヒントモード中 → 全入力をヒントモードに渡す
    if (hintMode.active) {
      await hintMode.handleInput(str);
      return;
    }

    // URL バー編集中 → コピペはここで処理、他は URL バーへ
    if (urlBar.editing) {
      const r = parseInput(str);
      const kn = r && r !== 'text' ? toKeyName(r) : null;
      const act = kn ? keyToAction[kn] : rawBindings[str];
      if (act === 'paste') {
        const text = await clipboardRead();
        if (text) urlBar.insertText(text);
        return;
      }
      if (act === 'copy') {
        if (urlBar.text) {
          clipboardWrite(urlBar.text);
          urlBar.setStatus('Copied');
          setTimeout(() => urlBar.clearStatus(), 1500);
        }
        return;
      }
      urlBar.handleInput(str);
      return;
    }

    // SGR マウスイベント
    const mouseRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let match;
    let hadMouse = false;

    while ((match = mouseRe.exec(str)) !== null) {
      hadMouse = true;
      const cb = parseInt(match[1]);
      const col = parseInt(match[2]);
      const row = parseInt(match[3]);
      const release = match[4] === 'm';
      const { x, y } = cellToPixel(col, row, cellWidth, cellHeight);

      // 1行目クリック → アドレスバー
      if (row === 1 && cb === 0 && !release) {
        await execAction('url_bar');
        return;
      }

      if (cb === 64) {
        await dispatchScroll(client, x, y, 0, -100);
      } else if (cb === 65) {
        await dispatchScroll(client, x, y, 0, 100);
      } else if (cb === 0) {
        if (release) {
          await dispatchMouse(client, 'mouseReleased', x, y, 'left');
        } else {
          await dispatchMouse(client, 'mousePressed', x, y, 'left', 1);
        }
      } else if (cb === 32) {
        await dispatchMouse(client, 'mouseMoved', x, y, 'left');
      }
    }

    if (hadMouse) return;

    // 生の入力文字で直接バインディングを検索 (macOS Option+文字)
    if (rawBindings[str]) {
      await execAction(rawBindings[str]);
      return;
    }

    // parseInput 経由でバインディングを検索
    const result = parseInput(str);
    if (result && result !== 'text') {
      const keyName = toKeyName(result);
      const action = keyToAction[keyName];
      if (action && await execAction(action)) return;
    }

    // Ctrl+C はフォールバック
    if (str === '\x03') {
      process.emit('SIGINT');
      return;
    }

    // casty アクションでなければ Chrome にスルー
    if (result === 'text') {
      await client.send('Input.insertText', { text: str });
    } else if (result) {
      await dispatchKey(client, result);
    }
  });

  return urlBar;
}
