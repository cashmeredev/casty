// Kitty graphics protocol 出力
//
// 2つの送信方式を自動選択:
//   ローカル → ファイル転送 (t=f): 高速、パスだけ送信
//   SSH 経由 → インライン (t=d): base64 を直接送信
//
// f=100: PNG format
// q=2  : suppress response
// C=1  : cursor movement なし

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const isSSH = !!process.env.SSH_CONNECTION;
const tmpFile = join(tmpdir(), 'casty-frame.png');
const tmpPathB64 = Buffer.from(tmpFile).toString('base64');

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
  if (!isSSH) {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ファイル転送方式 (ローカル用: 高速)
function sendFrameFile(pngBase64) {
  writeFileSync(tmpFile, Buffer.from(pngBase64, 'base64'));
  process.stdout.write(`\x1b_Ga=T,t=f,f=100,q=2,C=1;${tmpPathB64}\x1b\\`);
}

// インライン方式 (SSH 用: 4096B チャンク分割)
function sendFrameInline(pngBase64) {
  const CHUNK = 4096;
  let i = 0;
  while (i < pngBase64.length) {
    const chunk = pngBase64.slice(i, i + CHUNK);
    const more = i + CHUNK < pngBase64.length ? 1 : 0;
    if (i === 0) {
      process.stdout.write(`\x1b_Ga=T,f=100,q=2,C=1,m=${more};${chunk}\x1b\\`);
    } else {
      process.stdout.write(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    i += CHUNK;
  }
}

export const sendFrame = isSSH ? sendFrameInline : sendFrameFile;
