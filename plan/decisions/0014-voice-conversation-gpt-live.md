# 0014. 音声会話を GPT-Live-1（全二重）に置き換え、記録は会話の後で抽出する

- 状態: 検証待ち
- 日付: 2026-11-23

## 背景

提案フォームの「音声会話」（ADR 0013）は `gpt-realtime-2.1-mini` を使っている。Realtime API は半二重で、サーバー VAD が発話の区切りを判定して順番に話す。これを、聞きながら話せる全二重のモデル `gpt-live-1` に置き換えたい。

ユーザーが決めた前提は次の 3 つ。

- サービス構成（SWA + マネージド Functions + App Service F1 の中継）は変えない。
- `gpt-realtime-2.1-mini` の経路は残さない。
- RICE の情報の記録は、会話の後で抽出する。

GPT-Live（Microsoft Learn の `how-to/gpt-live`・`concepts/gpt-live`・`how-to/gpt-live-delegation`）と Realtime の違い:

| 項目       | Realtime（ADR 0013）                                     | GPT-Live                                                                                                            |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| URL        | `/openai/v1/realtime?model=<deployment>`                 | `/openai/v1/live/sessions`（model は `session.start` で指定）                                                       |
| 開始       | `session.created` → `session.update` → `session.updated` | `session.start` → `session.started`（session は未知のフィールドを拒否する）                                         |
| 入力音声   | `input_audio_buffer.append`                              | `session.input_audio.append`（24 kHz PCM16 LE mono の base64。応答はない）                                          |
| 出力音声   | `response.output_audio.delta`                            | `session.output_audio.delta`（`start_ms`・`end_ms` 付き。done イベントはない）                                      |
| 字幕       | 確定した発言単位                                         | `session.input_transcript.delta`・`session.output_transcript.delta`（断片だけで、発言の終わりを示すイベントはない） |
| 順番の制御 | `turn_detection`・`response.create`・`speech_started`    | どれもない（全二重。割り込みにはモデル側が合わせる）                                                                |
| ツール     | session の `tools`                                       | なし。委任（`delegation`）だけで、既定は `client`                                                                   |
| 終了       | WebSocket を閉じる                                       | `session.close` → `session.closed`（`usage` と `reason`）                                                           |

記録の方法として検討した選択肢:

| 選択肢                                                                        | 判断                                                                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A. 会話の後に、文字起こしから SWA API の `gpt-5-mini`（構造化出力）で抽出する | 採用。GPT-Live は会話だけを担当し、抽出には既存の `generateJson` を使える                                                  |
| B. A の抽出を、会話中にも定期的に行う                                         | 不採用。Foundry の呼び出しが増える。会話中の「記録した内容」の表示は必須ではない                                           |
| C. Responses への委任で、ツール `record_proposal_info` を使う                 | 不採用。委任はプレビューで、イベントの処理が複雑になる。`voice-stt-foundary` に Responses 対応モデルのデプロイも必要になる |

## 決定

1. **中継から Foundry への接続を GPT-Live に置き換える。**
   - `wss://<resource>.openai.azure.com/openai/v1/live/sessions` に `ws` パッケージで接続し、キーは `api-key` ヘッダーで渡す。
   - 接続したらすぐ `session.start`（`model`・`instructions`・`audio.output.voice`）を送る。
   - `session.started` を受け取るまでは、ブラウザーに成功を返さない。開始前のエラー・切断・10 秒のタイムアウトでは 502 を返す。ADR 0013 と同じ。
2. **ブラウザーへのイベントを単純にする。**
   - `audio`: AI の音声の差分
   - `transcript`: 字幕の断片。`{ role, delta }`
   - `closed`: 終了
   - `speech_started` と `tool_call` は削除する。
3. **委任には応答だけを返す。** `session.delegation.created` が来たら、`session.thinking.append` で「外部の処理はできないので会話を続ける」と返す。委任を待ったまま会話が止まらないようにするため。
4. **終了の手順**
   - 中継: `session.close` を送り、`session.closed` を最大 2 秒待ってからソケットを閉じる。`usage` はログに残す。
   - ブラウザー: 「終了」を押したらマイクと再生を止める。SSE は中継の `closed` を受け取るまで（最大 3 秒）読み続ける。押した時点で流れていた AI のまとめの字幕を、抽出に含めるため。
5. **記録は会話の後で抽出する（選択肢 A）。**
   - ブラウザーは、字幕の断片を話者ごとにつなげて発言にする（上限 20,000 文字）。
   - 終了後、それを `POST /api/products/{productId}/voice-sessions/extract` に送る。
   - API は `generateJson` でタイトル・概要・Reach・Impact・Confidence・Effort を取り出す。結果はサーバーで検証してから返し、会話の記録は保存しない。
   - 利用者の字幕が聞き取りにくくても事実が残るよう、指示文で、終了の前に AI に 4 要素を読み上げさせる。
6. **チケットからツールを外し、形式を `v: 2` にする。** 古い形式のチケットは中継が拒否する。
7. **設定**
   - `FOUNDRY_REALTIME_MODEL` を `FOUNDRY_LIVE_MODEL`（既定 `gpt-live-1`）に変える。
   - `REALTIME_TRANSCRIPTION_MODEL` と `REALTIME_AUDIO_FORMAT` は削除する。GPT-Live は自分で字幕を出す。音声形式は、文書にある 24 kHz PCM16 だけにする（`session.start` は未知のフィールドを拒否し、形式を指定するフィールドが文書にないため）。

## 結果・影響

- サービス構成、ブラウザーと中継の通信（POST と SSE）、F1・Japan West・CORS・チケットの仕組みは ADR 0013 のまま。
- マイクの音声は今も無音の間も送り続けているので、F1 の帯域への影響はほとんど変わらない。
- 料金は、会話中は無音も含めて $0.05/分（5 分で約 $0.25）。抽出 1 回分の `gpt-5-mini` の料金がこれに加わる。
- 全二重では、AI の声をマイクが拾うと会話が崩れ、AI の発言が利用者の字幕に混ざって抽出結果も誤る。
  - Web Audio で再生した音声に、ブラウザーのエコーキャンセルがどこまで効くかは未確認。
  - 画面でヘッドセットの利用をすすめる。
- 再生は、今と同じく届いた順につなげる。出力音声が実時間より速くまとめて届く場合は、`start_ms` に合わせて予約する方式に変える（検証の結果で決める）。

検証待ちの事項（手順は `plan/07-gpt-live-checklist.md`）:

- `voice-stt-foundary`（West US 3）に `gpt-live-1` をデプロイできること。
- `api-key` ヘッダーで認証できること。文書の例は Bearer だけ。使えない場合は中継にマネージド ID が必要になり、ADR 0011 の方針と食い違うので、改めて判断する。
- 利用者の発言の字幕（`session.input_transcript.delta`）が届くこと。抽出はこれに頼る。
- 拒否されたときのイベントの形。AI から話し始めるか。
- 出力音声が届く速さ。
- 終了前に AI が 4 要素を読み上げること。抽出結果が妥当であること。
