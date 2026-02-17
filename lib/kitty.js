// Kitty graphics protocol 出力
//
// ファイル転送方式 (t=f):
//   PNG をテンプファイルに書き、パスを base64 で渡す
//   チャンク分割不要、ターミナルが直接ファイルを読む
//
// f=100: PNG format (Kitty は JPEG 非対応)
// q=2  : suppress response

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
  try { unlinkSync(tmpFile); } catch {}
}

// Kitty graphics protocol で PNG フレームを送信 (ファイル転送方式)
export function sendFrame(pngBase64) {
  // base64 → バイナリに戻してテンプファイルに書き込み
  writeFileSync(tmpFile, Buffer.from(pngBase64, 'base64'));
  // t=f: ファイル転送、ペイロードはファイルパスの base64
  process.stdout.write(`\x1b_Ga=T,t=f,f=100,q=2,C=1;${tmpPathB64}\x1b\\`);
}
