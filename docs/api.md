# API 仕様

> MVP の API です。実装は `src/api/src/functions/` にあります。

## 共通事項

- すべて同じ Static Web App ホストの `/api` 配下です。SWA の認証（`authenticated` ロール）で保護されます。
- リクエストとレスポンスの本文は JSON です（判定のストリームだけは例外）。
- エラーは `{ "error": "<日本語の固定メッセージ>" }` で返します。外部サービス（Cosmos DB、Foundry、GitHub）のエラー本文、ヘッダー、スタックトレースは含めません。
- 投稿者や作成者は、`x-ms-client-principal` ヘッダーからサーバーが設定します。リクエスト本文にある値は使いません。
- 投稿者・作成者の `name`（表示名）には、メールアドレス（`userDetails`）を使いません。プリンシパルの `claims` に `name` クレームがあればその値を、なければ `userId` の SHA-256 から作る「ユーザー-xxxxxxxx」（16 進 8 桁）を使います。SWA が API に渡すヘッダーには通常 `claims` が含まれないため、多くの場合は後者になります。以前に保存したデータで `name` がメールアドレスのものは、読み出し時に同じ規則の名前へ置き換えて返します（`src/api/src/lib/person.ts`）。
- 存在しない `productId` を指定すると 404 を返します。

## プロダクト

| メソッド | ルート                  | 説明                                                     |
| -------- | ----------------------- | -------------------------------------------------------- |
| GET      | `/products`             | 一覧（名前順）                                           |
| POST     | `/products`             | 作成。本文 `{ name, strategy, repository? }` → 201       |
| PUT      | `/products/{productId}` | 更新。本文は POST と同じ                                 |
| DELETE   | `/products/{productId}` | 削除。紐づく提案・スコア付き項目・バックログも削除 → 204 |

`repository` は `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$` に一致する必要があります。一致しない場合は 400 を返します。

## 提案

| メソッド | ルート                                   | 説明                                                                                     |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET      | `/products/{productId}/proposals`        | 一覧（登録日の降順）。各要素にスコアを結合して返す                                       |
| POST     | `/products/{productId}/proposals`        | 作成。本文 `{ title, body }`。スコアリングして `proposals` と `scoredItems` に保存 → 201 |
| GET      | `/products/{productId}/proposals/{id}`   | 取得（スコアを含む）                                                                     |
| PUT      | `/products/{productId}/proposals/{id}`   | 更新。本文 `{ title, body }`。スコアリングをやり直す                                     |
| DELETE   | `/products/{productId}/proposals/{id}`   | 削除（スコア付き項目も削除） → 204                                                       |
| POST     | `/products/{productId}/proposals/review` | 判定。本文 `{ title, body }`。コメントを `text/event-stream`（SSE）のイベントで返す      |

- 判定とスコアリングで Foundry の呼び出しに失敗した場合は 502 を返します。判定のコメントが 1 文字も返らなかった場合や、スコアリングの出力が値の範囲外だった場合も 502 です。
- 判定のコメントは、Server-Sent Events（`text/event-stream`）で返します。最初の差分が届く前の失敗（400・404・502）は、ほかの API と同じく JSON のエラーで返します。
  - `event: delta` / `data: {"text": "…"}`: コメントの差分です。届いた順につなげて表示します。
  - `event: done` / `data: {}`: 正常に終わったことを示します。
  - `event: error` / `data: {"message": "…"}`: 途中で失敗したことを示します。状態コードは変えられないため、イベントで知らせて終えます。
  - `data` はいつも 1 行の JSON です。`done` も `error` もないまま本文が終わった場合は、クライアントは途中で切れたものとして扱います。
  - 応答ヘッダーは `content-type: text/event-stream`（charset などは付けない）、`cache-control: no-cache`、`x-accel-buffering: no` の 3 つだけです。SWA の経路は、Content-Type が `text/event-stream` と完全に一致するときだけイベントを逐次転送します。charset を付けると、応答全体をためてから圧縮して返します（PR プレビュー環境で確認。[ADR 0005](../plan/decisions/0005-ai-review-streaming.md)）。

## バックログ

期間（`from`・`to`）は日本時間の日付として扱い、両端の日を含みます。

| メソッド | ルート                                | 説明                                                                                                       |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET      | `/products/{productId}/backlogs`      | 一覧（作成日の降順）                                                                                       |
| POST     | `/products/{productId}/backlogs`      | 作成。本文 `{ from, to }`（`YYYY-MM-DD`、`from` ≤ `to`）→ 201 と作成内容                                   |
| GET      | `/products/{productId}/backlogs/{id}` | 詳細。スナップショットに最新の実装状況・Issue・根拠を結合し、`githubEnabled`・`hasRepository` を付けて返す |

## Phase 2（Want）

| メソッド | ルート                              | 説明                                                                                        |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| PATCH    | `/products/{productId}/items/{id}`  | 実装状況の変更。本文 `{ status }`（`open` または `done`）                                   |
| POST     | `/products/{productId}/issues`      | Issue 起票。本文 `{ itemIds }`。項目ごとの結果（起票した、起票済みでスキップ、失敗）を返す  |
| POST     | `/products/{productId}/issues/sync` | Issue 状態の同期。起票済みで未対応の項目の Issue を確認し、完了で閉じていれば実装済みにする |
| GET      | `/products/{productId}/dashboard`   | 集計。現在の提案数・Issue 起票数・実装済み数、直近 6 か月の月別推移、`githubEnabled`        |

- `issues` の `itemIds` は 1〜10 件です。項目ごとに起票し、成功したらすぐに保存します。起票済みの項目はスキップするため、再実行しても二重に起票しません。
- `issues` は、アプリケーション設定 `ISSUE_GITHUB_TOKEN` が未設定なら 503（「GitHub 連携が未設定です」）を返します。プロダクトにリポジトリが登録されていなければ 400 を返します。
- `githubEnabled` は、トークンが設定されているかどうかの真偽値です。トークンの値は返しません。
- `issues/sync` は本文なしで呼びます。
  - 応答は `{ checked, updated: [{ id, doneAt }], failed }` です。順に、確認した件数、実装済みにした項目、確認または保存に失敗した件数を表します。
  - 実装済みにするのは、Issue の `state_reason` が `completed` または `null` で閉じられた項目だけです。`doneAt` には Issue の `closed_at` を入れます。
  - エラーは `issues` と同じく、トークンが未設定なら 503、プロダクトがなければ 404、リポジトリが未登録なら 400 です。
  - 同じ処理（`src/api/src/lib/issueSync.ts`）を、独立した Function App のタイマー関数が毎日全プロダクトに対して実行します（[ADR 0010](../plan/decisions/0010-issue-status-sync-batch.md)）。
