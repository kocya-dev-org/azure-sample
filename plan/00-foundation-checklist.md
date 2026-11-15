# 土台構築チェックリスト

Node.js 24 / React SPA (Vite) / oxlint・oxfmt / vitest を導入し、SWA マネージド Functions 構成のまま開発の土台を作り直します。書き方は [README](./README.md) を参照してください。

関連 ADR:

- [0001 Node.js 24 とマネージド Functions](./decisions/0001-node24-on-managed-functions.md)
- [0002 ツールチェーン選定](./decisions/0002-toolchain.md)

## Step 0: 事前確認

- [x] マネージド Functions の `node:24` 対応状況と、oxlint / oxfmt / Vite / vitest / React の最新安定版・Node 24 対応を確認する
  - 対象ファイル: `plan/decisions/0001-node24-on-managed-functions.md`, `plan/decisions/0002-toolchain.md`
  - 完了条件: 確認結果が ADR に記録されている。（`node:24` の可否は PR プレビューで検証するため ADR 0001 は「検証待ち」）

## Step 1: AGENTS.md 更新

- [x] AGENTS.md を React + Vite、Node.js 24、npm workspaces、`plan/`・`docs/` の役割に合わせて更新する
  - 対象ファイル: `AGENTS.md`
  - 完了条件: 目標構成と規約（oxlint / oxfmt のみ、vitest、ランタイム一致ルール、CI 事前ビルド方式）が反映されている。

## Step 2: plan/ と docs/ の作成

- [x] 運用ルール、チェックリスト、仕様ドキュメントを作成する
  - 対象ファイル: `plan/README.md`, `plan/00-foundation-checklist.md`, `plan/decisions/*`, `docs/README.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/development.md`
  - 完了条件: 上記ファイルが存在し、内容が実コードおよび AGENTS.md と矛盾しない。

## Step 3: ルート workspace とツールチェーン

- [x] ルート `package.json`（npm workspaces: `src/frontend`, `src/api`）と lint / format / test 設定を追加する
  - 対象ファイル: `package.json`, `package-lock.json`, `.node-version`, `.oxlintrc.json`, oxfmt 設定, `vitest.config.ts`, `.gitignore`、削除: `src/api/package-lock.json`
  - 完了条件: Node 24 で `npm ci` が成功し、`format:check` / `lint` が実行できる。lockfile がルートに一本化されている。

## Step 4: フロントエンド（最小雛形）

- [x] `src/frontend/` を Vite + React + TypeScript の最小雛形に置換する
  - 対象ファイル: `src/frontend/{package.json,vite.config.ts,tsconfig.json,index.html,src/*}`, `src/frontend/public/staticwebapp.config.json`（移動）
  - 完了条件: `/api/goodbye`（外部依存なし）を呼んで結果を表示でき、`src/App.test.tsx` が通る。認証ルート・401 リダイレクトが維持され、SPA 用 `navigationFallback`（`/api/*` と静的アセットは除外）が設定されている。旧 `index.html` は削除されている。

## Step 5: API（Node 24 化とテスト）

- [x] API の `engines`・`@types/node` を実行ランタイムに合わせ、`typecheck` / `test` を追加する
  - 対象ファイル: `src/api/package.json`, `src/api/tsconfig.json`, `src/api/tsconfig.build.json`, `src/api/src/functions/goodbye.ts`（ハンドラーを export）, `src/api/src/functions/goodbye.test.ts`。`hello.ts` は Foundry 依存・`foundry.ts`/`data.ts` は import 時に必須設定を検査するため、雛形のテスト対象にしない
  - 完了条件: テストが `tsconfig.build.json` で除外され `dist/` に出力されない。`npm run build` と `npm test` が通る。初回の oxfmt 整形差分は機能変更と別コミットにしている。

## Step 6: CI/CD

- [x] `verify` ジョブを追加し、ビルド済み成果物を SWA にアップロードする方式に変更する
  - 対象ファイル: `.github/workflows/deploy.yml`
  - 完了条件: PR / push で `verify`（`format:check` → `lint` → `typecheck` → `test` → `build`）が実行され、`deploy-static-web-app` の前提になっている。`skip_app_build: true` / `skip_api_build: true` で動作し、paths-filter にルート設定ファイルが追加されている。インフラ系ジョブは変更していない。

## 手作業

- [ ] PR プレビュー環境で `apiRuntime: "node:24"` が使えるか確認する
  - 完了条件: 可否が判明し、ADR 0001 の状態が更新されている。不可の場合は API 実行ランタイムのみ `node:22` とし、その例外を AGENTS.md に反映する。
- [ ] GitHub の secrets / vars を確認する
  - Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_STATIC_WEB_APPS_API_TOKEN`, `AZURE_AI_FOUNDRY_API_KEY`
  - Variables: `AZURE_RESOURCE_GROUP`
  - 完了条件: すべて設定済みである。

## 後続タスク

- [ ] 旧 `index.html` の 3 画面を React に移植する
  - HTTP Function 呼び出し画面（`/api/jobs/run` など）
  - Cosmos DB レコード画面（`/api/items`）
  - Blob オブジェクト画面（`/api/blobs/{name}`）
- [ ] `docs/architecture.drawio` を React SPA と CI 事前ビルド方式に合わせて更新する
