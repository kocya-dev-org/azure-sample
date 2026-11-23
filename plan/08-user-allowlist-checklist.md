# 許可した利用者だけに利用を限定するチェックリスト

Entra ID でサインインした利用者のうち、Cosmos DB の `users` コンテナーに登録した利用者だけに利用を許可します。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0015 Cosmos DB の users コンテナーに登録した利用者だけに利用を許可する](./decisions/0015-user-allowlist.md)
- 方針:
  - 照合は `x-ms-client-principal` の `userDetails`（UPN）を小文字にした値で行う。
  - 認可は API で行い、画面はその結果で無効表示にする。
  - 利用者の登録は Data Explorer で手作業で行う。

## 実装

- [x] Step 1: `users` コンテナーを追加する
  - 対象ファイル: `infra/main.bicep`、`src/api/src/lib/cosmos.ts`
  - 完了条件: 両方にパーティションキー `/id` の `users` が定義されている。
- [x] Step 2: API の認可を追加する
  - 対象ファイル: `src/api/src/lib/auth.ts`、`src/api/src/functions/*.ts`、`src/api/src/functions/me.ts`、`src/api/src/index.ts`
  - 完了条件: `/api/me` 以外の全ハンドラーが `withAuth` で包まれている。未登録と匿名は 403、照合の失敗は 503 になる。
- [x] Step 3: 画面を、許可されるまで操作できない状態にする
  - 対象ファイル: `src/frontend/src/context/AuthContext.tsx`、`src/frontend/src/App.tsx`、`src/frontend/src/components/Layout.tsx`、`src/frontend/src/api/client.ts`
  - 完了条件: 未登録の利用者には、無効なメニューとプロダクト選択、理由のメッセージ、サインアウトだけが表示される。
- [x] Step 4: テストを追加する
  - 対象ファイル: `src/api/test/lib/auth.test.ts`、`src/api/test/functions/me.test.ts`、`src/frontend/test/App.test.tsx`、`src/frontend/test/fetchMock.ts`
  - 完了条件: `npm test` が通る。
- [x] Step 5: ドキュメントを更新する
  - 対象ファイル: `docs/api.md`、`docs/data-model.md`、`docs/architecture.md`、`docs/features.md`、`docs/development.md`、`AGENTS.md`
  - 完了条件: `users` コンテナー、`/api/me`、403、ローカル開発の手順が記載されている。

## 手作業

- [ ] **デプロイの前に**、本番の Cosmos DB（データベース `flyingfish`）に `users` コンテナー（パーティションキー `/id`）を作り、利用者を登録する
  - コンテナーは Bicep のデプロイでも作成されます。先に手で作る場合は、パーティションキーを `/id` にしてください。
  - 登録する値は、実際にサインインして確かめます。ゲスト（B2B）アカウントや、メールアドレスと UPN が違うテナントでは、想像した値と違うことがあるためです。
    1. デプロイ済みのサイトにサインインし、`https://<ホスト>/.auth/me` を開く。
    2. `clientPrincipal.userDetails` の値を控える。
  - Data Explorer で、利用者ごとに次のドキュメントを追加します。`id` は、控えた `userDetails` を**小文字**にした値です。

    ```json
    { "id": "user@example.com" }
    ```

  - 完了条件: 自分の `userDetails` が登録されている（登録しないと自分も締め出されます）。
- [ ] PR プレビュー環境で動作を確認する
  - 完了条件
    - 登録済みのアカウントでは、今までどおり操作できる。
    - 未登録のアカウントでは、メニューとプロダクト選択が無効で、「利用権限がありません」と表示される。
    - 未登録のアカウントで `/api/products` を開くと 403 になる。
- [ ] 確認が済んだら ADR 0015 の状態を「承認」にする
