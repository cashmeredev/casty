# casty

Playwright と Kitty graphics protocol を使った TTY Web ブラウザ。

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

## 機能

- ヘッドレス Chrome によるフル Web レンダリング
- Kitty graphics protocol による画像表示
- マウス操作 (クリック、スクロール、ドラッグ)
- キーボード入力を Chrome にパススルー
- ターミナルのフォントサイズに基づく自動ズーム
- アドレスバー + 検索 (Alt+L)
- 動的リサイズ (SIGWINCH)
- キーバインド設定 (`~/.casty/keys.json`)
- ファイルダウンロード (`~/Downloads/` に保存)
- ローディングインジケーター

## 必要環境

- **Kitty graphics protocol 対応ターミナル** — kitty, Ghostty 等
- Node.js >= 18
- Playwright (Chromium は自動管理)

## インストール

```bash
git clone https://github.com/sanohiro/casty.git
cd casty
npm install
npx playwright install chromium
```

## 使い方

```bash
# URL を指定して起動
./bin/casty https://google.com

# 引数なしで Google を開く
./bin/casty
```

### キーバインド

| キー | アクション |
|------|-----------|
| Alt+L | アドレスバーを開く |
| Alt+Left | 戻る |
| Alt+Right | 進む |
| Ctrl+Q | 終了 |
| Ctrl+C | 終了 (フォールバック) |

`~/.casty/keys.json` でカスタマイズ可能。

### アドレスバー

- **Alt+L** でフォーカス — URL が全選択状態になる
- **Enter** で移動 (URL) または検索 (Google)
- **Escape** でキャンセル
- **Ctrl+A** 全選択、**Ctrl+U** 全消去、**Ctrl+W** 単語削除

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
  urlbar.js      # アドレス/検索バー
```

## 仕組み

1. Playwright 経由でヘッドレス Chrome を起動
2. CDP Screencast を開始 (スクリーンショットではなく PNG フレームストリーム)
3. Kitty graphics protocol (ファイル転送方式) でフレームをターミナルに描画
4. ターミナル入力 (raw mode) をキャプチャし、CDP 経由で Chrome に送信
5. CSI 14t でターミナルのピクセルサイズを自動検出し、ズームを計算

## ライセンス

MIT
