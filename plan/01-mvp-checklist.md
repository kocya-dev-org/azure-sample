# MVP チェックリスト

土台の上に、要望スコアリング・バックログ SaaS の MVP を実装します。書き方は [README](./README.md) を参照してください。

- 仕様: [機能仕様](../docs/features.md)、[データモデル](../docs/data-model.md)、[API 仕様](../docs/api.md)
- 関連 ADR:
  - [0003 MVP のスコープ](./decisions/0003-mvp-scope.md)
  - [0004 Cosmos DB のコンテナー構成](./decisions/0004-cosmos-containers.md)
  - [0005 判定コメントのストリーミング方式](./decisions/0005-ai-review-streaming.md)
  - [0006 SPA のルーティング方式](./decisions/0006-spa-routing.md)
  - [0007 GitHub Issue 起票のトークン管理とアクセス制御](./decisions/0007-github-issue-token.md)

## セキュリティ方針（全 Step 共通の完了条件）

- Foundry と GitHub は、サーバー（マネージド Functions）からだけ呼び出す。ブラウザーから直接呼び出さない。
- シークレット（`FOUNDRY_API_KEY`、Cosmos DB の接続文字列、`ISSUE_GITHUB_TOKEN`）は SWA のアプリケーション設定にだけ置き、値は GitHub secrets から渡す。`VITE_*` 環境変数には入れない。
- ログには状況・コード・メッセージだけを記録する。SDK のエラーオブジェクトをそのまま `context.error` に渡さない（共通関数 `logError` を使う）。
- エラーレスポンスには、外部サービスのレスポンス本文やヘッダーを含めない。固定の日本語メッセージだけを返す。
- プロンプトにシークレットを含めない。ユーザー入力は区切り記号で囲み、指示として扱わないようシステムプロンプトで明記する。
- 投稿者は `x-ms-client-principal` からサーバーで設定する。クライアントから送られた値は使わない。

## Phase 0: 仕様と判断記録

- [x] 仕様ドキュメントを作成し、既存のドキュメントを更新する
  - 対象ファイル: `docs/features.md`, `docs/data-model.md`, `docs/api.md`, `docs/architecture.md`, `docs/development.md`, `docs/README.md`
  - 完了条件: 画面・データモデル・API が記載され、「実装予定」と明記されている。既存の現行構成の記述と矛盾しない。
- [x] ADR を追加し、土台チェックリストの後続タスクを整理する
  - 対象ファイル: `plan/decisions/0003`〜`0007`, `plan/00-foundation-checklist.md`
  - 完了条件: ADR が追加され、旧 3 画面の移植タスクが ADR 0003 へのリンク付きで廃止になっている。

## Phase 1-1: ストリーミングの検証

- [x] HTTP ストリーミングを有効にした検証用エンドポイントを作る
  - 対象ファイル: `src/api/package.json`（`main` を `dist/src/index.js` に変更）, `src/api/src/index.ts`（`app.setup({ enableHttpStream: true })` の後に各 functions を import）, `src/api/src/functions/diag-stream.ts`（`GET /api/diag/stream`）, `scripts/stage-api.mjs`（`main` の変更に対応しているか確認）
  - 完了条件: `@azure/functions`（4.17.1）が `app.setup({ enableHttpStream: true })` と `ReadableStream` の応答本文に対応していることを確認済み。`npm run stage:api` が成功する。
- [ ] PR プレビュー環境で `GET /api/diag/stream` を開き、固定テキストが 1 秒ごとにブラウザーへ届くか確認する（PR 作成後に実施）
  - 完了条件: 少しずつ届くか、まとめて届くかが判明している。
- [ ] 検証結果を ADR 0005 に記録し、方式を決める
  - 対象ファイル: `plan/decisions/0005-ai-review-streaming.md`, `docs/api.md`（代替案を採用した場合）
  - 完了条件: HTTP ストリーミングかポーリングかが決まり、ADR 0005 の状態が「承認」になっている。検証用エンドポイントは削除されている。

## Phase 1-2: API の基盤整理

- [x] サンプル API を削除し、共通モジュールを `src/api/src/lib/` に作る
  - 対象ファイル: 削除 `src/api/src/functions/{hello,goodbye,goodbye.test,items,blobs,jobs,data,foundry}.ts`。新規 `src/api/src/lib/{cosmos,foundry,http,rice,prompts}.ts` とテスト。`src/api/tsconfig*.json`
  - 完了条件:
    - 共通モジュールは import した時点で設定を検査せず、初めて使うときにクライアントを生成する。
    - `rice.ts`（スコア計算と値の範囲の検証）にテストがある。
    - `src/lib` が `dist/` に出力され、テストファイルは出力されない。
    - `npm run build` と `npm test` が通る。

## Phase 1-3: インフラと CI

- [x] Cosmos DB のコンテナーを追加する
  - 対象ファイル: `infra/main.bicep`
  - 完了条件: `records` が削除され、`products`（`/id`）、`proposals`（`/productId`、`defaultTtl: -1`）、`scoredItems`（`/productId`）、`backlogs`（`/productId`）が定義されている。`az bicep lint` と `az bicep build` が通る。
- [x] ワークフローを更新する
  - 対象ファイル: `.github/workflows/deploy.yml`, `scripts/`（シークレット検査）
  - 完了条件:
    - アプリケーション設定から `COSMOS_CONTAINER_ID` が外れている。
    - `verify` ジョブで、`src/frontend/dist/` と `.deploy/api` にシークレットらしき文字列（接続文字列やキーの形式）がないことを検査している。

## Phase 1-4: API ハンドラー（Must）

- [ ] プロダクト API
  - 対象ファイル: `src/api/src/functions/products.ts`, `products.test.ts`
  - 完了条件: [API 仕様](../docs/api.md)のとおり一覧・作成・更新・削除ができる。削除時に紐づくデータもまとめて削除する。`repository` の形式を検証する。
- [ ] 判定 API（ストリーム）
  - 対象ファイル: `src/api/src/functions/review.ts`, `review.test.ts`, `src/api/src/lib/prompts.ts`
  - 完了条件: Phase 1-1 で決めた方式でコメントを返す。reasoning effort が low で、出力上限トークン数が設定されている。Foundry の失敗時は 502 と固定メッセージを返す。
- [ ] 提案 API（スコアリング）
  - 対象ファイル: `src/api/src/functions/proposals.ts`, `proposals.test.ts`
  - 完了条件:
    - 作成と更新で `json_schema` の構造化出力を使ってスコアリングし、`proposals` と `scoredItems` に分けて保存する。
    - RICE スコアはサーバーで計算する。値が範囲外なら 502 を返す。
    - 更新時に `status`・`doneAt`・`issue` を残す。
- [ ] バックログ API
  - 対象ファイル: `src/api/src/functions/backlogs.ts`, `backlogs.test.ts`
  - 完了条件: 期間内の項目を RICE の降順（同じ値なら戦略合致度の降順）で並べ、上位 10 件をスナップショットとして保存する。詳細では最新の実装状況・Issue・根拠を結合して返す。

## Phase 1-5: フロントエンド（Must）

- [ ] レイアウト・ルーター・プロダクト選択
  - 対象ファイル: `src/frontend/src/{App.tsx,App.css,router.tsx}`, `src/frontend/src/context/ProductContext.tsx`, `src/frontend/src/components/*`, `src/frontend/src/api/client.ts`
  - 完了条件: 左メニュー（提案・バックログ・プロダクト情報）とヘッダー右端のプロダクト選択が表示される。選択が localStorage に保存される。`/` が `/proposals` にリダイレクトされる。
- [ ] プロダクト情報画面
  - 対象ファイル: `src/frontend/src/pages/Products.tsx` とテスト
  - 完了条件: 一覧、新規登録ダイアログ（名前・戦略・リポジトリ）、編集ダイアログ、削除（確認ダイアログ付き）ができる。
- [ ] 提案一覧と提案フォーム
  - 対象ファイル: `src/frontend/src/pages/{Proposals,ProposalForm}.tsx` とテスト
  - 完了条件:
    - 判定コメントがストリームで少しずつ表示される。
    - 「このまま送信」と「追記して再判定」を選べる。
    - 編集ボタンはちょうど 1 件を選んだときだけ有効になる。
    - 削除は確認ダイアログの後に行われる。
- [ ] バックログ一覧と詳細
  - 対象ファイル: `src/frontend/src/pages/{Backlogs,BacklogDetail}.tsx` とテスト
  - 完了条件: 作成ダイアログで期間を指定して作成すると、詳細画面に自動で移る。詳細に順位・項目名・RICE スコア・戦略合致度が表示され、根拠を展開して確認できる。

## Phase 1-6: 仕上げ

- [ ] ドキュメントを実装に合わせる
  - 対象ファイル: `docs/architecture.md`, `docs/architecture.drawio`, `docs/development.md`, `docs/api.md`, `AGENTS.md`
  - 完了条件: 「実装予定」の表記が外れ、サンプル API の記述が削除されている。コンテナー名と `src/api/src/lib` の構成が反映されている。
- [ ] 変更後の確認コマンドがすべて通る
  - 完了条件: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` と `npm run stage:api` が成功する。

## Phase 2: Want 項目

- [ ] 実装状況の編集
  - 対象ファイル: `src/api/src/functions/items.ts`（`PATCH`）とテスト, `src/frontend/src/pages/BacklogDetail.tsx`
  - 完了条件: 詳細画面で未対応と実装済みを切り替えられ、`doneAt` が記録される。
- [ ] GitHub Issue の起票
  - 対象ファイル: `src/api/src/lib/github.ts`, `src/api/src/functions/issues.ts` とテスト, `src/frontend/src/pages/BacklogDetail.tsx`, `.github/workflows/deploy.yml`
  - 完了条件:
    - チェックボックスで選んだ項目を `fetch` で起票し、番号と URL を `scoredItems.issue` に保存する。起票済みの項目はスキップする。
    - トークンが未設定なら 503 を返し、画面の「Issue 起票」ボタンを無効にして理由を表示する。
    - ワークフローは secret `ISSUE_GITHUB_TOKEN` をアプリケーション設定に渡す。secret が空なら警告を出して飛ばす。
    - トークンがなくても `npm test` が通る（GitHub API はモックする）。
- [ ] ダッシュボード
  - 対象ファイル: `src/api/src/functions/dashboard.ts` とテスト, `src/frontend/src/pages/Dashboard.tsx`, `router.tsx`, メニュー
  - 完了条件: メニューの先頭に「ダッシュボード」があり、`/` で開く。現在の提案数・Issue 起票数・実装済み数と、直近 6 か月の月別推移が棒グラフ（CSS か SVG）で表示される。`githubEnabled` を返す。

## 手作業

- [ ] Foundry の `gpt-5-mini` デプロイが、`json_schema` の response_format と `stream: true` に対応しているか確認する
  - 完了条件: 確認結果が ADR 0005 に記録されている。
- [ ] Bicep のデプロイ後に、不要になった `records` コンテナーを削除する
  - 増分デプロイでは自動で消えないため、`az cosmosdb sql container delete --account-name <アカウント名> --database-name flyingfish --name records --resource-group <リソースグループ>` で削除する。
  - 完了条件: `records` コンテナーが存在しない。
- [ ] PR プレビュー環境で、Must の操作の流れを確認する
  - 完了条件: プロダクト登録 → 提案の判定（ストリーム表示）→ 送信 → 一覧にスコアが表示される → バックログ作成 → 詳細画面に移る、までが動作する。ブラウザーの開発者ツールで、応答とバンドルにキーが含まれていない。
- [ ] GitHub トークンを登録する（Phase 2。ユーザーが実施）
  - 種類: fine-grained personal access token
  - 対象リポジトリ: プロダクト情報に登録するリポジトリだけ
  - 権限: Repository permissions の Issues: Read and write（Metadata: Read は自動で付く）
  - 登録先:

    | 用途                         | 登録先                                                                                 | 名前                 |
    | ---------------------------- | -------------------------------------------------------------------------------------- | -------------------- |
    | 本番環境と PR プレビュー環境 | GitHub リポジトリの Settings → Secrets and variables → Actions → New repository secret | `ISSUE_GITHUB_TOKEN` |
    | ローカル開発（任意）         | `src/api/local.settings.json` の `Values`（git 管理外。コミットしない）                | `ISSUE_GITHUB_TOKEN` |

  - 登録後に deploy ワークフローを再実行し、SWA のアプリケーション設定に反映する。
  - 完了条件: プレビュー環境で Issue を 1 件起票でき、リンクが表示される。
