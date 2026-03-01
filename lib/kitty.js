// Kitty graphics protocol output
//
// Protocol parameters:
//   a=T  : transmit and display
//   a=d  : delete image(s)
//   f=100: PNG format
//   t=f  : file transfer (send file path as base64)
//   t=d  : inline transfer (send image data as base64)
//   q=2  : suppress response (no OK/ERR from terminal)
//   C=1  : no cursor movement (keep cursor position after display)
//   i=N  : image ID (replace existing image with same ID)
//   m=0/1: chunk continuation (1=more chunks follow, 0=final chunk)
//   d=A  : delete all images (used with a=d)
//
// Two transfer modes:
//   File transfer (t=f): fast, sends only the path (bcon, etc.)
//   Inline (t=d): sends base64 data directly in 4096B chunks (Ghostty, kitty)
//
// ~/.casty/config.json transport setting:
//   "auto"   → file transfer for bcon, inline for others
//   "file"   → force file transfer
//   "inline" → force inline

import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

const tmpFile = join(tmpdir(), `casty-frame-${process.pid}.png`);
const tmpPathB64 = Buffer.from(tmpFile).toString('base64');

// Detect transfer mode
function detectTransport() {
  const config = loadConfig();
  const setting = config.transport || 'auto';

  if (setting === 'file') return 'file';
  if (setting === 'inline') return 'inline';

  // auto: file transfer (t=f) for terminals that support it
  const termProg = process.env.TERM_PROGRAM || '';
  if (/bcon/i.test(termProg)) return 'file';
  if (/kitty/i.test(termProg)) return 'file';
  return 'inline';
}

export const transport = detectTransport();

// Cursor to line 2 (line 1 is reserved for URL bar)
const CURSOR_HOME = '\x1b[2;1H';
export function cursorHome() {
  process.stdout.write(CURSOR_HOME);
}

// Clear screen (also delete all Kitty images)
export function clearScreen() {
  process.stdout.write('\x1b_Ga=d,d=A,q=2;\x1b\\\x1b[2J\x1b[H');
}

// Hide cursor
export function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

// Show cursor
export function showCursor() {
  process.stdout.write('\x1b[?25h');
}

// Clean up temp file
export function cleanup() {
  try { unlinkSync(tmpFile); } catch {}
}

// Frame deduplication — skip identical consecutive frames
let lastFrameData = '';

// File transfer mode (fast: sends only path)
// Prepends cursor-home to batch into a single write
function sendFrameFile(base64Data) {
  if (base64Data.length === lastFrameData.length && base64Data === lastFrameData) return;
  lastFrameData = base64Data;
  writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
  process.stdout.write(`${CURSOR_HOME}\x1b_Ga=T,f=100,t=f,q=2,C=1,i=1;${tmpPathB64}\x1b\\`);
}

// Inline mode (4096B chunked, PNG only)
// Prepends cursor-home and batches all chunks into a single stdout.write
function sendFrameInline(pngBase64) {
  if (pngBase64.length === lastFrameData.length && pngBase64 === lastFrameData) return;
  lastFrameData = pngBase64;
  const CHUNK = 4096;
  if (pngBase64.length <= CHUNK) {
    process.stdout.write(`${CURSOR_HOME}\x1b_Ga=T,f=100,q=2,C=1,i=1;${pngBase64}\x1b\\`);
    return;
  }
  const parts = [CURSOR_HOME];
  let i = 0;
  while (i < pngBase64.length) {
    const chunk = pngBase64.slice(i, i + CHUNK);
    const more = i + CHUNK < pngBase64.length ? 1 : 0;
    if (i === 0) {
      parts.push(`\x1b_Ga=T,f=100,q=2,C=1,i=1,m=${more};${chunk}\x1b\\`);
    } else {
      parts.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    i += CHUNK;
  }
  process.stdout.write(parts.join(''));
}

// Reset dedup state (e.g. after resize)
export function resetFrameCache() {
  lastFrameData = '';
}

export const sendFrame = transport === 'file' ? sendFrameFile : sendFrameInline;
