// アドレスバー / 検索バー (常時表示)
// ターミナルの最下行に現在の URL を常に表示
// Alt+L で編集モード → Enter で遷移、Escape でキャンセル

import { showCursor, hideCursor } from './kitty.js';

const SEARCH_URL = 'https://www.google.com/search?q=';

function isURL(str) {
  return /^https?:\/\//.test(str) || /^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/|$)/.test(str);
}

function toURL(input) {
  if (/^https?:\/\//.test(input)) return input;
  if (isURL(input)) return 'https://' + input;
  return SEARCH_URL + encodeURIComponent(input);
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
      const cursorCol = prefix.length + Math.min(this.cursor, cols - prefix.length) + 1;
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
    const display = (prefix + content).slice(0, cols);
    return `\x1b[38;5;250m\x1b[48;5;236m${display.padEnd(cols)}`;
  }

  _editLine(cols) {
    const prefix = ' > ';
    const maxLen = cols - prefix.length;
    const display = this.text.length > maxLen ? this.text.slice(this.text.length - maxLen) : this.text;
    if (this.selectAll) {
      // 選択状態: 反転表示
      return `\x1b[48;5;24m\x1b[97m${prefix}\x1b[7m${display}\x1b[27m${''.padEnd(Math.max(0, maxLen - display.length))}`;
    }
    return `\x1b[97m\x1b[48;5;24m${prefix}${display.padEnd(maxLen)}`;
  }

  // 編集モード開始 (Promise で URL を返す)
  startEditing() {
    this.editing = true;
    this.selectAll = true;
    this.text = this.currentUrl;
    this.cursor = this.text.length;
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
      this.cursor = this.text.length;
      this.render();
      return true;
    }

    // Ctrl+E → 末尾へ
    if (str === '\x05') {
      this._deselect();
      this.cursor = this.text.length;
      this.render();
      return true;
    }

    // Ctrl+W → 単語削除
    if (str === '\x17') {
      this._clearIfSelected();
      const before = this.text.slice(0, this.cursor);
      const after = this.text.slice(this.cursor);
      const trimmed = before.replace(/\S+\s*$/, '');
      this.text = trimmed + after;
      this.cursor = trimmed.length;
      this.render();
      return true;
    }

    // Backspace
    if (str === '\x7f' || str === '\x08') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor > 0) {
        this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
        this.cursor--;
      }
      this.render();
      return true;
    }

    // Delete
    if (str === '\x1b[3~') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor < this.text.length) {
        this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
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
      else if (this.cursor < this.text.length) this.cursor++;
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
      this.cursor = this.text.length;
      this.render();
      return true;
    }

    // 通常文字入力 → 選択中なら全置換
    if (!str.startsWith('\x1b') && str.charCodeAt(0) >= 32) {
      this._clearIfSelected();
      this.text = this.text.slice(0, this.cursor) + str + this.text.slice(this.cursor);
      this.cursor += str.length;
      this.render();
      return true;
    }

    return true; // 編集中は全入力を消費
  }
}
