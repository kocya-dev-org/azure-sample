// 日次で Issue の状態をバックログ項目へ反映するタイマー関数（ADR 0010）。
// SWA マネージド Functions は HTTP トリガーしか使えないため、独立した Function App にだけ載せる。
// src/index.ts（SWA 用エントリー）からは import しないこと。
import { app, type InvocationContext, type Timer } from '@azure/functions';
import { logError } from '../lib/http';
import { syncAllProductsIssueStatus } from '../lib/issueSync';

/** 毎日 18:00 UTC（日本時間 3:00）に実行する。 */
export const SYNC_SCHEDULE = '0 0 18 * * *';

export async function syncIssueStatusTimerHandler(
  _timer: Timer,
  context: InvocationContext,
): Promise<void> {
  try {
    const total = await syncAllProductsIssueStatus(context);
    context.log('Issue status sync completed', total);
  } catch (error) {
    logError(context, 'Issue status sync failed', error);
    throw error;
  }
}

app.timer('syncIssueStatus', {
  schedule: SYNC_SCHEDULE,
  handler: syncIssueStatusTimerHandler,
});
