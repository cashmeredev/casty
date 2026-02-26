#!/usr/bin/env node
// casty - TTY web browser using raw CDP and Kitty graphics protocol

import { startBrowser, setupPage, startScreencast, stopScreencast } from '../lib/browser.js';
import { sendFrame, cursorHome, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp, transport } from '../lib/kitty.js';
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
    return { cols, rows, width: pixelSize.width, height: pixelSize.height, cellWidth, cellHeight, zoom };
  }

  const cellWidth = parseInt(process.env.CASTY_CELL_WIDTH) || 10;
  const cellHeight = parseInt(process.env.CASTY_CELL_HEIGHT) || 20;
  const zoom = calcZoom(cellWidth);
  return {
    cols, rows,
    width: cols * cellWidth,
    height: rows * cellHeight,
    cellWidth, cellHeight, zoom,
  };
}

async function main() {
  // Phase 1: Chrome 起動とターミナル情報取得を並列実行
  // getTermInfo() は必ず完了させる (CSI 14t 応答の漏れ防止)
  const browserP = startBrowser();
  const term = await getTermInfo();
  const browser = await browserP;

  // 1行目を URL バー用に確保、残りをブラウザ表示に使う
  const barHeight = Math.round(term.cellHeight);
  const viewHeight = term.height - barHeight;

  // Phase 2: CDP 接続 + ページセットアップ (about:blank のまま)
  const { client, cssWidth, cssHeight } = await setupPage(browser, { ...term, height: viewHeight });
  const chromeProcess = browser.proc;

  const bindings = loadKeyBindings();

  let renderPaused = false;
  const pauseRender = (p = true) => { renderPaused = p; };

  hideCursor();
  clearScreen();
  enableMouse();

  // マウス座標は CSS ピクセルで送信 (cellWidth/zoom, cellHeight/zoom)
  const cssCellW = term.cellWidth / term.zoom;
  const cssCellH = term.cellHeight / term.zoom;
  // format: auto → 常に PNG (Kitty protocol で最も互換性が高い)
  // jpeg はファイル転送で使えるが対応ターミナルが限定的
  const fmt = config.format || 'auto';
  const screenshotFormat = fmt === 'auto' ? 'png' : fmt;

  console.error(`casty: ${term.width}x${term.height} cell=${term.cellWidth.toFixed(0)}x${term.cellHeight.toFixed(0)} zoom=${term.zoom.toFixed(2)} transport=${transport} format=${screenshotFormat}`);

  // Phase 3: Screencast 開始 (about:blank 上で先に起動)
  let { forceCapture } = await startScreencast(client, {
    width: cssWidth,
    height: cssHeight,
    format: screenshotFormat,
    onFrame(data) {
      if (renderPaused) return;
      cursorHome();
      sendFrame(data);
      urlBar.render();
    },
  });

  const urlBar = startInputHandling(client, cssCellW, cssCellH, bindings, pauseRender, forceCapture);
  urlBar.render();

  // ページ読み込みイベントで強制キャプチャ
  // 遅延キャプチャも追加: ページ描画完了後に確実にフレームを取得
  function delayedCapture() {
    forceCapture();
    setTimeout(() => forceCapture(), 300);
    setTimeout(() => forceCapture(), 1000);
  }
  client.on('Page.domContentEventFired', delayedCapture);
  client.on('Page.loadEventFired', delayedCapture);
  client.on('Page.frameNavigated', delayedCapture);

  // Phase 4: ナビゲーション
  client.send('Page.navigate', { url });

  async function shutdown() {
    console.error('casty: shutting down...');
    renderPaused = true;           // まず描画を止める
    try {
      await stopScreencast(client);  // screencast 停止 (pending capture も無効化)
      await client.send('Browser.close').catch(() => {});
    } catch {}
    client.close();
    chromeProcess.kill();
    disableMouse();
    showCursor();
    clearScreen();                 // 全停止後にクリア → 再描画される心配なし
    cleanupTmp();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // SIGWINCH: リサイズ＋フォントサイズ変更に追従
  process.on('SIGWINCH', async () => {
    const t = await getTermInfo();
    const vh = t.height - Math.round(t.cellHeight);
    const cw = Math.round(t.width / t.zoom);
    const ch = Math.round(vh / t.zoom);
    console.error(`casty: resize ${cw}x${ch} (dev:${t.width}x${vh}) zoom:${t.zoom.toFixed(2)}`);

    clearScreen();

    await stopScreencast(client);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: cw, height: ch, deviceScaleFactor: t.zoom, mobile: false,
    });

    ({ forceCapture } = await startScreencast(client, {
      width: cw,
      height: ch,
      format: screenshotFormat,
      onFrame(data) {
        if (renderPaused) return;
        cursorHome();
        sendFrame(data);
        urlBar.render();
      },
    }));
  });
}

main().catch((err) => {
  // stdin を raw mode から復帰 (CSI 14t 応答の漏れを防止)
  try { process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
  console.error('casty: error:', err.message);
  disableMouse();
  showCursor();
  cleanupTmp();
  process.exit(1);
});
