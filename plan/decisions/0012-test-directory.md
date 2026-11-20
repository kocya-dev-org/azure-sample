# 0012: テストを各 workspace の `test/` に置き、ソースと分ける

- 状態: 承認
- 日付: 2026-11-20

## 背景

これまでテスト（`*.test.ts` / `*.test.tsx`）は、対象コードの隣に置いていた。`src/api/src/` と `src/frontend/src/` には、デプロイするソースとテストが混在している。

- API では、テストが `dist/` に出ると Functions ホストが読み込んで起動に失敗する。これを `tsconfig.build.json` の `**/*.test.ts` の除外と、`scripts/stage-api.mjs` の検査で防いでいた。除外のパターンから外れる名前のファイルを置くと、デプロイ成果物に混ざるおそれがある。
- ヘルパーの置き場所が workspace ごとに違っていた。API は `src/api/test/helpers.ts`、フロントエンドは `src/frontend/src/test/` にあった。
- ソースのディレクトリを見たとき、デプロイ対象のファイルとテストを見分けにくい。

検討した選択肢:

| 選択肢                                                              | 判断                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A. 各 workspace 直下の `test/` に、`src/` と同じ構成で置く          | 採用。ビルド対象の `src/` にテストがなくなり、対象コードとの対応も保てる           |
| B. 対象コードの隣に置いたままにする                                 | 不採用。デプロイ対象からテストを除く仕組みが、除外パターンの設定頼みになる         |
| C. `src/**/__tests__/` に置く                                       | 不採用。テストが `src/` の中に残り、ビルド対象から構造的に分けられない             |
| D. リポジトリのルートに `test/` を置き、両 workspace のテストを置く | 不採用。workspace の外に出ると、各 workspace の設定（tsconfig、alias）を使いにくい |

## 決定

1. **テストは各 workspace 直下の `test/` に置く。** `test/` の中は `src/` と同じディレクトリ構成にする。
   - 例: `src/api/src/functions/backlogs.ts` のテストは `src/api/test/functions/backlogs.test.ts`。
   - 例: `src/frontend/src/pages/Backlogs.tsx` のテストは `src/frontend/test/pages/Backlogs.test.tsx`。
2. **ヘルパーは各 `test/` 直下に置く。**
   - API: `src/api/test/helpers.ts`（既存）。
   - フロントエンド: `src/frontend/src/test/{setup.ts,fetchMock.ts}` を `src/frontend/test/{setup.ts,fetchMock.ts}` へ移す。
3. **import の書き方を workspace ごとに決める。**
   - API のテストは、ソースを相対パスで import する（例: `'../../src/lib/store'`）。API には path alias がなく、ビルドに alias の解決処理を足したくないため。
   - フロントエンドのテストは、テスト対象を `@/` alias で import する。Vite と tsconfig に alias が既にあるため。
4. **設定を次のようにする。**
   - API: 型検査用の `tsconfig.json`（`noEmit`）は `src/**` と `test/**` を含む。ビルド用の `tsconfig.build.json` は `src/**/*.ts` だけを対象にし、`**/*.test.ts` の除外は保険として残す。
   - フロントエンド: `tsconfig.json` の `include` に `test` を足す。`vite.config.ts` の `setupFiles` は `./test/setup.ts` にする。

## 結果・影響

- デプロイ対象の `src/` にテストがなくなる。API のテストは、ビルドの対象範囲から構造的に外れる。
- `scripts/stage-api.mjs` のテストファイルの検査は、そのまま残す。
- API のテストの import は、相対パスが長くなる（`'../../src/...'`）。テストを移すときは、深さに合わせて書き換える必要がある。
- テストを追加するときは、対象コードと同じ相対パスで `test/` の下に置く。ソースを移動したら、対応するテストも同じ場所へ移す。
- `plan/` の過去のチェックリストにある、移動前のテストのパスは履歴として書き換えない。
