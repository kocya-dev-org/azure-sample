# 音声会話の GPT-Live-1 への置き換えチェックリスト

提案フォームの「音声会話」を、`gpt-realtime-2.1-mini`（半二重）から `gpt-live-1`（全二重）に置き換えます。RICE の情報は会話の後で文字起こしから抽出します。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0014 音声会話を GPT-Live-1（全二重）に置き換え、記録は会話の後で抽出する](./decisions/0014-voice-conversation-gpt-live.md)、[0013](./decisions/0013-voice-conversation-relay.md)
- 方針:
  - サービス構成（SWA + マネージド Functions + App Service F1 の中継）は変えない。
  - `gpt-realtime-2.1-mini` の経路は残さない。
  - 音声と会話の記録は保存しない。

## 手作業

- [ ] `voice-stt-foundary`（リソースグループ `sample-app-rc`、West US 3）に `gpt-live-1` をデプロイし、デプロイ名を控える
  - リージョンが対応していなければ、対応リージョンに Foundry リソースを作るかを相談する。
  - Foundry に `gpt-live-1.1` があれば記録しておく（モデル名は Bicep の `foundryLiveModel` で変えられる）。
- [ ] `api-key` ヘッダーで認証できることを確認する
  - 完了条件: 次のコマンドで `101 Switching Protocols` が返ること。401 なら Entra（Bearer）しか使えないので、作業を止めて相談する（中継にマネージド ID が必要になる）。

    ```powershell
    curl.exe -i --http1.1 `
      -H "Connection: Upgrade" -H "Upgrade: websocket" `
      -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" `
      -H "api-key: $env:FOUNDRY_KEY" `
      "https://voice-stt-foundary.openai.azure.com/openai/v1/live/sessions"
    ```

- [ ] 実際の音声で、会話と字幕が成り立つことを確認する
  - 完了条件
    - `session.started` が返る。
    - `session.input_transcript.delta`（利用者の字幕）と `session.output_transcript.delta`（AI の字幕）が両方届く。
    - `session.output_audio.delta` が届く。
    - 結果を ADR 0014 に追記する。追記するもの:
      - 利用者の字幕が届いたか（届かなければ、抽出の方針を見直す）
      - 何も送らずに AI が話し始めたか
      - エラーのときのイベントの形
      - 出力音声の届く速さ（到着時刻と `end_ms` の差）
  - 実行方法
    1. 空の作業フォルダーで `npm i ws` を実行する。
    2. 日本語で話した短い録音を、24 kHz・モノラルの PCM16 にする。
       - 例: `ffmpeg -i sample.webm -ar 24000 -ac 1 -f s16le sample.pcm`
    3. PowerShell で `$env:FOUNDRY_KEY` を設定し、`node check-live.mjs sample.pcm` を実行する。

    ```js
    // check-live.mjs
    import { readFileSync } from 'node:fs';
    import WebSocket from 'ws';

    const audio = readFileSync(process.argv[2]);
    const url = 'wss://voice-stt-foundary.openai.azure.com/openai/v1/live/sessions';
    const ws = new WebSocket(url, { headers: { 'api-key': process.env.FOUNDRY_KEY } });
    const started = Date.now();
    const seen = new Set();

    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'session.start',
          session: {
            model: 'gpt-live-1',
            instructions:
              '日本語で、提案の RICE の情報を聞き出してください。最初に一言あいさつしてください。',
            audio: { output: { voice: 'marin' } },
          },
        }),
      ),
    );
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      const elapsed = Date.now() - started;
      if (event.type === 'session.started') {
        console.log(elapsed, 'session.started');
        // 1 秒待ってから（AI が先に話すかを見るため）、録音を実時間の速さで送る
        setTimeout(() => {
          const chunk = 9600; // 200 ms 分
          let offset = 0;
          const timer = setInterval(() => {
            if (offset >= audio.length) {
              clearInterval(timer);
              setTimeout(() => ws.send(JSON.stringify({ type: 'session.close' })), 8000);
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'session.input_audio.append',
                audio: audio.subarray(offset, offset + chunk).toString('base64'),
              }),
            );
            offset += chunk;
          }, 200);
        }, 1000);
      } else if (event.type === 'session.output_audio.delta') {
        console.log(elapsed, 'audio', event.start_ms, event.end_ms);
      } else if (event.type.endsWith('transcript.delta')) {
        console.log(elapsed, event.type, event.delta);
      } else if (event.type === 'session.closed') {
        console.log(elapsed, 'session.closed', JSON.stringify(event.usage), event.reason);
        ws.close();
      } else if (!seen.has(event.type)) {
        seen.add(event.type);
        console.log(elapsed, 'other', JSON.stringify(event).slice(0, 300));
      }
    });
    ws.on('unexpected-response', (_req, res) => console.error('HTTP', res.statusCode));
    ws.on('error', (e) => console.error('接続エラー', e.message));
    ```

## Step 1: 中継（`src/relay/`）

- [x] Foundry との接続を GPT-Live に置き換える
  - 対象ファイル: `src/relay/src/lib/live.ts`（`realtime.ts` から置き換え）、`src/relay/src/lib/session.ts`、`src/relay/src/lib/settings.ts`、`src/relay/src/lib/ticket.ts`、`src/relay/src/app.ts`、`src/relay/src/server.ts`、`src/relay/test/**`
  - 完了条件
    - 開始: 接続後に `session.start` を送り、`session.started` で準備完了にする。開始前のエラー・切断・タイムアウトでは 502 を返す。
    - 転送: 出力音声と、両者の字幕の断片をブラウザーへ送る。
    - 応答: 委任には `session.thinking.append` で応答する。
    - 終了: `session.close` を送り、`session.closed` を待ってから閉じる。
    - ログ: 知らないイベントは、種類名だけを 1 回ログに出す。
    - チケット: `v: 2` で、`tools` を持たない。
    - テストが通る。

## Step 2: API

- [x] チケットからツールを外し、会話の記録を抽出する API を追加する
  - 対象ファイル: `src/api/src/functions/voiceSessions.ts`, `src/api/src/lib/prompts.ts`, `src/api/src/lib/relayTicket.ts`, `src/api/test/functions/voiceSessions.test.ts`, `src/api/test/lib/relayTicket.test.ts`, `src/api/test/lib/prompts.test.ts`
  - 完了条件
    - `POST /api/products/{productId}/voice-sessions/extract` が `{ record }` を返す。
    - 応答: 不正な本文は 400、プロダクトがなければ 404、Foundry の失敗や不正な出力は 502（外部の応答本文は含めない）。
    - 抽出結果は前後の空白を除き、長さを制限する。
    - テストベクターが中継とそろっている。
    - テストが通る。

## Step 3: フロントエンド

- [x] 字幕の組み立てと、会話後の抽出
  - 対象ファイル: `src/frontend/src/components/VoiceConversation.tsx`, `src/frontend/src/api/relay.ts`, `src/frontend/src/api/client.ts`, `src/frontend/test/components/VoiceConversation.test.tsx`
  - 完了条件
    - 字幕: 同じ話者の断片を 1 つの発言につなげる。
    - 終了: 「終了」を押すと中継の `closed` まで待ち、「記録をまとめています…」の後、フォームに反映する。
    - 抽出に失敗したら、エラーを表示してフォームを変えない。
    - 表示: 会話中はヘッドセットの利用をすすめる。
    - テストが通る。

## Step 4: インフラ・ドキュメント

- [x] 設定の名前を直す
  - 対象ファイル: `infra/main.bicep`, `infra/environments/dev.bicepparam`
  - 完了条件: `FOUNDRY_LIVE_MODEL` を設定し、`REALTIME_TRANSCRIPTION_MODEL`・`REALTIME_AUDIO_FORMAT` を削除する。Bicep の lint・build・build-params と `az deployment group validate` が通る。
- [x] 仕様とアーキテクチャのドキュメントを更新する
  - 対象ファイル: `docs/features.md`, `docs/api.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/development.md`, `AGENTS.md`, `plan/decisions/0013-voice-conversation-relay.md`, `plan/06-voice-conversation-checklist.md`

## Step 5: 検証

- [ ] ローカル（Functions、Vite、relay）の Chrome で、AI の話の途中に話しかけると AI が合わせる。終了後にフォームへ反映され、判定・送信まで通る
- [ ] デプロイ後、WebRTC がブロックされる環境の Chrome と iOS Safari で、同じ流れが通る
- [ ] スピーカーで聞いても、AI が自分の声で止まらず、利用者の字幕に AI の発言が混ざらない
- [ ] AI のまとめの途中で「終了」を押しても、まとめの字幕が抽出に含まれる
- [ ] 1 回の会話あたりの F1 の送信量と、`session.closed` の `usage` を ADR 0014 に記録する
- [ ] 検証が終わったら、ADR 0014 の状態を「承認」にする
