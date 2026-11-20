import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({
  getBacklog: vi.fn<() => Promise<unknown>>(),
  getProduct: vi.fn<() => Promise<unknown>>(),
  listBacklogs: vi.fn<() => Promise<unknown[]>>(),
  listScoredItems: vi.fn<() => Promise<unknown[]>>(),
  listScoredItemsInRange: vi.fn<() => Promise<unknown[]>>(),
  saveBacklog: vi.fn<() => Promise<void>>(),
}));

import * as store from '../../src/lib/store';
import type { Backlog, ScoredItem } from '../../src/lib/types';
import {
  createBacklogHandler,
  getBacklogHandler,
  selectTopItems,
  toUtcRange,
} from '../../src/functions/backlogs';

const item = (id: string, rice: number, fit: number) =>
  ({
    id,
    title: id,
    rice: { score: rice },
    strategyFit: { score: fit },
    status: 'open',
  }) as ScoredItem;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(store.getProduct).mockResolvedValue({
    id: 'p1',
    name: 'n',
    strategy: 's',
    createdAt: '',
    updatedAt: '',
  });
});

describe('toUtcRange', () => {
  it('日本時間の日付範囲を UTC の半開区間に変換する', () => {
    expect(toUtcRange('2026-11-01', '2026-11-30')).toEqual({
      fromIso: '2026-10-31T15:00:00.000Z',
      toIso: '2026-11-30T15:00:00.000Z',
    });
  });

  it('不正な日付や逆順の範囲を拒否する', () => {
    expect(toUtcRange('2026-02-30', '2026-03-01')).toBeUndefined();
    expect(toUtcRange('2026-11-02', '2026-11-01')).toBeUndefined();
    expect(toUtcRange('2026/11/01', '2026-11-02')).toBeUndefined();
    expect(toUtcRange(undefined, '2026-11-02')).toBeUndefined();
  });

  it('開始日と終了日が同じ日を受け付ける', () => {
    expect(toUtcRange('2026-11-01', '2026-11-01')).toBeDefined();
  });
});

describe('selectTopItems', () => {
  it('RICE の降順（同点は合致度の降順）で上位 10 件を選ぶ', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, i, 0));
    items.push(item('tie', 11, 99));
    const top = selectTopItems(items);
    expect(top).toHaveLength(10);
    expect(top.slice(0, 3).map((e) => e.scoredItemId)).toEqual(['tie', 'i11', 'i10']);
    expect(top[0]).toEqual({
      scoredItemId: 'tie',
      rank: 1,
      title: 'tie',
      riceScore: 11,
      strategyFitScore: 99,
    });
  });
});

describe('createBacklogHandler', () => {
  it('期間内の項目からバックログを作成する', async () => {
    vi.mocked(store.listScoredItemsInRange).mockResolvedValue([item('a', 5, 1), item('b', 9, 1)]);
    const result = await createBacklogHandler(
      makeRequest({ params: { productId: 'p1' }, body: { from: '2026-11-01', to: '2026-11-15' } }),
      makeContext(),
    );
    expect(result.status).toBe(201);
    expect(store.listScoredItemsInRange).toHaveBeenCalledWith(
      'p1',
      '2026-10-31T15:00:00.000Z',
      '2026-11-15T15:00:00.000Z',
    );
    const saved = vi.mocked(store.saveBacklog).mock.calls[0][0];
    expect(saved.items.map((e) => e.scoredItemId)).toEqual(['b', 'a']);
  });

  it('不正な期間は 400', async () => {
    const result = await createBacklogHandler(
      makeRequest({ params: { productId: 'p1' }, body: { from: 'x', to: 'y' } }),
      makeContext(),
    );
    expect(result.status).toBe(400);
  });
});

describe('getBacklogHandler', () => {
  it('スナップショットに最新の状態を結合し、削除済みを示す', async () => {
    vi.mocked(store.getBacklog).mockResolvedValue({
      id: 'b1',
      productId: 'p1',
      items: [
        { scoredItemId: 'a', rank: 1, title: 'a', riceScore: 5, strategyFitScore: 1 },
        { scoredItemId: 'gone', rank: 2, title: 'gone', riceScore: 1, strategyFitScore: 1 },
      ],
    } as Backlog);
    vi.mocked(store.listScoredItems).mockResolvedValue([{ ...item('a', 50, 1), status: 'done' }]);

    const result = await getBacklogHandler(
      makeRequest({ params: { productId: 'p1', id: 'b1' } }),
      makeContext(),
    );
    const items = (result.jsonBody as { items: Record<string, unknown>[] }).items;

    // スナップショットのスコアは変えない
    expect(items[0]).toMatchObject({ riceScore: 5, status: 'done', deleted: false });
    expect(items[1]).toMatchObject({ deleted: true, status: null });
    expect(result.jsonBody).toMatchObject({ githubEnabled: false, hasRepository: false });
  });
});
