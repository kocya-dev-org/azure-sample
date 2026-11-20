import { describe, expect, it } from 'vitest';
import {
  calcRiceScore,
  compareForBacklog,
  toScoringResult,
  validateRiceValues,
} from '../../src/lib/rice';
import type { ScoredItem } from '../../src/lib/types';

describe('validateRiceValues', () => {
  it('範囲内の値を受け付ける', () => {
    expect(validateRiceValues({ reach: 100, impact: 2, confidence: 0.8, effort: 1.5 })).toEqual({
      reach: 100,
      impact: 2,
      confidence: 0.8,
      effort: 1.5,
    });
  });

  it.each([
    { reach: -1, impact: 1, confidence: 1, effort: 1 },
    { reach: 1.5, impact: 1, confidence: 1, effort: 1 },
    { reach: 1, impact: 4, confidence: 1, effort: 1 },
    { reach: 1, impact: 1, confidence: 0.7, effort: 1 },
    { reach: 1, impact: 1, confidence: 1, effort: 0 },
    { reach: '1', impact: 1, confidence: 1, effort: 1 },
  ])('範囲外の値を拒否する: %o', (value) => {
    expect(validateRiceValues(value)).toBeUndefined();
  });
});

describe('calcRiceScore', () => {
  it('R × I × C ÷ E を小数第 2 位で丸める', () => {
    expect(calcRiceScore({ reach: 100, impact: 2, confidence: 0.8, effort: 3 })).toBe(53.33);
  });
});

describe('toScoringResult', () => {
  it('スコアをサーバーで計算する', () => {
    const result = toScoringResult({
      rice: { reach: 10, impact: 1, confidence: 1, effort: 2, rationale: '根拠', score: 9999 },
      strategyFit: { score: 70, rationale: '合致' },
    });
    expect(result?.rice.score).toBe(5);
    expect(result?.strategyFit).toEqual({ score: 70, rationale: '合致' });
  });

  it('戦略合致度が範囲外なら undefined', () => {
    expect(
      toScoringResult({
        rice: { reach: 10, impact: 1, confidence: 1, effort: 2, rationale: '根拠' },
        strategyFit: { score: 101, rationale: '合致' },
      }),
    ).toBeUndefined();
  });
});

describe('compareForBacklog', () => {
  const item = (rice: number, fit: number) =>
    ({ rice: { score: rice }, strategyFit: { score: fit } }) as ScoredItem;

  it('RICE の降順、同じ値なら合致度の降順に並べる', () => {
    const sorted = [item(10, 50), item(20, 10), item(10, 90)].sort(compareForBacklog);
    expect(sorted.map((i) => [i.rice.score, i.strategyFit.score])).toEqual([
      [20, 10],
      [10, 90],
      [10, 50],
    ]);
  });
});
