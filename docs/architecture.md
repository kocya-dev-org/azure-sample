# アーキテクチャ

構成図は [architecture.drawio](./architecture.drawio) を参照してください。

## 現行構成

| 要素                 | 構成                                                                                                                                          | リージョン                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Static Web Apps      | Free レベル。フロントエンドとマネージド Functions を同一ホストで提供                                                                          | マネージド Functions バックエンドは East Asia (`eastasia`) |
| マネージド Functions | Azure Functions v4 / TypeScript。HTTP トリガーのみ                                                                                            | East Asia                                                  |
| Cosmos DB for NoSQL  | Free Tier。データベース `flyingfish` に共有スループット 400 RU/s、アカウント上限 1,000 RU/s。コンテナー `records`（パーティションキー `/id`） | Japan East (`japaneast`)                                   |
| Blob Storage         | StorageV2 / Standard_LRS。コンテナー `objects` はプライベート                                                                                 | Japan East                                                 |

- Cosmos DB と Blob Storage はパブリックネットワークアクセスを有効にしています。Cosmos DB はローカルキー認証が有効です。
- Free Tier の Cosmos DB はサブスクリプションごとに 1 アカウントまでです。
- Bicep は `infra/main.bicep` に定義し、環境固有値は `infra/environments/dev.bicepparam` に置きます。

## アプリケーション設定

接続情報は SWA のアプリケーション設定に保存し、API が `process.env` から参照します。

- `COSMOS_CONNECTION_STRING`, `COSMOS_DATABASE_ID`, `COSMOS_CONTAINER_ID`
- `BLOB_CONNECTION_STRING`, `BLOB_CONTAINER_NAME`
- Microsoft Foundry: `FOUNDRY_API_KEY`, `FOUNDRY_ENDPOINT`, `FOUNDRY_MODEL`

Cosmos DB と Blob の設定は GitHub Actions のインフラデプロイ時に設定します。Foundry の設定は別ジョブ（`configure-foundry-settings`）で設定し、`FOUNDRY_API_KEY` にはリポジトリ secret `AZURE_AI_FOUNDRY_API_KEY` を使います。値をソースに記載してはいけません。

## 認証

`staticwebapp.config.json` で全ルート (`/*`) を `authenticated` ロールに限定しています。未認証の 401 は `/.auth/login/aad` へ 302 リダイレクトします。API の `authLevel` は `anonymous` ですが、SWA の `/api/*` も同じルート規則で保護されます。

## PR プレビュー環境

同一リポジトリからの PR では、SWA のプレビュー環境にデプロイします。PR のクローズ時にプレビュー環境も閉じます。

## API エンドポイント一覧

すべて `src/api/src/functions/` に定義されています。フロントエンドからは同一ホストの `/api/...` で呼び出します。

| ファイル     | メソッド | ルート              | 概要                                                         |
| ------------ | -------- | ------------------- | ------------------------------------------------------------ |
| `hello.ts`   | GET      | `/api/hello`        | Microsoft Foundry で日本語の挨拶を生成して返す。失敗時は 502 |
| `goodbye.ts` | GET      | `/api/goodbye`      | `{ "message": "goodbye" }` を返す                            |
| `jobs.ts`    | POST     | `/api/jobs/run`     | Function を手動実行し、メッセージを返す                      |
| `items.ts`   | GET      | `/api/items`        | Cosmos DB のレコード一覧                                     |
| `items.ts`   | POST     | `/api/items`        | レコード作成                                                 |
| `items.ts`   | GET      | `/api/items/{id}`   | レコード取得                                                 |
| `items.ts`   | PUT      | `/api/items/{id}`   | レコード置換                                                 |
| `items.ts`   | DELETE   | `/api/items/{id}`   | レコード削除                                                 |
| `blobs.ts`   | POST     | `/api/blobs/{name}` | Blob 作成                                                    |
| `blobs.ts`   | GET      | `/api/blobs/{name}` | Blob 取得                                                    |
| `blobs.ts`   | PUT      | `/api/blobs/{name}` | Blob 置換                                                    |
| `blobs.ts`   | DELETE   | `/api/blobs/{name}` | Blob 削除                                                    |

`data.ts`（Cosmos DB / Blob クライアント）と `foundry.ts`（Foundry クライアント）は共通モジュールで、ルートを持ちません。

## 土台構築後の変更点

[土台構築チェックリスト](../plan/00-foundation-checklist.md)の完了後は次のようになります。

- フロントエンドは React + Vite の SPA になります。ビルド成果物は `src/frontend/dist/` です。`staticwebapp.config.json` は `src/frontend/public/` に置き、SPA 用の `navigationFallback` を追加します。
- CI（GitHub Actions、Node.js 24）でフロントエンドと API を事前にビルドし、`Azure/static-web-apps-deploy` に `skip_app_build: true` と `skip_api_build: true` を指定してビルド済み成果物をアップロードします。SWA 側のビルド (Oryx) は使いません。API は `npm run stage:api`（`scripts/stage-api.mjs`）で `.deploy/api` にステージングしてからアップロードします。workspaces では依存がルートに hoist されるため、lockfile で解決済みの本番依存ツリー（`npm ls --omit=dev --workspace src/api`）だけを `dist/`・`host.json`・`package.json` と一緒にコピーします。テストファイルが含まれていないこともこの段階で検査します。
- API 実行ランタイムは `apiRuntime` で指定します。`node:24` が使えない場合は API のみ `node:22` とします（[ADR 0001](../plan/decisions/0001-node24-on-managed-functions.md)）。
- インフラ（Bicep）のリソース構成は変更しません。
