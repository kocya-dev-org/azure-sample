# アーキテクチャ

構成図は [architecture.drawio](./architecture.drawio) を参照してください（図は土台構築時点の内容に日次バッチと GitHub を追記したもので、MVP のその他の内容は未反映です）。

## 構成

| 要素                    | 構成                                                                                                                                                                                                                                                                                                    | リージョン                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Static Web Apps         | Free レベル。React SPA とマネージド Functions を同一ホストで提供                                                                                                                                                                                                                                        | マネージド Functions バックエンドは East Asia (`eastasia`) |
| マネージド Functions    | Azure Functions v4 / TypeScript。HTTP トリガーのみ。HTTP ストリーミングを有効化                                                                                                                                                                                                                         | East Asia                                                  |
| Cosmos DB for NoSQL     | Free Tier。データベース `flyingfish` に共有スループット 400 RU/s、アカウント上限 1,000 RU/s。コンテナー `products`・`proposals`・`scoredItems`・`backlogs`（[データモデル](./data-model.md)）                                                                                                           | Japan East (`japaneast`)                                   |
| Blob Storage            | StorageV2 / Standard_LRS。コンテナー `objects` はプライベート。MVP では使っていない                                                                                                                                                                                                                     | Japan East                                                 |
| Microsoft Foundry       | OpenAI 互換 API（既定モデル `gpt-5-mini`）。提案の判定（ストリーム）とスコアリング（構造化出力）に使う                                                                                                                                                                                                  | —                                                          |
| 文字起こし用 Foundry    | リソース `voice-stt-foundary`（リソースグループ `sample-app-rc`、Bicep の管理対象外）。モデル `gpt-4o-transcribe` で、提案の音声入力を文字起こしする。API キーで認証し、音声は保存しない（[ADR 0011](../plan/decisions/0011-voice-input-transcription.md)）                                             | —                                                          |
| 音声会話の中継          | App Service（Linux、F1）/ Node.js 24。ブラウザーとは HTTPS（POST と SSE）、文字起こし用 Foundry の `gpt-realtime-2.1-mini` とは WebSocket でつなぐ。WebRTC がブロックされ、マネージド Functions が WebSocket を扱えないため（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)）           | Japan East                                                 |
| GitHub REST API         | バックログ項目の Issue 起票と Issue 状態の確認（任意。トークンが未設定なら無効）                                                                                                                                                                                                                        | —                                                          |
| 日次バッチ Function App | Flex Consumption（FC1）/ Node.js 24。タイマー関数 `syncIssueStatus` だけを動かし、毎日 18:00 UTC に Issue の状態をバックログ項目へ反映する。ホスト用ストレージは Blob Storage のアカウントを共有する（コンテナー `batch-deployments`）（[ADR 0010](../plan/decisions/0010-issue-status-sync-batch.md)） | Japan East                                                 |

- Cosmos DB と Blob Storage はパブリックネットワークアクセスを有効にしています。Cosmos DB はローカルキー認証が有効です。
- Free Tier の Cosmos DB はサブスクリプションごとに 1 アカウントまでです。
- Bicep は `infra/main.bicep` に定義し、環境固有値は `infra/environments/dev.bicepparam` に置きます。
- Cosmos DB のコンテナーは Bicep で定義するほか、API が初回アクセス時に `createIfNotExists` で作成します。PR ではインフラをデプロイしないため、プレビュー環境でも動かすための措置です。両方の定義を同じに保ちます（[ADR 0008](../plan/decisions/0008-create-containers-on-first-use.md)）。
- PR プレビュー環境と本番は、同じアプリケーション設定と同じ Cosmos DB を使います。プレビューで登録したデータは本番にも表示されます。

## アプリケーション設定

接続情報は SWA のアプリケーション設定に保存し、API が `process.env` から参照します。API は設定を初めて使うときに検査するため、未設定の設定があっても、それを使わない API は動きます。

| 設定                          | 必須 | 設定元                                                                                                                     |
| ----------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| `COSMOS_CONNECTION_STRING`    | ○    | インフラのデプロイ時に Cosmos DB から取得                                                                                  |
| `COSMOS_DATABASE_ID`          | —    | 同上（`flyingfish`）                                                                                                       |
| `FOUNDRY_API_KEY`             | ○    | ジョブ `configure-foundry-settings`。リポジトリ secret `AZURE_AI_FOUNDRY_API_KEY`                                          |
| `FOUNDRY_ENDPOINT`            | ○    | 同上（ワークフローに記載）                                                                                                 |
| `FOUNDRY_MODEL`               | —    | 同上（`gpt-5-mini`）                                                                                                       |
| `ISSUE_GITHUB_TOKEN`          | —    | 同上。リポジトリ secret `ISSUE_GITHUB_TOKEN`。空なら警告を出して設定しない                                                 |
| `FOUNDRY_TRANSCRIBE_API_KEY`  | —    | 同上。リポジトリ secret `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY`。空なら警告を出して、次の 2 つも設定しない（音声入力は無効） |
| `FOUNDRY_TRANSCRIBE_ENDPOINT` | —    | 同上（ワークフローに記載）                                                                                                 |
| `FOUNDRY_TRANSCRIBE_MODEL`    | —    | 同上（`gpt-4o-transcribe`）                                                                                                |
| `REALTIME_RELAY_URL`          | —    | 同上。Bicep の出力 `relayUrl`。`REALTIME_TICKET_SECRET` が空なら設定しない（音声会話は無効）                               |
| `REALTIME_TICKET_SECRET`      | —    | 同上。リポジトリ secret `REALTIME_TICKET_SECRET`。空なら警告を出して設定しない                                             |

日次バッチの Function App のアプリ設定は、すべて Bicep（`infra/main.bicep` の `siteConfig.appSettings`）で定義します。

- `AzureWebJobsStorage`・`DEPLOYMENT_STORAGE_CONNECTION_STRING`・`COSMOS_CONNECTION_STRING`: デプロイ時にアカウントキーから組み立てる
- `COSMOS_DATABASE_ID`
- `ISSUE_GITHUB_TOKEN`: `@secure()` パラメーター `issueGithubToken`。ジョブ `deploy-infrastructure` がリポジトリ secret から渡し、空なら空のまま

音声会話の中継（App Service）のアプリ設定も、すべて Bicep で定義します（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)）。

- `FOUNDRY_REALTIME_ENDPOINT`・`FOUNDRY_REALTIME_MODEL`・`REALTIME_AUDIO_FORMAT`（`pcm` か `pcmu`）・`REALTIME_TRANSCRIPTION_MODEL`（`off` で無効）: `dev.bicepparam` とパラメーターの既定値
- `FOUNDRY_REALTIME_API_KEY`: `@secure()` パラメーター `foundryRealtimeApiKey`。リポジトリ secret `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY`（文字起こしと同じリソースのキー）
- `REALTIME_TICKET_SECRET`: `@secure()` パラメーター `realtimeTicketSecret`。SWA API と同じ値
- `RELAY_ALLOWED_ORIGINS`: SWA の既定ホストと、PR プレビューのホストから組み立てる

キーか署名鍵が空のままだと、中継は起動しません（起動時に設定を検査します）。

CLI で設定を足すと、Bicep の再デプロイで消えます。トークンを更新したら、インフラのデプロイを再実行してください。

値をソースに記載してはいけません。以前の `COSMOS_CONTAINER_ID`・`BLOB_CONNECTION_STRING`・`BLOB_CONTAINER_NAME` はワークフローで設定しなくなりました。既存の値は残っていても使われません。

## シークレットの扱い

- Foundry（文字起こし用を含む）と GitHub は API（サーバー）からだけ呼び出します。音声会話の Realtime API は中継（App Service）から呼び出し、キーは中継だけが持ちます。ブラウザーが中継に渡すのは、SWA API が署名した短命のチケットと、中継が発行したセッションキーだけです。フロントエンドにはキーやトークンを置かず、`VITE_*` 環境変数にも入れません。
- CI の `verify` ジョブで、ビルド成果物（`src/frontend/dist/`・`src/api/dist/`・`src/relay/dist/`）にシークレットらしき文字列がないことを `npm run check:secrets`（`scripts/check-secrets.mjs`）で検査します。
- API のログには、エラーの名前・コード・状態・メッセージだけを記録します（`src/api/src/lib/http.ts` の `logError`）。エラーレスポンスは固定の日本語メッセージで、外部サービスの応答本文やヘッダーを含めません。
- プロンプトのユーザー入力は区切りタグで囲み、指示として扱わないようシステムプロンプトで指定しています（`src/api/src/lib/prompts.ts`）。

## 認証

`staticwebapp.config.json` で全ルート (`/*`) を `authenticated` ロールに限定しています。未認証の 401 は `/.auth/login/aad` へ 302 リダイレクトします。API の `authLevel` は `anonymous` ですが、SWA の `/api/*` も同じルート規則で保護されます。

投稿者・作成者は、SWA が付与する `x-ms-client-principal` ヘッダーから API が設定します。ログインできる人なら誰でも全プロダクトのデータを扱え、Issue も起票できます。このリスクは PoC として受け入れています（[ADR 0007](../plan/decisions/0007-github-issue-token.md)）。

## PR プレビュー環境

同一リポジトリからの PR では、SWA のプレビュー環境にデプロイします。PR のクローズ時にプレビュー環境も閉じます。インフラ（Bicep）のデプロイとアプリケーション設定の更新は `main` への push と手動実行のときだけ行います。

## API

エンドポイントは [API 仕様](./api.md) を参照してください。

- エントリーポイントは `src/api/src/index.ts` です（`package.json` の `main` は `dist/src/index.js`）。`app.setup({ enableHttpStream: true })` を呼んでから、`src/api/src/functions/` の各ハンドラーを import します。新しいハンドラーを追加したら、ここに import を追加してください。
- 共通モジュールは `src/api/src/lib/` にあります（Cosmos DB アクセス、Foundry 呼び出し、プロンプト、RICE の検証と計算、GitHub 起票と状態取得、Issue 状態の同期、HTTP 共通処理）。
- 日次バッチは同じ `src/api` パッケージを、別のエントリー `src/api/src/batch.ts` で動かします。読み込むのはタイマー関数（`src/api/src/batch/`）だけです。
  - SWA のマネージド Functions は HTTP トリガーしか使えません。そのため `src/api/src/index.ts` からはタイマー関数を import しないでください。

## フロントエンド

React + Vite の SPA です。UI は shadcn/ui（Tailwind CSS v4 + Radix）の部品で組み立てます（[ADR 0009](../plan/decisions/0009-shadcn-ui.md)）。画面の切り替えは History API を使った自前のルーター（`src/frontend/src/router.tsx`、[ADR 0006](../plan/decisions/0006-spa-routing.md)）で行い、SWA の `navigationFallback` で任意のパスに `index.html` を返します。画面の仕様は [機能仕様](./features.md) を参照してください。

## ビルドとデプロイ

- CI（GitHub Actions、Node.js 24）でフロントエンドと API を事前にビルドし、`Azure/static-web-apps-deploy` に `skip_app_build: true` と `skip_api_build: true` を指定してビルド済み成果物をアップロードします。SWA 側のビルド (Oryx) は使いません。
- API は `npm run stage:api`（`scripts/stage-api.mjs`）で `.deploy/api` にステージングしてからアップロードします。workspaces では依存がルートに hoist されるため、lockfile で解決済みの本番依存ツリー（`npm ls --omit=dev --workspace src/api`）だけを `dist/`・`host.json`・`package.json` と一緒にコピーします。テストファイルが含まれていないこともこの段階で検査します。
- 日次バッチは `npm run stage:batch` で `.deploy/batch` にステージングし、ジョブ `deploy-batch-functions` が `Azure/functions-action`（`sku: flexconsumption`）でデプロイします。
  - ステージングの手順は API と同じです。違いは、`package.json` の `main` を `dist/src/batch.js` に書き換えることだけです。
  - デプロイは main への push と手動実行のときだけ行い、PR ではデプロイしません。
- 音声会話の中継は `npm run stage:relay` で `.deploy/relay` にステージングします（本番依存は `ws` だけ）。ジョブ `deploy-relay` が zip にし、`az webapp deploy` で App Service にデプロイします。
  - App Service 側ではビルドしません（`SCM_DO_BUILD_DURING_DEPLOYMENT=false`）。
  - デプロイは main への push と手動実行のときだけです。PR プレビューで音声会話を試すには、先にブランチから手動実行して、中継とインフラをデプロイします。
- App Service F1 には制限（CPU 60 分/日、帯域 165 MB/日、アイドル時のアンロード）があるため、音声会話の回数には上限があります。初回の接続は、コールドスタートで時間がかかることがあります。
- API 実行ランタイムは `apiRuntime` で指定します。マネージド Functions が `node:24` に対応していないため、API のみ `node:22` です（[ADR 0001](../plan/decisions/0001-node24-on-managed-functions.md)）。
