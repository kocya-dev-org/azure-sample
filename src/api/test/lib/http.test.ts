import type { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { getPrincipal, logError, readString } from '../../src/lib/http';
import { generatedName } from '../../src/lib/person';

function requestWithHeader(value?: string): HttpRequest {
  return {
    headers: new Headers(value === undefined ? {} : { 'x-ms-client-principal': value }),
  } as unknown as HttpRequest;
}

describe('getPrincipal', () => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');

  it('name クレームがなければ、メールアドレスではなく userId から生成した名前を使う', () => {
    const header = encode({ userId: 'u1', userDetails: 'user@example.com' });
    expect(getPrincipal(requestWithHeader(header))).toEqual({
      userId: 'u1',
      name: generatedName('u1'),
    });
  });

  it('name クレームがあればそれを表示名にする', () => {
    const header = encode({
      userId: 'u1',
      userDetails: 'user@example.com',
      claims: [{ typ: 'name', val: '山田 太郎' }],
    });
    expect(getPrincipal(requestWithHeader(header))).toEqual({ userId: 'u1', name: '山田 太郎' });
  });

  it('ヘッダーがない・不正な場合は匿名にする', () => {
    expect(getPrincipal(requestWithHeader())).toEqual({ userId: 'anonymous', name: '不明' });
    expect(getPrincipal(requestWithHeader('!!!'))).toEqual({ userId: 'anonymous', name: '不明' });
  });
});

describe('logError', () => {
  it('エラーオブジェクトの一部だけを記録する', () => {
    const error = vi.fn<(...args: unknown[]) => void>();
    const sdkError = Object.assign(new Error('failed'), {
      code: 401,
      request: { headers: { authorization: 'Bearer secret-token' } },
    });
    logError({ error } as unknown as InvocationContext, '失敗', sdkError);
    expect(error).toHaveBeenCalledWith('失敗', { name: 'Error', message: 'failed', code: 401 });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-token');
  });
});

describe('readString', () => {
  it('前後の空白を除き、空や長すぎる値を拒否する', () => {
    expect(readString({ a: '  x  ' }, 'a', 10)).toBe('x');
    expect(readString({ a: '   ' }, 'a', 10)).toBeUndefined();
    expect(readString({ a: 'abc' }, 'a', 2)).toBeUndefined();
    expect(readString({ a: 1 }, 'a', 10)).toBeUndefined();
  });
});
