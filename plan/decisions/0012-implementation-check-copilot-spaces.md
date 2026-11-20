# 0012: 判定時の実装状況の確認に、GitHub MCP サーバーの Copilot Spaces ツールを使う

- 状態: 検証待ち
- 日付: 2026-11-20

## 背景

提案フォームの「判定」で、RICE に足りない情報のコメントと並行して、「その提案がすでにアプリに実装されているか」を生成 AI に確認させたい。結果はコメントの最後に、実装済みかどうかと、どの画面にどんな形で実装されているかを、コードを知らない利用者向けの言葉で表示する。根拠となるコードと資料は、GitHub Copilot Spaces の `kocya-dev-org/spaces-azure-sample` から GitHub MCP サーバー経由で取得する（ユーザーの指定）。

前提:

- 判定 API はマネージド Functions の HTTP トリガーで、実行時間は約 45 秒まで。Foundry の呼び出しは 40 秒でタイムアウトする。
- GitHub MCP サーバー（`https://api.githubcopilot.com/mcp/`）の `get_copilot_space`（引数 `owner`・`name`）は、Space の目次と各ドキュメントの全文をテキストで返すだけで、推論はしない（2026-11-20 に実際の応答で確認。結果は `type: "resource"` の埋め込みリソースで、Streamable HTTP の応答は `text/event-stream`）。

検討した選択肢:

| 選択肢                                                                                    | 判断                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. API が MCP クライアントとして Space の内容を取得し、Foundry の構造化出力で判断させる   | 採用。トークンは API から GitHub へ直接送るだけで済む。既存の `generateJson` を使え、テストもしやすい                                            |
| B. Foundry の Responses API の `mcp` ツールで、モデルに GitHub MCP サーバーを直接呼ばせる | 不採用。GitHub トークンが Foundry を経由する。デプロイの対応状況に依存し、既存のクライアント（Chat Completions）も変える必要がある               |
| C. MCP クライアントに `@modelcontextprotocol/sdk` を使う                                  | 不採用。サーバー用の依存（express など）も入り、デプロイ成果物が大きくなる。必要なのは `initialize` と `tools/call` だけで、fetch で十分に書ける |

## 決定

1. **MCP は fetch で最小限だけ実装する**（`src/api/src/lib/copilotSpace.ts`）。エンドポイントは `https://api.githubcopilot.com/mcp/x/copilot_spaces/readonly`。`initialize` → `notifications/initialized` → `tools/call`（`get_copilot_space`）の順に送り、`Mcp-Session-Id` を引き継ぐ。応答は JSON と SSE の両方を受け付ける。新しい依存は追加しない。
2. **Space は固定値**（owner `kocya-dev-org`、name `spaces-azure-sample`）とする。
3. **トークンは `ISSUE_GITHUB_TOKEN` を共用する**（ユーザーの判断）。新しい secret は追加しない。
4. **判断は Foundry の構造化出力で行う**（`src/api/src/lib/implementationCheck.ts`）。Space の内容は最大 60,000 文字に切り、`<space>` タグで囲んだデータとして渡す。状態は `implemented`・`partial`・`not_implemented`・`unknown` のいずれか。説明は画面名・ボタンや項目の文言で書かせ、ファイル名や技術用語は書かせない。
5. **判定のコメントと並行して実行し、失敗しても判定は止めない。** コメントの送信が終わったら結果を待って、`done` の前に SSE イベント `implementation` を送る。制限時間は 30 秒。トークン未設定・タイムアウト・MCP や Foundry のエラー・不正な出力はすべて `unknown`（「実装状況を確認できませんでした。」）にする。エラーは `logError` で記録し、GitHub の応答本文はログにもイベントにも含めない。トークン未設定と、利用者の切断による中断は記録しない。
6. 結果は保存しない（判定時の表示だけ）。

## 結果・影響

- 判定の 1 回につき、GitHub MCP への 3 リクエストと Foundry の呼び出しが 1 回増える。コメントが先に終わると、実装状況が届くまで最大 30 秒ほど「確認中」の表示が続く。
- Space が固定のため、どのプロダクトの提案でもこのアプリ（Flyingfish）の Space を参照する。プロダクトごとに Space を変えるのは後続の課題とする。
- `ISSUE_GITHUB_TOKEN` に、Copilot Spaces を読む権限が必要になる。Copilot のライセンスがあるユーザーのトークンで、fine-grained PAT なら `kocya-dev-org` を対象にして Copilot Spaces の読み取り権限（README では `organization_copilot_spaces: read` とされるが要確認） と、Space が参照するリポジトリへのアクセスが必要（`plan/05-implementation-check-checklist.md`）。
- 2026-11-20 時点で Space のドキュメントは 0 件で、このままでは常に `unknown` になる。Space にリポジトリまたは資料を追加する必要がある。
- MCP のプロトコルや GitHub MCP サーバーの応答形式が変わった場合は、`copilotSpace.ts` を直す。
