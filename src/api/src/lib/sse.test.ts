import { describe, expect, it } from 'vitest';
import { SSE_HEADERS, SSE_PADDING, sseEvent } from './sse';

describe('sseEvent', () => {
  it('改行を含むテキストでも data を 1 行の JSON にする', () => {
    expect(sseEvent('delta', { text: '1 行目\n2 行目' })).toBe(
      'event: delta\ndata: {"text":"1 行目\\n2 行目"}\n\n',
    );
  });
});

describe('SSE_PADDING', () => {
  it('コメント行として送り、空行で区切る', () => {
    expect(SSE_PADDING.startsWith(': ')).toBe(true);
    expect(SSE_PADDING.endsWith('\n\n')).toBe(true);
    expect(SSE_PADDING.length).toBeGreaterThanOrEqual(2048);
  });
});

describe('SSE_HEADERS', () => {
  it('text/event-stream を返し、変換をさせない', () => {
    expect(SSE_HEADERS['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(SSE_HEADERS['cache-control']).toContain('no-transform');
  });
});
