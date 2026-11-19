import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { mockFetch, PRODUCT } from './test/fetchMock';

// ダッシュボードは遅延読み込みのため、初回の変換（Recharts）で findBy が時間切れにならないよう先に読み込む
beforeAll(async () => {
  await import('./pages/Dashboard');
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('App', () => {
  it('/ でダッシュボードを開き、メニューを上から順に表示する', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'ダッシュボード' })).toBeInTheDocument();
    const links = within(screen.getByRole('navigation', { name: 'メニュー' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual(['ダッシュボード', '提案', 'バックログ', 'プロダクト情報']);
  });

  it('ヘッダーで選んだプロダクトを保存する', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    render(<App />);

    const select = await screen.findByRole('combobox', { name: 'プロダクト' });
    await screen.findByRole('option', { name: '製品A' });
    fireEvent.change(select, { target: { value: 'p1' } });

    expect(window.localStorage.getItem('flyingfish.selectedProductId')).toBe('p1');
  });

  it('メニューのリンクで画面を切り替える', async () => {
    mockFetch({ 'GET /api/products': [] });
    render(<App />);

    const menu = within(screen.getByRole('navigation', { name: 'メニュー' }));
    fireEvent.click(menu.getByRole('link', { name: 'プロダクト情報' }));

    expect(window.location.pathname).toBe('/products');
    expect(menu.getByRole('link', { name: 'プロダクト情報' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('ヘッダーのメニューでテーマを切り替える', async () => {
    mockFetch({ 'GET /api/products': [] });
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'テーマの切り替え' });
    // Radix の DropdownMenu はポインター操作で開く
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'ダーク' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('flyingfish.theme')).toBe('dark');
  });

  it('狭い画面ではメニューボタンからメニューを開いて移動できる', async () => {
    mockFetch({ 'GET /api/products': [] });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
    // jsdom はメディアクエリで隠したサイドバーも DOM に残すため、開いたシートの中に絞る
    const sheet = within(await screen.findByRole('dialog'));
    fireEvent.click(sheet.getByRole('link', { name: 'バックログ' }));

    expect(window.location.pathname).toBe('/backlogs');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
