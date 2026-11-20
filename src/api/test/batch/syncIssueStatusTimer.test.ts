import { describe, expect, it, vi } from 'vitest';
import { makeContext } from '../helpers';

// 登録内容は import 時に記録する（テストごとのモックのリセットで消えないようにする）
const registered = vi.hoisted(() => [] as unknown[][]);
vi.mock('@azure/functions', () => ({
  app: { timer: (...args: unknown[]) => registered.push(args) },
}));
vi.mock('../../src/lib/issueSync', () => ({
  syncAllProductsIssueStatus: vi.fn<() => Promise<unknown>>(),
}));

import type { Timer } from '@azure/functions';
import { syncAllProductsIssueStatus } from '../../src/lib/issueSync';
import { SYNC_SCHEDULE, syncIssueStatusTimerHandler } from '../../src/batch/syncIssueStatusTimer';

describe('syncIssueStatusTimer', () => {
  it('毎日 18:00 UTC のタイマーとして登録する', () => {
    expect(SYNC_SCHEDULE).toBe('0 0 18 * * *');
    expect(registered).toEqual([
      ['syncIssueStatus', { schedule: SYNC_SCHEDULE, handler: syncIssueStatusTimerHandler }],
    ]);
  });

  it('全プロダクトの同期を実行する', async () => {
    vi.mocked(syncAllProductsIssueStatus).mockResolvedValue({
      products: 1,
      checked: 1,
      updated: 1,
      failed: 0,
    });
    const context = makeContext();
    await syncIssueStatusTimerHandler({} as Timer, context);
    expect(syncAllProductsIssueStatus).toHaveBeenCalledWith(context);
    expect(context.log).toHaveBeenCalled();
  });
});
