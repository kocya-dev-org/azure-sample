import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest, PRINCIPAL } from '../../test/helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../lib/store', () => ({
  deleteProposal: vi.fn<() => Promise<boolean>>(),
  getProduct: vi.fn<() => Promise<unknown>>(),
  getProposal: vi.fn<() => Promise<unknown>>(),
  getScoredItem: vi.fn<() => Promise<unknown>>(),
  listProposals: vi.fn<() => Promise<unknown[]>>(),
  listScoredItems: vi.fn<() => Promise<unknown[]>>(),
  saveProposal: vi.fn<() => Promise<void>>(),
  saveScoredItem: vi.fn<() => Promise<void>>(),
}));
vi.mock('../lib/scoring', () => ({ scoreProposal: vi.fn<() => Promise<unknown>>() }));

import { scoreProposal } from '../lib/scoring';
import * as store from '../lib/store';
import type { Proposal, ScoredItem } from '../lib/types';
import {
  createProposalHandler,
  deleteProposalHandler,
  listProposalsHandler,
  updateProposalHandler,
} from './proposals';

const product = {
  id: 'p1',
  name: '製品',
  strategy: '戦略',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const scores = {
  rice: { reach: 10, impact: 1, confidence: 1, effort: 1, score: 10, rationale: 'r' },
  strategyFit: { score: 80, rationale: 'f' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(store.getProduct).mockResolvedValue(product);
  vi.mocked(scoreProposal).mockResolvedValue(scores);
});

describe('createProposalHandler', () => {
  it('スコアリングして提案とスコア付き項目を分けて保存する', async () => {
    const result = await createProposalHandler(
      makeRequest({
        params: { productId: 'p1' },
        body: { title: 'T', body: 'B', author: { name: '偽装' } },
        principal: PRINCIPAL,
      }),
      makeContext(),
    );

    expect(result.status).toBe(201);
    const proposal = vi.mocked(store.saveProposal).mock.calls[0][0];
    const item = vi.mocked(store.saveScoredItem).mock.calls[0][0];
    // 投稿者はクライアントの値ではなく x-ms-client-principal から設定する
    expect(proposal.author).toEqual({ userId: 'user-1', name: 'user@example.com' });
    expect(proposal).not.toHaveProperty('rice');
    expect(item).toMatchObject({
      id: proposal.id,
      proposalId: proposal.id,
      productId: 'p1',
      status: 'open',
      rice: scores.rice,
      proposalCreatedAt: proposal.createdAt,
    });
  });

  it('スコアリングに失敗したら 502 を返し、何も保存しない', async () => {
    vi.mocked(scoreProposal).mockRejectedValue(new Error('invalid'));
    const result = await createProposalHandler(
      makeRequest({ params: { productId: 'p1' }, body: { title: 'T', body: 'B' } }),
      makeContext(),
    );
    expect(result.status).toBe(502);
    expect(store.saveProposal).not.toHaveBeenCalled();
  });
});

describe('updateProposalHandler', () => {
  it('再スコアリングしても実装状況と Issue を残す', async () => {
    const existing: Proposal = {
      id: 'a1',
      productId: 'p1',
      title: 'old',
      body: 'old',
      author: { userId: 'u0', name: 'author' },
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    vi.mocked(store.getProposal).mockResolvedValue(existing);
    vi.mocked(store.getScoredItem).mockResolvedValue({
      status: 'done',
      doneAt: '2026-03-01T00:00:00.000Z',
      issue: { number: 1, url: 'https://github.com/o/r/issues/1', createdAt: 'x' },
    } as ScoredItem);

    const result = await updateProposalHandler(
      makeRequest({ params: { productId: 'p1', id: 'a1' }, body: { title: 'new', body: 'new' } }),
      makeContext(),
    );

    expect(result.status).toBe(200);
    const proposal = vi.mocked(store.saveProposal).mock.calls[0][0];
    expect(proposal).toMatchObject({ title: 'new', author: existing.author });
    expect(vi.mocked(store.saveScoredItem).mock.calls[0][0]).toMatchObject({
      status: 'done',
      doneAt: '2026-03-01T00:00:00.000Z',
      issue: { number: 1 },
      proposalCreatedAt: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('listProposalsHandler', () => {
  it('提案にスコアを結合して返す', async () => {
    vi.mocked(store.listProposals).mockResolvedValue([{ id: 'a1' } as Proposal]);
    vi.mocked(store.listScoredItems).mockResolvedValue([
      { id: 'a1', ...scores, status: 'open' } as ScoredItem,
    ]);
    const result = await listProposalsHandler(
      makeRequest({ params: { productId: 'p1' } }),
      makeContext(),
    );
    expect(result.jsonBody).toEqual([
      { id: 'a1', rice: scores.rice, strategyFit: scores.strategyFit, status: 'open' },
    ]);
  });
});

describe('deleteProposalHandler', () => {
  it('存在しなければ 404', async () => {
    vi.mocked(store.deleteProposal).mockResolvedValue(false);
    const result = await deleteProposalHandler(
      makeRequest({ params: { productId: 'p1', id: 'x' } }),
      makeContext(),
    );
    expect(result.status).toBe(404);
  });
});
