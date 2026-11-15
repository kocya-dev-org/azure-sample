import type { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';

// app.http を何もしないスパイに差し替え、登録内容だけを検証する
const { http } = vi.hoisted(() => ({
  http: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock('@azure/functions', () => ({ app: { http } }));

import { goodbye } from './goodbye';

// テストごとにモックがクリアされるため、import 時の登録呼び出しを先に退避する
const registrations = [...http.mock.calls];

describe('goodbye', () => {
  it('GET /goodbye として登録される', () => {
    expect(registrations).toContainEqual([
      'goodbye',
      expect.objectContaining({ route: 'goodbye', methods: ['GET'], handler: goodbye }),
    ]);
  });

  it('goodbye メッセージを返す', async () => {
    const info = vi.fn<(...args: unknown[]) => void>();
    const request = {
      method: 'GET',
      url: 'http://localhost/api/goodbye?x=1',
    } as unknown as HttpRequest;
    const context = {
      invocationId: 'test-invocation',
      functionName: 'goodbye',
      info,
    } as unknown as InvocationContext;

    const result = await goodbye(request, context);

    expect(result).toEqual({ jsonBody: { message: 'goodbye' } });
    expect(info).toHaveBeenCalledTimes(2);
  });
});
