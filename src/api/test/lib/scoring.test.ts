import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/foundry', () => ({ generateJson: vi.fn<() => Promise<unknown>>() }));

import { generateJson } from '../../src/lib/foundry';
import { InvalidScoringError, scoreProposal } from '../../src/lib/scoring';

const product = { id: 'p1', name: '製品', strategy: '戦略', createdAt: '', updatedAt: '' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('scoreProposal', () => {
  it('構造化出力を検証してスコアを計算する', async () => {
    vi.mocked(generateJson).mockResolvedValue({
      rice: { reach: 200, impact: 2, confidence: 0.5, effort: 4, rationale: 'r' },
      strategyFit: { score: 60, rationale: 'f' },
    });
    const result = await scoreProposal(product, 'T', 'B');
    expect(result.rice.score).toBe(50);
    expect(vi.mocked(generateJson).mock.calls[0][0]).toMatchObject({
      schemaName: 'proposal_scoring',
    });
  });

  it('範囲外の値なら InvalidScoringError', async () => {
    vi.mocked(generateJson).mockResolvedValue({
      rice: { reach: 1, impact: 9, confidence: 1, effort: 1, rationale: 'r' },
      strategyFit: { score: 60, rationale: 'f' },
    });
    await expect(scoreProposal(product, 'T', 'B')).rejects.toBeInstanceOf(InvalidScoringError);
  });
});
