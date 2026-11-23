import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest, PRINCIPAL } from '../helpers';

const read = vi.fn<() => Promise<{ resource?: unknown }>>();
const item = vi.fn<(id: string, partitionKey: string) => { read: typeof read }>(() => ({ read }));

vi.mock('../../src/lib/cosmos', () => ({
  getContainer: vi.fn<() => Promise<unknown>>(async () => ({ item })),
  isCosmosStatus: (error: unknown, code: number) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code,
}));

import {
  authorize,
  clearAuthCache,
  isAllowedUser,
  principalKey,
  withAuth,
} from '../../src/lib/auth';

beforeEach(() => {
  vi.clearAllMocks();
  read.mockReset();
  clearAuthCache();
});

describe('principalKey', () => {
  it('userDetails を小文字にして返す', () => {
    expect(
      principalKey(makeRequest({ principal: { userId: 'u', userDetails: ' User@Example.COM ' } })),
    ).toBe('user@example.com');
  });

  it('ヘッダーがない・userDetails がない・不正な場合は undefined', () => {
    expect(principalKey(makeRequest())).toBeUndefined();
    expect(principalKey(makeRequest({ principal: { userId: 'u' } }))).toBeUndefined();
    expect(
      principalKey(makeRequest({ headers: { 'x-ms-client-principal': 'not-base64-json' } })),
    ).toBeUndefined();
  });
});

describe('isAllowedUser', () => {
  it('users に登録されていれば許可し、照合結果をキャッシュする', async () => {
    read.mockResolvedValue({ resource: { id: 'user@example.com' } });
    expect(await isAllowedUser('user@example.com', 0)).toBe(true);
    expect(await isAllowedUser('user@example.com', 59_000)).toBe(true);
    expect(item).toHaveBeenCalledOnce();
    expect(item).toHaveBeenCalledWith('user@example.com', 'user@example.com');
  });

  it('キャッシュの期限が切れたら照合し直す', async () => {
    read.mockResolvedValueOnce({ resource: undefined }).mockResolvedValueOnce({ resource: {} });
    expect(await isAllowedUser('user@example.com', 0)).toBe(false);
    expect(await isAllowedUser('user@example.com', 61_000)).toBe(true);
  });

  it('404 は未登録として扱う', async () => {
    read.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
    expect(await isAllowedUser('user@example.com')).toBe(false);
  });

  it('それ以外のエラーは投げ、キャッシュしない', async () => {
    read.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 429 }));
    await expect(isAllowedUser('user@example.com')).rejects.toThrow('busy');
    read.mockResolvedValueOnce({ resource: {} });
    expect(await isAllowedUser('user@example.com')).toBe(true);
  });
});

describe('authorize / withAuth', () => {
  const inner = vi.fn<() => Promise<{ status: number }>>(async () => ({ status: 200 }));

  it('登録済みの利用者はハンドラーを呼ぶ（大文字・小文字は区別しない）', async () => {
    read.mockResolvedValue({ resource: {} });
    const result = await withAuth(inner)(
      makeRequest({ principal: { ...PRINCIPAL, userDetails: 'USER@example.com' } }),
      makeContext(),
    );
    expect(result).toEqual({ status: 200 });
    expect(item).toHaveBeenCalledWith('user@example.com', 'user@example.com');
  });

  it('未登録の利用者は 403 を返し、ハンドラーを呼ばない', async () => {
    read.mockResolvedValue({ resource: undefined });
    const result = await withAuth(inner)(makeRequest({ principal: PRINCIPAL }), makeContext());
    expect(result).toMatchObject({ status: 403 });
    expect(inner).not.toHaveBeenCalled();
  });

  it('匿名の要求は照合せずに 403 を返す', async () => {
    expect(await authorize(makeRequest(), makeContext())).toMatchObject({ status: 403 });
    expect(item).not.toHaveBeenCalled();
  });

  it('照合に失敗したら記録して 503 を返す（利用は許可しない）', async () => {
    read.mockRejectedValue(new Error('down'));
    const context = makeContext();
    const result = await withAuth(inner)(makeRequest({ principal: PRINCIPAL }), context);
    expect(result).toMatchObject({ status: 503 });
    expect(context.error).toHaveBeenCalledOnce();
    expect(inner).not.toHaveBeenCalled();
  });
});
