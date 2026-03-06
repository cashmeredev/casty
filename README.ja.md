# casty

Kitty graphics protocol を使った TTY Web ブラウザ。

**[English](README.md)**

ヘッドレス Chrome のレンダリングを Kitty 対応ターミナルに表示し、ターミナル上で完全な Web ブラウジングを実現します。

<video src="https://raw.githubusercontent.com/sanohiro/casty/main/demo.mp4" autoplay loop muted playsinline></video>

```
Chrome (Headless Shell)     casty              Terminal
┌─────────────────┐      ┌─────────────────┐  ┌─────────────────┐
│  Web レンダリング │ ───→ │  高解像度       │ ─→│  Kitty graphics │
│  JS 実行         │      │  キャプチャ     │  │  画面表示       │
│  フルブラウザ     │ ←─── │  入力ブリッジ    │ ←─│  マウス/キーボード│
└─────────────────┘      └─────────────────┘  └─────────────────┘
```

## 機能

- ヘッドレス Chrome によるフル Web レンダリング (生 CDP、Playwright 不使用)
- ボット検出回避のステルスパッチ (Google ログイン可能)
- Kitty graphics protocol による画像表示
- マウス操作 (クリック、スクロール、ドラッグ)
- キーボード入力を Chrome にパススルー
- Vimium 風ヒントモード (Alt+F) でキーボードナビゲーション
- アドレスバー + 検索 (Alt+L)
- ブックマーク (アドレスバーで `/b` 検索)
- テキスト選択コピー / クリップボードペースト
- ターミナルのフォントサイズに基づく自動ズーム
- 動的リサイズ (SIGWINCH)
- キーバインド設定 (`~/.casty/keys.json`)
- 各種設定 (`~/.casty/config.json`)
- ファイルダウンロード (`~/Downloads/` に保存)
- ローディングインジケーター
- プロファイル自動クリーンアップによる高速起動

## 必要環境

- **Kitty graphics protocol** 対応ターミナル
- Node.js >= 18
- `unzip`（Chrome Headless Shell の自動インストールに必要）

動作確認済み: **bcon**, **Ghostty**, **kitty**

## インストール

```bash
npm install -g @sanohiro/casty
casty
```

ソースからインストールする場合:

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
./bin/casty
```

初回起動時に Chrome Headless Shell が `~/.casty/browsers/` に自動インストールされます。以降の起動時にバックグラウンドで更新チェックし、常に一世代だけ保持します。

## 使い方

```bash
casty https://google.com
casty https://youtube.com
casty   # ホームページを開く (デフォルト: casty GitHub ページ)
```

### キーバインド

| キー | アクション |
|------|-----------|
| Alt+L | アドレスバーを開く |
| Alt+F | ヒントモード (Vimium 風リンク/ボタン選択) |
| Alt+Left | 戻る |
| Alt+Right | 進む |
| Alt+C | 選択テキストをコピー |
| Ctrl+V | クリップボードからペースト |
| Ctrl+Q | 終了 |
| Ctrl+C | 終了 (フォールバック) |

`~/.casty/keys.json` でカスタマイズ可能 (ファイルは自動生成されません):

```json
{
  "ctrl+q": "quit",
  "alt+left": "back",
  "alt+right": "forward",
  "alt+l": "url_bar",
  "alt+f": "hints",
  "alt+c": "copy",
  "ctrl+v": "paste"
}
```

### アドレスバー

- **Alt+L** または1行目クリックでフォーカス — URL が全選択状態になる
- **Enter** で移動 (URL) または検索 (Google)
- **`/b クエリ`** でブックマーク検索
- **Escape** でキャンセル
- **Ctrl+A** 全選択、**Ctrl+U** 全消去、**Ctrl+W** 単語削除

### ヒントモード

**Alt+F** でクリック可能/フォーカス可能な要素にラベルを表示。ラベルの文字を入力するとリンク/ボタンのクリックや入力欄へのフォーカスができます。**Escape** でキャンセル。

ラベルはホームロウキー (`a`, `s`, `d`, `f`, `j`, `k`, `l`) を使用 — 7個以下なら1文字、それ以上は2文字 (最大49個)。

### ブックマーク

`~/.casty/bookmarks.json` を手動で作成:

```json
{
  "GitHub": "https://github.com",
  "Google": "https://google.com",
  "YouTube": "https://youtube.com"
}
```

アドレスバーで `/b クエリ` と入力して検索 (名前・URL の部分一致、大文字小文字無視)。

### 設定

`~/.casty/config.json` でカスタマイズ可能 (ファイルは自動生成されません):

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
| `homeUrl` | URL 未指定時に開くページ | `https://github.com/sanohiro/casty` |
| `searchUrl` | 検索エンジン URL (クエリが末尾に付加される) | `https://www.google.com/search?q=` |
| `transport` | Kitty 画像転送方式: `auto`, `file`, `inline` | `auto` (bcon/kitty→file、他→inline) |
| `format` | スクリーンショット形式: `auto`, `png`, `jpeg` | `auto` (file→jpeg、inline→png) |
| `mouseMode` | マウストラッキングモード: `1002` (ボタンイベント) or `1003` (全イベント) | 自動 (Ghostty→1003、他→1002) |

## アーキテクチャ

```
bin/
  casty          # シェルラッパー (Chrome インストール/更新)
  casty.js       # エントリポイント (ターミナル検出、ズーム、リサイズ)
lib/
  browser.js     # CDP ブラウザ制御 (起動、Screencast、キャプチャ)
  cdp.js         # 軽量 CDP WebSocket クライアント
  chrome.js      # Chrome バイナリ検出、起動、プロファイルクリーンアップ
  kitty.js       # Kitty graphics protocol 出力 (file/inline)
  input.js       # マウス/キーボード処理、アクション
  hints.js       # Vimium 風ヒントモード
  urlbar.js      # アドレス/検索バー
  bookmarks.js   # ブックマーク検索
  keys.js        # キーバインド設定
  config.js      # ユーザー設定
```

## 仕組み

1. 生 CDP で Chrome Headless Shell を起動 (Playwright 不使用、`Runtime.enable` も送信しない)
2. ページロード前にステルスパッチを注入してボット検出を回避
3. ハイブリッドフレーム取得: 低解像度 Screencast を変更検知トリガーとして使い、`Page.captureScreenshot` で高解像度フレームを取得
4. Kitty graphics protocol でフレームをターミナルに描画
5. ターミナル入力 (raw mode) をキャプチャし、CDP 経由で Chrome に送信
6. CSI 14t でターミナルのピクセルサイズを自動検出し、ズームを計算
7. 起動時にプロファイルをクリーンアップ (Cookie/LocalStorage を保持、キャッシュ類を削除) して高速起動を維持

## ライセンス

MIT
