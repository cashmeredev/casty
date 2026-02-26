// キーバインド設定
// ~/.casty/keys.json でカスタマイズ可能
// casty が横取りするアクションだけ定義。それ以外は Chrome にスルー。

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const configPath = join(homedir(), '.casty', 'keys.json');

// デフォルトのキーバインド
// キー名: "ctrl+c", "alt+left", "f5", "ctrl+shift+r" 等
const DEFAULTS = {
  'ctrl+q':      'quit',
  'alt+left':    'back',
  'alt+right':   'forward',
  'alt+l':       'url_bar',
  'alt+c':       'copy',
  'ctrl+v':      'paste',
  'alt+f':       'hints',
};

// 設定を読み込み (なければデフォルト)
export function loadKeyBindings() {
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8'));
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

// キーバインド → アクション名の逆引きマップを作る
// { "quit": Set(["ctrl+q"]), "back": Set(["alt+left"]), ... }
export function buildActionMap(bindings) {
  const actionToKeys = {};
  for (const [key, action] of Object.entries(bindings)) {
    if (!actionToKeys[action]) actionToKeys[action] = new Set();
    actionToKeys[action].add(key);
  }
  return actionToKeys;
}

// パースした入力から人間可読なキー名を生成
// { key: 'ArrowLeft', modifiers: 1 } → "alt+left"
// { key: 'r', modifiers: 2 }        → "ctrl+r"
// { key: 'F5', modifiers: 0 }       → "f5"
export function toKeyName(info) {
  const parts = [];
  if (info.modifiers & 2) parts.push('ctrl');
  if (info.modifiers & 1) parts.push('alt');
  if (info.modifiers & 8) parts.push('shift');
  if (info.modifiers & 4) parts.push('meta');

  // key を正規化
  const k = info.key;
  const normalized =
    k === 'ArrowUp'    ? 'up' :
    k === 'ArrowDown'  ? 'down' :
    k === 'ArrowLeft'  ? 'left' :
    k === 'ArrowRight' ? 'right' :
    k === ' '          ? 'space' :
    k.toLowerCase();

  parts.push(normalized);
  return parts.join('+');
}
