import { describe, expect, it } from 'vitest';
import { SSE_HEADERS, sseEvent } from './sse';

describe('sseEvent', () => {
  it('改行を含むテキストでも data を 1 行の JSON にする', () => {
    expect(sseEvent('delta', { text: '1 行目\n2 行目' })).toBe(
      'event: delta\ndata: {"text":"1 行目\\n2 行目"}\n\n',
    );
  });
});

describe('SSE_HEADERS', () => {
  it('Content-Type は charset を付けない text/event-stream ちょうどにする', () => {
    expect(SSE_HEADERS).toEqual({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
  });
});
