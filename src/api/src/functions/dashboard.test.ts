import { describe, expect, it, vi } from 'vitest';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));

import type { Proposal, ScoredItem } from '../lib/types';
import { monthKey, recentMonths, summarize } from './dashboard';

describe('monthKey', () => {
  it('日本時間の年月を返す', () => {
    expect(monthKey('2026-10-31T15:30:00.000Z')).toBe('2026-11');
    expect(monthKey('2026-10-31T14:59:00.000Z')).toBe('2026-10');
  });
});

describe('recentMonths', () => {
  it('年をまたいで直近の月を古い順に返す', () => {
    expect(recentMonths(new Date('2026-02-10T00:00:00.000Z'), 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('summarize', () => {
  it('現在の件数と月別の推移を集計する', () => {
    const proposals = [
      { createdAt: '2026-11-01T00:00:00.000Z' },
      { createdAt: '2026-10-05T00:00:00.000Z' },
      { createdAt: '2025-01-01T00:00:00.000Z' },
    ] as Proposal[];
    const items = [
      {
        status: 'done',
        doneAt: '2026-11-10T00:00:00.000Z',
        issue: { number: 1, url: 'u', createdAt: '2026-11-02T00:00:00.000Z' },
      },
      { status: 'open' },
    ] as ScoredItem[];

    const result = summarize(proposals, items, new Date('2026-11-16T00:00:00.000Z'));

    expect(result.totals).toEqual({ proposals: 3, issues: 1, done: 1 });
    expect(result.monthly).toHaveLength(6);
    expect(result.monthly.at(-1)).toEqual({ month: '2026-11', proposals: 1, issues: 1, done: 1 });
    expect(result.monthly.at(-2)).toEqual({ month: '2026-10', proposals: 1, issues: 0, done: 0 });
  });
});
