// Playwright / CDP によるブラウザ制御
import { chromium } from 'playwright';

// ブラウザ起動
// width/height: ターミナルのピクセルサイズ (= Screencast 出力サイズ)
// zoom: CSS zoom で拡大 (Screencast サイズには影響しない)
export async function launch(url, { width, height, zoom = 1 } = {}) {
  const browser = await chromium.launch({ headless: true });

  // viewport = ターミナルのフルピクセルサイズ (Screencast がこのサイズで出力)
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();

  // CSS zoom: ページ遷移のたびに適用
  if (zoom !== 1) {
    const z = zoom.toString();
    page.on('domcontentloaded', () => {
      page.evaluate(v => { document.documentElement.style.zoom = v; }, z).catch(() => {});
    });
  }

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (zoom !== 1) {
    await page.evaluate(v => { document.documentElement.style.zoom = v; }, zoom.toString());
  }

  const client = await page.context().newCDPSession(page);

  return { browser, context, page, client };
}

// Screencast 開始
export async function startScreencast(client, { width, height, onFrame }) {
  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    onFrame(data);
    await client.send('Page.screencastFrameAck', { sessionId });
  });

  await client.send('Page.startScreencast', {
    format: 'png',
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  });
}

// Screencast 停止
export async function stopScreencast(client) {
  try {
    await client.send('Page.stopScreencast');
  } catch {
    // 既に閉じている場合は無視
  }
}
