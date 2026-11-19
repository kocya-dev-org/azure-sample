import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import {
  json,
  mockFetch,
  noContent,
  PRODUCT,
  selectProductInStorage,
  textStream,
} from '../test/fetchMock';

const proposal = (id: string, title: string) => ({
  id,
  productId: 'p1',
  title,
  body: `${title} の内容`,
  author: { userId: 'u1', name: 'user@example.com' },
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  rice: { reach: 100, impact: 1, confidence: 0.8, effort: 2, score: 40, rationale: 'r' },
  strategyFit: { score: 75, rationale: 'f' },
  status: 'open',
});

function openAt(path: string) {
  window.history.replaceState(null, '', path);
  render(<App />);
}

beforeEach(() => {
  window.localStorage.clear();
  selectProductInStorage('p1');
});

describe('提案一覧', () => {
  it('プロダクト未選択なら選択を促す', async () => {
    window.localStorage.clear();
    mockFetch({ 'GET /api/products': [PRODUCT] });
    openAt('/proposals');
    expect(await screen.findByText(/操作するプロダクトを選んでください/)).toBeInTheDocument();
  });

  it('提案をカードで表示し、一括削除は選択があるときだけ有効にする', async () => {
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [proposal('a1', '提案A'), proposal('a2', '提案B')],
    });
    openAt('/proposals');

    const list = await screen.findByRole('list', { name: '提案の一覧' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const first = within(cards[0]);
    expect(first.getByText('提案A')).toBeInTheDocument();
    expect(first.getByText('提案A の内容')).toBeInTheDocument();
    expect(first.getByText('user@example.com')).toBeInTheDocument();
    expect(first.getByText('40')).toBeInTheDocument();
    expect(first.getByText('75')).toBeInTheDocument();

    const remove = screen.getByRole('button', { name: '削除' });
    expect(remove).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '提案A を選択' }));
    expect(remove).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }));
    expect(screen.getByRole('checkbox', { name: '提案B を選択' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }));
    expect(remove).toBeDisabled();
  });

  it('カードの鉛筆アイコンでその提案の編集フォームに移る', async () => {
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [proposal('a1', '提案A'), proposal('a2', '提案B')],
      'GET /api/products/p1/proposals/a2': proposal('a2', '提案B'),
    });
    openAt('/proposals');

    fireEvent.click(await screen.findByRole('button', { name: '提案B を編集' }));
    expect(window.location.pathname).toBe('/proposals/a2/edit');
  });

  it('カードのゴミ箱アイコンで、確認後にその提案だけを削除する', async () => {
    const deletedA = vi.fn<() => Response>(() => noContent());
    const deletedB = vi.fn<() => Response>(() => noContent());
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [proposal('a1', '提案A'), proposal('a2', '提案B')],
      'DELETE /api/products/p1/proposals/a1': deletedA,
      'DELETE /api/products/p1/proposals/a2': deletedB,
    });
    openAt('/proposals');

    fireEvent.click(await screen.findByRole('button', { name: '提案B を削除' }));
    const dialog = await screen.findByRole('alertdialog', { name: '提案の削除' });
    expect(dialog).toHaveTextContent('「提案B」を削除します');
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }));

    await waitFor(() => expect(deletedB).toHaveBeenCalledOnce());
    expect(deletedA).not.toHaveBeenCalled();
  });

  it('本文は冒頭 50 文字だけを表示する', async () => {
    const long = { ...proposal('a1', '提案A'), body: `${'あ'.repeat(30)}\n${'い'.repeat(30)}` };
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [long],
    });
    openAt('/proposals');

    expect(await screen.findByText(`${'あ'.repeat(30)} ${'い'.repeat(19)}…`)).toBeInTheDocument();
  });

  it('選択した提案を確認後に削除する', async () => {
    const deleted = vi.fn<() => Response>(() => noContent());
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [proposal('a1', '提案A')],
      'DELETE /api/products/p1/proposals/a1': deleted,
    });
    openAt('/proposals');

    fireEvent.click(await screen.findByRole('checkbox', { name: '提案A を選択' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    const dialog = await screen.findByRole('alertdialog', { name: '提案の削除' });
    expect(dialog).toHaveTextContent('選択した 1 件の提案を削除します');
    expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }));

    await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
  });

  it('確認ダイアログでキャンセルすると削除しない', async () => {
    const deleted = vi.fn<() => Response>(() => noContent());
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [proposal('a1', '提案A')],
      'DELETE /api/products/p1/proposals/a1': deleted,
    });
    openAt('/proposals');

    fireEvent.click(await screen.findByRole('checkbox', { name: '提案A を選択' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    const dialog = await screen.findByRole('alertdialog', { name: '提案の削除' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleted).not.toHaveBeenCalled();
  });
});

describe('提案フォーム', () => {
  it('判定コメントをストリームで表示し、このまま送信できる', async () => {
    const created = vi.fn<(body: unknown) => Response>(() => json(proposal('a1', 'T'), 201));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [],
      'POST /api/products/p1/proposals/review': () =>
        textStream(['Reach: 対象ユーザー数が不明です。', '\n- 何社が利用しますか？']),
      'POST /api/products/p1/proposals': created,
    });
    openAt('/proposals/new');

    fireEvent.change(await screen.findByLabelText('タイトル'), { target: { value: 'CSV 出力' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '帳票を CSV で出したい' } });
    fireEvent.click(screen.getByRole('button', { name: '判定' }));

    await waitFor(() =>
      expect(screen.getByTestId('ai-comment')).toHaveTextContent(
        'Reach: 対象ユーザー数が不明です。 - 何社が利用しますか？',
      ),
    );
    expect(screen.getByLabelText('内容')).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'このまま送信' }));

    await waitFor(() => expect(window.location.pathname).toBe('/proposals'));
    expect(created).toHaveBeenCalledWith({ title: 'CSV 出力', body: '帳票を CSV で出したい' });
  });

  it('追記して再判定すると内容を編集できるようになる', async () => {
    const review = vi.fn<(body: unknown) => Response>(() => textStream(['コメント']));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/proposals/review': review,
    });
    openAt('/proposals/new');

    fireEvent.change(await screen.findByLabelText('タイトル'), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '判定' }));
    fireEvent.click(await screen.findByRole('button', { name: '追記して再判定' }));

    const body = screen.getByLabelText('内容');
    expect(body).not.toHaveAttribute('readonly');
    fireEvent.change(body, { target: { value: 'B\n対象は 50 社' } });
    fireEvent.click(screen.getByRole('button', { name: '判定' }));

    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(review).toHaveBeenLastCalledWith({ title: 'T', body: 'B\n対象は 50 社' });
  });

  it('編集では既存の内容を読み込み、更新として送信する', async () => {
    const updated = vi.fn<(body: unknown) => Response>(() => json(proposal('a1', 'T')));
    mockFetch({
      'GET /api/products': [PRODUCT],
      'GET /api/products/p1/proposals': [],
      'GET /api/products/p1/proposals/a1': proposal('a1', '既存の提案'),
      'POST /api/products/p1/proposals/review': () => textStream(['OK']),
      'PUT /api/products/p1/proposals/a1': updated,
    });
    openAt('/proposals/a1/edit');

    expect(await screen.findByDisplayValue('既存の提案')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '判定' }));
    fireEvent.click(await screen.findByRole('button', { name: 'このまま送信' }));

    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  });

  it('判定に失敗したらエラーを表示して入力に戻す', async () => {
    mockFetch({
      'GET /api/products': [PRODUCT],
      'POST /api/products/p1/proposals/review': () =>
        json({ error: '生成 AI による判定に失敗しました。' }, 502),
    });
    openAt('/proposals/new');

    fireEvent.change(await screen.findByLabelText('タイトル'), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: '判定' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '生成 AI による判定に失敗しました。',
    );
    expect(screen.getByRole('button', { name: '判定' })).toBeEnabled();
  });
});
