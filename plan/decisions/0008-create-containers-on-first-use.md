# 0008: Cosmos DB コンテナーを API の初回アクセス時にも作成する

- 状態: 承認
- 日付: 2026-11-16

## 背景

[ADR 0004](./0004-cosmos-containers.md) で、Cosmos DB のコンテナー `products`・`proposals`・`scoredItems`・`backlogs` を Bicep で定義すると決めた。

ところが、deploy ワークフローがインフラ（Bicep）をデプロイするのは `main` への push と手動実行のときだけで、PR では行わない。PR プレビュー環境のアプリケーション設定は本番と共通で、接続先も本番と同じ Cosmos DB アカウントになる。そのため、`main` にマージされるまではコンテナーが存在せず、プレビュー環境で MVP を確認できない。

## 決定

1. API（`src/api/src/lib/cosmos.ts`）は、各コンテナーに初めてアクセスするときに `createIfNotExists` で作成する。パーティションキーと TTL は Bicep と同じ定義にする。
2. Bicep の定義も残し、本番の正とする。コンテナーの定義を変えるときは、`infra/main.bicep` と `src/api/src/lib/cosmos.ts` の `CONTAINER_DEFINITIONS` を同じ変更で更新する。
3. Cosmos DB のアカウント、データベース、スループットは変えない。共有スループット（400 RU/s）のデータベースにコンテナーを追加するだけなので、費用は増えない。

## 結果・影響

- PR プレビュー環境でも、マージ前に MVP の操作を確認できる。
- プレビュー環境と本番は、同じ Cosmos DB のデータを読み書きする。プレビューで登録したデータは本番にも表示される。PoC として受け入れるが、確認用のデータは確認後に削除する。
- ローカルキー認証（接続文字列）を使うため、管理操作（コンテナー作成）もキーで実行できる（`disableKeyBasedMetadataWriteAccess: false`）。この設定を変える場合は、この ADR を見直す。
