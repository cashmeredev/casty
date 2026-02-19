// アドレスバー / 検索バー (常時表示)
// ターミナルの1行目に現在の URL を常に表示
// Alt+L で編集モード → Enter で遷移、Escape でキャンセル

import { showCursor, hideCursor } from './kitty.js';
import { loadConfig } from './config.js';

function isURL(str) {
  return /^https?:\/\//.test(str) || /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/|$)/.test(str);
}

function toURL(input) {
  if (/^https?:\/\//.test(input)) return input;
  if (isURL(input)) return 'https://' + input;
  const config = loadConfig();
  return config.searchUrl + encodeURIComponent(input);
}

// 文字の表示幅 (全角=2, 半角=1)
function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33BF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7FF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x2FA1F)
  ) return 2;
  return 1;
}

function strWidth(str) {
  let w = 0;
  for (const ch of str) w += charWidth(ch.codePointAt(0));
  return w;
}

// 表示幅で切り詰め (末尾から maxW カラム分)
function sliceByWidth(str, maxW) {
  const chars = [...str];
  let w = 0;
  let start = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i].codePointAt(0));
    if (w + cw > maxW) break;
    w += cw;
    start = i;
  }
  return { text: chars.slice(start).join(''), width: w };
}

// 表示幅で padEnd
function padEndByWidth(str, totalW) {
  const w = strWidth(str);
  return w >= totalW ? str : str + ' '.repeat(totalW - w);
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class UrlBar {
  constructor() {
    this.currentUrl = '';
    this.editing = false;
    this.loading = false;
    this._spinIdx = 0;
    this._status = null;
    this.text = '';
    this.cursor = 0;
    this.selectAll = false; // 全選択状態
    this._resolve = null;
  }

  // 現在の URL を更新して再描画 (編集中でなければ)
  setUrl(url) {
    this.currentUrl = url;
    if (!this.editing) this.render();
  }

  // ステータスメッセージ (ダウンロード等)
  setStatus(msg) { this._status = msg; }
  clearStatus() { this._status = null; }

  // 1行目に描画
  render() {
    const cols = process.stdout.columns || 80;
    const line = this.editing ? this._editLine(cols) : this._displayLine(cols);
    process.stdout.write(`\x1b[1;1H${line}\x1b[0m`);
    if (this.editing) {
      const prefix = ' > ';
      const textBeforeCursor = [...this.text].slice(0, this.cursor).join('');
      const cursorCol = prefix.length + strWidth(textBeforeCursor) + 1;
      process.stdout.write(`\x1b[1;${cursorCol}H`);
    }
  }

  _displayLine(cols) {
    let prefix;
    if (this.loading) {
      prefix = ' ' + SPINNER[this._spinIdx++ % SPINNER.length] + ' ';
    } else {
      prefix = '   ';
    }
    const content = this._status || this.currentUrl;
    const full = prefix + content;
    return `\x1b[38;5;250m\x1b[48;5;236m${padEndByWidth(full, cols)}`;
  }

  _editLine(cols) {
    const prefix = ' > ';
    const maxW = cols - prefix.length;
    const tw = strWidth(this.text);
    const display = tw > maxW ? sliceByWidth(this.text, maxW).text : this.text;
    const dw = strWidth(display);
    const pad = Math.max(0, maxW - dw);
    if (this.selectAll) {
      return `\x1b[48;5;24m\x1b[97m${prefix}\x1b[7m${display}\x1b[27m${' '.repeat(pad)}`;
    }
    return `\x1b[97m\x1b[48;5;24m${prefix}${display}${' '.repeat(pad)}`;
  }

  // 編集モード開始 (Promise で URL を返す)
  startEditing() {
    this.editing = true;
    this.selectAll = true;
    this.text = this.currentUrl;
    this.cursor = [...this.text].length;
    showCursor();
    this.render();
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  // 編集モード終了
  _finishEditing(result) {
    this.editing = false;
    hideCursor();
    this.render();
    if (this._resolve) {
      this._resolve(result ? toURL(result) : null);
      this._resolve = null;
    }
  }

  // 選択解除
  _deselect() { this.selectAll = false; }

  // 選択状態で文字入力/削除 → 全置換
  _clearIfSelected() {
    if (this.selectAll) {
      this.text = '';
      this.cursor = 0;
      this.selectAll = false;
    }
  }

  // テキスト挿入 (ペースト用)
  insertText(str) {
    if (!this.editing) return;
    this._clearIfSelected();
    const chars = [...this.text];
    const input = [...str];
    this.text = chars.slice(0, this.cursor).join('') + str + chars.slice(this.cursor).join('');
    this.cursor += input.length;
    this.render();
  }

  // 編集中のキー入力を処理 (true を返したら処理済み)
  handleInput(str) {
    if (!this.editing) return false;

    // Enter → 確定
    if (str === '\r' || str === '\n') {
      this._finishEditing(this.text.trim() || null);
      return true;
    }

    // Escape → キャンセル
    if (str === '\x1b') {
      this._finishEditing(null);
      return true;
    }

    // Ctrl+C → キャンセル
    if (str === '\x03') {
      this._finishEditing(null);
      return true;
    }

    // Ctrl+U → 全クリア
    if (str === '\x15') {
      this.text = '';
      this.cursor = 0;
      this._deselect();
      this.render();
      return true;
    }

    // Ctrl+A → 全選択
    if (str === '\x01') {
      this.selectAll = true;
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // Ctrl+E → 末尾へ
    if (str === '\x05') {
      this._deselect();
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // Ctrl+W → 単語削除
    if (str === '\x17') {
      this._clearIfSelected();
      const chars = [...this.text];
      const before = chars.slice(0, this.cursor).join('');
      const after = chars.slice(this.cursor).join('');
      const trimmed = before.replace(/\S+\s*$/, '');
      this.text = trimmed + after;
      this.cursor = [...trimmed].length;
      this.render();
      return true;
    }

    // Backspace
    if (str === '\x7f' || str === '\x08') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor > 0) {
        const chars = [...this.text];
        chars.splice(this.cursor - 1, 1);
        this.text = chars.join('');
        this.cursor--;
      }
      this.render();
      return true;
    }

    // Delete
    if (str === '\x1b[3~') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor < [...this.text].length) {
        const chars = [...this.text];
        chars.splice(this.cursor, 1);
        this.text = chars.join('');
      }
      this.render();
      return true;
    }

    // 左矢印 → 選択解除して先頭へ
    if (str === '\x1b[D') {
      if (this.selectAll) { this.cursor = 0; this._deselect(); }
      else if (this.cursor > 0) this.cursor--;
      this.render();
      return true;
    }

    // 右矢印 → 選択解除して末尾へ
    if (str === '\x1b[C') {
      if (this.selectAll) { this._deselect(); }
      else if (this.cursor < [...this.text].length) this.cursor++;
      this.render();
      return true;
    }

    // Home
    if (str === '\x1b[H') {
      this._deselect();
      this.cursor = 0;
      this.render();
      return true;
    }

    // End
    if (str === '\x1b[F') {
      this._deselect();
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // 通常文字入力 → 選択中なら全置換
    if (!str.startsWith('\x1b') && str.charCodeAt(0) >= 32) {
      this._clearIfSelected();
      const chars = [...this.text];
      const input = [...str];
      this.text = chars.slice(0, this.cursor).join('') + str + chars.slice(this.cursor).join('');
      this.cursor += input.length;
      this.render();
      return true;
    }

    return true; // 編集中は全入力を消費
  }
}
