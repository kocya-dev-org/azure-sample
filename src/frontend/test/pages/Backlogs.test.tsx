import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { json, mockFetch, PRODUCT, selectProductInStorage } from '../fetchMock';
import { tokyoDate } from '@/pages/Backlogs';

const backlog = {
  id: 'b1',
  productId: 'p1',
  from: '2026-11-01',
  to: '2026-11-15',
  createdAt: '2026-11-16T00:00:00.000Z',
  createdBy: { userId: 'u1', name: 'ユーザー-1a2b3c4d' },
  items: [{ scoredItemId: 'a1', rank: 1, title: '提案A', riceScore: 40, strategyFitScore: 75 }],
};

const detail = {
  ...backlog,
  githubEnabled: false,
  hasRepository: true,
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

  it('GitHub 連携が未設定なら Issue 起票ボタンを無効にして理由を表示する', async () => {
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs/b1': detail,
    });
    openAt('/backlogs/b1');

    expect(await screen.findByText(/GitHub 連携が未設定/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue 起票' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Issue 状態を更新' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '提案A を選択' })).toBeDisabled();
  });

  it('Issue 状態を更新すると、完了で閉じられた項目を実装済みにする', async () => {
    const synced = vi.fn<(body: unknown) => Response>(() =>
      json({ checked: 1, updated: [{ id: 'a1', doneAt: '2026-11-18T00:00:00Z' }], failed: 0 }),
    );
    const issue = { number: 12, url: 'https://github.com/org/repo/issues/12', createdAt: 'x' };
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs/b1': {
        ...detail,
        githubEnabled: true,
        items: [{ ...detail.items[0], issue }],
      },
      'POST /api/products/p1/issues/sync': synced,
    });
    openAt('/backlogs/b1');

    const select = await screen.findByRole('combobox', { name: '提案A の実装状況' });
    expect(select).toHaveValue('open');
    fireEvent.click(screen.getByRole('button', { name: 'Issue 状態を更新' }));

    await waitFor(() => expect(select).toHaveValue('done'));
    expect(synced).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('1 件を実装済みにしました');
  });

  it('選択した項目を Issue として起票し、リンクを表示する', async () => {
    const issued = vi.fn<(body: unknown) => Response>(() =>
      json({
        results: [
          {
            itemId: 'a1',
            result: 'created',
            issue: { number: 12, url: 'https://github.com/org/repo/issues/12', createdAt: 'x' },
          },
        ],
      }),
    );
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/backlogs/b1': { ...detail, githubEnabled: true },
      'POST /api/products/p1/issues': issued,
    });
    openAt('/backlogs/b1');

    const button = await screen.findByRole('button', { name: 'Issue 起票' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '提案A を選択' }));
    fireEvent.click(button);

    expect(await screen.findByRole('link', { name: '#12' })).toHaveAttribute(
      'href',
      'https://github.com/org/repo/issues/12',
    );
    expect(issued).toHaveBeenCalledWith({ itemIds: ['a1'] });
    expect(screen.getByRole('status')).toHaveTextContent('起票 1 件');
    expect(screen.getByRole('checkbox', { name: '提案A を選択' })).toBeDisabled();
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
