// Kitty graphics protocol 出力
//
// 2つの送信方式:
//   ファイル転送 (t=f): 高速、パスだけ送信 (bcon 等)
//   インライン (t=d): base64 を直接送信 (Ghostty 等)
//
// ~/.casty/config.json の transport で指定:
//   "auto"   → bcon ならファイル転送、それ以外はインライン
//   "file"   → ファイル転送を強制
//   "inline" → インラインを強制
//
// f=100: PNG format
// q=2  : suppress response
// C=1  : cursor movement なし

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from './config.js';

const tmpFile = join(tmpdir(), `casty-frame-${process.pid}.png`);
const tmpPathB64 = Buffer.from(tmpFile).toString('base64');

// 転送方式を判定
function detectTransport() {
  const config = loadConfig();
  const setting = config.transport || 'auto';

  if (setting === 'file') return 'file';
  if (setting === 'inline') return 'inline';

  // auto: bcon は t=f 対応
  const termProg = process.env.TERM_PROGRAM || '';
  if (/bcon/i.test(termProg)) return 'file';

  return 'inline';
}

export const transport = detectTransport();

// カーソルを2行目に移動 (1行目は URL バー用)
export function cursorHome() {
  process.stdout.write('\x1b[2;1H');
}

// 画面クリア (Kitty 画像も全削除)
export function clearScreen() {
  process.stdout.write('\x1b_Ga=d,d=A,q=2;\x1b\\'); // Kitty 画像を全削除
  process.stdout.write('\x1b[2J\x1b[H');
}

// カーソル非表示
export function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

// カーソル表示
export function showCursor() {
  process.stdout.write('\x1b[?25h');
}

// テンプファイル削除
export function cleanup() {
  try { unlinkSync(tmpFile); } catch {}
}

// ファイル転送方式 (高速: パスだけ送信)
function sendFrameFile(base64Data) {
  writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
  process.stdout.write(`\x1b_Ga=T,f=100,t=f,q=2,C=1,i=1;${tmpPathB64}\x1b\\`);
}

// インライン方式 (4096B チャンク分割、PNG 専用)
function sendFrameInline(pngBase64) {
  const CHUNK = 4096;
  let i = 0;
  while (i < pngBase64.length) {
    const chunk = pngBase64.slice(i, i + CHUNK);
    const more = i + CHUNK < pngBase64.length ? 1 : 0;
    if (i === 0) {
      process.stdout.write(`\x1b_Ga=T,f=100,q=2,C=1,i=1,m=${more};${chunk}\x1b\\`);
    } else {
      process.stdout.write(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    i += CHUNK;
  }
}

export const sendFrame = transport === 'file' ? sendFrameFile : sendFrameInline;
