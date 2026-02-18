#!/usr/bin/env node
// casty - TTY web browser using Playwright and Kitty graphics protocol

import { launch, startScreencast, stopScreencast } from '../lib/browser.js';
import { sendFrame, cursorHome, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp } from '../lib/kitty.js';
import { enableMouse, disableMouse, startInputHandling } from '../lib/input.js';
import { loadKeyBindings } from '../lib/keys.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
const url = process.argv[2] || config.homeUrl;

// 基準セルサイズ (96 DPI、標準的なターミナルフォント)
// これより大きいセル → 拡大、小さいセル → 縮小
const REF_CELL_WIDTH = 8;

// セルサイズから zoom を自動計算
function calcZoom(cellWidth) {
  return cellWidth / REF_CELL_WIDTH;
}

// ターミナルのピクセルサイズを CSI 14 t で取得
function queryTermPixelSize() {
  if (!process.stdin.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw;
    const timeout = setTimeout(() => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve(null);
    }, 1000);

    process.stdin.setRawMode(true);
    process.stdin.resume();

    let buf = '';
    const onData = (data) => {
      buf += data.toString();
      const match = buf.match(/\x1b\[4;(\d+);(\d+)t/);
      if (match) {
        clearTimeout(timeout);
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(wasRaw);
        resolve({ height: parseInt(match[1]), width: parseInt(match[2]) });
      }
    };
    process.stdin.on('data', onData);

    process.stdout.write('\x1b[14t');
  });
}

// ターミナル情報を取得
async function getTermInfo() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const pixelSize = await queryTermPixelSize();
  if (pixelSize) {
    const cellWidth = pixelSize.width / cols;
    const cellHeight = pixelSize.height / rows;
    const zoom = calcZoom(cellWidth);
    return { width: pixelSize.width, height: pixelSize.height, cellWidth, cellHeight, zoom };
  }

  const cellWidth = parseInt(process.env.CASTY_CELL_WIDTH) || 10;
  const cellHeight = parseInt(process.env.CASTY_CELL_HEIGHT) || 20;
  const zoom = calcZoom(cellWidth);
  return {
    width: cols * cellWidth,
    height: rows * cellHeight,
    cellWidth, cellHeight, zoom,
  };
}

async function main() {
  const term = await getTermInfo();
  console.error(`casty: ${term.width}x${term.height} cell=${term.cellWidth.toFixed(0)}x${term.cellHeight.toFixed(0)} zoom=${term.zoom.toFixed(2)}`);

  // 1行目を URL バー用に確保、残りをブラウザ表示に使う
  const barHeight = Math.round(term.cellHeight);
  const viewHeight = term.height - barHeight;

  const { browser, page, client } = await launch(url, { ...term, height: viewHeight });
  const bindings = loadKeyBindings();

  let renderPaused = false;
  const pauseRender = (p = true) => { renderPaused = p; };

  hideCursor();
  clearScreen();
  enableMouse();

  const urlBar = startInputHandling(client, page, term.cellWidth, term.cellHeight, bindings, pauseRender);

  await startScreencast(client, {
    width: term.width,
    height: viewHeight,
    onFrame(data) {
      if (renderPaused) return;
      cursorHome();
      sendFrame(data);
      urlBar.render();
    },
  });

  async function shutdown() {
    console.error('casty: shutting down...');
    disableMouse();
    showCursor();
    clearScreen();
    cleanupTmp();
    await stopScreencast(client);
    await browser.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // SIGWINCH: リサイズ＋フォントサイズ変更に追従
  process.on('SIGWINCH', async () => {
    const t = await getTermInfo();
    const vh = t.height - Math.round(t.cellHeight);
    console.error(`casty: resize ${t.width}x${vh} zoom:${t.zoom.toFixed(2)}`);

    clearScreen();

    await stopScreencast(client);
    await page.setViewportSize({ width: t.width, height: vh });
    await page.evaluate(v => { document.documentElement.style.zoom = v; }, t.zoom.toString()).catch(() => {});

    await startScreencast(client, {
      width: t.width,
      height: vh,
      onFrame(data) {
        if (renderPaused) return;
        cursorHome();
        sendFrame(data);
        urlBar.render();
      },
    });
  });
}

main().catch((err) => {
  console.error('casty: error:', err.message);
  disableMouse();
  showCursor();
  cleanupTmp();
  process.exit(1);
});
