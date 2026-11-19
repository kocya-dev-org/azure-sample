import { describe, expect, it } from 'vitest';
import { rawStream } from '../test/fetchMock';
import { readEvents, type SseEvent } from './sse';

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readEvents(rawStream(chunks).body!)) events.push(event);
  return events;
}

describe('readEvents', () => {
  it('コメント行を無視し、event と JSON の data を読む', async () => {
    expect(
      await collect([
        ': padding\n\nevent: delta\ndata: {"text":"a\\nb"}\n\nevent: done\ndata: {}\n\n',
      ]),
    ).toEqual([
      { event: 'delta', data: { text: 'a\nb' } },
      { event: 'done', data: {} },
    ]);
  });

  it('チャンクの境目がイベントや文字の途中にあってもつなげて読む', async () => {
    const text = 'event: delta\ndata: {"text":"日本語"}\r\n\r\nevent: done\ndata: {}\n\n';
    const bytes = new TextEncoder().encode(text);
    // UTF-8 の 1 文字の途中も含め、1 バイトずつに分けて送る
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    for await (const event of readEvents(stream)) events.push(event);

    expect(events).toEqual([
      { event: 'delta', data: { text: '日本語' } },
      { event: 'done', data: {} },
    ]);
  });

  it('\\r\\n がチャンクの境目で分かれても、1 つの改行として扱う', async () => {
    expect(
      await collect([
        'event: delta\r',
        '\ndata: {"text":"a"}\r',
        '\n\r',
        '\nevent: done\ndata: {}\n\n',
      ]),
    ).toEqual([
      { event: 'delta', data: { text: 'a' } },
      { event: 'done', data: {} },
    ]);
  });

  it('最後の空行がなくても、終わりに残ったイベントを返す', async () => {
    expect(await collect(['event: done\ndata: {}'])).toEqual([{ event: 'done', data: {} }]);
  });
});
