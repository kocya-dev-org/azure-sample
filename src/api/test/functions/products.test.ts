import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({
  listProducts: vi.fn<() => Promise<unknown>>(),
  getProduct: vi.fn<() => Promise<unknown>>(),
  saveProduct: vi.fn<() => Promise<void>>(),
  deleteProductCascade: vi.fn<() => Promise<boolean>>(),
}));

import * as store from '../../src/lib/store';
import {
  createProductHandler,
  deleteProductHandler,
  parseProductInput,
  updateProductHandler,
} from '../../src/functions/products';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('parseProductInput', () => {
  it('名前と戦略は必須', () => {
    expect(parseProductInput({ name: '', strategy: 's' })).toBeTypeOf('string');
    expect(parseProductInput({ name: 'n' })).toBeTypeOf('string');
  });

  it('リポジトリは org/repo 形式だけを受け付ける', () => {
    expect(parseProductInput({ name: 'n', strategy: 's', repository: 'org/repo.js' })).toEqual({
      name: 'n',
      strategy: 's',
      repository: 'org/repo.js',
    });
    expect(parseProductInput({ name: 'n', strategy: 's', repository: '' })).toEqual({
      name: 'n',
      strategy: 's',
    });
    expect(
      parseProductInput({ name: 'n', strategy: 's', repository: 'https://github.com/a/b' }),
    ).toBeTypeOf('string');
    expect(parseProductInput({ name: 'n', strategy: 's', repository: '../x' })).toBeTypeOf(
      'string',
    );
  });
});

describe('createProductHandler', () => {
  it('プロダクトを作成して 201 を返す', async () => {
    const result = await createProductHandler(
      makeRequest({ body: { name: ' 製品 ', strategy: '戦略' } }),
      makeContext(),
    );
    expect(result.status).toBe(201);
    expect(result.jsonBody).toMatchObject({ name: '製品', strategy: '戦略' });
    expect(store.saveProduct).toHaveBeenCalledOnce();
  });

  it('保存に失敗したら固定メッセージで 500 を返す', async () => {
    vi.mocked(store.saveProduct).mockRejectedValue(new Error('AccountKey=secret'));
    const context = makeContext();
    const result = await createProductHandler(
      makeRequest({ body: { name: 'n', strategy: 's' } }),
      context,
    );
    expect(result).toEqual({
      status: 500,
      jsonBody: { error: 'プロダクトの登録に失敗しました。' },
    });
  });
});

describe('updateProductHandler', () => {
  it('存在しないプロダクトは 404', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    const result = await updateProductHandler(
      makeRequest({ params: { productId: 'p1' }, body: { name: 'n', strategy: 's' } }),
      makeContext(),
    );
    expect(result.status).toBe(404);
  });

  it('作成日時を引き継いで更新する', async () => {
    vi.mocked(store.getProduct).mockResolvedValue({
      id: 'p1',
      name: 'old',
      strategy: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await updateProductHandler(
      makeRequest({ params: { productId: 'p1' }, body: { name: 'n', strategy: 's' } }),
      makeContext(),
    );
    expect(result.jsonBody).toMatchObject({
      id: 'p1',
      name: 'n',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('deleteProductHandler', () => {
  it('紐づくデータごと削除して 204 を返す', async () => {
    vi.mocked(store.deleteProductCascade).mockResolvedValue(true);
    const result = await deleteProductHandler(
      makeRequest({ params: { productId: 'p1' } }),
      makeContext(),
    );
    expect(result.status).toBe(204);
    expect(store.deleteProductCascade).toHaveBeenCalledWith('p1');
  });
});
