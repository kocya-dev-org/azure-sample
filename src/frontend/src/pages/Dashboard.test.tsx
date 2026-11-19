import { render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { mockFetch, PRODUCT, selectProductInStorage } from '../test/fetchMock';

const dashboard = {
  totals: { proposals: 12, issues: 3, done: 2 },
  monthly: [
    { month: '2026-06', proposals: 0, issues: 0, done: 0 },
    { month: '2026-07', proposals: 1, issues: 0, done: 0 },
    { month: '2026-08', proposals: 2, issues: 1, done: 0 },
    { month: '2026-09', proposals: 3, issues: 0, done: 1 },
    { month: '2026-10', proposals: 2, issues: 1, done: 0 },
    { month: '2026-11', proposals: 4, issues: 1, done: 1 },
  ],
  githubEnabled: false,
};

// ダッシュボードは遅延読み込みのため、初回の変換（Recharts）で findBy が時間切れにならないよう先に読み込む
beforeAll(async () => {
  await import('./Dashboard');
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('ダッシュボード', () => {
  it('現在の件数、月別の推移のグラフと表を表示する', async () => {
    selectProductInStorage('p1');
    mockFetch({ 'GET /api/products': [PRODUCT], 'GET /api/products/p1/dashboard': dashboard });
    render(<App />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/GitHub 連携が未設定/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /直近 6 か月/ })).toBeInTheDocument();

    // グラフの数値は表でも読める（jsdom では Recharts のツールチップを再現できない）
    const table = screen.getByRole('table', { name: '月別の推移' });
    const row = within(table).getByRole('cell', { name: '2026年11月' }).closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['2026年11月', '4', '1', '1']);
  });

  it('プロダクト未選択なら選択を促す', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    render(<App />);
    expect(await screen.findByText(/操作するプロダクトを選んでください/)).toBeInTheDocument();
  });
});
