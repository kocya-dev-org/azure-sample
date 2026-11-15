# 0002: フロントエンドと開発ツールチェーンの選定

- 状態: 承認
- 日付: 2026-11-15

## 背景

静的 HTML 1 枚のサンプルから、継続的に機能追加するプロダクトへ移行する。フロントエンドとツールチェーンを決め、frontend と api の両方で同じ品質チェックを回せる土台が必要。

## 決定

| 領域 | 採用 | 備考 |
| --- | --- | --- |
| ランタイム | Node.js 24 | `.node-version` で固定。API 実行ランタイムは ADR 0001 に従う |
| フロントエンド | React + TypeScript の SPA | SWA の静的ホスティングで配信。`navigationFallback` で SPA ルーティング |
| ビルド / dev server | Vite | dev server は `/api` を Functions ホストへプロキシ |
| テスト | vitest | ルートの `vitest.config.ts` の `test.projects` で frontend（jsdom）と api（node）を束ねる |
| lint | oxlint | ESLint は導入しない |
| format | oxfmt | Prettier は導入しない |
| パッケージ管理 | npm workspaces | ルート `package-lock.json` に一本化 |

## 選定時点の確認結果（2026-11-15, npm registry）

| パッケージ | 最新安定版 | engines.node / 注意点 |
| --- | --- | --- |
| oxlint | 1.93.0 | `^20.19.0 \|\| >=22.12.0`。設定は `.oxlintrc.json`。TypeScript プラグインは既定で有効、react / vitest はフラグまたは設定で有効化 |
| oxfmt | 0.78.0 | 同上。整形チェックは `--check`、設定は `.oxfmtrc.json`（`--init` で生成）。`.gitignore` を参照 |
| vite | 8.3.8 | `^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.3.0 | vite `^8` が必要 |
| vitest | 5.1.0 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`、vite `^6.4 \|\| ^7 \|\| ^8` |
| react / react-dom | 19.3.1 | — |
| jsdom | 31.0.1 | `^24.15.0` 以上が必要（Node 24 系は 24.15 以降に固定する） |
| @testing-library/react | 16.3.3 | `@testing-library/dom` ^10 を peer として明示インストール |
| typescript | 7.0.2 | API は現在 5.9 系。Step 3 で 7 系へ揃えるか判断する |
| @types/node | 24.19.2（24 系最新） | ADR 0001 の結果で 22 系に下げる可能性あり |
| @azure/functions | 4.17.1 | `>=20.0` |

ローカル環境の Node.js が v26 の場合は、Node.js 24（24.15 以降）に切り替えてから作業する。

## 理由

- Vite・vitest・oxlint・oxfmt は設定が少なく高速で、frontend / api 共通のルート設定にまとめやすい。
- npm workspaces は追加ツールなしで lockfile とスクリプトを一元化できる。

## 結果・影響

- ルートに `package.json` を置く（旧 AGENTS.md の「ルートに manifest なし」を廃止）。
- workspaces で依存がルートに hoist されるため、SWA マネージド API のデプロイでは本番依存だけを入れたステージングディレクトリを CI で作る。
- API のテストファイルは `tsconfig.build.json` でビルド対象から外し、`dist/` に出力しない（Functions ホストが `dist/src/functions/*.js` をすべて読み込むため）。
- oxfmt はまだ若いツールのため、整形結果の差分やルール変更に注意する。問題が大きい場合はこの ADR を見直す。
