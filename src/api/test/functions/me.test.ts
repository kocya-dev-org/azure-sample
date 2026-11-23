import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest, PRINCIPAL } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/auth', () => ({
  checkUser: vi.fn<() => Promise<string>>(),
}));

import * as auth from '../../src/lib/auth';
import { meHandler } from '../../src/functions/me';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('meHandler', () => {
  it('許可されているかと表示名を返す（メールアドレスは返さない）', async () => {
    vi.mocked(auth.checkUser).mockResolvedValue('authorized');
    const result = await meHandler(makeRequest({ principal: PRINCIPAL }), makeContext());
    expect(result.jsonBody).toEqual({
      authorized: true,
      name: expect.stringMatching(/^ユーザー-/),
    });
    expect(JSON.stringify(result.jsonBody)).not.toContain('@');
  });

  it('未登録の利用者には authorized: false を返す', async () => {
    vi.mocked(auth.checkUser).mockResolvedValue('unauthorized');
    const result = await meHandler(makeRequest({ principal: PRINCIPAL }), makeContext());
    expect(result.jsonBody).toMatchObject({ authorized: false });
  });

  it('照合に失敗したら 503 を返す', async () => {
    vi.mocked(auth.checkUser).mockRejectedValue(new Error('down'));
    const context = makeContext();
    const result = await meHandler(makeRequest({ principal: PRINCIPAL }), context);
    expect(result.status).toBe(503);
    expect(context.error).toHaveBeenCalledOnce();
  });
});
