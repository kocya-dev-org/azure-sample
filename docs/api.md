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

| メソッド | ルート                                         | 説明                                                                                     |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET      | `/products/{productId}/proposals`              | 一覧（登録日の降順）。各要素にスコアを結合して返す                                       |
| POST     | `/products/{productId}/proposals`              | 作成。本文 `{ title, body }`。スコアリングして `proposals` と `scoredItems` に保存 → 201 |
| GET      | `/products/{productId}/proposals/{id}`         | 取得（スコアを含む）                                                                     |
| PUT      | `/products/{productId}/proposals/{id}`         | 更新。本文 `{ title, body }`。スコアリングをやり直す                                     |
| DELETE   | `/products/{productId}/proposals/{id}`         | 削除（スコア付き項目も削除） → 204                                                       |
| POST     | `/products/{productId}/proposals/review`       | 判定。本文 `{ title, body }`。コメントを `text/event-stream`（SSE）のイベントで返す      |
| POST     | `/products/{productId}/transcriptions`         | 音声入力の文字起こし。本文は録音した音声のバイナリ。`{ text }` を返す                    |
| POST     | `/products/{productId}/voice-sessions`         | 音声会話の開始。本文 `{ title?, body? }`（フォームの現在値）。中継のチケットを返す       |
| POST     | `/products/{productId}/voice-sessions/extract` | 音声会話の文字起こしから、提案の記録（タイトルと RICE の項目）を取り出す                 |

- 判定とスコアリングで Foundry の呼び出しに失敗した場合は 502 を返します。判定のコメントが 1 文字も返らなかった場合や、スコアリングの出力が値の範囲外だった場合も 502 です。
- 文字起こし（`transcriptions`）の本文は、録音した音声そのもの（JSON ではない）です（[ADR 0011](../plan/decisions/0011-voice-input-transcription.md)）。
  - `Content-Type` は `audio/webm` か `audio/mp4` です（`;codecs=...` は無視します）。それ以外は 415 を返します。
  - 本文が空なら 400、4 MB を超えたら 413、プロダクトがなければ 404、文字起こしに失敗したら 502 を返します。
  - 音声は保存しません。結果のテキストを返すだけで、提案への追記は画面側で行います。
  - 文字起こしの設定（`FOUNDRY_TRANSCRIBE_*`）が未設定の場合も 502 です。
- 判定のコメントは、Server-Sent Events（`text/event-stream`）で返します。最初の差分が届く前の失敗（400・404・502）は、ほかの API と同じく JSON のエラーで返します。
  - `event: delta` / `data: {"text": "…"}`: コメントの差分です。届いた順につなげて表示します。
  - `event: done` / `data: {}`: 正常に終わったことを示します。
  - `event: error` / `data: {"message": "…"}`: 途中で失敗したことを示します。状態コードは変えられないため、イベントで知らせて終えます。
  - `data` はいつも 1 行の JSON です。`done` も `error` もないまま本文が終わった場合は、クライアントは途中で切れたものとして扱います。
  - 応答ヘッダーは `content-type: text/event-stream`（charset などは付けない）、`cache-control: no-cache`、`x-accel-buffering: no` の 3 つだけです。SWA の経路は、Content-Type が `text/event-stream` と完全に一致するときだけイベントを逐次転送します。charset を付けると、応答全体をためてから圧縮して返します（PR プレビュー環境で確認。[ADR 0005](../plan/decisions/0005-ai-review-streaming.md)）。

- 音声会話の開始（`voice-sessions`）は、中継（App Service）を使うためのチケットを返します（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)・[ADR 0014](../plan/decisions/0014-voice-conversation-gpt-live.md)）。
  - 応答は `{ relayUrl, ticket, expiresAt, maxSeconds }` です。`maxSeconds` は会話の上限（300 秒）です。
  - チケットは `base64url(payload).base64url(HMAC-SHA256)` で、署名の鍵は `REALTIME_TICKET_SECRET` です。payload には、プロダクトの戦略とフォームの現在値から組み立てた指示文、有効期限（5 分）、使い捨ての nonce が入ります。形式は `v: 2` です（`v: 1` はツールの定義を含んでいた古い形式で、中継が拒否します）。
  - `title` は 200 文字、`body` は 8000 文字までです（空でもよい）。超えたら 400、プロダクトがなければ 404、`REALTIME_RELAY_URL` か `REALTIME_TICKET_SECRET` が未設定なら 503 を返します。
- 記録の取り出し（`voice-sessions/extract`）は、会話の文字起こしから、提案の記録を Foundry（`gpt-5-mini`、構造化出力）で取り出します（[ADR 0014](../plan/decisions/0014-voice-conversation-gpt-live.md)）。
  - 本文は `{ title?, body?, transcript: [{ role: "user" | "assistant", text }] }` です。`title`・`body` は開始時と同じくフォームの現在値で、記録と重ならないよう AI に渡します。
  - 応答は `{ record: { title, summary, reach, impact, confidence, effort } }` です。分からない項目は空文字です。サーバーは前後の空白を除き、長さを制限します（タイトル 200 文字、ほかは 1,000 文字）。
  - 長い会話は拒否しません。同じ話者が続く発言をつなげたうえで、新しい発言を優先して 200 件・合計 20,000 文字に収めます。
  - 会話がない・形式が違う（2,000 件を超える場合を含む）場合は 400、プロダクトがなければ 404、Foundry の呼び出しに失敗した場合や出力の形が違う場合は 502 です。
  - 会話の記録は保存しません。

## 音声会話の中継（App Service）

中継は SWA とは別のホスト（`https://<relayAppName>.azurewebsites.net`）で、実装は `src/relay/` です（[ADR 0013](../plan/decisions/0013-voice-conversation-relay.md)・[ADR 0014](../plan/decisions/0014-voice-conversation-gpt-live.md)）。ブラウザーとは HTTPS の POST と SSE だけでやりとりし、Foundry の GPT-Live（`gpt-live-1`、全二重）とは中継が WebSocket（`/openai/v1/live/sessions`）でつなぎます。

| メソッド | ルート                  | 説明                                                                                                                                                                |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/healthz`              | 稼働確認。`{ status: "ok" }`                                                                                                                                        |
| POST     | `/sessions`             | 本文 `{ ticket }`。GPT-Live に接続して `session.start` を送り、`session.started` を受け取ってから `{ sessionId, sessionKey, audioFormat, maxSeconds }` を返す → 201 |
| GET      | `/sessions/{id}/events` | AI の音声と、両者の字幕の断片を SSE で返す。1 セッションにつき 1 本                                                                                                 |
| POST     | `/sessions/{id}/audio`  | マイクの音声（`application/octet-stream`、200 ms ごと。AI が話している間も送る）→ 204                                                                               |
| DELETE   | `/sessions/{id}`        | 会話を終える → 204。中継は `session.close` を送り、`session.closed` までの字幕を SSE に送ってから閉じる（最大 2 秒）                                                |

- `/sessions/{id}` 以下は `Authorization: Bearer <sessionKey>` が必要です。違えば 401、セッションがなければ 404 です。
- CORS は `RELAY_ALLOWED_ORIGINS`（SWA の既定ホストと PR プレビューのホスト）だけを許可し、ほかのオリジンには 403 を返します。プリフライトは 2 時間キャッシュさせます。
- `POST /sessions`: チケットが無効（署名違い・期限切れ・使用済み）なら 401、同時セッションが 4 を超えるなら 429、GPT-Live が開始を受け付けない場合や、10 秒以内に始まらない場合は 502 です。
- `POST /sessions/{id}/audio`: 形式が違えば 415、空なら 400、64 KB を超えたら 413 です。音声は PCM16・24 kHz・モノラル（リトルエンディアン）で、`audioFormat` はいつも `pcm` です。
- 中継は音声を Foundry に転送するだけで、保存しません。ブラウザーから受け付けるのは音声だけで、指示文を変える操作はできません。GPT-Live からの委任（`session.delegation.created`）には、中継が「外部の処理はできないので会話を続ける」と応答します。
- SSE のイベント（`data` は 1 行の JSON）:
  - `audio` / `{ "delta": "<base64>" }`: AI の音声の差分です。
  - `transcript` / `{ "role": "user" | "assistant", "delta": "…" }`: 字幕の断片です。発言の区切りを示すイベントはないので、クライアントは同じ話者の断片を直前の発言につなげます。
  - `closed` / `{ "reason": "…" }`: 会話が終わりました。理由は `client`（利用者が終了）・`time_limit`（上限時間）・`idle`（30 秒間音声が届かない）・`upstream_closed`（GPT-Live が切断）・`disconnected`（SSE が切れた）です。
- SSE の応答ヘッダーは判定と同じ 3 つです（`content-type: text/event-stream`、`cache-control: no-cache`、`x-accel-buffering: no`）。最初に `: ok` を、その後は 15 秒ごとに `: ping` のコメント行を送ります。

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
