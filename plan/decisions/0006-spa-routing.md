# 0006: SPA のルーティング方式

- 状態: 承認
- 日付: 2026-11-15

## 背景

MVP では、次の画面を URL で切り替える。

- 提案一覧・提案フォーム
- バックログ一覧・バックログ詳細
- プロダクト情報
- ダッシュボード（Phase 2）

バックログ作成後には、詳細画面に自動で移る必要もある。SWA の `navigationFallback` は設定済みで、任意のパスで `index.html` が返る。

AGENTS.md の方針では、依存関係は必要最小限にする。

## 決定

react-router などのルーティングライブラリーは導入しない。History API（`pushState`）と `popstate` イベントを使った小さな自前のルーターを `src/frontend/src/router.tsx` に作る。対象のパスは次のとおり。

- `/`（Phase 1 は `/proposals` にリダイレクト、Phase 2 はダッシュボード）
- `/proposals`、`/proposals/new`、`/proposals/:id/edit`
- `/backlogs`、`/backlogs/:id`
- `/products`

## 結果・影響

- 依存が増えない。画面数が少ないため、パスとパラメーターの照合だけで足りる。
- 画面やネストが大きく増えた場合は、この ADR を見直してライブラリーの導入を検討する。
