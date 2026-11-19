# Issue 状態の同期チェックリスト

起票済みの GitHub Issue が completed で閉じられたら、バックログ項目を実装済みにします。実行の入り口は、日次のタイマーとバックログ詳細画面の手動ボタンの 2 つです。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0010 Issue 状態の日次同期を独立した Function App で動かす](./decisions/0010-issue-status-sync-batch.md)、[0007 GitHub Issue 起票のトークン管理](./decisions/0007-github-issue-token.md)
- 方針:
  - 既存の SWA、Cosmos DB、Storage の構成は変えない。
  - 日次バッチ用の Function App だけを追加する。
  - 共通処理は 1 つにまとめる。

## Step 1: 共通処理

- [x] Issue の状態取得と同期処理
  - 対象ファイル: `src/api/src/lib/github.ts`, `src/api/src/lib/issueSync.ts`, `src/api/src/lib/store.ts`（`listOpenItemsWithIssue`）
  - 完了条件:
    - completed または理由なしで閉じた Issue の項目だけが実装済みになり、`doneAt` が close の日時になる。
    - 手動で変更済みの項目は上書きしない。
    - 項目ごとの失敗は数えて、残りの処理を続ける。
    - テストが通る。

## Step 2: 手動の入り口

- [x] `POST /api/products/{productId}/issues/sync` と、バックログ詳細画面の「Issue 状態を更新」ボタン
  - 対象ファイル: `src/api/src/functions/issues.ts`, `src/frontend/src/api/client.ts`, `src/frontend/src/pages/BacklogDetail.tsx`
  - 完了条件:
    - トークンが未設定なら 503、プロダクトがなければ 404、リポジトリがなければ 400 を返す。
    - ボタンを押すと結果がトーストで表示され、実装済みになった項目の表示が変わる。
    - GitHub 連携が使えないときはボタンが無効になる。

## Step 3: 日次の入り口

- [x] タイマー関数、バッチ用エントリー、ステージング
  - 対象ファイル: `src/api/src/batch.ts`, `src/api/src/batch/syncIssueStatusTimer.ts`, `scripts/stage-api.mjs`, `package.json`
  - 完了条件:
    - `npm run stage:batch` で `.deploy/batch` が作成され、`main` が `dist/src/batch.js` になる。
    - `.deploy/api` の `main` は `dist/src/index.js` のままで、タイマー関数を読み込まない。
- [x] インフラとワークフロー
  - 対象ファイル: `infra/main.bicep`, `.github/workflows/deploy.yml`
  - 完了条件:
    - `az bicep lint`・`build`・`build-params` が通る。
    - ジョブ `deploy-batch-functions` が追加されている。

## Step 4: ドキュメント

- [x] 仕様と構成の更新
  - 対象ファイル: `docs/features.md`, `docs/api.md`, `docs/architecture.md`, `docs/architecture.drawio`, `docs/development.md`, `AGENTS.md`
  - 完了条件: 手動と日次の同期、close 理由の扱い、Function App の構成が記載されている。

## 手作業

- [ ] main にマージ後、インフラのデプロイで Function App が作成されることを確認する
- [ ] `deploy-batch-functions` が成功し、関数 `syncIssueStatus` が Azure ポータルに表示されることを確認する
- [ ] Azure ポータルからタイマー関数を手動実行し、completed で閉じた Issue の項目が実装済みになることを確認する（ADR 0010 の検証項目）
- [ ] 本番の画面で「Issue 状態を更新」を押し、同じ結果になることを確認する

## 後続タスク

- 失敗の調査がしにくい場合は、Application Insights を追加する
