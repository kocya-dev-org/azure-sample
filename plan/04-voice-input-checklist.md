# 提案の音声入力チェックリスト

提案フォームで録音した音声を文字起こしし、「内容」に追記します。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0011 提案の音声入力を、文字起こし用の Foundry リソースとキー認証で実装する](./decisions/0011-voice-input-transcription.md)
- 方針:
  - 既存のサービス構成は変えない。
  - マネージド ID は使わず、API キーで認証する。
  - 音声は保存しない。

## 手作業

- [x] Foundry リソース `voice-stt-foundary`（リソースグループ `sample-app-rc`）を作成し、`gpt-4o-transcribe` をデプロイする（ユーザー実施済み）
- [x] `voice-stt-foundary` の「キーとエンドポイント」で、エンドポイントとキー 1 を確認する
  - 完了条件: エンドポイントが `https://voice-stt-foundary.openai.azure.com/` であること（2026-11-20 に確認）。違う場合は `.github/workflows/deploy.yml` の `FOUNDRY_TRANSCRIBE_ENDPOINT` を直す。
- [x] `voice-stt-foundary` の「ネットワーク」が、すべてのネットワークからのアクセスを許可していることを確認する
- [x] 疎通を確認する（2026-11-20）
  - 完了条件: 次のコマンドで 200 とテキストが返る。v1 のパス（`/openai/v1/audio/transcriptions`）は `DeploymentNotFound` を返すため使わない。

    ```bash
    curl -sS "https://voice-stt-foundary.openai.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview" \
      -H "api-key: <キー>" \
      -F language=ja -F file=@sample.webm
    ```

- [x] GitHub リポジトリの Settings → Secrets and variables → Actions に、secret `AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY` を登録する
- [ ] （任意）ローカル開発用に、`src/api/local.settings.json` の `Values` に `FOUNDRY_TRANSCRIBE_ENDPOINT`・`FOUNDRY_TRANSCRIBE_API_KEY`・`FOUNDRY_TRANSCRIBE_MODEL` を設定する

## Step 1: API

- [x] `POST /api/products/{productId}/transcriptions`
  - 対象ファイル: `src/api/src/lib/transcription.ts`, `src/api/src/functions/transcriptions.ts`, `src/api/src/index.ts`, `src/api/test/helpers.ts`
  - 完了条件:
    - `audio/webm` と `audio/mp4` 以外は 415、空なら 400、4 MB を超えたら 413、プロダクトがなければ 404 を返す。
    - 文字起こしに失敗したら 502 を返し、外部の応答本文を含めない。
    - テストが通る。

## Step 2: フロントエンド

- [x] 提案フォームの「音声で入力」ボタン
  - 対象ファイル: `src/frontend/src/components/VoiceInput.tsx`, `src/frontend/src/api/client.ts`, `src/frontend/src/pages/ProposalForm.tsx`
  - 完了条件:
    - 録音を止めると、文字起こしの結果が内容の末尾に追記される。
    - 録音は 90 秒で自動的に止まる。
    - 録音中と文字起こし中は「判定」が無効になる。
    - マイクの使用が拒否されたら、その旨を表示する。
    - 録音に対応していないブラウザーでは、ボタンを表示しない。
    - テストが通る。

## Step 3: CI とドキュメント

- [x] ワークフローに「Set transcription API settings」ステップを追加する
  - 対象ファイル: `.github/workflows/deploy.yml`
  - 完了条件: secret があれば 3 つの設定を入れ、なければ警告を出して成功で終わる。
- [x] 仕様とアーキテクチャのドキュメントを更新する
  - 対象ファイル: `docs/features.md`, `docs/api.md`, `docs/architecture.md`, `docs/tech-stack.md`, `docs/development.md`, `AGENTS.md`

## Step 4: 検証

- [ ] SWA のアプリケーション設定に `FOUNDRY_TRANSCRIBE_*` が入っている
  - 設定ジョブ `configure-foundry-settings` は `main` への push か手動実行でしか動かない。PR のプレビューで試す場合は、先に設定を入れる。

- [ ] PR プレビュー環境の Chrome で、録音 → 文字起こし → 判定 → 送信が通る
- [ ] iOS Safari（`audio/mp4`）で、同じ流れが通る
- [ ] 90 秒の録音で、413 にもタイムアウトにもならない
- [ ] 検証が終わったら、ADR 0011 の状態を「承認」にする

## 後続タスク

- `docs/architecture.drawio` に、文字起こし用の Foundry リソースを追加する
