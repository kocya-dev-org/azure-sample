import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext } from '../../test/helpers';

vi.mock('./store', () => ({
  getScoredItem: vi.fn<() => Promise<unknown>>(),
  listOpenItemsWithIssue: vi.fn<() => Promise<unknown>>(),
  listProducts: vi.fn<() => Promise<unknown>>(),
  saveScoredItem: vi.fn<() => Promise<void>>(),
}));
vi.mock('./github', async (importOriginal) => ({
  GithubError: (await importOriginal<typeof import('./github')>()).GithubError,
  isGithubEnabled: vi.fn<() => boolean>(),
  getIssueState: vi.fn<() => Promise<unknown>>(),
}));

import { getIssueState, GithubError, isGithubEnabled } from './github';
import { isCompleted, syncAllProductsIssueStatus, syncProductIssueStatus } from './issueSync';
import * as store from './store';
import type { Product, ScoredItem } from './types';

const product = {
  id: 'p1',
  name: 'n',
  strategy: 's',
  repository: 'org/repo',
  createdAt: '',
  updatedAt: '',
} as Product;
const item = (id: string, number: number, extra: Partial<ScoredItem> = {}) =>
  ({
    id,
    productId: 'p1',
    title: `項目 ${id}`,
    status: 'open',
    issue: { number, url: `https://github.com/org/repo/issues/${number}`, createdAt: '' },
    ...extra,
  }) as ScoredItem;

const closed = (stateReason: string | null, closedAt = '2026-11-01T00:00:00Z') => ({
  state: 'closed' as const,
  stateReason,
  closedAt,
});

/** listOpenItemsWithIssue が返す項目。getScoredItem の読み直しでも同じものを返す。 */
let stored: ScoredItem[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  stored = [];
  vi.mocked(isGithubEnabled).mockReturnValue(true);
  vi.mocked(store.listOpenItemsWithIssue).mockImplementation(async () => stored);
  vi.mocked(store.getScoredItem).mockImplementation(async (_productId, id) =>
    stored.find((i) => i.id === id),
  );
});

describe('isCompleted', () => {
  it('completed または理由なしの close だけを完了とみなす', () => {
    expect(isCompleted(closed('completed'))).toBe(true);
    expect(isCompleted(closed(null))).toBe(true);
    expect(isCompleted(closed('not_planned'))).toBe(false);
    expect(isCompleted(closed('duplicate'))).toBe(false);
    expect(isCompleted({ state: 'open', stateReason: 'reopened' })).toBe(false);
  });
});

describe('syncProductIssueStatus', () => {
  it('completed で close された項目だけを実装済みにし、doneAt を close 日時にする', async () => {
    stored = [item('a', 1), item('b', 2), item('c', 3)];
    vi.mocked(getIssueState).mockImplementation(async (_repo, number) => {
      if (number === 1) return closed('completed');
      if (number === 2) return closed('not_planned');
      return { state: 'open', stateReason: null, closedAt: null };
    });

    const summary = await syncProductIssueStatus(product, makeContext());

    expect(summary).toEqual({
      checked: 3,
      updated: [{ id: 'a', doneAt: '2026-11-01T00:00:00Z' }],
      failed: 0,
    });
    expect(store.listOpenItemsWithIssue).toHaveBeenCalledWith('p1');
    expect(getIssueState).toHaveBeenCalledWith('org/repo', 1);
    expect(store.saveScoredItem).toHaveBeenCalledTimes(1);
    expect(store.saveScoredItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', status: 'done', doneAt: '2026-11-01T00:00:00Z' }),
    );
  });

  it('読み直した時点で実装済みなら上書きしない', async () => {
    stored = [item('a', 1)];
    vi.mocked(store.getScoredItem).mockResolvedValue(
      item('a', 1, { status: 'done', doneAt: '2026-10-01T00:00:00Z' }),
    );
    vi.mocked(getIssueState).mockResolvedValue(closed('completed'));

    const summary = await syncProductIssueStatus(product, makeContext());

    expect(summary.updated).toEqual([]);
    expect(store.saveScoredItem).not.toHaveBeenCalled();
  });

  it('項目ごとの失敗は数えて、残りの項目は処理を続ける', async () => {
    stored = [item('a', 1), item('b', 2)];
    vi.mocked(getIssueState).mockImplementation(async (_repo, number) => {
      if (number === 1) throw new GithubError(404);
      return closed('completed');
    });
    const context = makeContext();

    const summary = await syncProductIssueStatus(product, context);

    expect(summary).toEqual({
      checked: 1,
      updated: [{ id: 'b', doneAt: '2026-11-01T00:00:00Z' }],
      failed: 1,
    });
    expect(context.error).toHaveBeenCalledWith(
      'Issue status sync failed',
      expect.objectContaining({ name: 'GithubError' }),
    );
  });

  it('リポジトリがなければ何もしない', async () => {
    const summary = await syncProductIssueStatus(
      { ...product, repository: undefined },
      makeContext(),
    );
    expect(summary).toEqual({ checked: 0, updated: [], failed: 0 });
    expect(store.listOpenItemsWithIssue).not.toHaveBeenCalled();
  });

  it('トークンが未設定なら GithubError を投げる', async () => {
    vi.mocked(isGithubEnabled).mockReturnValue(false);
    await expect(syncProductIssueStatus(product, makeContext())).rejects.toBeInstanceOf(
      GithubError,
    );
  });
});

describe('syncAllProductsIssueStatus', () => {
  it('リポジトリが登録されたプロダクトだけを同期して合計を返す', async () => {
    vi.mocked(store.listProducts).mockResolvedValue([
      product,
      { ...product, id: 'p2', repository: undefined },
    ]);
    stored = [item('a', 1)];
    vi.mocked(getIssueState).mockResolvedValue(closed('completed'));

    const total = await syncAllProductsIssueStatus(makeContext());

    expect(total).toEqual({ products: 1, checked: 1, updated: 1, failed: 0 });
    expect(store.listOpenItemsWithIssue).toHaveBeenCalledTimes(1);
    expect(store.listOpenItemsWithIssue).toHaveBeenCalledWith('p1');
  });

  it('トークンが未設定なら警告してスキップする', async () => {
    vi.mocked(isGithubEnabled).mockReturnValue(false);
    const context = makeContext();
    const total = await syncAllProductsIssueStatus(context);
    expect(total).toEqual({ products: 0, checked: 0, updated: 0, failed: 0 });
    expect(context.warn).toHaveBeenCalled();
    expect(store.listProducts).not.toHaveBeenCalled();
  });
});
