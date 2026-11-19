// バックログ項目の GitHub Issue 起票（Phase 2、ADR 0007）と、Issue 状態の手動同期（ADR 0010）。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { createIssue, isGithubEnabled } from '../lib/github';
import { jsonError, logError, readJsonObject } from '../lib/http';
import { syncProductIssueStatus } from '../lib/issueSync';
import { getProduct, getProposal, getScoredItem, saveScoredItem } from '../lib/store';
import type { IssueRef, Proposal, ScoredItem } from '../lib/types';

// マネージド Functions の制限時間に収めるため、1 回の起票数を制限する
export const MAX_ISSUES_PER_REQUEST = 10;

export type IssueResult =
  | { itemId: string; result: 'created' | 'skipped'; issue: IssueRef }
  | { itemId: string; result: 'not_found' | 'failed' };

export function buildIssueBody(item: ScoredItem, proposal: Proposal | undefined): string {
  const { rice, strategyFit } = item;
  return [
    '## 提案内容',
    proposal?.body ?? '（元の提案は削除されています）',
    '',
    '## スコア',
    `- RICE スコア: ${rice.score}（Reach ${rice.reach} × Impact ${rice.impact} × Confidence ${rice.confidence} ÷ Effort ${rice.effort}）`,
    `- 戦略合致度: ${strategyFit.score} / 100`,
    '',
    '### RICE の根拠',
    rice.rationale,
    '',
    '### 戦略合致度の根拠',
    strategyFit.rationale,
    '',
    '---',
    `Flyingfish のバックログから起票しました（投稿者: ${proposal?.author.name ?? '不明'}）。`,
  ].join('\n');
}

function parseItemIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ISSUES_PER_REQUEST) {
    return undefined;
  }
  if (!value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100)) {
    return undefined;
  }
  return [...new Set(value as string[])];
}

export async function createIssuesHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (!isGithubEnabled()) return jsonError(503, 'GitHub 連携が未設定です。');
  const { productId } = request.params;
  const itemIds = parseItemIds((await readJsonObject(request))?.itemIds);
  if (!itemIds) {
    return jsonError(
      400,
      `itemIds に 1〜${MAX_ISSUES_PER_REQUEST} 件の項目 ID を指定してください。`,
    );
  }

  let product;
  try {
    product = await getProduct(productId);
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
  if (!product) return jsonError(404, 'プロダクトが見つかりません。');
  const { repository } = product;
  if (!repository) return jsonError(400, 'プロダクトにリポジトリが登録されていません。');

  const results: IssueResult[] = [];
  for (const itemId of itemIds) {
    try {
      const item = await getScoredItem(productId, itemId);
      if (!item) {
        results.push({ itemId, result: 'not_found' });
        continue;
      }
      if (item.issue) {
        results.push({ itemId, result: 'skipped', issue: item.issue });
        continue;
      }
      const proposal = await getProposal(productId, item.proposalId);
      const created = await createIssue(repository, {
        title: item.title,
        body: buildIssueBody(item, proposal),
      });
      const issue: IssueRef = { ...created, createdAt: new Date().toISOString() };
      // 起票に成功したらすぐ保存し、再実行で二重に起票しないようにする
      await saveScoredItem({ ...item, issue });
      results.push({ itemId, result: 'created', issue });
    } catch (error) {
      logError(context, 'Issue creation failed', error);
      results.push({ itemId, result: 'failed' });
    }
  }
  return { jsonBody: { results } };
}

app.http('createIssues', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/issues',
  handler: createIssuesHandler,
});

/** 起票済みで未対応の項目について Issue の状態を確認し、completed で close されていれば実装済みにする。 */
export async function syncIssueStatusHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (!isGithubEnabled()) return jsonError(503, 'GitHub 連携が未設定です。');
  const { productId } = request.params;

  let product;
  try {
    product = await getProduct(productId);
  } catch (error) {
    logError(context, 'Product read failed', error);
    return jsonError(500, 'プロダクトの読み込みに失敗しました。');
  }
  if (!product) return jsonError(404, 'プロダクトが見つかりません。');
  if (!product.repository) return jsonError(400, 'プロダクトにリポジトリが登録されていません。');

  try {
    return { jsonBody: await syncProductIssueStatus(product, context) };
  } catch (error) {
    logError(context, 'Issue status sync failed', error);
    return jsonError(500, 'Issue の状態の確認に失敗しました。');
  }
}

app.http('syncIssueStatus', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'products/{productId}/issues/sync',
  handler: syncIssueStatusHandler,
});
