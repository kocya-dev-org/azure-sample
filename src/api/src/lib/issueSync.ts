// 起票済み GitHub Issue の状態をバックログ項目へ反映する共通処理。
// SWA API の手動更新（POST products/{productId}/issues/sync）と、
// 独立 Function App の日次タイマー（src/batch）の両方から使う（ADR 0010）。
import type { InvocationContext } from '@azure/functions';
import { getIssueState, GithubError, isGithubEnabled } from './github';
import { logError } from './http';
import { getScoredItem, listOpenItemsWithIssue, listProducts, saveScoredItem } from './store';
import type { Product, ScoredItem } from './types';

/** GitHub API を同時に呼ぶ上限。 */
const CONCURRENCY = 4;

export interface IssueSyncSummary {
  /** 状態を確認した項目数 */
  checked: number;
  /** 実装済みにした項目 */
  updated: { id: string; doneAt: string }[];
  /** 確認または保存に失敗した項目数 */
  failed: number;
}

/** completed で close された Issue だけを実装済みとみなす（not_planned・duplicate は除く）。 */
export function isCompleted(state: { state: string; stateReason: string | null }): boolean {
  return (
    state.state === 'closed' && (state.stateReason === null || state.stateReason === 'completed')
  );
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
}

async function syncItem(
  repository: string,
  item: ScoredItem & { issue: NonNullable<ScoredItem['issue']> },
): Promise<string | undefined> {
  const state = await getIssueState(repository, item.issue.number);
  if (!isCompleted(state)) return undefined;
  // 確認中に手動で状態が変わっている場合があるため、保存直前に読み直す
  const current = await getScoredItem(item.productId, item.id);
  if (!current || current.status !== 'open' || current.issue?.number !== item.issue.number) {
    return undefined;
  }
  const doneAt = state.closedAt ?? new Date().toISOString();
  await saveScoredItem({ ...current, status: 'done', doneAt });
  return doneAt;
}

/**
 * プロダクトの起票済み・未対応の項目について Issue の状態を確認し、
 * completed で close されていれば実装済みにする。項目ごとの失敗は数えて処理を続ける。
 */
export async function syncProductIssueStatus(
  product: Product,
  context: InvocationContext,
): Promise<IssueSyncSummary> {
  if (!isGithubEnabled()) throw new GithubError(0);
  const summary: IssueSyncSummary = { checked: 0, updated: [], failed: 0 };
  const { repository } = product;
  if (!repository) return summary;

  const items = (await listOpenItemsWithIssue(product.id)).filter(
    (item): item is ScoredItem & { issue: NonNullable<ScoredItem['issue']> } =>
      item.status === 'open' && !!item.issue,
  );
  await runPool(items, async (item) => {
    try {
      const doneAt = await syncItem(repository, item);
      summary.checked += 1;
      if (doneAt) summary.updated.push({ id: item.id, doneAt });
    } catch (error) {
      logError(context, 'Issue status sync failed', error);
      summary.failed += 1;
    }
  });
  return summary;
}

/** リポジトリが登録されたすべてのプロダクトを順に同期する（日次タイマー用）。 */
export async function syncAllProductsIssueStatus(
  context: InvocationContext,
): Promise<{ products: number; checked: number; updated: number; failed: number }> {
  const total = { products: 0, checked: 0, updated: 0, failed: 0 };
  if (!isGithubEnabled()) {
    context.warn('ISSUE_GITHUB_TOKEN が未設定のため、Issue 状態の同期をスキップしました。');
    return total;
  }
  const products = (await listProducts()).filter((product) => product.repository);
  for (const product of products) {
    try {
      const summary = await syncProductIssueStatus(product, context);
      total.products += 1;
      total.checked += summary.checked;
      total.updated += summary.updated.length;
      total.failed += summary.failed;
    } catch (error) {
      logError(context, 'Issue status sync failed for a product', error);
      total.failed += 1;
    }
  }
  return total;
}
