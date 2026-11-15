# 0003: MVP のスコープと旧サンプル画面移植の廃止

- 状態: 承認
- 日付: 2026-11-15

## 背景

土台構築チェックリストの後続タスクには「旧 `index.html` の 3 画面（HTTP Function 呼び出し、Cosmos DB レコード、Blob オブジェクト）を React に移植する」が残っていた。今回、アプリの目的を「ソフトウェア製品への要望を生成 AI でスコアリングし、次期開発のバックログを作る SaaS」に定めた。サンプル画面の移植は、この目的に寄与しない。

アプリは PoC 用途であり、MVP として最低限の機能があればよい。ただし、トークンやシークレットの漏えいは許容しない。

## 決定

1. 旧 3 画面の移植は行わない。サンプル API（`hello`・`items`・`blobs`・`jobs`・`goodbye`）は、MVP の実装時に削除する。
2. MVP の機能を次の 2 段階で実装する。仕様は [docs/features.md](../../docs/features.md) に記載する。
   - Phase 1（Must）: プロダクト情報の登録・編集・削除、提案の登録（生成 AI による判定のストリーム表示、RICE と戦略合致度のスコアリング）、期間指定によるバックログ（上位 10 件）の作成と表示
   - Phase 2（Want）: 実装状況の編集、GitHub Issue の起票、ダッシュボード
3. バックログの並び順は RICE スコアの降順とし、同じ値なら戦略合致度の降順にする。
4. サービス構成（SWA Free ＋ マネージド Functions、Cosmos DB Free Tier、Blob Storage、Microsoft Foundry）は変更しない。Blob Storage のリソースは残すが、MVP では使わない。
5. アクセス制御は現状の `authenticated` ロールのままにする（[ADR 0007](./0007-github-issue-token.md)）。

## 結果・影響

- [土台構築チェックリスト](../00-foundation-checklist.md)の後続タスク「旧 `index.html` の 3 画面を React に移植する」は廃止する。
- 作業は [MVP チェックリスト](../01-mvp-checklist.md)で管理する。
