import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({
  getScoredItem: vi.fn<() => Promise<unknown>>(),
  saveScoredItem: vi.fn<() => Promise<void>>(),
}));

import * as store from '../../src/lib/store';
import type { ScoredItem } from '../../src/lib/types';
import { updateItemStatusHandler } from '../../src/functions/items';

const request = (status: unknown) =>
  makeRequest({ params: { productId: 'p1', id: 'a1' }, body: { status } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('updateItemStatusHandler', () => {
  it('実装済みにすると実装日時を記録する', async () => {
    vi.mocked(store.getScoredItem).mockResolvedValue({ id: 'a1', status: 'open' } as ScoredItem);
    const result = await updateItemStatusHandler(request('done'), makeContext());
    const saved = vi.mocked(store.saveScoredItem).mock.calls[0][0];
    expect(saved.status).toBe('done');
    expect(saved.doneAt).toEqual(expect.any(String));
    expect(result.jsonBody).toMatchObject({ id: 'a1', status: 'done' });
  });

  it('未対応に戻すと実装日時を消す', async () => {
    vi.mocked(store.getScoredItem).mockResolvedValue({
      id: 'a1',
      status: 'done',
      doneAt: '2026-11-01T00:00:00.000Z',
    } as ScoredItem);
    await updateItemStatusHandler(request('open'), makeContext());
    const saved = vi.mocked(store.saveScoredItem).mock.calls[0][0];
    expect(saved).toEqual({ id: 'a1', status: 'open' });
  });

  it('不正な値は 400、存在しない項目は 404', async () => {
    expect((await updateItemStatusHandler(request('wip'), makeContext())).status).toBe(400);
    vi.mocked(store.getScoredItem).mockResolvedValue(undefined);
    expect((await updateItemStatusHandler(request('done'), makeContext())).status).toBe(404);
  });
});
