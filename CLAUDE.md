# casty

TTY web browser using Playwright and Kitty graphics protocol.

**リモートデスクトップのような仕組みで、TTY 上で完全な Web ブラウジングを実現する。**

## Requirements

- **Kitty graphics protocol 必須** - bcon, kitty 等の対応ターミナルが必要
- Node.js >= 18
- Playwright (Chromium を管理)

## Concept

Remote desktop-like architecture for web browsing on TTY:

```
Chrome (Headless)          casty              bcon/kitty
┌─────────────────┐      ┌─────────────────┐  ┌─────────────────┐
│  Web rendering  │ ───→ │  Screencast     │ ─→│  Kitty graphics │
│  JS execution   │      │  JPEG frames    │  │  display        │
│  WebRTC/Audio   │ ←─── │  Input events   │ ←─│  Mouse/Keyboard │
└─────────────────┘      └─────────────────┘  └─────────────────┘
```

**ポイント:**
- Chrome がレンダリング/JS実行/WebRTC を全部やる
- casty は「画面転送 + 入力転送」のブリッジだけ
- 実質 100-200 行程度のコードで実現可能

## Core Features

### 1. 自動アップデート

起動時に安全に自動更新:

```bash
#!/bin/bash
# bin/casty (シェルラッパー)
CASTY_DIR="$HOME/.casty"

# 更新チェック (バックグラウンド or 起動時)
cd "$CASTY_DIR"
npm update --silent 2>/dev/null
npx playwright install chromium --silent 2>/dev/null

# 本体起動
node "$CASTY_DIR/lib/main.js" "$@"
```

- npm update で casty 本体を更新
- playwright install で Chromium を更新
- オフラインでも動作 (エラー無視)

### 2. コマンド起動

```bash
casty https://google.com
casty https://youtube.com
casty https://meet.google.com
```

シェルスクリプトをエントリポイントにして ~/.local/bin/ に配置。

### 3. Cookie/Storage 永続化 (ログイン維持)

Playwright の persistent context を使用:

```javascript
import { chromium } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';

const profileDir = join(homedir(), '.casty', 'profile');

const browser = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    '--auto-accept-camera-and-microphone-capture',
  ]
});
```

サポート:
- Cookie ✅
- localStorage ✅
- sessionStorage ✅
- IndexedDB ✅
- Service Workers ✅
- ログイン状態維持 ✅

### 4. Kitty Graphics Protocol

JPEG フレームを直接送信:

```javascript
function sendFrame(jpegBase64) {
  // a=T: transmit and display
  // f=100: JPEG format
  // q=2: suppress response
  // C=1: cursor movement (画面クリア不要)
  process.stdout.write(`\x1b_Ga=T,f=100,q=2,C=1;${jpegBase64}\x1b\\`);
}
```

### 5. ダイナミックリサイズ (tmux 対応)

tmux でペインサイズが変わっても追従:

```javascript
import { stdout } from 'process';

// ターミナルサイズ取得
function getTermSize() {
  return {
    cols: stdout.columns,
    rows: stdout.rows
  };
}

// セルのピクセルサイズ取得 (CSI 14 t)
async function getCellPixelSize() {
  // ターミナルに問い合わせ
  // ESC [ 14 t → ESC [ 4 ; height ; width t
  // または環境変数から取得
  return {
    cellWidth: parseInt(process.env.CASTY_CELL_WIDTH) || 10,
    cellHeight: parseInt(process.env.CASTY_CELL_HEIGHT) || 20
  };
}

// SIGWINCH (サイズ変更シグナル) を監視
process.on('SIGWINCH', async () => {
  const { cols, rows } = getTermSize();
  const { cellWidth, cellHeight } = await getCellPixelSize();

  // ピクセルサイズに変換
  const pixelWidth = cols * cellWidth;
  const pixelHeight = rows * cellHeight;

  // Chrome のビューポート更新
  await page.setViewport({
    width: pixelWidth,
    height: pixelHeight
  });

  // Screencast は自動で新サイズに追従
});
```

## Architecture

### Files

```
~/.casty/                    # インストール先
├── bin/
│   └── casty               # シェルラッパー (エントリポイント)
├── lib/
│   ├── main.js             # メインロジック
│   ├── browser.js          # Playwright/CDP 制御
│   ├── kitty.js            # Kitty graphics 出力
│   └── input.js            # 入力イベント処理
├── profile/                 # ブラウザプロファイル (Cookie等)
├── package.json
└── node_modules/

~/.local/bin/casty          # シンボリックリンク
```

### Screencast (not Screenshot)

CDP の Page.startScreencast を使用:
- 差分ベースで高速 (16-50ms)
- JPEG 品質調整可能
- 30fps 目標

```javascript
const client = await page.context().newCDPSession(page);

await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: 1280,
  maxHeight: 720,
});

client.on('Page.screencastFrame', async ({ data, sessionId }) => {
  sendFrame(data);  // Kitty protocol で出力
  await client.send('Page.screencastFrameAck', { sessionId });
});
```

### Input Handling

```javascript
// stdin から入力を受け取る
process.stdin.setRawMode(true);
process.stdin.on('data', async (buf) => {
  // キー入力 → Chrome に送信
  // マウス入力 → 座標変換して Chrome に送信
});
```

## Implementation Priority

1. **Phase 1: 最小動作版**
   - [ ] URL を引数で受け取って表示
   - [ ] Screencast → Kitty 出力
   - [ ] Ctrl+C で終了

2. **Phase 2: インタラクション**
   - [ ] キーボード入力転送
   - [ ] マウスクリック
   - [ ] スクロール

3. **Phase 3: 実用機能**
   - [ ] Cookie/Storage 永続化
   - [ ] ダイナミックリサイズ
   - [ ] 自動アップデート

4. **Phase 4: 高度な機能**
   - [ ] テキスト選択/コピー
   - [ ] 動画再生最適化
   - [ ] ビデオ会議対応

## Installation (Planned)

```bash
# インストール
curl -fsSL https://example.com/casty/install.sh | bash

# または手動
git clone https://github.com/user/casty ~/.casty
cd ~/.casty && npm install
npx playwright install chromium
ln -s ~/.casty/bin/casty ~/.local/bin/casty
```

## Usage

```bash
# 基本
casty https://google.com

# オプション (予定)
casty --quality 60 https://youtube.com    # 低品質モード
casty --size 960x540 https://example.com  # 解像度指定
```

## Technical Notes

### なぜ Screenshot じゃなく Screencast か

| 方式 | レイテンシ | 備考 |
|------|-----------|------|
| page.screenshot() | 100-300ms | 毎回フル取得 |
| **Screencast** | 16-50ms | 差分ベース、ストリーム |

### Kitty vs Sixel

| | Kitty | Sixel |
|--|-------|-------|
| 形式 | PNG/JPEG 直送 | 独自形式に変換必要 |
| 速度 | 速い | 遅い |
| 対応 | bcon, kitty | 多くのターミナル |

casty は Kitty 専用。Sixel は対象外。

### 音声/カメラ (Zoom/Meet 等)

Chrome が PulseAudio 経由で処理:
- 音声出力 → PulseAudio → スピーカー
- 音声入力 ← PulseAudio ← マイク
- カメラ ← V4L2 ← /dev/video0

casty 側で特別な処理は不要。Chrome 任せ。
