import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductProvider } from '@/context/ProductContext';
import { RouterProvider } from '@/router';
import { json, mockFetch, noContent, PRODUCT } from '../fetchMock';
import { ProductsPage } from '@/pages/Products';

function renderPage() {
  return render(
    <RouterProvider>
      <ProductProvider>
        <ProductsPage />
      </ProductProvider>
    </RouterProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('ProductsPage', () => {
  it('新規登録ダイアログでプロダクトを登録する', async () => {
    const created = vi.fn<(body: unknown) => Response>(() => json(PRODUCT, 201));
    mockFetch({ 'GET /api/products': [], 'POST /api/products': created });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '新規登録' }));
    const dialog = screen.getByRole('dialog', { name: 'プロダクトの新規登録' });
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: '製品A' } });
    fireEvent.change(screen.getByLabelText('戦略'), { target: { value: '戦略' } });
    fireEvent.change(screen.getByLabelText('リポジトリ（任意）'), {
      target: { value: 'org/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(created).toHaveBeenCalledWith({
      name: '製品A',
      strategy: '戦略',
      repository: 'org/repo',
    });
  });

  it('リポジトリの形式が不正なら送信しない', async () => {
    const created = vi.fn<(body: unknown) => Response>(() => json(PRODUCT, 201));
    mockFetch({ 'GET /api/products': [], 'POST /api/products': created });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('名前'), { target: { value: 'n' } });
    fireEvent.change(screen.getByLabelText('戦略'), { target: { value: 's' } });
    fireEvent.change(screen.getByLabelText('リポジトリ（任意）'), {
      target: { value: 'https://github.com/org/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('org/repository の形式');
    expect(created).not.toHaveBeenCalled();
  });

  it('一覧の行を選ぶと編集ダイアログが開き、確認後に削除できる', async () => {
    const deleted = vi.fn<() => Response>(() => noContent());
    mockFetch({ 'GET /api/products': [PRODUCT], 'DELETE /api/products/p1': deleted });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '製品A' }));
    expect(screen.getByRole('dialog', { name: 'プロダクトの編集' })).toBeInTheDocument();
    expect(screen.getByLabelText('名前')).toHaveValue('製品A');
    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    const confirmDialog = await screen.findByRole('alertdialog', { name: 'プロダクトの削除' });
    expect(confirmDialog).toHaveTextContent('すべて削除されます');
    expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '削除' }));

    await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
  });
});
