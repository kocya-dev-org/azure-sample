// ダッシュボードの集計（Phase 2）。月は日本時間で区切る。
import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { isGithubEnabled } from '../lib/github';
import { withAuth } from '../lib/auth';
import { jsonError, logError } from '../lib/http';
import { getProduct, listProposals, listScoredItems } from '../lib/store';
import type { Proposal, ScoredItem } from '../lib/types';

export const MONTHS = 6;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の年月（YYYY-MM）を返す。 */
export function monthKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 7);
}

/** now を含む直近 count か月の年月を古い順に返す。 */
export function recentMonths(now: Date, count: number): string[] {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export function summarize(proposals: Proposal[], items: ScoredItem[], now: Date) {
  const months = recentMonths(now, MONTHS);
  const monthly = months.map((month) => ({ month, proposals: 0, issues: 0, done: 0 }));
  const byMonth = new Map(monthly.map((row) => [row.month, row]));
  for (const proposal of proposals) {
    const row = byMonth.get(monthKey(proposal.createdAt));
    if (row) row.proposals += 1;
  }
  for (const item of items) {
    if (item.issue) {
      const row = byMonth.get(monthKey(item.issue.createdAt));
      if (row) row.issues += 1;
    }
    if (item.status === 'done' && item.doneAt) {
      const row = byMonth.get(monthKey(item.doneAt));
      if (row) row.done += 1;
    }
  }
  return {
    totals: {
      proposals: proposals.length,
      issues: items.filter((item) => item.issue).length,
      done: items.filter((item) => item.status === 'done').length,
    },
    monthly,
  };
}

export async function dashboardHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { productId } = request.params;
  try {
    if (!(await getProduct(productId))) return jsonError(404, 'プロダクトが見つかりません。');
    const [proposals, items] = await Promise.all([
      listProposals(productId),
      listScoredItems(productId),
    ]);
    return {
      jsonBody: { ...summarize(proposals, items, new Date()), githubEnabled: isGithubEnabled() },
    };
  } catch (error) {
    logError(context, 'Dashboard failed', error);
    return jsonError(500, 'ダッシュボードの集計に失敗しました。');
  }
}

app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'products/{productId}/dashboard',
  handler: withAuth(dashboardHandler),
});
