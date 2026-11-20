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

| コマンド                | 内容                           |
| ----------------------- | ------------------------------ |
| `npm run format`        | oxfmt で整形                   |
| `npm run format:check`  | 整形の差分を検査               |
| `npm run lint`          | oxlint                         |
| `npm run typecheck`     | 全 workspace の型検査          |
| `npm test`              | vitest（frontend / api）       |
| `npm run build`         | 全 workspace のビルド          |
| `npm run check:secrets` | ビルド成果物のシークレット検査 |

CI の `verify` ジョブは `format:check` → `lint` → `typecheck` → `test` → `build` → `check:secrets` の順に実行します。

## フロントエンド

```bash
npm run dev -w src/frontend
```

Vite の dev server が起動し、`/api` を `http://localhost:7071` にプロキシします。

### UI 部品の追加

UI 部品は shadcn/ui の CLI で `src/frontend/src/components/ui/` に生成します（[ADR 0009](../plan/decisions/0009-shadcn-ui.md)）。

```bash
cd src/frontend
npx shadcn@latest add <部品名>
cd ../..
npm run format && npm run lint
```

- 生成コードの `cn` が `@/lib/utils` 以外（npm パッケージの `cn` など）から import されていたら直します。CLI が別の依存を追加した場合は、`package.json` から外します。
- `next-themes` は使いません。テーマは `src/context/ThemeContext.tsx` の `useTheme` を使います。
- 選択リストは Radix Select ではなく、`components/ui/native-select.tsx`（native の `select`）を使います。

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
- `FOUNDRY_API_KEY`（必須）
- `FOUNDRY_ENDPOINT`（必須）
- `FOUNDRY_MODEL`（任意。既定 `gpt-5-mini`）
- `FOUNDRY_TRANSCRIBE_ENDPOINT`・`FOUNDRY_TRANSCRIBE_API_KEY`・`FOUNDRY_TRANSCRIBE_MODEL`（任意）: 音声入力の文字起こし用です。Foundry リソース `voice-stt-foundary` のエンドポイント（`https://voice-stt-foundary.openai.azure.com/`。`/openai/v1/` は付けない）、キー、デプロイ名（`gpt-4o-transcribe`）を設定します。未設定なら文字起こしの API が 502 を返し、それ以外は動きます（[ADR 0011](../plan/decisions/0011-voice-input-transcription.md)）。
- `ISSUE_GITHUB_TOKEN`（任意）: GitHub Issue 起票用の fine-grained personal access token です。対象リポジトリを限定し、権限は Issues: Read and write だけにします。未設定でも起票以外の機能は動きます。本番環境とプレビュー環境では、リポジトリ secret `ISSUE_GITHUB_TOKEN` に登録します（[ADR 0007](../plan/decisions/0007-github-issue-token.md)）。

コンテナー名はコードの定数です（`src/api/src/lib/cosmos.ts`）。コンテナーがなければ、API が初回アクセス時に作成します。

設定は、使うときに初めて検査します（`src/api/src/lib/settings.ts`）。たとえば Foundry の設定がなくても、プロダクトの登録や一覧は動きます。

## 日次バッチ（Issue 状態の同期）

日次バッチのタイマー関数（`src/api/src/batch/syncIssueStatusTimer.ts`）は、独立した Function App で動かします（[ADR 0010](../plan/decisions/0010-issue-status-sync-batch.md)）。

- **ローカルでの確認:** 同じ処理を `POST /api/products/{productId}/issues/sync`（バックログ詳細画面の「Issue 状態を更新」）で実行できます。
- **タイマー関数そのものをローカルで動かす場合:**
  1. `npm run build` と `npm run stage:batch` を実行する。
  2. `.deploy/batch` に `local.settings.json` を置く。`AzureWebJobsStorage` に Azurite などのストレージを指定する。
  3. そのディレクトリで `func start` を実行する。
- **デプロイ用の成果物:** `npm run stage:batch` で `.deploy/batch` に作成します。`package.json` の `main` は `dist/src/batch.js` に書き換わります。

## シークレット検査

```bash
npm run build
npm run check:secrets
```

ビルド成果物にシークレットらしき文字列（接続文字列、アカウントキー、GitHub トークン、API キーの形式）や、実行環境に設定されたシークレットの値そのものがないかを検査します。CI の `verify` ジョブでも実行します。

## API のテスト

API のテスト（`*.test.ts`）は `tsconfig.build.json` で除外され、`dist/` に出力されずデプロイにも含まれません。`tsconfig.json` は型検査用（`noEmit`、テストを含む）です。テストが `dist/` に出ると Functions ホストが読み込んで起動に失敗するためです。
