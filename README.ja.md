# casty

ターミナルで本物の Chrome ブラウザを動かす。

**[English](README.md)**

casty はテキストモードブラウザではありません。実際の Chrome エンジンをヘッドレスで起動し、Chrome DevTools Protocol でレンダリング結果をキャプチャし、Kitty graphics protocol でターミナルに表示します。ターミナルが Chrome のリモートビューアになります。

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## 仕組み

```
ターミナル（あなた）     casty               Chrome（ヘッドレス）
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Kitty       │ ←──  │  Screencast  │ ←──  │  完全な Web   │
│  graphics    │      │  + 高解像度   │      │  レンダリング  │
│  画面表示     │      │  キャプチャ   │      │  JS, CSS,    │
│              │ ──→  │  入力        │ ──→  │  Canvas,     │
│  マウス/KB    │      │  ブリッジ     │      │  WebGL       │
└──────────────┘      └──────────────┘      └──────────────┘
```

- **本物の Chrome エンジン** — JavaScript, CSS, Canvas, WebGL すべて動作
- **生 CDP** — Playwright/puppeteer 不使用、約1200行のコード
- **ステルスパッチ** — Google ログイン可能（ボット検出を回避）
- **高解像度フレーム** — DPR 対応キャプチャ、ぼやけない
- **マウス + キーボード** — クリック、スクロール、ドラッグ、入力、本物のブラウザと同じ操作感

## なぜ casty？

従来のターミナルブラウザ（w3m, lynx, Browsh）は HTML をパースしてテキストとして再描画します。casty は異なるアプローチを取ります：Chrome がすべてをレンダリングし、casty はピクセルをターミナルに流すだけです。

つまり：
- **すべての Web サイトが動く** — レンダリングの不具合や機能欠落がない
- **SSH フレンドリー** — ヘッドレスサーバーで SSH 越しに Web ブラウジング
- **X11/Wayland 不要** — Kitty 対応ターミナルがあれば OK
- **ワークフローを維持** — GUI ブラウザへのコンテキストスイッチ不要

## インストール

```bash
npm install -g @sanohiro/casty
casty
```

ソースから:

```bash
git clone https://github.com/sanohiro/casty.git
cd casty && npm install
./bin/casty
```

初回起動時に Chrome Headless Shell が `~/.casty/browsers/` に自動インストールされます。

### 必要環境

- **Kitty graphics protocol** 対応ターミナル (動作確認済み: **Ghostty**, **kitty**, **bcon**)
- Node.js >= 18
- `unzip`（Chrome 自動インストールに必要）

## 使い方

```bash
casty https://google.com
casty https://youtube.com
casty   # ホームページを開く
```

### キーバインド

| キー | アクション |
|------|-----------|
| Alt+L | アドレスバー |
| Alt+F | ヒントモード (Vimium 風) |
| Alt+Left / Right | 戻る / 進む |
| Alt+C | 選択テキストをコピー |
| Ctrl+V | ペースト |
| Ctrl+Q | 終了 |

`~/.casty/keys.json` でカスタマイズ可能。

### ヒントモード

**Alt+F** でクリック可能な要素にラベルを表示。ラベルを入力してクリック。ホームロウキー (`a s d f j k l`) を使用。

### アドレスバー

**Alt+L** で開く。URL または検索クエリを入力。`/b クエリ` でブックマーク検索。

### ブックマーク

`~/.casty/bookmarks.json` を作成:

```json
{
  "GitHub": "https://github.com",
  "YouTube": "https://youtube.com"
}
```

### 設定

`~/.casty/config.json`:

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| キー | 説明 | デフォルト |
|------|------|-----------|
| `homeUrl` | スタートページ | `https://github.com/sanohiro/casty` |
| `searchUrl` | 検索エンジン URL | `https://www.google.com/search?q=` |
| `transport` | 画像転送方式: `auto`, `file`, `inline` | `auto` (bcon/kitty→file、他→inline) |
| `format` | キャプチャ形式: `auto`, `png`, `jpeg` | `auto` (file→jpeg adaptive、inline→png) |
| `mouseMode` | `1002` (ボタンイベント) or `1003` (全イベント) | 自動 (Ghostty→1003、他→1002) |

<details>
<summary><strong>技術詳細</strong></summary>

1. 生 CDP WebSocket で Chrome Headless Shell を起動（`Runtime.enable` 送信不可 — Google ログインが壊れる）
2. `Page.addScriptToEvaluateOnNewDocument` でページロード前にステルスパッチを注入
3. ハイブリッドフレーム取得: 低解像度 Screencast で変更検知、`Page.captureScreenshot` で高解像度出力
4. アダプティブフォーマット: 高速更新時は JPEG、静止後に PNG で精細化（ファイル転送モード）
5. CSI 14t でターミナルピクセルサイズを検出し、自動ズーム計算
6. 起動時にプロファイルクリーンアップ（Cookie/LocalStorage 保持、キャッシュ削除）

```
bin/casty          シェルラッパー（Chrome インストール/更新）
bin/casty.js       エントリポイント（ターミナル、ズーム、リサイズ）
lib/browser.js     CDP ブラウザ制御、フレームキャプチャ
lib/cdp.js         軽量 CDP WebSocket クライアント
lib/chrome.js      Chrome 検出、起動、プロファイルクリーンアップ
lib/kitty.js       Kitty graphics protocol（file/inline）
lib/input.js       マウス/キーボード処理
lib/hints.js       Vimium 風ヒントモード
lib/urlbar.js      アドレス/検索バー
lib/config.js      ユーザー設定
lib/keys.js        キーバインド設定
lib/bookmarks.js   ブックマーク検索
```

</details>

## 比較

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| エンジン | 本物の Chrome | 本物の Firefox | 独自パーサー |
| 描画 | ピクセルパーフェクト | テキスト近似 | テキストのみ |
| JavaScript | 完全サポート | 完全サポート | なし |
| プロトコル | Kitty graphics | 文字セル | 文字セル |
| 依存関係 | Node.js + Chrome | Go + Firefox | スタンドアロン |
| Google ログイン | 動作（ステルス） | ブロックされる場合あり | 非対応 |

## ライセンス

MIT
