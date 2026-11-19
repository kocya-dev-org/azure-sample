import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../../test/helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../lib/store', () => ({ getProduct: vi.fn<() => Promise<unknown>>() }));
vi.mock('../lib/foundry', () => ({ streamText: vi.fn<() => AsyncGenerator<string>>() }));

import { streamText } from '../lib/foundry';
import * as store from '../lib/store';
import { SSE_PADDING } from '../lib/sse';
import { reviewProposalHandler, STREAM_ERROR_MESSAGE } from './review';

const product = {
  id: 'p1',
  name: '製品',
  strategy: '戦略',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

/** パディングを除いた SSE の本文を、{ event, data } の列に分解する。 */
function parseEvents(text: string): { event: string; data: unknown }[] {
  expect(text.startsWith(SSE_PADDING)).toBe(true);
  return text
    .slice(SSE_PADDING.length)
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine.replace(/^event: /, ''),
        data: JSON.parse(dataLine.replace(/^data: /, '')) as unknown,
      };
    });
}

const request = () =>
  makeRequest({ params: { productId: 'p1' }, body: { title: 'タイトル', body: '内容' } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('reviewProposalHandler', () => {
  it('AI のコメントを差分ごとに delta イベントで返し、done で終える', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield 'Reach: ';
      yield '不足\n- 質問';
    });

    const result = await reviewProposalHandler(request(), makeContext());

    expect(result.headers).toMatchObject({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    });
    expect(parseEvents(await readAll(result.body as ReadableStream<Uint8Array>))).toEqual([
      { event: 'delta', data: { text: 'Reach: ' } },
      { event: 'delta', data: { text: '不足\n- 質問' } },
      { event: 'done', data: {} },
    ]);
  });

  it('最初の応答前に失敗したら 502 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield* [];
      throw new Error('401 invalid api key');
    });

    const result = await reviewProposalHandler(request(), makeContext());

    expect(result).toEqual({
      status: 502,
      jsonBody: { error: '生成 AI による判定に失敗しました。' },
    });
  });

  it('コメントが空なら 502 を返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield* [];
    });

    const result = await reviewProposalHandler(request(), makeContext());

    expect(result.status).toBe(502);
  });

  it('途中で失敗したら error イベントを送って終える', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield '途中まで';
      throw new Error('timeout');
    });
    const context = makeContext();

    const result = await reviewProposalHandler(request(), context);
    const events = parseEvents(await readAll(result.body as ReadableStream<Uint8Array>));

    expect(events).toEqual([
      { event: 'delta', data: { text: '途中まで' } },
      { event: 'error', data: { message: STREAM_ERROR_MESSAGE } },
    ]);
    expect(context.error).toHaveBeenCalledOnce();
  });

  it('プロダクトがなければ 404、入力が不正なら 400', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(undefined);
    expect((await reviewProposalHandler(request(), makeContext())).status).toBe(404);
    expect(
      (
        await reviewProposalHandler(
          makeRequest({ params: { productId: 'p1' }, body: { title: '' } }),
          makeContext(),
        )
      ).status,
    ).toBe(400);
  });
});
