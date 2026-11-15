import { describe, expect, it, vi } from 'vitest';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));

import { createChunkStream } from './diag-stream';

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
