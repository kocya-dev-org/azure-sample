# 0001: SWA マネージド Functions での Node.js 24 利用

- 状態: 検証待ち
- 日付: 2026-11-15

## 背景

プロダクトの開発・ビルド・API 実行を Node.js 24 で統一したい。一方、インフラは SWA (Free) のマネージド Functions を維持する方針とした（BYO Functions は採用しない）。

確認時点の情報:

- Microsoft Learn「Static Web Apps の言語とランタイム」では、マネージド Functions の Node.js は 18 / 20 / 22 のみ記載されており、未記載のバージョンは BYO Functions の利用が案内されている。
  - https://learn.microsoft.com/azure/static-web-apps/languages-runtimes
- SWA のビルド（Oryx）イメージが Node.js 24 に未対応との報告がある（2026 年 1 月時点の情報）。

## 決定（暫定）

1. ビルドは GitHub Actions 上の Node.js 24 で行い、SWA にはビルド済み成果物をアップロードする（`skip_app_build: true` / `skip_api_build: true`）。SWA 側のビルドには依存しない。
2. `staticwebapp.config.json` の `platform.apiRuntime` に `node:24` を指定し、PR プレビュー環境で実デプロイして検証する。
3. 検証で `node:24` が使えない場合は、API の実行ランタイムのみ `node:22` に留める。
   - `src/api/package.json` の `engines` と `@types/node` は実行ランタイムに合わせる。
   - 開発・CI ビルドは Node.js 24 のまま。API コードは Node.js 22 互換を保つ。
   - マネージド Functions が Node.js 24 に対応した時点で `apiRuntime`・`engines`・`@types/node` を同時に更新する。

## 検証項目

- [ ] PR プレビュー環境へのデプロイが成功する（`apiRuntime: node:24`）
- [ ] プレビュー環境で `/api/goodbye` が 200 を返す
- [ ] 不可の場合、`node:22` に切り替えて同じ確認が通る

## 結果・影響

検証後に記入し、状態を「承認」に更新する。
