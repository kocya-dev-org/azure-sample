# 提案の音声会話チェックリスト

提案フォームの「音声会話」で、AI（`gpt-realtime-2.1-mini`）と話しながら、RICE の算出に必要な情報を「タイトル」「内容」に書き込みます。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0013 提案の音声会話を、App Service（F1）上の HTTP 中継で Foundry の Realtime API につなぐ](./decisions/0013-voice-conversation-relay.md)
- 方針:
  - 経路
    - ブラウザー ⇔ 中継: HTTPS（POST と SSE）だけで通信し、WebRTC と WebSocket は使わない。
    - 中継 ⇔ Foundry: WebSocket。
  - 認証
    - チケットはマネージド Functions が HMAC で署名する。
    - Foundry のキーは中継だけが持つ。
  - 保存: 音声と会話の記録は保存しない。

> 2026-11-23: Foundry 側を GPT-Live（`gpt-live-1`）に置き換えた。音声形式（`pcmu`）・文字起こしのモデル・ツールに関する項目は不要になった。続きは [07 GPT-Live への置き換え](./07-gpt-live-checklist.md) を参照（[ADR 0014](./decisions/0014-voice-conversation-gpt-live.md)）。

## 手作業

- [x] `voice-stt-foundary` に `gpt-realtime-2.1-mini` がデプロイ済みであることを確認する（2026-11-21。デプロイ名は `gpt-realtime-2.1-mini`）
- [x] v1 の WebSocket に、HTTP/1.1 と `api-key` ヘッダーで接続できることを確認する（2026-11-21）
  - 結果
    - 次のコマンドで `101 Switching Protocols` と `session.created` が返った（既定の音声形式は `audio/pcm`・24 kHz、`server_vad`、`interrupt_response: true`）。
    - Node.js 組み込みの `WebSocket` は、ヘッダーで渡してもクエリで渡しても `1006` で失敗した（HTTP/2 で接続しようとする。ADR 0013 の追記）。

    ```powershell
    curl.exe -i --http1.1 `
      -H "Connection: Upgrade" -H "Upgrade: websocket" `
      -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" `
      -H "api-key: $env:FOUNDRY_KEY" `
      "https://voice-stt-foundary.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1-mini"
    ```

- [ ] 中継が送るものと同じ `session.update` を、Foundry が受け付けるかを確認する
  - 中継は、指示文・ツール・文字起こしのモデル・音声形式をまとめて 1 回の `session.update` で送る。1 つでも受け付けない項目があると全体が拒否され、音声会話を始められない（中継は 502 を返す）。
  - 完了条件
    - 次のスクリプトで `session.updated` が返ること。表示された `audio` の `format.type` が `audio/pcmu` になっていること。
    - 結果ごとの対応
      - `audio/pcmu` で `error` が返る: `FORMAT=pcm` で再度試す。通ったら `dev.bicepparam` の `realtimeAudioFormat` は `pcm` のままにし、ADR 0013 に追記する。
      - `pcmu` が通る: `realtimeAudioFormat` を `pcmu` にする。
      - 文字起こしのモデルで `error` が返る: `TRANSCRIPTION=off` か別のモデル名で試す。結果に合わせて Bicep の `realtimeTranscriptionModel` を変える。
  - 実行方法: 空の作業フォルダーで `npm i ws` を実行し、PowerShell で `$env:FOUNDRY_KEY` を設定してから `node check-realtime.mjs` を実行する（`$env:FORMAT`・`$env:TRANSCRIPTION` で切り替え）。

    ```js
    // check-realtime.mjs
    import WebSocket from 'ws';

    const format =
      process.env.FORMAT === 'pcm' ? { type: 'audio/pcm', rate: 24000 } : { type: 'audio/pcmu' };
    const model = process.env.TRANSCRIPTION ?? 'whisper-1';
    const url =
      'wss://voice-stt-foundary.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1-mini';
    const ws = new WebSocket(url, { headers: { 'api-key': process.env.FOUNDRY_KEY } });
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'session.created') {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              type: 'realtime',
              instructions: '日本語で、提案の RICE の情報を聞き出してください。',
              tools: [
                {
                  type: 'function',
                  name: 'record_proposal_info',
                  description: '会話で分かった提案の情報を記録する。',
                  parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { reach: { type: 'string' } },
                  },
                },
              ],
              tool_choice: 'auto',
              output_modalities: ['audio'],
              audio: {
                input: {
                  format,
                  transcription: model === 'off' ? null : { model, language: 'ja' },
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 600,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
                output: { format, voice: 'marin' },
              },
            },
          }),
        );
      } else if (event.type === 'session.updated') {
        console.log(event.type, JSON.stringify(event.session.audio));
        ws.close();
      } else if (event.type === 'error') {
        console.log(event.type, event.error?.code ?? '', event.error?.message ?? '');
        ws.close();
      }
    });
    ws.on('unexpected-response', (_req, res) => console.error('HTTP', res.statusCode));
    ws.on('error', (e) => console.error('接続エラー', e.message));
    ```

- [ ] App Service の Linux F1 で Node 24 を選べることを確認する（`az webapp list-runtimes --os linux`）
  - 完了条件: `NODE:24-lts` が一覧にあること。なければ 22 LTS にし、ADR 0013 に追記する。
- [ ] GitHub リポジトリの Settings → Secrets and variables → Actions に、secret `REALTIME_TICKET_SECRET`（32 バイト以上の乱数。例: `openssl rand -base64 48`）を登録する
  - Foundry のキーは、既存の `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY` を再利用する。

## Step 1: インフラ

- [x] App Service プラン（Linux、F1、Japan West。当初の Japan East は F1 を作れなかった）と Web App を追加する
  - 対象ファイル: `infra/main.bicep`, `infra/environments/dev.bicepparam`
  - 完了条件
    - 作成する内容
      - 中継の設定（`FOUNDRY_REALTIME_*`、`REALTIME_AUDIO_FORMAT`、`REALTIME_TICKET_SECRET`、`RELAY_ALLOWED_ORIGINS`）を `appSettings` に定義する。
      - キーとチケットの鍵は `@secure` パラメーターで受け取る。
      - `relayAppName` と `relayUrl` を出力する。
    - 検証: `az bicep lint`、`az bicep build`、`az bicep build-params` が通る。

## Step 2: 中継（`src/relay/`）

- [x] workspace を追加する
  - 対象ファイル: `src/relay/package.json`, `src/relay/tsconfig.json`, `src/relay/tsconfig.build.json`, `package.json`, `vitest.config.ts`, `scripts/stage-api.mjs`（`relay` を追加）, `scripts/check-secrets.mjs`
  - 完了条件: `npm run typecheck`・`npm test`・`npm run build`・`npm run stage:relay`・`npm run check:secrets` に relay が含まれる。
- [x] チケットの検証とセッションの管理を実装する
  - 対象ファイル: `src/relay/src/server.ts`, `src/relay/src/app.ts`, `src/relay/src/lib/ticket.ts`, `src/relay/src/lib/session.ts`, `src/relay/src/lib/realtime.ts`, `src/relay/src/lib/log.ts`, `src/relay/test/**`
  - 完了条件
    - チケット: 署名の不一致、期限切れ、再利用を拒否する。
    - 応答
      - 本文: 不正な本文は 400、大きすぎる本文は 413。
      - 認証: 誤ったセッションキーは 401、未知のセッションは 404。
      - 同時セッション: 5 つ目は 429。
    - CORS: 許可していないオリジンを拒否する。
    - イベントの扱い
      - Foundry のイベントのうち、必要なものだけを SSE に転送する。
      - ツール呼び出しには自動で応答する。
    - 終了: 5 分と無通信 30 秒でセッションを閉じる。
    - ログ: キーや外部の応答本文を出さない。
    - テストが通る。

## Step 3: API

- [x] `POST /api/products/{productId}/voice-sessions`
  - 対象ファイル: `src/api/src/functions/voiceSessions.ts`, `src/api/src/lib/relayTicket.ts`, `src/api/src/lib/prompts.ts`, `src/api/src/index.ts`, `src/api/test/functions/voiceSessions.test.ts`, `src/api/test/lib/relayTicket.test.ts`
  - 完了条件
    - 応答
      - プロダクトがなければ 404。
      - `REALTIME_RELAY_URL` か `REALTIME_TICKET_SECRET` が未設定なら 503。
      - 成功したら `{ relayUrl, ticket, expiresAt, maxSeconds }`。
    - チケット: relay 側と同じテストベクターで、署名が一致する。
    - 指示文: RICE の定義とインジェクション対策を含み、フォームの現在値を区切りタグで渡す。
    - テストが通る。

## Step 4: フロントエンド

- [x] 提案フォームの「音声会話」ボタン
  - 対象ファイル: `src/frontend/src/components/VoiceConversation.tsx`, `src/frontend/src/audio/*`, `src/frontend/src/api/client.ts`, `src/frontend/src/pages/ProposalForm.tsx`, `src/frontend/test/**`
  - 完了条件
    - 会話中の表示
      - 接続中は「接続中…」を表示する。
      - 会話中は、経過時間、字幕、「記録した内容」を表示する。
      - 利用者が話し始めたら、AI の音声を止める。
    - 終了と反映
      - 「終了」を押すか 5 分たつと、記録をフォームに反映する。
      - 「タイトル」は空のときだけ設定する。
      - 「内容」には末尾に追記し、8000 文字で切る。
    - 制限: 会話中は「判定」と「音声で入力」を無効にする。
    - エラーと非対応
      - マイクの使用が拒否されたとき、および中継に接続できないときは、エラーを表示する。
      - 録音に対応していないブラウザーでは、ボタンを表示しない。
    - テストが通る。

## Step 5: CI とドキュメント

- [x] ワークフローを更新する
  - 対象ファイル: `.github/workflows/deploy.yml`
  - 完了条件
    - 変更フィルターに `src/relay/**` がある。
    - secret の受け渡し
      - Bicep に secure パラメーターを渡す。
      - SWA API に `REALTIME_RELAY_URL` と `REALTIME_TICKET_SECRET` を設定する。secret が空なら警告だけ出す。
    - `deploy-relay` ジョブで、ビルド済みの成果物を Web App にデプロイする。
- [x] 仕様とアーキテクチャのドキュメントを更新する
  - 対象ファイル: `docs/features.md`, `docs/api.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/development.md`, `AGENTS.md`

## Step 6: 検証

- [ ] リポジトリ secret（`AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY`・`REALTIME_TICKET_SECRET`）をそろえ、ブランチから手動実行でインフラと中継をデプロイする
  - インフラと中継のデプロイ、SWA のアプリ設定の更新は、main への push と手動実行のときだけ動く。PR プレビューで試す前に実行する。
  - 手順
    1. target `infra` で実行する。Bicep のデプロイに加えて、SWA に `REALTIME_RELAY_URL` と `REALTIME_TICKET_SECRET` を設定する。
    2. target `relay` で実行する。中継だけをデプロイする。
  - target `all` と `app` は使わない。ブランチのコードが本番の SWA と日次バッチにもデプロイされる。
  - 完了条件
    - `https://<relayAppName>.azurewebsites.net/healthz` が `{"status":"ok"}` を返す。
    - SWA のアプリ設定に `REALTIME_RELAY_URL` と `REALTIME_TICKET_SECRET` が入っている。
- [ ] ローカル（Functions、Vite、relay を同時に起動）で、会話 → 反映 → 判定 → 送信が通る
- [ ] WebRTC がブロックされる環境の PR プレビューで、Chrome と iOS Safari の両方で同じ流れが通る。開発者ツールで、HTTPS（POST と SSE）だけで通信していることを確認する
- [ ] コールドスタート後の初回接続が、タイムアウトせずにつながる
- [ ] Chrome と iOS Safari で、音声の POST（`/sessions/{id}/audio`）が 200 ms ごとに送られている（マイクの取り込みが動いている）
- [ ] スピーカーで聞いても、AI の声をマイクが拾って AI が自分の発言で止まらない（エコーキャンセル）
- [ ] 5 分を超える会話でも SSE が切れない（App Service の前段のタイムアウト）
- [ ] 5 分の会話 1 回あたりの、App Service の送信データ量と CPU 時間を測り、1 日に何回会話できるかを ADR 0013 に追記する
- [ ] 検証が終わったら、ADR 0013 の状態を「承認」にする

## 後続タスク

- `conversation.item.truncate` で、割り込んだ時点の AI の発言を切り詰める
- `docs/architecture.drawio` に中継を追加する
