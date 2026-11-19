# UI 刷新チェックリスト

shadcn/ui（Tailwind CSS v4 + Radix）で UI を刷新します。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0009 UI を shadcn/ui で刷新する](./decisions/0009-shadcn-ui.md)
- 方針: API、ルーター（ADR 0006）、画面遷移は変えない。見た目と操作感（確認ダイアログ、トースト、テーマ切り替え、グラフ）を改善する。

## Step 1: 基盤

- [x] 依存の追加、Tailwind と `@/` alias の設定、テーマトークン、テーマ切り替え、テスト用 polyfill
  - 対象ファイル: `src/frontend/package.json`, `src/frontend/vite.config.ts`, `src/frontend/tsconfig.json`, `src/frontend/components.json`, `src/frontend/index.html`, `src/frontend/src/index.css`, `src/frontend/src/lib/utils.ts`, `src/frontend/src/context/ThemeContext.tsx`, `src/frontend/src/test/setup.ts`, `src/frontend/src/components/ui/*`
  - 完了条件: shadcn の部品が生成されている。lint・format・型チェック・テスト・ビルドが通る。

## Step 2: レイアウトと共通部品

- [x] アイコン付きサイドバー、ヘッダー（プロダクト選択、テーマ切り替え）、共通部品（PageHeader、Alert、確認ダイアログ、トースト）
  - 対象ファイル: `src/frontend/src/components/Layout.tsx`, `src/frontend/src/components/common.tsx`, `src/frontend/src/components/Dialog.tsx`, `src/frontend/src/components/ConfirmDialog.tsx`, `src/frontend/src/router.tsx`, `src/frontend/src/App.tsx`
  - 完了条件: 全画面が新しいレイアウトで表示される。スマートフォン幅でもメニューを操作できる。

## Step 3: 各画面

- [x] 提案、提案フォーム、バックログ、バックログ詳細、プロダクト情報の画面を shadcn の部品で作り直す
  - 対象ファイル: `src/frontend/src/pages/*.tsx`
  - 完了条件: `window.confirm` を使っていない。削除などの操作結果をトーストで知らせる。既存の操作がすべてできる。

## Step 4: ダッシュボード

- [x] 集計値をカードで、月別の推移を shadcn Chart（Recharts）で表示する
  - 対象ファイル: `src/frontend/src/pages/Dashboard.tsx`
  - 完了条件: ライトでもダークでも系列を見分けられる。数値はアクセシブルな表でも読める。

## Step 5: テストとドキュメント

- [x] テストを新しい UI に合わせ、ドキュメントを更新する
  - 対象ファイル: `src/frontend/src/**/*.test.tsx`, `docs/tech-stack.md`, `docs/features.md`, `docs/development.md`, `AGENTS.md`
  - 完了条件: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run check:secrets` が通る。
