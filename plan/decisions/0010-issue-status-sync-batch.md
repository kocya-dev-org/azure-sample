# 0010: Issue 状態の日次同期を独立した Function App で動かす

- 状態: 検証待ち
- 日付: 2026-11-19

## 背景

起票済みの GitHub Issue が閉じられたら、バックログ項目を実装済みにしたい。実行の入り口は 2 つある。

- 1 日 1 回の自動実行
- バックログ詳細画面の「Issue 状態を更新」ボタンからの手動実行

SWA (Free) のマネージド Functions は HTTP トリガーしか使えず、タイマートリガーは置けない（ADR 0001、0003）。既存の SWA、Cosmos DB、Storage の構成は変えずに、Functions の実装で解決したい（ユーザー決定）。

検討した選択肢:

| 選択肢                                                           | 判断                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A. 独立した Function App（Flex Consumption）にタイマー関数を置く | 採用。SWA とは無関係に動き、既存構成に手を入れない                                    |
| B. GitHub Actions の cron から SWA の HTTP API を呼ぶ            | 不採用。SWA のルート認証（`authenticated`）を外すか、共有シークレットを足す必要がある |
| C. 画面アクセス時に、前回から 24 時間経っていれば同期する        | 不採用。誰もアクセスしない日は実行されない                                            |
| D. SWA を Standard にして BYO Functions にする                   | 不採用。SWA の構成とコストが変わる                                                    |

## 決定

1. **Function App を追加する。** 日次バッチ用に、Flex Consumption（`FC1`）の Function App を Japan East に追加する。
   - ランタイムは Node.js 24。2026-11-19 に `az functionapp list-flexconsumption-runtimes --location japaneast` で、24 が既定の対応バージョンであることを確認した。
   - SWA の API（マネージド Functions、`node:22`）には手を入れない。
2. **コードは `src/api` パッケージで共有する。**
   - 共通処理: `src/api/src/lib/issueSync.ts`
   - 手動の入り口: SWA API の `POST /api/products/{productId}/issues/sync`（`src/api/src/functions/issues.ts`）
   - 日次の入り口: タイマー関数 `src/api/src/batch/syncIssueStatusTimer.ts`。毎日 18:00 UTC（日本時間 3:00）に動く。
   - タイマー関数は、バッチ用エントリー `src/api/src/batch.ts` からだけ読み込む。SWA 用エントリー `src/api/src/index.ts` には載せない。
   - `npm run stage:batch` が `.deploy/batch` にステージングし、`package.json` の `main` を `dist/src/batch.js` に書き換える。
3. **実装済みにする条件を決める。**
   - 対象は、`status` が `open` で、Issue を起票済みの項目だけ。
   - Issue が `closed` で、`state_reason` が `completed` または `null` のときだけ実装済みにする。`not_planned` と `duplicate` は未対応のまま残す。
   - `doneAt` には Issue の `closed_at` を入れる。ダッシュボードの集計（実装済みにした月）が実態に合うようにするため。
   - 保存の直前に項目を読み直し、確認中に手動で変更されていれば上書きしない。
   - Issue が完了で閉じたまま手動で未対応へ戻した項目は、次回の確認で再び実装済みになる。手動で戻したことを記録するフィールドは持たない。
   - 実装済みから未対応へは戻さない。Issue を reopen しても戻らない。
4. **ストレージとアプリ設定の扱いを決める。**
   - ホスト用ストレージ（`AzureWebJobsStorage`）とデプロイパッケージの置き場には、既存のアプリケーションデータ用ストレージアカウントを再利用する。
     - デプロイパッケージ用に、プライベートコンテナー `batch-deployments` を追加する。
     - 接続には接続文字列（アカウントキー）を使う。ロール割り当てを使わないので、デプロイ用の OIDC プリンシパルに権限を足さずに済む。
   - Function App のアプリ設定は、すべて Bicep の `siteConfig.appSettings` で定義する。CLI で後から足した設定は、Bicep を再デプロイすると消えるため。
     - `COSMOS_CONNECTION_STRING` は、Bicep で `listConnectionStrings()` から取得する。
     - `ISSUE_GITHUB_TOKEN` は、`@secure()` パラメーター `issueGithubToken` で受け取る。ワークフローがリポジトリ secret から渡す。
     - secret が空ならパラメーターも空のままにする。その場合、バッチは警告を出して同期をスキップする（ADR 0007 と同じ扱い）。
   - Application Insights は追加しない（最小構成）。
5. **デプロイ方法を決める。**
   - ワークフローのジョブ `deploy-batch-functions` が `Azure/functions-action@v1`（`sku: flexconsumption`）でデプロイする。
   - 対象は main への push と手動実行だけ。PR ではデプロイしない（プレビュー環境がないため）。

## 結果・影響

- **費用:** 追加するのは Flex Consumption のプランと Function App。実行は 1 日 1 回なので、無料付与の範囲に収まる見込み。ストレージには、ホスト用のデータとデプロイパッケージが少し増える。
- **トークン更新の手順:** `ISSUE_GITHUB_TOKEN` を更新したら、インフラのデプロイを再実行する（手動実行で `infra` か `all` を選ぶ）。そうしないとバッチ側に反映されない。
- **残るリスク:**
  - ログは Functions ホストの標準出力だけで、Application Insights がない。失敗の調査が難しい。必要になったら追加する。
  - 手動同期（SWA API）には件数の上限がない。同時実行数は 4、GitHub 呼び出し 1 回のタイムアウトは 10 秒。GitHub の応答が遅いときに対象が数十件あると、マネージド Functions の制限時間を超えるおそれがある。
  - 同期対象はプロダクトの現在のリポジトリ（`product.repository`）。Issue を起票した後でリポジトリを変えると、元の Issue の状態は読めず、失敗として数える。
- **検証項目:**
  - [ ] Bicep のデプロイで Function App が作成される
  - [ ] `deploy-batch-functions` が成功し、関数 `syncIssueStatus` が一覧に出る
  - [ ] Azure ポータルからタイマー関数を手動実行し、completed で閉じた Issue の項目が実装済みになる
