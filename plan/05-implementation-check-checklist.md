# 判定時の実装状況の確認チェックリスト

提案フォームの「判定」で、提案がすでにアプリに実装されているかを、GitHub MCP サーバー経由で Copilot Space `kocya-dev-org/spaces-azure-sample` の内容から確認し、コメントの最後に表示します。書き方は [README](./README.md) を参照してください。

- 関連 ADR: [0012 判定時の実装状況の確認に、GitHub MCP サーバーの Copilot Spaces ツールを使う](./decisions/0012-implementation-check-copilot-spaces.md)
- 方針:
  - トークンは `ISSUE_GITHUB_TOKEN` を共用する。
  - 実装状況の確認に失敗しても、判定のコメントは通常どおり返す。
  - 結果は保存しない。

## 手作業

- [ ] Copilot Space `kocya-dev-org/spaces-azure-sample` に資料を追加する
  - API は Space の内容の先頭 60,000 文字だけを使う（`SPACE_CONTEXT_MAX_LENGTH`）。リポジトリ全体を入れると、画面の資料が切り捨てられることがある。
  - 追加する順: まず `docs/features.md`（画面ごとの機能を利用者向けの言葉で書いてある）、次に `src/frontend/src/pages/*`。合計を約 60,000 文字以内に収める。
  - 完了条件: GitHub MCP の `get_copilot_space` の応答で `Documents` が 1 件以上になり、目次の順と合計サイズが上の方針どおりであること（2026-11-20 時点では 0 件）。
- [ ] `ISSUE_GITHUB_TOKEN` のトークンで Copilot Space を読めることを確認する。読めなければトークンを発行し直し、リポジトリ secret `ISSUE_GITHUB_TOKEN` を更新する
  - 2026-11-20 の疎通確認は `gh auth token`（OAuth トークン）で行ったもので、`ISSUE_GITHUB_TOKEN` の値ではまだ確認していない。
  - 必要な権限（要確認）: トークンの持ち主に Copilot のライセンスと Space へのアクセスがあること。fine-grained PAT なら Resource owner を `kocya-dev-org` にし、Issue の権限に加えて Copilot Spaces の読み取り権限（GitHub MCP サーバーの README では `organization_copilot_spaces: read` とされるが未確認）と、Space が参照するリポジトリの Contents 読み取りを付ける。
  - 完了条件: 実際の secret の値で、次のコマンドが Space の目次を表示すること（`npm run build` の後に実行）。

    ```bash
    ISSUE_GITHUB_TOKEN=<トークン> node -e "require('./src/api/dist/src/lib/copilotSpace.js').fetchSpaceContext(AbortSignal.timeout(20000)).then(console.log, (e) => console.log(e.name, e.message))"
    ```

  - secret を更新したら、インフラのデプロイも再実行する（日次バッチも同じトークンを使うため）。
- [ ] （任意）ローカル開発用に、`src/api/local.settings.json` の `Values` に `ISSUE_GITHUB_TOKEN` を設定する

## Step 1: API

- [x] MCP クライアントと実装状況の確認を追加する
  - 対象ファイル: `src/api/src/lib/copilotSpace.ts`、`src/api/src/lib/implementationCheck.ts`、`src/api/src/lib/prompts.ts`、`src/api/src/lib/foundry.ts`（`generateJson` に中断用の `signal`）
  - 完了条件: 実際の GitHub MCP サーバーから Space の内容を取得できる（2026-11-20、`gh auth token` のトークンで確認）。失敗時は `unknown` を返し、テストが通る。
- [x] 判定 API でコメントと並行して確認し、`implementation` イベントを `done` の前に送る
  - 対象ファイル: `src/api/src/functions/review.ts`、`src/api/src/lib/sse.ts`
  - 完了条件: `review.test.ts` で、イベントの順序と、失敗・切断時の中断を確認できる。

## Step 2: フロントエンド

- [x] 判定のコメントの下に「実装状況」の欄を表示する
  - 対象ファイル: `src/frontend/src/api/client.ts`、`src/frontend/src/pages/ProposalForm.tsx`
  - 完了条件: 確認中はスピナー、結果が届いたら状態のバッジと説明を表示する。`Proposals.test.tsx` が通る。

## Step 3: ドキュメント

- [x] 仕様を更新する
  - 対象ファイル: `docs/features.md`、`docs/api.md`、`docs/architecture.md`、`docs/architecture.drawio`
  - 完了条件: 判定の SSE イベント `implementation`、表示、`ISSUE_GITHUB_TOKEN` の用途が記載されている。

## Step 4: 動作確認

- [ ] PR プレビュー環境で、実装済みの機能（例: 音声入力）と未実装の機能の提案をそれぞれ判定し、実装状況と画面上の場所が説明されることを確認する
  - 完了条件: 説明にファイル名や技術用語が含まれず、画面名・ボタン名で書かれていること。
- [ ] コメントの後、実装状況が届くまで数十秒あいても、`implementation` イベントが SWA の経路でためられず、欠けずに届くことを確認する（ADR 0005 のとおり、経路の挙動に敏感なため）
  - 完了条件: 確認中のスピナーの後に結果が表示されること。届かない場合は、待っている間に SSE のコメント行（`: keepalive`）を送る対策を検討する（画面側はコメント行を読み飛ばす）。

## 後続タスク

- プロダクトごとに参照する Copilot Space を設定できるようにする。
