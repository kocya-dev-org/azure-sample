# 0013. 提案の音声会話を、App Service（F1）上の HTTP 中継で Foundry の Realtime API につなぐ

- 状態: 検証待ち
- 日付: 2026-11-21

## 背景

提案フォームに「音声会話」ボタンを追加したい。`voice-stt-foundary` にデプロイした `gpt-realtime-2.1-mini` と話しながら、RICE のスコア算出に必要な情報（Reach・Impact・Confidence・Effort）を AI に聞き出してもらい、フォームに書き込む。

前提と制約は次のとおり。

- 利用者の環境では WebRTC（UDP）がブロックされる。
- SWA マネージド Functions は WebSocket を扱えない。ブラウザーからの WebSocket は通る。
- 中継用のトークン（チケット）の発行は、マネージド Functions で行ってよい。
- ユーザーは当初、TURN サーバーを App Service（F1）に立てることを想定していた。
- 新しいデータは増やさない。会話の結果は「タイトル」「内容」に反映するだけで、保存は既存の「判定 → 送信」で行う。音声と会話の記録は保存しない。

検討した選択肢:

| 選択肢                                                                                                                              | 判断                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A. App Service F1 に TURN（coturn など）を立て、WebRTC を TURN 経由で通す                                                           | 不採用。App Service が公開するのは 80/443 の HTTP/HTTPS だけで、UDP も生の TCP/TLS も通らない |
| B. ACI か VM に TURN を立てる                                                                                                       | 不採用。F1 ではなくなり、インフラ構成が大きく変わる                                           |
| C. App Service F1 に HTTP 中継を置く。ブラウザー ⇔ 中継は HTTPS（音声は POST、応答は SSE）、中継 ⇔ Foundry はサーバー間の WebSocket | 採用。既存の判定ストリーム（ADR 0005）が SSE で動いており、同じ環境で通る見込み               |
| D. ブラウザー ⇔ 中継を WebSocket にする                                                                                             | 不採用。F1 の Linux は WebSocket が 5 接続までで、中継から Foundry への接続と枠を分け合う     |
| E. Functions がエフェメラルキー（`/openai/v1/realtime/client_secrets`）を発行し、中継はキーを持たない                               | 不採用。エフェメラルキーは WebRTC 用としてしか文書化されておらず、WebSocket で使えるかが不明  |

## 決定

1. **App Service F1（Linux、Japan West）に中継を置く。**（当初は Japan East。末尾の追記を参照） これは新しいデプロイ単位で、ADR 0011 の「既存のサービス構成は変えない」からの意図的な変更である。
   - Bicep で App Service プランと Web App を作る。
   - アプリ設定は、日次バッチ（ADR 0010）と同じく Bicep の `appSettings` に定義する。
2. **中継は依存を追加しない。** HTTP サーバーには `node:http` を、Foundry への接続には Node.js 組み込みの `WebSocket` を使う。コードは新しい workspace の `src/relay/` に置く。（Foundry への接続は、疎通確認の結果 `ws` パッケージに変えた。末尾の追記を参照）
   - 実行ランタイムは App Service の `NODE|24-lts` とする。ただし Linux F1 で Node 24 を選べるかは未確認のため、`src/relay` の `engines` と `@types/node` は API と同じく Node 22 互換にしておく。Node 24 を選べることを確かめたら、24 にそろえる。
3. **認証は 2 段階にする。**
   - Functions（SWA 認証の内側）が、`POST /api/products/{productId}/voice-sessions` で短命のチケットを発行する。
     - 署名は HMAC-SHA256 で、形式は `base64url(payload).base64url(sig)`。有効期限は 5 分（F1 のコールドスタートで期限が切れないよう長めにし、使い回しは nonce で防ぐ）。
     - payload には、プロダクトの戦略とフォームの現在値から組み立てた指示文とツール定義を含める。プロンプトは `src/api/src/lib/prompts.ts` に置いたままにする。
   - 中継はチケットを検証する（署名、期限、nonce の再利用の禁止）。そのうえでランダムなセッションキーを返し、以降の要求は `Authorization: Bearer <sessionKey>` で認証する。
   - 署名の鍵は repository secret `REALTIME_TICKET_SECRET` で、SWA API と中継の両方に設定する。
4. **Foundry のキーは中継だけが持つ。** 同じリソースの既存 secret `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY` を再利用する。
   - 中継は、設定済みのエンドポイント（`FOUNDRY_REALTIME_ENDPOINT`）にだけ接続する。オープンリレーにしない。
   - URL は `wss://<resource>.openai.azure.com/openai/v1/realtime?model=<deployment>` で、`api-version` は付けない。キーは `api-key` ヘッダーで渡す。
5. **中継のプロトコル**
   - `POST /sessions`: チケットを受け取ってセッションを開く。
   - `GET /sessions/{id}/events`: SSE で応答を返す。
     - 転送するのは、出力音声、両者の文字起こし、ツール呼び出し、発話の開始、エラー、終了だけ。
     - 15 秒ごとにハートビートを送る。
   - `POST /sessions/{id}/audio`: 音声をバイナリで受け取る（200 ms ごと）。
   - `DELETE /sessions/{id}`: セッションを閉じる。
   - `session.update` は中継だけが送る。ブラウザーから受け付けるのは音声だけ。
   - ツール呼び出し（`record_proposal_info`）は、ブラウザーへ転送したうえで、中継が `function_call_output` と `response.create` を自動で返す。
   - CORS は `RELAY_ALLOWED_ORIGINS`（SWA の既定ホストと PR プレビューのホスト）で判定する。ホスト名の `*` は英数字とハイフンにだけ一致させ、`.` をまたがせない。音声の POST ごとにプリフライトが走らないよう、`Access-Control-Max-Age` は 7200 秒にする。
   - 実装上の注意:
     - Foundry の `session.created` は汎用の人格・ツールなしの既定セッションなので、`session.update` が拒否されたり時間内（10 秒）に反映されなかったりしたら、`POST /sessions` を 502 にして閉じる。
     - `response.create` は応答中に送るとエラーになるため、ツールの結果は `response.done` を受けてから返す。
     - AI の最初の発言は、ブラウザーが SSE をつないでから作らせる（先に作ると最初の音声が届かない）。
     - SSE のヘッダーは判定（ADR 0005）と同じ 3 つにし、最初に `: ok` を書いてヘッダーを送り出す。
     - ブラウザーは、iOS Safari で音を出せるよう、クリックの処理の中で `await` より前に `AudioContext` を作ってマイクを要求する。Firefox はマイクと周波数の違う `AudioContext` をつなげないため、マイクの周波数のまま取り込み、送信用の周波数への変換は自前で行う。音声の POST は順番が入れ替わらないよう 1 つずつ送る。
6. **上限を設ける。**
   - 時間: 会話は最大 5 分。30 秒間通信がなければ閉じる。
   - 同時セッション: 4 まで（WebSocket の 5 接続の枠より内側）。
   - 本文: 音声 1 チャンク 64 KB、チケット 128 KB（指示文にフォームの内容が最大 8000 文字入るため）。
7. **音声形式は設定（`REALTIME_AUDIO_FORMAT`）で切り替える。**
   - Foundry が `audio/pcmu`（G.711 μ-law、8 kHz）を受け付けるなら、それを使う。
   - 受け付けなければ `audio/pcm`（PCM16、24 kHz）を使う。

## 結果・影響

App Service F1 の制限（Azure のサービス制限のページ。2026-09 更新）:

| 項目               | F1 の制限                                                  |
| ------------------ | ---------------------------------------------------------- |
| CPU 時間           | 60 分/日、3 分/5 分                                        |
| 帯域               | 165 MB/日                                                  |
| Linux の WebSocket | 5 接続まで                                                 |
| Always On          | なし（アイドル時にアンロードされ、初回はコールドスタート） |
| スケールアウト     | 1 インスタンス（共有）                                     |

インスタンスが 1 つなので、セッションの状態はメモリーに持てる。

**帯域が最大のボトルネックになる。**

- PCM16・24 kHz は 48 KB/s で、base64 にすると約 64 KB/s。サーバー VAD のため、マイクの音声は無音の間も送り続ける。
- このため、5 分の会話で中継からの送信が 20〜30 MB になり、1 日 5 回程度で上限に達する。
- μ-law（8 KB/s）なら約 1/6 になる。
- 実測値は検証後にこの ADR に追記する。

検証待ちの事項:

- `audio/pcmu` を受け付けること。
- App Service の Linux F1 で Node 24 を選べること。選べなければ 22 LTS にし、ここに追記する。
- WebRTC がブロックされる実際の環境で、POST と SSE だけで会話が成り立つこと。

後続タスク:

- `conversation.item.truncate` で、割り込んだ時点の AI の発言を切り詰める。
- `docs/architecture.drawio` に中継を追加する。

## 追記（2026-11-21）: Foundry への接続には `ws` パッケージを使う

疎通確認の結果、決定 2 のうち「Foundry への接続に Node.js 組み込みの `WebSocket` を使う」をやめる。

- **v1 のパスとヘッダーの認証は通った。**
  - `curl --http1.1` で、`wss://voice-stt-foundary.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1-mini` に `api-key` ヘッダーを付けて接続した。
  - `101 Switching Protocols` と `session.created` が返った。
  - 既定のセッションは、`audio/pcm`・24 kHz、`server_vad`、`interrupt_response: true` だった。
- **Node.js 24 の組み込み `WebSocket`（undici）は接続できなかった。**
  - ヘッダーで渡してもクエリで渡しても、`1006` で失敗した。
  - その際に `WebSocket over HTTP2 is experimental` の警告が出る。HTTP/2 で接続しようとして、Foundry 側が受け付けないとみられる。
- そのため、中継は `ws` パッケージで、HTTP/1.1 で接続する。
  - キーは `api-key` ヘッダーで渡す。
  - `ws` は依存のない広く使われた実装で、`src/relay` の本番依存はこれ 1 つだけにする。
  - HTTP サーバーは引き続き `node:http` を使う。

## 追記（2026-11-22）: 中継を Japan West に置く

- `main` へのマージ後のインフラのデプロイで、中継の App Service プラン（F1、Japan East）の事前検証が `SubscriptionIsOverQuotaForSku`（F1 のインスタンスの上限 0）で失敗した。
  - サブスクリプションに F1 のプランは 1 つもなかった。また、同じ F1 をポータルからは作成できた。
  - 原因は確定していない。有力なのは、同じリソースグループ・同じリージョンのプランが同じ webspace に置かれ、`sample-app-rc` の Japan East の webspace（日次バッチの Flex Consumption のプランがある）では F1 を作れない、という説明。
- そこで、中継のプランと Web App だけを Japan West に置く（パラメーター `relayLocation`）。ほかのリソースは Japan East のまま。
  - 中継はデータを保存せず、Cosmos DB や Storage にもつながないので、リージョンを分けても影響はない。
  - Foundry リソース `voice-stt-foundary` は West US 3 にある。ブラウザーは 200 ms ごとに音声を 1 つずつ POST するため、往復の短い利用者の近く（日本）に中継を置く。中継と Foundry の間は WebSocket 1 本なので、距離の影響は小さい。
- Japan West でも同じエラーになった場合は、クォータの引き上げを申請するか、中継を別のリソースグループに置く。

## 追記（2026-11-23）: Foundry 側を GPT-Live に置き換えた

[ADR 0014](./0014-voice-conversation-gpt-live.md) で、`gpt-realtime-2.1-mini` を全二重の `gpt-live-1` に置き換えた。この ADR のうち、次の部分は 0014 に置き換わっている。

- Foundry への接続先（`/openai/v1/live/sessions`）と、開始の手順（`session.start` → `session.started`）
- ブラウザーへのイベント（`speech_started` と `tool_call` を削除し、`transcript` を断片にした）
- ツール `record_proposal_info` と、その自動応答（記録は会話の後で抽出する）
- `REALTIME_AUDIO_FORMAT` と `REALTIME_TRANSCRIPTION_MODEL` の設定、`audio/pcmu` の確認
- チケットの形式（`v: 2` でツールを外した）

中継を App Service（F1、Japan West）に置くこと、ブラウザーと HTTPS（POST と SSE）だけでつなぐこと、チケットとセッションキーによる認証、上限、CORS は、この ADR のまま変わらない。
