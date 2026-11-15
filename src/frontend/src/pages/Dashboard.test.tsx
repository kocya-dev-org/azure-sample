import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { mockFetch, PRODUCT, selectProductInStorage } from '../test/fetchMock';
import { niceMax } from './Dashboard';

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

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('niceMax', () => {
  it('目盛りの上限を切りのよい値にする', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(41)).toBe(50);
  });
});

describe('ダッシュボード', () => {
  it('現在の件数、月別の推移の表、ホバーの詳細を表示する', async () => {
    selectProductInStorage('p1');
    mockFetch({ 'GET /api/products': [PRODUCT], 'GET /api/products/p1/dashboard': dashboard });
    render(<App />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/GitHub 連携が未設定/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /直近 6 か月/ })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2026年11月' })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('month-2026-11'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('2026年11月');
    expect(tooltip).toHaveTextContent('提案数4');
  });

  it('プロダクト未選択なら選択を促す', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    render(<App />);
    expect(await screen.findByText(/操作するプロダクトを選んでください/)).toBeInTheDocument();
  });
});
