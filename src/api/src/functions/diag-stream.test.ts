import { describe, expect, it, vi } from 'vitest';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));

import type { HttpRequest } from '@azure/functions';
import { SSE_HEADERS, SSE_PADDING } from '../lib/sse';
import { createChunkStream, diagStream, sseChunks } from './diag-stream';

const requestWithQuery = (query: string) =>
  ({ query: new URLSearchParams(query) }) as unknown as HttpRequest;

describe('diagStream', () => {
  it('既定は text/plain、format=sse なら text/event-stream で返す', async () => {
    expect((await diagStream(requestWithQuery(''))).headers).toMatchObject({
      'content-type': 'text/plain; charset=utf-8',
    });
    expect((await diagStream(requestWithQuery('format=sse'))).headers).toEqual(SSE_HEADERS);
  });
});

describe('sseChunks', () => {
  it('行ごとに delta を送り、最初にパディング、最後に done を付ける', () => {
    expect(sseChunks(['a\n', 'b\n'])).toEqual([
      `${SSE_PADDING}event: delta\ndata: {"text":"a\\n"}\n\n`,
      'event: delta\ndata: {"text":"b\\n"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
  });
});

describe('createChunkStream', () => {
  it('チャンクを順番に返して閉じる', async () => {
    const reader = createChunkStream(['a', 'b', 'c'], 0).getReader();
    const decoder = new TextDecoder();
    const received: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(decoder.decode(value));
    }
    expect(received).toEqual(['a', 'b', 'c']);
  });
});
