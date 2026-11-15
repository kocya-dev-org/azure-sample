# アーキテクチャ

構成図は [architecture.drawio](./architecture.drawio) を参照してください（図は土台構築時点のままで、MVP の内容は未反映です）。

## 構成

| 要素                 | 構成                                                                                                                                                                                          | リージョン                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Static Web Apps      | Free レベル。React SPA とマネージド Functions を同一ホストで提供                                                                                                                              | マネージド Functions バックエンドは East Asia (`eastasia`) |
| マネージド Functions | Azure Functions v4 / TypeScript。HTTP トリガーのみ。HTTP ストリーミングを有効化                                                                                                               | East Asia                                                  |
| Cosmos DB for NoSQL  | Free Tier。データベース `flyingfish` に共有スループット 400 RU/s、アカウント上限 1,000 RU/s。コンテナー `products`・`proposals`・`scoredItems`・`backlogs`（[データモデル](./data-model.md)） | Japan East (`japaneast`)                                   |
| Blob Storage         | StorageV2 / Standard_LRS。コンテナー `objects` はプライベート。MVP では使っていない                                                                                                           | Japan East                                                 |
| Microsoft Foundry    | OpenAI 互換 API（既定モデル `gpt-5-mini`）。提案の判定（ストリーム）とスコアリング（構造化出力）に使う                                                                                        | —                                                          |
| GitHub REST API      | バックログ項目の Issue 起票（任意。トークンが未設定なら無効）                                                                                                                                 | —                                                          |

- Cosmos DB と Blob Storage はパブリックネットワークアクセスを有効にしています。Cosmos DB はローカルキー認証が有効です。
- Free Tier の Cosmos DB はサブスクリプションごとに 1 アカウントまでです。
- Bicep は `infra/main.bicep` に定義し、環境固有値は `infra/environments/dev.bicepparam` に置きます。
- Cosmos DB のコンテナーは Bicep で定義するほか、API が初回アクセス時に `createIfNotExists` で作成します。PR ではインフラをデプロイしないため、プレビュー環境でも動かすための措置です。両方の定義を同じに保ちます（[ADR 0008](../plan/decisions/0008-create-containers-on-first-use.md)）。
- PR プレビュー環境と本番は、同じアプリケーション設定と同じ Cosmos DB を使います。プレビューで登録したデータは本番にも表示されます。

## アプリケーション設定

接続情報は SWA のアプリケーション設定に保存し、API が `process.env` から参照します。API は設定を初めて使うときに検査するため、未設定の設定があっても、それを使わない API は動きます。

| 設定                       | 必須 | 設定元                                                                            |
| -------------------------- | ---- | --------------------------------------------------------------------------------- |
| `COSMOS_CONNECTION_STRING` | ○    | インフラのデプロイ時に Cosmos DB から取得                                         |
| `COSMOS_DATABASE_ID`       | —    | 同上（`flyingfish`）                                                              |
| `FOUNDRY_API_KEY`          | ○    | ジョブ `configure-foundry-settings`。リポジトリ secret `AZURE_AI_FOUNDRY_API_KEY` |
| `FOUNDRY_ENDPOINT`         | ○    | 同上（ワークフローに記載）                                                        |
| `FOUNDRY_MODEL`            | —    | 同上（`gpt-5-mini`）                                                              |
| `ISSUE_GITHUB_TOKEN`       | —    | 同上。リポジトリ secret `ISSUE_GITHUB_TOKEN`。空なら警告を出して設定しない        |

値をソースに記載してはいけません。以前の `COSMOS_CONTAINER_ID`・`BLOB_CONNECTION_STRING`・`BLOB_CONTAINER_NAME` はワークフローで設定しなくなりました。既存の値は残っていても使われません。

## シークレットの扱い

- Foundry と GitHub は API（サーバー）からだけ呼び出します。フロントエンドにはキーやトークンを置かず、`VITE_*` 環境変数にも入れません。
- CI の `verify` ジョブで、ビルド成果物（`src/frontend/dist/`・`src/api/dist/`）にシークレットらしき文字列がないことを `npm run check:secrets`（`scripts/check-secrets.mjs`）で検査します。
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
- 共通モジュールは `src/api/src/lib/` にあります（Cosmos DB アクセス、Foundry 呼び出し、プロンプト、RICE の検証と計算、GitHub 起票、HTTP 共通処理）。

## フロントエンド

React + Vite の SPA です。画面の切り替えは History API を使った自前のルーター（`src/frontend/src/router.tsx`、[ADR 0006](../plan/decisions/0006-spa-routing.md)）で行い、SWA の `navigationFallback` で任意のパスに `index.html` を返します。画面の仕様は [機能仕様](./features.md) を参照してください。

## ビルドとデプロイ

- CI（GitHub Actions、Node.js 24）でフロントエンドと API を事前にビルドし、`Azure/static-web-apps-deploy` に `skip_app_build: true` と `skip_api_build: true` を指定してビルド済み成果物をアップロードします。SWA 側のビルド (Oryx) は使いません。
- API は `npm run stage:api`（`scripts/stage-api.mjs`）で `.deploy/api` にステージングしてからアップロードします。workspaces では依存がルートに hoist されるため、lockfile で解決済みの本番依存ツリー（`npm ls --omit=dev --workspace src/api`）だけを `dist/`・`host.json`・`package.json` と一緒にコピーします。テストファイルが含まれていないこともこの段階で検査します。
- API 実行ランタイムは `apiRuntime` で指定します。マネージド Functions が `node:24` に対応していないため、API のみ `node:22` です（[ADR 0001](../plan/decisions/0001-node24-on-managed-functions.md)）。
