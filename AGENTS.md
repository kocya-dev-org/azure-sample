# プロジェクトの概要

## 概要

Flyingfish は Azure 上で提供するクラウドサービスのプロダクトです。ソフトウェア製品への要望（提案）を生成 AI で RICE と戦略合致度によりスコアリングし、期間内の上位 10 件を次期開発のバックログとして表示します（仕様は `docs/features.md`）。フロントエンドは React + Vite で構築する SPA、API には SWA マネージド Azure Functions v4 と TypeScript v4 プログラミングモデルを使用します。アプリケーションデータは Cosmos DB for NoSQL と Blob Storage に保存します。開発・ビルドは Node.js 24 を前提とします。

> 現在は土台構築中です。本ファイルは土台完成後の構成を記述しています。進捗と未完了の作業は `plan/00-foundation-checklist.md` を確認してください。

## リポジトリ構成とデプロイ後のアーキテクチャ

- `package.json`（ルート）: npm workspaces（`src/frontend`、`src/api`、`src/relay`）の定義と、lint・format・型チェック・テスト・ビルドの共通スクリプトを持ちます。lockfile はルートの `package-lock.json` に一本化します。
- `.node-version`: 開発・CI で使う Node.js のメジャーバージョン（`24`）です。
- `.oxlintrc.json`・oxfmt 設定・`vitest.config.ts`（ルート）: lint・format・テストの共通設定です。vitest は `test.projects` で frontend（jsdom）と api（node）と relay（node）を束ねます。
- `infra/main.bicep`: リソースグループをスコープとするデプロイ定義です。Cosmos DB とアプリケーション用 Blob Storage は Japan East (`japaneast`)、SWA マネージド Functions バックエンドは、マネージド API がサポートされているリージョンの East Asia (`eastasia`) に配置します。Free レベルの Static Web App、Free Tier の Cosmos DB アカウント、アプリケーションデータ用ストレージアカウントと、日次バッチ（Issue 状態の同期）用の Flex Consumption の Function App（Japan East。ホスト用ストレージはアプリケーションデータ用ストレージアカウントを共有）、音声会話の中継用の App Service（Linux、F1。Japan East では F1 を作れないため Japan West。ADR 0013）を作成します。
- Cosmos DB と Blob Storage ではパブリックネットワークアクセスを有効にします。Blob コンテナーはプライベートのままにします（Blob Storage は MVP では使っていません）。Cosmos DB のアカウント接続文字列は、SWA API のアプリケーション設定に保存して使用します。この接続文字列を使う構成では、Cosmos DB のローカルキー認証を有効にします。Cosmos DB のコンテナーは `products`・`proposals`・`scoredItems`・`backlogs` で、Bicep の定義と `src/api/src/lib/cosmos.ts` の定義を一致させます（API が初回アクセス時にも作成します。ADR 0008）。
- Cosmos DB では Free Tier を使用し、共有スループット 400 RU/s のデータベースを設定します。アカウントのスループット上限は 1,000 RU/s です。Free Tier を利用できるのはサブスクリプションごとに 1 アカウントまでで、対象は最大 1,000 RU/s、ストレージ 25 GB です。
- `infra/environments/dev.bicepparam`: `main.bicep` 用の開発環境パラメーターです。Japan East のデータ配置先と `dev` タグを含みます。
- `src/frontend/`: React + TypeScript の SPA（Vite プロジェクト）です。エントリーは `index.html` と `src/main.tsx`、ビルド出力は `src/frontend/dist/` です。UI は shadcn/ui（Tailwind CSS v4 + Radix、ADR 0009）で、生成した部品は `src/components/ui/`、テーマトークンとエントリーの CSS は `src/index.css`、shadcn の設定は `components.json` にあります。`@/` は `src/frontend/src/` を指す alias です（`tsconfig.json` と `vite.config.ts`）。テーマ（ライト・ダーク・システム）は `src/context/ThemeContext.tsx` で管理します。テストは `test/` に `src/` と同じディレクトリ構成で置き、テストの共通設定（`setup.ts`）とヘルパー（`fetchMock.ts`）は `test/` 直下にあります。`public/staticwebapp.config.json` はビルド時に `dist/` へ同梱され、マネージド Functions のランタイム（`platform.apiRuntime`）、SWA のルート認証、SPA 用の `navigationFallback` を設定します。
- `src/api/`: SWA マネージド Azure Functions v4 API です。TypeScript でビルドします。HTTP ハンドラーは `src/api/src/functions/`、共通モジュール（Cosmos DB、Foundry、プロンプト、RICE、GitHub、HTTP 共通処理）は `src/api/src/lib/` にあります。マネージド Functions がサポートするのは HTTP トリガーのみのため、タイマー関数（`src/api/src/batch/`）は SWA 用エントリーの `src/api/src/index.ts` から import せず、バッチ用エントリーの `src/api/src/batch.ts` から読み込みます。バッチは独立した Function App（Flex Consumption、Japan East）にデプロイします（`npm run stage:batch`、ADR 0010）。Microsoft Foundry の設定（`FOUNDRY_*`。音声入力の文字起こし用 Foundry の `FOUNDRY_TRANSCRIBE_*` は任意、ADR 0011）と GitHub Issue 起票用のトークン（`ISSUE_GITHUB_TOKEN`、任意）も SWA API のアプリケーション設定から読み込みます。設定は import 時ではなく使うときに検査します。テストは `src/api/test/` に `src/api/src/` と同じディレクトリ構成（`functions/`・`lib/`・`batch/`）で置き、ヘルパーは `src/api/test/helpers.ts` です。
- `src/relay/`: 提案の音声会話の中継です（App Service F1 で動く Node.js の HTTP サーバー、ADR 0013・0014）。WebRTC がブロックされ、マネージド Functions が WebSocket を扱えないため、ブラウザーとは HTTPS（POST と SSE）、Foundry の GPT-Live（`gpt-live-1`、全二重）とは `ws` パッケージの WebSocket でつなぎます。GPT-Live にはツールを渡さず、RICE の情報の記録は、会話の後で SWA API（`POST /api/products/{productId}/voice-sessions/extract`）が文字起こしから取り出します。エントリーは `src/relay/src/server.ts`（`main` は `dist/src/server.js`）、HTTP ハンドラーは `src/relay/src/app.ts`、チケットの検証・セッション・GPT-Live との接続（`live.ts`）は `src/relay/src/lib/` にあります。チケットは SWA API（`src/api/src/functions/voiceSessions.ts`、`src/api/src/lib/relayTicket.ts`）が HMAC で署名し、指示文もチケットに入れます（中継はプロンプトを持ちません）。チケットの形式を変えるときは、両方のテストのテストベクターを合わせてください。設定は起動時に検査します。テストは `src/relay/test/`、ヘルパーは `src/relay/test/helpers.ts` です。
- `.github/workflows/deploy.yml`: パスフィルター付きの Bicep 検証とデプロイ、SWA API のアプリケーション設定、Node.js 24 での検証（format・lint・型チェック・テスト・ビルド）、ビルド済みのフロントエンドとマネージド API の一括デプロイ、日次バッチの Function App のデプロイ、音声会話の中継の App Service へのデプロイ、PR プレビュー環境の作成とクローズを定義します。
- `plan/`: 作業手順、チェックリスト、技術的な意思決定記録（`plan/decisions/` の ADR）を置きます。
- `docs/`: アプリケーションの仕様（アーキテクチャ、技術スタック、開発手順、機能仕様）を置きます。`docs/architecture.drawio` は構成図です。

## コマンド

ルートで実行します。各 workspace 固有のスクリプトは `src/frontend/package.json`・`src/api/package.json`・`src/relay/package.json` を正とします。

- `npm ci`: 依存関係のインストール
- `npm run format` / `npm run format:check`: oxfmt による整形 / 整形チェック
- `npm run lint`: oxlint による静的解析
- `npm run typecheck`: 全 workspace の型チェック
- `npm test`: vitest による全テストの実行
- `npm run build`: 全 workspace のビルド
- `npm run stage:api`: ビルド済み API を本番依存のみで `.deploy/api` にステージング（CI のデプロイ用。`scripts/stage-api.mjs`）
- `npm run stage:batch`: 日次バッチ用の Function App の成果物を `.deploy/batch` にステージング（`main` を `dist/src/batch.js` に書き換える）
- `npm run stage:relay`: 音声会話の中継の成果物を、本番依存（`ws`）だけで `.deploy/relay` にステージング
- `npm run check:secrets`: ビルド成果物（`src/frontend/dist`・`src/api/dist`・`src/relay/dist`）にシークレットらしき文字列がないかを検査（`scripts/check-secrets.mjs`）

変更後は `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run check:secrets` が通ることを確認してください。

## 作業時の規約

- インフラストラクチャの変更は Bicep で行い、環境固有の値は `infra/environments/*.bicepparam` に記述します。アーキテクチャを意図的に変更する場合を除き、リソースグループスコープのデプロイと SWA マネージド Functions の構成を維持してください。
- フロントエンドのコードは `src/frontend/src/`、API ハンドラーは `src/api/src/functions/` に配置します。フロントエンドから API を呼び出すときは、同じ Static Web App ホスト上の `/api/...` パスを使用します。ローカル開発では Vite の dev server が `/api` を Functions ホスト（`http://localhost:7071`）へプロキシします。
- Node.js のバージョンは `.node-version`、各 `package.json` の `engines`、`src/frontend/public/staticwebapp.config.json` の `platform.apiRuntime`、ワークフローの `actions/setup-node` で一致させてください。SWA マネージド Functions が Node.js 24 に対応していない場合に限り、API の実行ランタイム（`apiRuntime` と `src/api` の `engines`・`@types/node`）を対応済みの最新バージョンに留めます。その判断は `plan/decisions/` の ADR に記録します。
- lint と format には oxlint と oxfmt のみを使用します。ESLint や Prettier は導入しないでください。テストは vitest で記述し、`src/api/test/`・`src/frontend/test/` に、ソース（各 workspace の `src/`）と同じディレクトリ構成で `*.test.ts` / `*.test.tsx` として置きます（例: `src/api/src/functions/backlogs.ts` のテストは `src/api/test/functions/backlogs.test.ts`）。テスト用のヘルパーは各 `test/` 直下に置きます。ソースのディレクトリにテストを置かないでください（ADR 0012）。API のテストはソースを相対パス（例: `'../../src/lib/store'`）で、フロントエンドのテストは `@/` alias で import します。API のエントリーポイントは `src/api/src/index.ts`（`main` は `dist/src/index.js`）で、HTTP ストリーミングを有効にしてから各ハンドラーを import します。新しいハンドラーを追加したら、ここに import を追加してください。ビルド用の `src/api/tsconfig.build.json` は `src/**/*.ts` だけを対象にし、保険として `**/*.test.ts` も除外して、テストファイルをデプロイ成果物に含めないでください（型チェック用の `tsconfig.json` は `src/**` と `test/**` を含めて `noEmit` とします）。フロントエンドの `tsconfig.json` の `include` には `test` を含め、`vite.config.ts` の `setupFiles` は `./test/setup.ts` とします。
- SWA へのデプロイは、CI 上で Node.js 24 を使ってビルドした成果物をアップロードする方式です（`skip_app_build` / `skip_api_build`）。SWA 側のビルド（Oryx）には依存しないでください。
- `infra/main.bicep` と `infra/environments/dev.bicepparam` の Cosmos DB および Blob Storage の配置先を、意図するデータリージョンに合わせてください。SWA マネージド Functions の配置先はサポート対象リージョンに限られます。現在の API リージョンは East Asia です。
- Azure リソースのプロパティ、パブリックネットワーク規則、ランタイムバージョン、デプロイ先のパス、GitHub 権限、シークレット名を変更する場合は、関連する設定も合わせて変更してください。認証情報の値をソースファイルに記載してはいけません。
- ワークフローでは `az bicep lint`、`az bicep build`、`az bicep build-params` を使ってインフラストラクチャを検証します。Azure のデプロイには GitHub OIDC 認証情報（`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`）と `AZURE_RESOURCE_GROUP` を使用します。SWA のデプロイには `AZURE_STATIC_WEB_APPS_API_TOKEN` を使用します。API のアプリケーション設定には、リポジトリ secret の `AZURE_AI_FOUNDRY_API_KEY`（必須）と `ISSUE_GITHUB_TOKEN`（任意。空なら警告のみ）、`AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY`（任意。空なら警告のみで音声入力は無効）、`REALTIME_TICKET_SECRET`（任意。音声会話のチケットの署名鍵。空なら警告のみで音声会話は無効）を使用します。中継の App Service のアプリ設定は Bicep で定義し、Foundry のキー（`AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY` を再利用）と `REALTIME_TICKET_SECRET` は `@secure()` パラメーターで渡します。
- Foundry や GitHub などの外部サービスは API からだけ呼び出し、キーやトークンをフロントエンドに置かないでください（例外は音声会話の Realtime API で、中継から呼び出し、キーは中継だけが持ちます）。API のエラーログには `src/api/src/lib/http.ts` の `logError` を使い、エラーレスポンスには外部サービスの応答本文を含めないでください。

## ドキュメントと計画

- 仕様（画面、API、データモデル、アーキテクチャ）を変更したら、同じ変更で `docs/` を更新してください。
- 複数ステップにわたる作業や Azure・GitHub 側の手作業を伴う作業は、`plan/` にチェックリストを作成または更新してから進めてください。
- 技術選定やアーキテクチャの判断は `plan/decisions/NNNN-<slug>.md` に ADR として記録してください。

## 変更時の指針

- 別の言語が求められている場合を除き、名前、ユーザー向けの文言、コメント、ドキュメントは日本語で記述してください。
- デプロイ対象ファイルを追加したり、コードを移動したりする場合は、必要に応じて `.github/workflows/deploy.yml` の対象パスとビルド・デプロイ先も更新してください。変更フィルターは `infra/**`、`src/api/**`、`src/frontend/**` とルートのツール設定（`package.json`、`package-lock.json`、`.node-version`、lint・format・テストの設定、`scripts/**`）を監視します。
- 依存関係は必要最小限にしてください。新しいフレームワーク、ライブラリ、デプロイ方式を導入する場合は、事前に ADR で理由を記録してください。
