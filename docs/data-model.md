# データモデル

> MVP のデータモデルです。コンテナーは API の初回アクセス時にも作成されます（[ADR 0008](../plan/decisions/0008-create-containers-on-first-use.md)）。コンテナー構成の判断は [ADR 0004](../plan/decisions/0004-cosmos-containers.md) にあります。

Cosmos DB for NoSQL のデータベース `flyingfish`（共有スループット 400 RU/s）に、次の 4 つのコンテナーを置きます。

- プロダクト以外のデータは、すべて `productId` でプロダクトに紐づけます。
- 提案の元データ（`proposals`）と、スコアや実装状況を加えた項目（`scoredItems`）は分けて保存します。
- 日時はすべて ISO 8601 形式（UTC）の文字列です。ID はサーバーで生成する UUID です。

| 関係                         | 多重度                                 |
| ---------------------------- | -------------------------------------- |
| products → proposals         | 1 対多                                 |
| proposals → scoredItems      | 1 対 1（同じ `id`）                    |
| scoredItems → backlogs.items | 1 対多（複数のバックログに含まれ得る） |

## products（パーティションキー `/id`）

| フィールド   | 型      | 説明                               |
| ------------ | ------- | ---------------------------------- |
| `id`         | string  | プロダクト ID                      |
| `name`       | string  | 名前（必須）                       |
| `strategy`   | string  | 狙い、開発戦略、将来像など（必須） |
| `repository` | string? | GitHub の `org/repo`（任意）       |
| `createdAt`  | string  | 作成日時                           |
| `updatedAt`  | string  | 更新日時                           |

## proposals（パーティションキー `/productId`）

提案の元データです。入力された内容だけを持ち、スコアは持ちません。

| フィールド  | 型     | 説明                                                                                                                                   |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | string | 提案 ID                                                                                                                                |
| `productId` | string | プロダクト ID                                                                                                                          |
| `title`     | string | タイトル                                                                                                                               |
| `body`      | string | 内容（追記を含む最終版）                                                                                                               |
| `author`    | object | `{ userId, name }`。SWA の `x-ms-client-principal` から設定。`name` は表示名で、メールアドレスは保存しない（[API の共通仕様](api.md)） |
| `createdAt` | string | 登録日時。バックログの期間判定に使う                                                                                                   |
| `updatedAt` | string | 更新日時                                                                                                                               |

コンテナーは TTL を有効（既定 -1 で無期限）にしています。[ADR 0005](../plan/decisions/0005-ai-review-streaming.md) の代替案（判定途中のテキストを一時ドキュメントとして保存するポーリング方式）のために用意した設定です。判定は SSE で返すことにしたため、今は一時ドキュメントを保存していません。

## scoredItems（パーティションキー `/productId`）

スコアリング済みの項目です。提案と 1 対 1 で、`id` は提案の `id` と同じ値です。

| フィールド          | 型      | 説明                                                                       |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| `id`                | string  | 提案 ID と同じ値                                                           |
| `productId`         | string  | プロダクト ID                                                              |
| `proposalId`        | string  | 提案 ID                                                                    |
| `title`             | string  | 項目名（提案のタイトルを複製）                                             |
| `rice`              | object  | `{ reach, impact, confidence, effort, score, rationale }`                  |
| `strategyFit`       | object  | `{ score, rationale }`。`score` は 0〜100 の整数                           |
| `status`            | string  | `open`（未対応）または `done`（実装済み）。初期値 `open`（Phase 2 で編集） |
| `doneAt`            | string? | 実装済みにした日時（Phase 2、ダッシュボードの集計に使う）                  |
| `issue`             | object? | `{ number, url, createdAt }`（Phase 2）                                    |
| `proposalCreatedAt` | string  | 提案の登録日時（期間での絞り込み用）                                       |
| `scoredAt`          | string  | スコアリングした日時                                                       |

提案を編集すると、`title`・`rice`・`strategyFit`・`scoredAt` を更新します。`status`・`doneAt`・`issue` は残します。

## backlogs（パーティションキー `/productId`）

作成した時点の上位 10 件のスナップショットです。

| フィールド  | 型     | 説明                                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------------- |
| `id`        | string | バックログ ID                                                                       |
| `productId` | string | プロダクト ID                                                                       |
| `from`      | string | 期間の開始日（`YYYY-MM-DD`、その日を含む）                                          |
| `to`        | string | 期間の終了日（`YYYY-MM-DD`、その日を含む）                                          |
| `items`     | array  | `[{ scoredItemId, rank, title, riceScore, strategyFitScore }]`（最大 10 件）        |
| `createdAt` | string | 作成日時                                                                            |
| `createdBy` | object | `{ userId, name }`。`author` と同じく `name` は表示名で、メールアドレスは保存しない |

詳細画面では、`items` の各要素に `scoredItems` の最新の `status`・`issue`・根拠を結合して返します。元の提案が削除された項目は、削除済みと表示します。

## users（パーティションキー `/id`）

利用を許可する利用者の一覧です。Azure Portal の Data Explorer で手作業で登録します（[ADR 0015](../plan/decisions/0015-user-allowlist.md)）。画面には表示しません。登録する値は、その利用者がサインインした状態で `/.auth/me` を開き、`clientPrincipal.userDetails` で確かめてください。

| フィールド | 型     | 説明                                                                               |
| ---------- | ------ | ---------------------------------------------------------------------------------- |
| `id`       | string | Entra の UPN（`x-ms-client-principal` の `userDetails`）を小文字にした値。必須です |

`id` 以外のフィールド（メモなど）は自由に追加できますが、API は使いません。

## 削除時の扱い

- **提案を削除する**: `proposals` と `scoredItems` の該当ドキュメントを削除します。作成済みのバックログのスナップショットは残ります。
- **プロダクトを削除する**: `products` のドキュメントと、`proposals`・`scoredItems`・`backlogs` の同じ `productId` のパーティション内のドキュメントをすべて削除します。
