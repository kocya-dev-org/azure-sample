import { describe, expect, it, vi } from 'vitest';

vi.mock('@azure/functions', () => ({ app: { http: vi.fn<(...args: unknown[]) => void>() } }));

import type { HttpRequest } from '@azure/functions';
import { Readable } from 'node:stream';
import { LEGACY_SSE_HEADERS, SSE_HEADERS } from '../lib/sse';
import {
  diagChunks,
  diagHeaders,
  diagStream,
  padding,
  parseDiagOptions,
  type DiagOptions,
} from './diag-stream';

const options = (query: string) => parseDiagOptions(new URLSearchParams(query));
const request = (query: string) =>
  ({ query: new URLSearchParams(query) }) as unknown as HttpRequest;

async function collect(chunks: AsyncGenerator<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const value of chunks) result.push(value);
  return result;
}

async function readBody(body: unknown): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  if (body instanceof Readable) {
    for await (const value of body) text += decoder.decode(value as Buffer, { stream: true });
    return text;
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

describe('parseDiagOptions', () => {
  it('既定は text/plain・パディングなし・1 秒ごとに 5 件', () => {
    expect(options('')).toEqual({
      format: 'plain',
      pad: 0,
      count: 5,
      interval: 1000,
      impl: 'web',
      identity: false,
      legacy: false,
    });
    expect(options('format=sse').pad).toBe(2048);
  });

  it('クエリの値を読み、範囲外や不正な値は既定値にする', () => {
    expect(options('format=sse&pad=65536&count=50&interval=100&impl=node&identity=1')).toEqual({
      format: 'sse',
      pad: 65536,
      count: 50,
      interval: 100,
      impl: 'node',
      identity: true,
      legacy: false,
    });
    expect(options('pad=99999&count=0&interval=abc')).toMatchObject({
      pad: 0,
      count: 5,
      interval: 1000,
    });
  });
});

describe('padding', () => {
  it('指定したバイト数のパディングを作る', () => {
    expect(padding('sse', 16384)).toHaveLength(16384);
    expect(padding('sse', 16384).startsWith(': ')).toBe(true);
    expect(padding('sse', 16384).endsWith('\n\n')).toBe(true);
    expect(padding('plain', 100)).toHaveLength(100);
    expect(padding('plain', 0)).toBe('');
  });
});

describe('diagChunks', () => {
  const noWait = () => Promise.resolve();

  it('最初のチャンクにパディングを付け、SSE なら最後に done を送る', async () => {
    const opts: DiagOptions = { ...options('format=sse&pad=100'), count: 2 };
    const chunks = await collect(diagChunks(opts, noWait, () => 0));

    expect(chunks).toHaveLength(3);
    expect(chunks[0].startsWith(padding('sse', 100))).toBe(true);
    expect(chunks[0]).toContain('event: delta');
    expect(chunks[1]).toContain('2 件目');
    expect(chunks[2]).toBe('event: done\ndata: {}\n\n');
  });

  it('plain では件数どおりの行を返す', async () => {
    const chunks = await collect(diagChunks(options('count=3'), noWait, () => 0));
    expect(chunks).toEqual([
      '1 件目（サーバー 0 ms）\n',
      '2 件目（サーバー 0 ms）\n',
      '3 件目（サーバー 0 ms）\n',
    ]);
  });
});

describe('diagStream', () => {
  it('format と identity に応じたヘッダーを返す', () => {
    expect(diagHeaders(options(''))).toMatchObject({ 'content-type': 'text/plain; charset=utf-8' });
    expect(diagHeaders(options('format=sse'))).toEqual(SSE_HEADERS);
    expect(diagHeaders(options('format=sse&legacy=1'))).toEqual(LEGACY_SSE_HEADERS);
    expect(diagHeaders(options('format=sse&identity=1'))).toEqual({
      ...SSE_HEADERS,
      'content-encoding': 'identity',
    });
  });

  it('impl=web でも impl=node でも同じ本文を返す', async () => {
    const web = await diagStream(request('count=2&interval=100'));
    const node = await diagStream(request('count=2&interval=100&impl=node'));

    expect(web.body).toBeInstanceOf(ReadableStream);
    expect(node.body).toBeInstanceOf(Readable);
    const strip = (text: string) => text.replace(/サーバー \d+ ms/g, 'サーバー x ms');
    expect(strip(await readBody(node.body))).toBe(strip(await readBody(web.body)));
  });
});
