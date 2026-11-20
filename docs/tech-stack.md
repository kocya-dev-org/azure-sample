# 技術スタック

パッケージの具体的なバージョン番号はここに書きません。実装時に最新の安定版を採用し、`package-lock.json` で固定します。

| 領域                   | 採用技術                                                     | 選定理由                                                                             |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ランタイム（開発・CI） | Node.js 24                                                   | 開発・CI ビルドを統一する。`.node-version` で固定する                                |
| API 実行ランタイム     | Node.js 24（未確認。非対応なら 22）                          | 下記参照                                                                             |
| API                    | Azure Functions v4 / TypeScript                              | SWA マネージド Functions で使える。HTTP トリガーのみ                                 |
| フロントエンド         | React                                                        | 画面を部品化して後続の画面移植を進めやすい                                           |
| UI 部品                | shadcn/ui（Radix）                                           | アクセシブルな部品のソースをリポジトリで管理し、自由に編集できる                     |
| スタイル               | Tailwind CSS v4                                              | テーマトークン（CSS 変数）でライト・ダークを切り替えられる                           |
| アイコン・通知・グラフ | lucide-react / sonner / Recharts                             | shadcn/ui の標準構成に合わせる                                                       |
| ビルド                 | Vite                                                         | 高速な dev server と `/api` プロキシ。静的成果物を出力できる                         |
| 言語                   | TypeScript                                                   | フロントエンドと API で型を扱う                                                      |
| lint                   | oxlint                                                       | 高速で、ESLint を導入しなくて済む                                                    |
| format                 | oxfmt                                                        | 高速で、Prettier を導入しなくて済む                                                  |
| テスト                 | vitest                                                       | Vite と相性がよく、frontend(jsdom) / api(node) を `projects` で一元管理できる        |
| パッケージ管理         | npm workspaces                                               | ルートに lockfile を一本化し、コマンドを一元管理する                                 |
| 音声入力               | MediaRecorder（ブラウザー標準）+ Foundry `gpt-4o-transcribe` | ライブラリを追加せずに録音でき、文字起こしは既存の `openai` SDK で呼べる（ADR 0011） |

ESLint と Prettier は導入しません。UI の部品とスタイルの選定は [ADR 0009](../plan/decisions/0009-shadcn-ui.md) を参照してください。

## Node.js 24 とマネージド Functions

Microsoft Learn の SWA ドキュメントでは、マネージド Functions の Node.js は 18 / 20 / 22 のみ記載されています。`apiRuntime: "node:24"` の対応は未確認です。

- ビルドは CI の Node.js 24 で行い、ビルド済み成果物をアップロードします。
- PR プレビュー環境で `node:24` を実際にデプロイして可否を判定します。
- 非対応の場合、API の実行ランタイムのみ `node:22` とし、API コードは Node 22 互換を維持します。`@types/node` は実行ランタイムに合わせます。

詳細と判定結果は [ADR 0001](../plan/decisions/0001-node24-on-managed-functions.md)、ツールチェーンの選定は [ADR 0002](../plan/decisions/0002-toolchain.md) を参照してください。

## バージョン方針

- ランタイムのバージョンは `.node-version`、各 `package.json` の `engines`、`staticwebapp.config.json` の `apiRuntime`、ワークフローの `setup-node` で一致させます。API が `node:22` に留まる場合はその例外を明記します。
- 依存パッケージは追加時に最新安定版を選び、`package-lock.json` をコミットします。
