# 技術構成と開発ガイド

[紹介へ戻る](../README.md) · [セットアップ](SETUP.md) · [使い方](USAGE.md)

## 技術構成

| 役割 | 技術 |
| --- | --- |
| Chrome拡張 | Manifest V3・Chrome拡張API |
| 言語 | TypeScript（strict） |
| UI | DOM・CSS・Shadow DOM・Canvas |
| 依存関係・スクリプト・テスト | Bun |
| ビルド | Vite |
| フォーマット・静的チェック | Biome |
| 下書き | Chromeローカルストレージ |
| 日本語音声入力 | ブラウザーのSpeechRecognition API |

依存関係は [package.json](../package.json) と `bun.lock` で管理します。Bun 1.4.2で開発・ビルドを確認しています。

## 実装の流れ

拡張アイコンのクリックでバックグラウンドが `content.js` を対象ページへ挿入します。要素の選択・コメント・画像編集のUIはShadow DOM内で表示し、ページのスタイルから分離します。選択した要素とコメントからプロンプトを作成し、クリップボードへコピーします。画像とHTMLは個別に保存できます。

音声入力はページ内でブラウザー標準の認識APIを使用し、確定した結果を対応するコメントへ追加します。別タブ・別ウィンドウは開きません。

## コード構成

| ファイル | 担当 |
| --- | --- |
| [src/content.ts](../src/content.ts) | 要素選択・その場のコメント・一覧・画像編集・保存 |
| [src/comment-position.ts](../src/comment-position.ts) | 枠の上下と画面端に応じたコメント欄の配置 |
| [src/background.ts](../src/background.ts) | 拡張の起動・撮影API |
| [src/capture.ts](../src/capture.ts) | 表示範囲・ページ全体・対象要素の撮影 |
| [src/editing.ts](../src/editing.ts) | 日本語IMEとコメント同期 |
| [src/speech.ts](../src/speech.ts) | 日本語音声認識・暫定結果・停止・キャンセル |
| [src/prompt.ts](../src/prompt.ts)・[src/types.ts](../src/types.ts) | プロンプト生成・共有する型 |
| [src/ui.ts](../src/ui.ts)・[src/ui.css](../src/ui.css)・[src/icons.ts](../src/icons.ts) | 画面・スタイル・アイコン |
| [public/](../public/) | manifest・アイコン・プライバシーポリシー |
| [scripts/](../scripts/) | ビルドと配布ZIPの作成 |
| [tests/](../tests/) | 入力・同期・配置・撮影・プロンプト・音声セッションのテスト |

## 開発コマンド

プロジェクトのルートで実行します。

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun test
bun run build
```

| コマンド | 用途 |
| --- | --- |
| `bun run dev` | 変更を監視して再ビルド |
| `bun run format` | ソースのフォーマット |
| `bun run package` | ビルド後、配布用ZIPを作成 |

修正するのは `src/` と `public/` のファイルです。実行用JavaScriptは `dist/` へ生成します。既存の読み込み設定でも使えるよう、プロジェクト直下の実行ファイルもビルド時に更新します。反映には拡張機能と対象ページの再読み込みが必要です。

## 音声認識の実装と確認

`SpeechRecognition` または `webkitSpeechRecognition` を使用し、`ja-JP`・連続認識・暫定結果の表示を指定します。確定結果の重複追加を防ぎ、キャンセル後の結果を無視します。音声はブラウザーの認識サービスへ送信される場合があります。

Bunテストでは、日本語IME・コメント同期・配置・撮影計算・プロンプト・音声認識イベントを確認しています。音声認識の自動テストには模擬イベントを使用します。実際のブラウザー認識サービスと実マイクの精度は環境に依存するため、普段使うChromeでも確認してください。

## 配布

```sh
bun run package
```

`artifacts/UI-Feedback-Capture-store.zip` に、`manifest.json` を直下へ配置したChrome Web Store用ZIPを作成します。推論モデルやWASMは同梱しません。

ストアへの掲載・審査提出には、開発者アカウント、公開プライバシーポリシーのURL、サポート連絡先、掲載素材の設定が別途必要です。ストアへの公開はまだ行っていません。

