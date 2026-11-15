# ローカル開発手順

土台構築の完了後の目標状態として記述しています。

## 前提ツール

- Node.js 24（`.node-version` 参照）
- Azure Functions Core Tools v4（`func`）
- 任意: Azure Static Web Apps CLI（`swa`）

## セットアップ

```bash
npm ci
```

ルートで実行します。lockfile はルートの `package-lock.json` のみです。

## ルートコマンド

| コマンド               | 内容                     |
| ---------------------- | ------------------------ |
| `npm run format`       | oxfmt で整形             |
| `npm run format:check` | 整形の差分を検査         |
| `npm run lint`         | oxlint                   |
| `npm run typecheck`    | 全 workspace の型検査    |
| `npm test`             | vitest（frontend / api） |
| `npm run build`        | 全 workspace のビルド    |

CI の `verify` ジョブは `format:check` → `lint` → `typecheck` → `test` → `build` の順に実行します。

## フロントエンド

```bash
npm run dev -w src/frontend
```

Vite の dev server が起動し、`/api` を `http://localhost:7071` にプロキシします。

## API

```bash
cd src/api
npm run build
func start
```

`func start` は `http://localhost:7071` で待ち受けます。フロントエンドと API を同一ホストで確認したい場合は `swa start` も使えます。

### local.settings.json

`src/api/local.settings.json` を作成し、`Values` に次のキーを設定します。値はこのドキュメントに書きません。このファイルはコミットしません。

- `COSMOS_CONNECTION_STRING`（必須）
- `COSMOS_DATABASE_ID`（任意。既定 `flyingfish`）
- `COSMOS_CONTAINER_ID`（任意。既定 `records`）
- `BLOB_CONNECTION_STRING`（必須）
- `BLOB_CONTAINER_NAME`（任意。既定 `objects`）
- `FOUNDRY_API_KEY`（必須）
- `FOUNDRY_ENDPOINT`（必須）
- `FOUNDRY_MODEL`（任意。既定 `gpt-5-mini`）

`foundry.ts` はモジュール読み込み時に `FOUNDRY_API_KEY` と `FOUNDRY_ENDPOINT` を検査します。未設定のまま `hello.ts` が読み込まれると例外になります。`data.ts` も同様に `COSMOS_CONNECTION_STRING` と `BLOB_CONNECTION_STRING` を検査します。

## API のテスト

API のテスト（`*.test.ts`）は `tsconfig.build.json` で除外され、`dist/` に出力されずデプロイにも含まれません。`tsconfig.json` は型検査用（`noEmit`、テストを含む）です。テストが `dist/` に出ると Functions ホストが読み込んで起動に失敗するためです。
