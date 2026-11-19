# 0005: 生成 AI による判定コメントのストリーミング方式

- 状態: 承認
- 日付: 2026-11-15（承認 2026-11-19）

## 背景

提案を確定すると、生成 AI が RICE に必要な情報がそろっているかを判定する。足りない情報を求めるコメントは、ストリームで少しずつ表示する必要がある。

制約:

- Microsoft Foundry の API キーをブラウザーに渡してはいけない。Foundry はサーバー（SWA マネージド Functions）からだけ呼ぶ。
- Azure Functions Node.js v4 の HTTP ストリーミングには、`app.setup({ enableHttpStream: true })` と、対応するバージョンの `@azure/functions` とホストが必要になる。
- SWA マネージド Functions の前段にあるプロキシが、レスポンスをまとめてから返す可能性がある。現時点では確認できていない。
- マネージド Functions のリクエストには約 45 秒の制限時間がある。

## 結論（2026-11-19）

判定コメントは Server-Sent Events で返す。応答ヘッダーは次の 3 つだけにする。

- `content-type: text/event-stream`（charset なし）
- `cache-control: no-cache`
- `x-accel-buffering: no`

SWA マネージド Functions の経路は、Content-Type が `text/event-stream` と完全に一致するときだけ、イベントを逐次転送する。`text/event-stream; charset=utf-8` や `text/plain` では、応答全体をためて Brotli で圧縮してから返す。経緯と測定結果は「結果・影響」に記録した。ポーリング（決定 3）は採用しない。

## 決定（当初の暫定案）

1. まず HTTP ストリーミングを試す。`POST /api/products/{productId}/proposals/review` が Foundry のストリームを `text/plain` のチャンクとしてそのまま中継し、クライアントは `response.body.getReader()` で読みながら表示する。
2. 実装の前に、固定テキストを 1 秒ごとに返す検証用エンドポイントを PR プレビュー環境にデプロイする。ブラウザーにチャンクが少しずつ届くかを確認する。
3. 届かない場合は、次の代替案（ポーリング）に切り替える。
   - `POST review` は Foundry のストリームを受けながら、途中までのテキストを約 1 秒ごとに Cosmos DB の一時ドキュメントに書き込む。保存先は `proposals` コンテナー、`type: 'review'`、TTL は 3600 秒とする。
   - クライアントは `POST` を送った後、完了するまで `GET review/{reviewId}` を約 1 秒ごとに呼んで少しずつ表示する。
4. どちらの方式でも、制限時間に収まるよう出力を短くする。reasoning effort は low、出力上限トークン数を設定し、目安は 600 字以内とする。

## 検証項目

- [x] PR プレビュー環境で、検証用エンドポイントのチャンクが少しずつ届く（`text/event-stream` ちょうどの場合だけ）
- [ ] Foundry の `gpt-5-mini` デプロイで `stream: true` が使える
- [ ] 判定が 45 秒以内に終わる

## 結果・影響

検証後に、採用した方式と結果を追記し、状態を「承認」に更新する。

### 実装状況（2026-11-16）

- 決定 1 の HTTP ストリーミングを実装した。`src/api/src/index.ts` で `app.setup({ enableHttpStream: true })` を呼び、`POST /api/products/{productId}/proposals/review` が Foundry の差分を `ReadableStream` で返す。
- 検証用に `GET /api/diag/stream`（1 秒ごとに 1 行）を追加した。PR プレビュー環境で確認後に削除する。
- クライアント（`streamReview`）は、応答がまとめて届いた場合も同じ処理で表示できる。そのため、プロキシがまとめて返す場合でも機能は動き、少しずつ表示されないだけになる。その場合は決定 3 のポーリングに切り替えるかを判断する。
- コメントが 1 文字も返らない場合（推論だけで出力上限に達した場合など）は 502 を返す。

### text/plain での確認結果と SSE への切り替え（2026-11-19）

- デプロイ済みの環境で `GET /api/diag/stream`（`text/plain`、1 秒ごとに 1 行）を開くと、約 5 秒後にまとめて届いた（ユーザーによる確認）。Foundry を通らない応答でも一括になるため、SWA マネージド Functions の経路（前段のプロキシ、またはホスト）でバッファリングされている。検証項目 1 は未達。
- プロキシ類は `text/event-stream` を逐次転送の対象として扱うことが多いため、判定の応答を Server-Sent Events に切り替えた。これは仮説で、SWA で効くかは未確認。
  - イベントは `delta`（`{ text }`）・`done`（`{}`）・`error`（`{ message }`）。`data` は 1 行の JSON。形式は `docs/api.md` に記載する。
  - 最初に約 2 KB のコメント行（パディング）を送り、プロキシの初期バッファーを押し出す。
  - ヘッダーは `content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache, no-transform`、`x-accel-buffering: no`。
  - 途中の失敗は、本文の末尾に文言を足すのではなく `error` イベントで知らせる。クライアントは届いたコメントを残してエラーを表示し、入力に戻る（不完全なコメントのまま「このまま送信」はさせない）。
  - クライアントは `EventSource` ではなく `fetch` で読む（POST が必要なため）。パーサーは `src/frontend/src/api/sse.ts`。新しい依存関係はない。
- 比較用に、`GET /api/diag/stream?format=sse` で同じ内容を SSE で返せるようにした。
- 判断基準（PR プレビュー環境で確認する）:
  - `?format=sse` が 1 秒ごとに届き、判定コメントも少しずつ表示される → SSE を採用し、状態を「承認」にする。検証用エンドポイントは別の PR で削除する。
  - `?format=sse` もまとめて届く → ホスト側でバッファリングされていると判断し、決定 3 のポーリングに進む。
  - `?format=sse` は逐次届くのに判定コメントだけまとめて届く → Foundry 側（コンテンツフィルターの非同期ストリーミング設定など）を調べる。
- 確認結果（2026-11-19、PR #16 のプレビュー環境、ユーザーによる確認）: ブラウザーのコンソールから `fetch` で本文を読み、チャンクが届くたびに経過時間を出力した。
  - `text/plain`: 1 チャンクだけ、4124 ms で届いた（5 行がまとめて 1 回）。
  - `?format=sse`: 1 チャンクだけ、5125 ms で届いた（パディング・5 件の `delta`・`done` がまとめて 1 回。`done` の前にも 1 秒待つため、`text/plain` より約 1 秒遅い）。
  - どちらも、応答の生成が終わるまで 1 バイトも届いていない。`content-type` やパディングに関係なく、SWA マネージド Functions の経路で応答全体がためられている。SSE への切り替えでは解消しない。
  - 判断基準どおりならポーリングに進むが、その前に、SWA の経路で逐次届かない原因の候補を切り分ける（次の節）。

### SSE が逐次届かない原因の切り分け（2026-11-19）

Node.js v4 の HTTP ストリーミングに SSE を載せることはできるが、SWA の公式資料は SSE への対応を明記していない。参考にした記事（Zenn の C# の例、shibayan 氏の Node.js v4 の例）は、どちらもローカルの Functions ホストでの確認で、SWA の経路は試していない。そこで、`/api/diag/stream` にクエリを足し、次の仮説をプレビュー環境の 1 回の測定で比べられるようにした。

| 仮説                                                 | 試し方                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| プロキシが 2 KB より大きいバッファーをためている     | パディングを 0 / 2 KB / 16 KB / 64 KB で比べる（`pad`）                                             |
| 途中で圧縮がかかり、そのためにためている             | `content-encoding: identity` を付ける版（`identity=1`）と比べ、応答の `content-encoding` も記録する |
| Web 標準の `ReadableStream` ではホストが逐次送らない | Node.js の `Readable.from` で返す版（`impl=node`）と比べる                                          |
| SWA の `/api` の 45 秒の上限                         | 1 秒ごとに 50 件を送る版（`count=50`）で、どこで切れるかを測る                                      |

- 判断基準: どれかの組み合わせでチャンクが約 1000 ms 間隔で届けば、その設定を判定 API に入れる。どの組み合わせでも 1 チャンクにまとまれば、SWA マネージド Functions の経路では逐次送信できないと判断し、決定 3 のポーリングに進む。
- 測定結果（2026-11-19、PR #16 のプレビュー環境、ユーザーによる確認）: すべて 1 チャンクにまとまって届いた。応答は既定で Brotli（`br`）で圧縮されていた（`cache-control: no-transform` を付けていても）。

  | ケース                 | content-encoding | 受信                  |
  | ---------------------- | ---------------- | --------------------- |
  | plain                  | br               | 4114 ms に 1 チャンク |
  | sse（パディング 2 KB） | br               | 5116 ms に 1 チャンク |
  | sse + パディング 16 KB | br               | 5087 ms に 1 チャンク |
  | sse + パディング 64 KB | br               | 5085 ms に 1 チャンク |
  | sse + `identity=1`     | identity         | 5088 ms に 1 チャンク |
  | sse + `impl=node`      | br               | 5088 ms に 1 チャンク |
  - パディング量・圧縮・ストリームの実装は原因ではない。
  - この時点の SSE のヘッダーは `content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache, no-transform`、`x-accel-buffering: no`、`x-content-type-options: nosniff` だった。

### Content-Type の完全一致（2026-11-19）

- Azure Web App で SSE が逐次届かなかった事例で、`Content-Type` を `text/event-stream` ちょうど（charset なし）にし、`Cache-Control: no-cache` と `X-Accel-Buffering: no` を付けると届いたという報告がある（https://stackoverflow.com/questions/78584265/fastapi-sse-working-locally-but-not-in-azure-web-app ）。Azure の前段のプロキシは、Content-Type が完全に一致するときだけ逐次転送に切り替えるとみられる。
- そこで `SSE_HEADERS`（`src/api/src/lib/sse.ts`）を、この 3 つだけにした。判定 API も同じヘッダーになる。比較のため、`/api/diag/stream?format=sse&legacy=1` で以前のヘッダーを返せるようにした。
- 判断基準: `?format=sse` が約 1000 ms 間隔で届き、`legacy=1` は 1 チャンクのままなら、完全一致が条件だったと確定する。そのうえで、提案フォームでも少しずつ表示されるかを確かめる。どちらも 1 チャンクなら、ポーリング（決定 3）に進む。
- 測定結果（2026-11-19、PR #16 のプレビュー環境、ユーザーによる確認）: Content-Type の完全一致が条件だった。

  | ケース                                 | 受け取った content-type            | content-encoding | 受信                                                       |
  | -------------------------------------- | ---------------------------------- | ---------------- | ---------------------------------------------------------- |
  | sse（新しいヘッダー、パディング 2 KB） | `text/event-stream`                | なし             | 101 ms / 1100 / 2103 / 3103 / 4117 / 5103 ms の 6 チャンク |
  | sse + `legacy=1`（以前のヘッダー）     | `text/event-stream; charset=utf-8` | br               | 5082 ms に 1 チャンク                                      |
  | sse + パディングなし（`pad=0`）        | `text/event-stream`                | なし             | 79 ms / 1086 / 2085 / 3085 / 4085 / 5086 ms の 6 チャンク  |
  | sse + `identity=1`                     | `text/event-stream`                | identity         | 96 ms / 1231 / 2091 / 3090 / 4090 / 5085 ms の 6 チャンク  |
  - Content-Type が `text/event-stream` ちょうどなら、SWA の経路はイベントを約 1 秒ごとに逐次転送し、圧縮もかけない。charset が付くと、応答全体をためて Brotli で圧縮する。
  - パディングがなくても逐次届く。
  - 残りの確認: 提案フォームの判定コメントが少しずつ表示されること。

### 後片付け（2026-11-19）

- 検証用エンドポイント `GET /api/diag/stream` を削除した。
- 最初に送っていた約 2 KB のパディング（コメント行）は、なくても逐次届いたため削除した。クライアントのパーサーは、SSE の仕様どおりコメント行を読み飛ばす処理を残している。
- 比較用に残していた以前のヘッダー（`LEGACY_SSE_HEADERS`）を削除した。
- `app.setup({ enableHttpStream: true })` は SSE に必要なので残す。
