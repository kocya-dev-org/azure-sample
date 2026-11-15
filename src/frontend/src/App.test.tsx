import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { mockFetch, PRODUCT } from './test/fetchMock';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('App', () => {
  it('/ を提案一覧にリダイレクトし、メニューを上から順に表示する', async () => {
    mockFetch({ 'GET /api/products': [PRODUCT] });
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/proposals'));
    const links = within(screen.getByRole('navigation', { name: 'メニュー' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual(['提案', 'バックログ', 'プロダクト情報']);
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
});
