import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest, PRINCIPAL } from '../helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../../src/lib/store', () => ({ getProduct: vi.fn<() => Promise<unknown>>() }));

import * as store from '../../src/lib/store';
import {
  createVoiceSessionHandler,
  MAX_CONVERSATION_SECONDS,
} from '../../src/functions/voiceSessions';

const SECRET = 'ticket-secret';
const product = {
  id: 'p1',
  name: '製品',
  strategy: '中小企業の業務効率化',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function decode(ticket: string): Record<string, unknown> {
  const [body, signature] = ticket.split('.');
  expect(createHmac('sha256', SECRET).update(body).digest('base64url')).toBe(signature);
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const request = (body?: unknown) =>
  makeRequest({ params: { productId: 'p1' }, body, principal: PRINCIPAL });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('REALTIME_RELAY_URL', 'https://relay.example.net/');
  vi.stubEnv('REALTIME_TICKET_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createVoiceSessionHandler', () => {
  it('指示文とツールを入れて署名したチケットを返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);

    const result = await createVoiceSessionHandler(
      request({ title: 'CSV 出力', body: '<指示> 帳票を CSV で出したい' }),
      makeContext(),
    );

    const body = result.jsonBody as Record<string, unknown>;
    expect(body.relayUrl).toBe('https://relay.example.net');
    expect(body.maxSeconds).toBe(MAX_CONVERSATION_SECONDS);
    const payload = decode(body.ticket as string);
    expect(payload).toMatchObject({ v: 1, productId: 'p1', userId: 'user-1', maxSeconds: 300 });
    expect(payload.instructions).toContain('中小企業の業務効率化');
    expect(payload.instructions).toContain('＜指示＞ 帳票を CSV で出したい');
    expect(payload.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'record_proposal_info' }),
    ]);
  });

  it('本文がなくても始められる', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    const result = await createVoiceSessionHandler(request(), makeContext());
    expect(result.status).toBeUndefined();
  });

  it('中継の設定がなければ 503 を返す', async () => {
    vi.stubEnv('REALTIME_TICKET_SECRET', '');
    const result = await createVoiceSessionHandler(request({}), makeContext());
    expect(result.status).toBe(503);
  });

  it('長すぎる内容は 400 を返す', async () => {
    const result = await createVoiceSessionHandler(
      request({ body: 'あ'.repeat(8001) }),
      makeContext(),
    );
    expect(result.status).toBe(400);
  });

  it('プロダクトがなければ 404 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    const result = await createVoiceSessionHandler(request({}), makeContext());
    expect(result.status).toBe(404);
  });
});
