import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext, makeRequest } from '../../test/helpers';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));
vi.mock('../lib/store', () => ({ getProduct: vi.fn<() => Promise<unknown>>() }));
vi.mock('../lib/foundry', () => ({ streamText: vi.fn<() => AsyncGenerator<string>>() }));

import { streamText } from '../lib/foundry';
import * as store from '../lib/store';
import { reviewProposalHandler, STREAM_ERROR_MARKER } from './review';

const product = {
  id: 'p1',
  name: '製品',
  strategy: '戦略',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(decoder.decode(value));
  }
}

const request = () =>
  makeRequest({ params: { productId: 'p1' }, body: { title: 'タイトル', body: '内容' } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('reviewProposalHandler', () => {
  it('AI のコメントをチャンクごとに返す', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield 'Reach: ';
      yield '不足';
    });

    const result = await reviewProposalHandler(request(), makeContext());

    expect(result.headers).toMatchObject({ 'content-type': 'text/plain; charset=utf-8' });
    expect(await readAll(result.body as ReadableStream<Uint8Array>)).toEqual(['Reach: ', '不足']);
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

  it('途中で失敗したら固定の文言を付けて終える', async () => {
    vi.mocked(store.getProduct).mockResolvedValue(product);
    vi.mocked(streamText).mockImplementation(async function* () {
      yield '途中まで';
      throw new Error('timeout');
    });
    const context = makeContext();

    const result = await reviewProposalHandler(request(), context);
    const chunks = await readAll(result.body as ReadableStream<Uint8Array>);

    expect(chunks).toEqual(['途中まで', STREAM_ERROR_MARKER]);
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
