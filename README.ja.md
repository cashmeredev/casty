# casty

Kitty graphics protocol を使った TTY Web ブラウザ。

**[English](README.md)**

ヘッドレス Chrome の Screencast を Kitty 対応ターミナルに表示し、ターミナル上で完全な Web ブラウジングを実現します。

```
Chrome (Headless)          casty              Terminal
┌─────────────────┐      ┌─────────────────┐  ┌─────────────────┐
│  Web レンダリング │ ───→ │  Screencast     │ ─→│  Kitty graphics │
│  JS 実行         │      │  PNG フレーム    │  │  画面表示       │
│  フルブラウザ     │ ←─── │  入力ブリッジ    │ ←─│  マウス/キーボード│
└─────────────────┘      └─────────────────┘  └─────────────────┘
```

> **アルファ版:** 現在 Playwright で Chrome を制御していますが、Playwright の自動操作フラグにより多くのサイトでボット検出が作動し、Google アカウントのログインもブロックされます。これらの制限を解消するため、Playwright を廃止し生の CDP (Chrome DevTools Protocol) で直接制御する大幅な書き直しを予定しています。

## 機能

- ヘッドレス Chrome によるフル Web レンダリング
- Kitty graphics protocol による画像表示
- マウス操作 (クリック、スクロール、ドラッグ)
- キーボード入力を Chrome にパススルー
- ターミナルのフォントサイズに基づく自動ズーム
- アドレスバー + 検索 (Alt+L)
- 動的リサイズ (SIGWINCH)
- キーバインド設定 (`~/.casty/keys.json`)
- ホームページ・検索エンジン設定 (`~/.casty/config.json`)
- ファイルダウンロード (`~/Downloads/` に保存)
- ローディングインジケーター

## 必要環境

- **Kitty graphics protocol 対応ターミナル** — kitty, Ghostty 等
- Node.js >= 18

## インストール

> **注意:** `npm install -g casty` はまだ利用できません。現在はソースからのインストールのみです。npm 公開は将来のリリースで予定しています。

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
./bin/casty
```

初回起動時に Chromium (headless shell) が `~/.casty/browsers/` に自動インストールされます。以降の起動時にバックグラウンドで更新チェックし、常に一世代だけ保持します。

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
| Alt+Left | 戻る |
| Alt+Right | 進む |
| Ctrl+Q | 終了 |
| Ctrl+C | 終了 (フォールバック) |

`~/.casty/keys.json` でカスタマイズ可能 (ファイルは自動生成されません):

```json
{
  "ctrl+q": "quit",
  "alt+left": "back",
  "alt+right": "forward",
  "alt+l": "url_bar"
}
```

### アドレスバー

- **Alt+L** または1行目クリックでフォーカス — URL が全選択状態になる
- **Enter** で移動 (URL) または検索 (Brave Search)
- **Escape** でキャンセル
- **Ctrl+A** 全選択、**Ctrl+U** 全消去、**Ctrl+W** 単語削除

### 設定

`~/.casty/config.json` でカスタマイズ可能 (ファイルは自動生成されません):

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://search.brave.com/search?q="
}
```

| キー | 説明 | デフォルト |
|------|------|-----------|
| `homeUrl` | URL 未指定時に開くページ | `https://github.com/sanohiro/casty` |
| `searchUrl` | 検索エンジン URL (クエリが末尾に付加される) | `https://search.brave.com/search?q=` |

## アーキテクチャ

```
bin/
  casty          # シェルラッパー
  casty.js       # エントリポイント (ターミナル検出、ズーム、リサイズ)
lib/
  browser.js     # Playwright/CDP 制御 (起動、Screencast)
  kitty.js       # Kitty graphics protocol 出力
  input.js       # マウス/キーボード処理、アクション
  keys.js        # キーバインド設定
  config.js      # ユーザー設定
  urlbar.js      # アドレス/検索バー
```

## 仕組み

1. Playwright 経由でヘッドレス Chrome を起動
2. CDP Screencast を開始 (スクリーンショットではなく PNG フレームストリーム)
3. Kitty graphics protocol でフレームをターミナルに描画 (ローカルはファイル転送、SSH 時はインライン方式を自動選択)
4. ターミナル入力 (raw mode) をキャプチャし、CDP 経由で Chrome に送信
5. CSI 14t でターミナルのピクセルサイズを自動検出し、ズームを計算

## ライセンス

MIT
