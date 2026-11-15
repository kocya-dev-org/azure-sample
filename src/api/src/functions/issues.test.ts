import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../../test/helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../lib/store', () => ({
  getProduct: vi.fn<() => Promise<unknown>>(),
  getProposal: vi.fn<() => Promise<unknown>>(),
  getScoredItem: vi.fn<() => Promise<unknown>>(),
  saveScoredItem: vi.fn<() => Promise<void>>(),
}));
vi.mock('../lib/github', () => ({
  isGithubEnabled: vi.fn<() => boolean>(),
  createIssue: vi.fn<() => Promise<unknown>>(),
}));

import { createIssue, isGithubEnabled } from '../lib/github';
import * as store from '../lib/store';
import type { ScoredItem } from '../lib/types';
import { createIssuesHandler } from './issues';

const product = {
  id: 'p1',
  name: 'n',
  strategy: 's',
  repository: 'org/repo',
  createdAt: '',
  updatedAt: '',
};
const item = (id: string, extra: Partial<ScoredItem> = {}) =>
  ({
    id,
    proposalId: id,
    title: `項目 ${id}`,
    rice: { reach: 1, impact: 1, confidence: 1, effort: 1, score: 1, rationale: 'r' },
    strategyFit: { score: 50, rationale: 'f' },
    status: 'open',
    ...extra,
  }) as ScoredItem;

const request = (itemIds: unknown) =>
  makeRequest({ params: { productId: 'p1' }, body: { itemIds } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isGithubEnabled).mockReturnValue(true);
  vi.mocked(store.getProduct).mockResolvedValue(product);
});

describe('createIssuesHandler', () => {
  it('トークンが未設定なら 503 を返す', async () => {
    vi.mocked(isGithubEnabled).mockReturnValue(false);
    const result = await createIssuesHandler(request(['a']), makeContext());
    expect(result).toEqual({ status: 503, jsonBody: { error: 'GitHub 連携が未設定です。' } });
  });

  it('リポジトリがなければ 400、件数が範囲外なら 400', async () => {
    expect((await createIssuesHandler(request([]), makeContext())).status).toBe(400);
    expect(
      (await createIssuesHandler(request(Array.from({ length: 11 }, String)), makeContext()))
        .status,
    ).toBe(400);
    vi.mocked(store.getProduct).mockResolvedValue({ ...product, repository: undefined });
    expect((await createIssuesHandler(request(['a']), makeContext())).status).toBe(400);
  });

  it('起票して項目ごとに保存し、起票済みはスキップ、失敗は続行する', async () => {
    const existing = { number: 1, url: 'https://github.com/org/repo/issues/1', createdAt: 'x' };
    vi.mocked(store.getScoredItem).mockImplementation(async (_p, id) =>
      id === 'done' ? item('done', { issue: existing }) : id === 'gone' ? undefined : item(id),
    );
    vi.mocked(createIssue).mockImplementation(async (_repo, { title }) => {
      if (title === '項目 bad') throw new Error('500');
      return { number: 9, url: 'https://github.com/org/repo/issues/9' };
    });

    const result = await createIssuesHandler(
      request(['new', 'done', 'gone', 'bad']),
      makeContext(),
    );

    expect((result.jsonBody as { results: unknown[] }).results).toEqual([
      { itemId: 'new', result: 'created', issue: expect.objectContaining({ number: 9 }) },
      { itemId: 'done', result: 'skipped', issue: existing },
      { itemId: 'gone', result: 'not_found' },
      { itemId: 'bad', result: 'failed' },
    ]);
    expect(store.saveScoredItem).toHaveBeenCalledOnce();
    expect(vi.mocked(store.saveScoredItem).mock.calls[0][0]).toMatchObject({
      id: 'new',
      issue: { number: 9 },
    });
    expect(createIssue).toHaveBeenCalledWith(
      'org/repo',
      expect.objectContaining({ title: '項目 new' }),
    );
  });
});
