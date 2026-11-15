import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { json, mockFetch, PRODUCT, selectProductInStorage } from '../test/fetchMock';
import { tokyoDate } from './Backlogs';

const backlog = {
  id: 'b1',
  productId: 'p1',
  from: '2026-11-01',
  to: '2026-11-15',
  createdAt: '2026-11-16T00:00:00.000Z',
  createdBy: { userId: 'u1', name: 'user@example.com' },
  items: [{ scoredItemId: 'a1', rank: 1, title: '提案A', riceScore: 40, strategyFitScore: 75 }],
};

const detail = {
  ...backlog,
  items: [
    {
      ...backlog.items[0],
      deleted: false,
      status: 'open',
      issue: null,
      rice: {
        reach: 100,
        impact: 1,
        confidence: 0.8,
        effort: 2,
        score: 40,
        rationale: 'RICE の根拠',
      },
      strategyFit: { score: 75, rationale: '戦略の根拠' },
    },
  ],
};

function openAt(path: string) {
  window.history.replaceState(null, '', path);
  render(<App />);
}

beforeEach(() => {
  window.localStorage.clear();
  selectProductInStorage('p1');
});

describe('tokyoDate', () => {
  it('日本時間の日付を返す', () => {
    expect(tokyoDate(new Date('2026-11-15T16:00:00.000Z'))).toBe('2026-11-16');
  });
});

describe('バックログ', () => {
  it('作成ダイアログで期間を指定して作成し、詳細画面に移る', async () => {
    const created = vi.fn<(body: unknown) => Response>(() => json(backlog, 201));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs': [],
      'POST /api/products/p1/backlogs': created,
      'GET /api/products/p1/backlogs/b1': detail,
    });
    openAt('/backlogs');

    fireEvent.click(await screen.findByRole('button', { name: '作成' }));
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-11-15' } });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'バックログの作成' })).getByRole('button', {
        name: '作成',
      }),
    );

    await waitFor(() => expect(window.location.pathname).toBe('/backlogs/b1'));
    expect(created).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-15' });
    expect(await screen.findByText('提案A')).toBeInTheDocument();
  });

  it('一覧の行をクリックすると詳細に移り、根拠を展開できる', async () => {
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs': [backlog],
      'GET /api/products/p1/backlogs/b1': detail,
    });
    openAt('/backlogs');

    fireEvent.click(await screen.findByRole('button', { name: '2026-11-01 〜 2026-11-15' }));
    expect(window.location.pathname).toBe('/backlogs/b1');

    fireEvent.click(await screen.findByRole('button', { name: '表示' }));
    expect(screen.getByText(/RICE の根拠/)).toBeInTheDocument();
    expect(screen.getByText('戦略の根拠')).toBeInTheDocument();
  });

  it('詳細画面で実装状況を変更できる', async () => {
    const patched = vi.fn<(body: unknown) => Response>(() =>
      json({ id: 'a1', status: 'done', doneAt: '2026-11-16T00:00:00.000Z' }),
    );
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs/b1': detail,
      'PATCH /api/products/p1/items/a1': patched,
    });
    openAt('/backlogs/b1');

    const select = await screen.findByRole('combobox', { name: '提案A の実装状況' });
    expect(select).toHaveValue('open');
    fireEvent.change(select, { target: { value: 'done' } });

    await waitFor(() => expect(select).toHaveValue('done'));
    expect(patched).toHaveBeenCalledWith({ status: 'done' });
  });

  it('開始日が終了日より後なら作成しない', async () => {
    const created = vi.fn<(body: unknown) => Response>(() => json(backlog, 201));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs': [],
      'POST /api/products/p1/backlogs': created,
    });
    openAt('/backlogs');

    fireEvent.click(await screen.findByRole('button', { name: '作成' }));
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-11-15' } });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'バックログの作成' })).getByRole('button', {
        name: '作成',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('開始日は終了日以前');
    expect(created).not.toHaveBeenCalled();
  });
});
