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

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

// Per-frame temp file.  Prefer /dev/shm (tmpfs/RAM) so kitty re-reads each
// frame at memory speed -- /tmp may be disk-backed (zfs/ext4), which adds a
// per-frame round-trip and visibly stutters the stream.  This mirrors mpv's
// shared-memory transport.
const frameDir = existsSync('/dev/shm') ? '/dev/shm' : tmpdir();
const tmpFile = join(frameDir, `casty-frame-${process.pid}.png`);
const tmpPathB64 = Buffer.from(tmpFile).toString('base64');

// Display size in cells (set by caller, used for c=/r= parameters)
let _cols = 0;
let _rows = 0;

// Placement: terminal cell the frame is anchored to, and the kitty image id.
// Defaults reproduce the interactive full-screen behaviour (row 2 = below the
// URL bar, column 1, image id 1).  Embed mode overrides these via setPlacement
// so the frame can be drawn inside an arbitrary sub-rectangle (e.g. an Emacs
// window) with an id allocated by the host to avoid collisions.  Like mpv's
// kitty VO, frames are replaced in place under a single id (a=T) -- no double
// buffering needed for flicker-free updates once the format is decodable.
let _top = 2;
let _left = 1;
let _imageId = 1;

// Set display size (cols = terminal columns, rows = display rows excluding URL bar)
export function setDisplaySize(cols, rows) {
  _cols = cols;
  _rows = rows;
}

// Set frame placement.  Pass null/undefined for any field to leave it unchanged.
export function setPlacement(top, left, imageId) {
  if (top != null) _top = top;
  if (left != null) _left = left;
  if (imageId != null) _imageId = imageId;
}

// Cursor-position escape for the current placement (line _top, column _left).
function placement() {
  return `\x1b[${_top};${_left}H`;
}

// Detect transfer mode
function detectTransport() {
  // Embed mode (driven by a host like kitty-graphics.el over a pty) always
  // uses file transfer: it sends only a temp-file path per frame (~100 bytes)
  // instead of multi-KB base64, keeping the pty filter cheap.
  if (process.argv.includes('--embed')) return 'file';

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

// Move the cursor to the frame's top-left placement cell.
export function cursorHome() {
  process.stdout.write(placement());
}

// tmux only forwards kitty graphics if they are wrapped in a DCS passthrough
// envelope. Regular cursor/control sequences must stay outside that wrapper.
function wrapKitty(seq) {
  if (!process.env.TMUX) return seq;
  return `\x1bPtmux;${seq.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`;
}

// Clear screen (also delete all Kitty images)
export function clearScreen() {
  process.stdout.write(`${wrapKitty('\x1b_Ga=d,d=A,q=2;\x1b\\')}\x1b[2J\x1b[H`);
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
let _dedupDisabled = false;
let _dedupTimer = null;

// Temporarily disable dedup (e.g. after resize, bcon needs re-send)
export function disableDedup(ms = 3000) {
  _dedupDisabled = true;
  clearTimeout(_dedupTimer);
  _dedupTimer = setTimeout(() => { _dedupDisabled = false; }, ms);
}

// File transfer mode (fast: sends only path)
// Prepends cursor-home to batch into a single write
function sendFrameFile(base64Data) {
  if (!_dedupDisabled && base64Data.length === lastFrameData.length && base64Data === lastFrameData) {
    return;
  }
  lastFrameData = base64Data;
  writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
  const crFile = _cols && _rows ? `,c=${_cols},r=${_rows}` : '';
  const seq = `\x1b_Ga=T,f=100,t=f,q=2,C=1,i=${_imageId}${crFile};${tmpPathB64}\x1b\\`;
  process.stdout.write(`${placement()}${wrapKitty(seq)}`);
}

// Inline mode (4096B chunked, PNG only)
// Prepends cursor-home and batches all chunks into a single stdout.write
function sendFrameInline(pngBase64) {
  if (!_dedupDisabled && pngBase64.length === lastFrameData.length && pngBase64 === lastFrameData) {
    return;
  }
  lastFrameData = pngBase64;
  const CHUNK = 4096;
  const crInline = _cols && _rows ? `,c=${_cols},r=${_rows}` : '';
  if (pngBase64.length <= CHUNK) {
    const seq = `\x1b_Ga=T,f=100,q=2,C=1,i=${_imageId}${crInline};${pngBase64}\x1b\\`;
    process.stdout.write(`${placement()}${wrapKitty(seq)}`);
    return;
  }
  const parts = [];
  let i = 0;
  while (i < pngBase64.length) {
    const chunk = pngBase64.slice(i, i + CHUNK);
    const more = i + CHUNK < pngBase64.length ? 1 : 0;
    if (i === 0) {
      parts.push(`\x1b_Ga=T,f=100,q=2,C=1,i=${_imageId}${crInline},m=${more};${chunk}\x1b\\`);
    } else {
      parts.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    i += CHUNK;
  }
  process.stdout.write(`${placement()}${wrapKitty(parts.join(''))}`);
}

// Reset dedup state (e.g. after resize)
export function resetFrameCache() {
  lastFrameData = '';
}

export const sendFrame = transport === 'file' ? sendFrameFile : sendFrameInline;
