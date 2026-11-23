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

### 利用者の照合（ローカル）

API は Cosmos DB の `users` に登録した利用者だけを通します（[ADR 0015](../plan/decisions/0015-user-allowlist.md)）。Vite の dev server から Functions ホストに直接つなぐと `x-ms-client-principal` が付きません。そのため全 API が 403 になり、画面は操作できない状態になります。画面を操作して確かめるときは、次のようにします。

1. `local.settings.json` の `COSMOS_CONNECTION_STRING` が指す Cosmos DB の `users` に、`{ "id": "<モックログインで入力する UPN の小文字>" }` を登録する。
2. `func start` と `npm run dev -w src/frontend` を起動したうえで、`swa start http://localhost:5173 --api-devserver-url http://localhost:7071` を実行する。
3. `http://localhost:4280` を開き、モックログインの画面で、手順 1 の UPN を「Username」に入力してサインインする。

認可を迂回する設定はありません。

### local.settings.json

`src/api/local.settings.json` を作成し、`Values` に次のキーを設定します。値はこのドキュメントに書きません。このファイルはコミットしません。

- `COSMOS_CONNECTION_STRING`（必須）
- `COSMOS_DATABASE_ID`（任意。既定 `flyingfish`）
- `FOUNDRY_API_KEY`（必須）
- `FOUNDRY_ENDPOINT`（必須）
- `FOUNDRY_MODEL`（任意。既定 `gpt-5-mini`）
- `FOUNDRY_TRANSCRIBE_ENDPOINT`・`FOUNDRY_TRANSCRIBE_API_KEY`・`FOUNDRY_TRANSCRIBE_MODEL`（任意）: 音声入力の文字起こし用です。Foundry リソース `voice-stt-foundary` のエンドポイント（`https://voice-stt-foundary.openai.azure.com/`。`/openai/v1/` は付けない）、キー、デプロイ名（`gpt-4o-transcribe`）を設定します。未設定なら文字起こしの API が 502 を返し、それ以外は動きます（[ADR 0011](../plan/decisions/0011-voice-input-transcription.md)）。
- `REALTIME_RELAY_URL`・`REALTIME_TICKET_SECRET`（任意）: 音声会話の中継の URL と、チケットの署名鍵（中継と同じ値）です。未設定なら、音声会話の API が 503 を返します（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)）。
- `ISSUE_GITHUB_TOKEN`（任意）: GitHub Issue 起票用の fine-grained personal access token です。対象リポジトリを限定し、権限は Issues: Read and write だけにします。未設定でも起票以外の機能は動きます。本番環境とプレビュー環境では、リポジトリ secret `ISSUE_GITHUB_TOKEN` に登録します（[ADR 0007](../plan/decisions/0007-github-issue-token.md)）。

コンテナー名はコードの定数です（`src/api/src/lib/cosmos.ts`）。コンテナーがなければ、API が初回アクセス時に作成します。

設定は、使うときに初めて検査します（`src/api/src/lib/settings.ts`）。たとえば Foundry の設定がなくても、プロダクトの登録や一覧は動きます。

## 音声会話の中継

音声会話の中継（`src/relay/`）は、App Service で動く Node.js の HTTP サーバーです（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)）。ローカルでは次のように動かします。

1. 中継を起動します（既定のポートは 8080）。値はこのドキュメントに書きません。

   ```bash
   FOUNDRY_REALTIME_ENDPOINT=https://voice-stt-foundary.openai.azure.com/ \
   FOUNDRY_REALTIME_API_KEY=<キー> \
   FOUNDRY_LIVE_MODEL=gpt-live-1 \
   REALTIME_TICKET_SECRET=<任意の乱数> \
   npm -w src/relay run dev
   ```

   任意の設定は次のとおりです。
   - `REALTIME_VOICE`: 既定 `marin`
   - `RELAY_ALLOWED_ORIGINS`: 既定 `http://localhost:5173`
   - `PORT`

2. API の `local.settings.json` に、`REALTIME_RELAY_URL`（`http://localhost:8080`）と、中継と同じ `REALTIME_TICKET_SECRET` を設定します。
3. Vite の dev server（`http://localhost:5173`）で提案フォームを開き、「音声会話」を押します。

デプロイ用の成果物は、`npm run stage:relay` で `.deploy/relay` に作成します。

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

## テストの配置

テストはソース（各 workspace の `src/`）と分けて、各 workspace 直下の `test/` に置きます（[ADR 0012](../plan/decisions/0012-test-directory.md)）。`test/` の中は `src/` と同じディレクトリ構成にし、ファイル名は `*.test.ts` / `*.test.tsx` とします。

| 対象                                  | テスト                                      |
| ------------------------------------- | ------------------------------------------- |
| `src/api/src/functions/backlogs.ts`   | `src/api/test/functions/backlogs.test.ts`   |
| `src/api/src/lib/rice.ts`             | `src/api/test/lib/rice.test.ts`             |
| `src/frontend/src/pages/Backlogs.tsx` | `src/frontend/test/pages/Backlogs.test.tsx` |

- API のテストは、ソースを相対パスで import します（例: `import { ... } from '../../src/lib/store'`）。ヘルパーは `src/api/test/helpers.ts` です。
- フロントエンドのテストは、テスト対象を `@/` alias で import します（例: `import { BacklogsPage } from '@/pages/Backlogs'`）。テストの共通設定は `src/frontend/test/setup.ts`（`vite.config.ts` の `setupFiles`）、`fetch` のモックは `src/frontend/test/fetchMock.ts` です。
- 型検査はテストも対象です。API の `tsconfig.json` は `src/**` と `test/**`、フロントエンドの `tsconfig.json` は `src` と `test` を含みます（いずれも `noEmit`）。

### API のテストとデプロイ

API のビルド用の `tsconfig.build.json` は `src/**/*.ts` だけを対象にするため、テストは `dist/` に出力されずデプロイにも含まれません。保険として `**/*.test.ts` も除外しています。テストが `dist/` に出ると Functions ホストが読み込んで起動に失敗するためです。
