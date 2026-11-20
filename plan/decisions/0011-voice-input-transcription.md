# 0011: 提案の音声入力を、文字起こし用の Foundry リソースとキー認証で実装する

- 状態: 検証待ち
- 日付: 2026-11-20

## 背景

提案フォームの「内容」を、キーボードだけでなく音声でも入力したい。営業担当が顧客から聞いた要望を話すと、そのまま文字になる形を目指す。ユーザーが決めた前提は次の 2 つ。

- 既存のサービス構成（SWA、Cosmos DB、Storage、日次バッチの Function App）は変えない。
- マネージド ID は使わない。

検討した選択肢:

| 選択肢                                                                       | 判断                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A. 文字起こし用の Foundry リソースを、SWA API から API キーで呼ぶ            | 採用。既存の Foundry 呼び出しと同じ方式で、Bicep の構成は変わらない                    |
| B. Azure AI Speech リソースを Bicep に追加する                               | 不採用。アプリのリソース構成が変わる                                                   |
| C. ブラウザーの Web Speech API（`SpeechRecognition`）だけで文字起こしする    | 不採用。Firefox などで使えず、音声がブラウザーのベンダーのサーバーに送られることがある |
| D. スコアリング用の Foundry（`sample-app-foundary`）に文字起こしモデルを足す | 不採用。ユーザーが文字起こし専用のリソースを用意した。キーの用途を分けられる利点もある |

## 決定

1. **文字起こしのリソースは手作業で用意する。** ユーザーが作成した次のリソースを使う。スコアリング用の Foundry と同じく、Bicep の管理対象外とする。

   | 項目             | 値                   |
   | ---------------- | -------------------- |
   | リソースグループ | `sample-app-rc`      |
   | Foundry リソース | `voice-stt-foundary` |
   | デプロイ         | `gpt-4o-transcribe`  |

   `Phi-4-mini-reasoning` はテキスト専用で、音声を入力できないため使わない。

2. **API キーで認証する。** SWA API が、既存の依存 `openai` で `audio/transcriptions` を呼ぶ。
   - 設定は `FOUNDRY_TRANSCRIBE_ENDPOINT`・`FOUNDRY_TRANSCRIBE_API_KEY`・`FOUNDRY_TRANSCRIBE_MODEL` の 3 つ。
   - キーはリポジトリ secret `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY` から、ワークフローがアプリケーション設定に入れる。
   - secret が空なら、警告だけ出して設定しない（ADR 0007 の `ISSUE_GITHUB_TOKEN` と同じ扱い）。音声入力以外は動く。
3. **音声は保存しない。** API は受け取った音声をそのまま文字起こしに渡し、結果のテキストだけを返す。
   - 保存すると、Blob Storage の利用、保存期間、個人の声というデータの扱いを新たに決める必要がある。
   - 提案に残るのは、利用者が確認・編集した後のテキストだけ。
4. **録音は最大 90 秒、本文は最大 4 MB にする。**
   - マネージド Functions の制限時間は約 45 秒で、Foundry のクライアントのタイムアウトは 40 秒。90 秒程度の音声なら、この時間内に文字起こしが終わる見込み。
   - 90 秒の Opus（webm）は約 0.5〜1 MB、Safari の mp4/AAC は約 1.5 MB。4 MB の上限で足りる。
5. **本文は生のバイナリで送る。** `Content-Type` は `audio/webm`（Chrome・Edge・Firefox）か `audio/mp4`（Safari）のみ受け付ける。
   - multipart にしないことで、API 側の解析処理が要らない。
   - ファイル名の拡張子を Content-Type から決める。サービスは拡張子で形式を判定するため。

## 結果・影響

- 新しいライブラリは追加しない。録音はブラウザーの `MediaRecorder` を使う。
- 文字起こし用リソースのネットワークは、すべてのネットワークからのアクセスを許可しておく必要がある。SWA マネージド API の送信元 IP は固定できない。
- 検証待ちの事項:
  - SWA マネージド API がこのサイズの本文を受け付けること。
  - `voice-stt-foundary` の v1 エンドポイント（`https://voice-stt-foundary.openai.azure.com/openai/v1/`）から `gpt-4o-transcribe` を呼べること。
  - PR プレビュー環境の Chrome と iOS Safari で、録音から送信まで通ること。
- v1 エンドポイントで呼べない場合は、`AzureOpenAI` クライアント（`apiVersion` を指定）に切り替える。その際はこの ADR に追記する。
